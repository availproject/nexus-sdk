# Services Explainer

This document exists to make `src/services` easier to reason about for both human developers and LLMs.

The goal is not to restate every line of code. The goal is to explain the intent, boundaries, and non-obvious behavior of the service layer, especially where chain-specific fee logic or synthetic estimation is involved.

Only files that are not straightforward get full explanations below. For the simpler files, this document records what they do and intentionally stops there.

## Service Files

- `depositFeeEstimation.ts`
  Uses a representative synthetic deposit transaction to estimate source-chain native fee requirements for deposit-like flows. Explained below.
- `executeTransactions.ts`
  Sends approval + execute transactions, prefers `wallet_sendCalls` atomic batching when supported, and falls back to sequential sends when it is not. No extra explanation needed.
- `feeEstimation.ts`
  Shared fee estimation engine for chain-aware gas pricing and fee overhead handling. Explained below.
- `gasFeeHistory.ts`
  Reads fee history from the client and turns it into low/medium/high EIP-1559 recommendations. No extra explanation needed.
- `walletCapabilities.ts`
  Small helper that checks whether a wallet reports atomic batch support for a set of chain IDs. No extra explanation needed.

## Files With Detailed Explanations

- `feeEstimation.ts`
- `depositFeeEstimation.ts`

## `feeEstimation.ts`

### What this file is for

`feeEstimation.ts` is the shared internal fee engine for any flow that already knows the transaction shape and either already has a gas estimate or can obtain one separately.

Its job is to answer:

- what fee model should be used for this chain
- what gas-price recommendation should be used for the selected speed tier
- whether the chain has an extra fee component beyond plain L2 execution gas
- what gas and fee values should actually be recommended back to the caller

This file is intentionally chain-aware. The SDK cannot treat all EVM chains the same because OP Stack chains, Scroll-style oracles, and Arbitrum do not expose fee overheads in the same way.

### Mental model

The file splits fee work into two stages:

1. `estimateFeeContext(...)`
   Fetches chain-specific pricing context in parallel.
   This means:
   - gas-price recommendations from `gasFeeHistory.ts`
   - per-transaction chain overheads from the relevant fee strategy

2. `finalizeFeeEstimates(...)`
   Pure function that combines:
   - resolved transaction gas estimates
   - the pricing context from step 1
   - chain-specific buffer rules

This split exists so callers can do their own `Promise.all(...)` with gas estimation. In practice that means gas estimation does not need to block fee-history or L1-overhead work.

### Supported fee models

The core switch is `CHAIN_FEE_MODEL`.

- `OP_STACK`
  Uses the canonical L1 fee oracle and stores the result as a direct `l1Fee`.
- `OP_STACK_SCROLL`
  Uses Scroll's oracle address but follows the same shape as the OP Stack path: a direct `l1Fee`.
- `ARBITRUM`
  Uses `gasEstimateL1Component(...)` from the node interface. This does not come back as a direct ETH-denominated `l1Fee` in the current model. Instead, it returns L1 posting cost as gas units, which this file stores in `extraGas`.
- `DEFAULT`
  No special chain overhead handling. Only normal gas pricing applies.

### Why `FeeOverhead` has both `l1Fee` and `extraGas`

This is the most important internal shape in the file.

It exists because not all chains expose their extra fee component the same way.

- On OP Stack style chains, the extra cost is naturally represented as a separate `l1Fee`.
- On Arbitrum, the extra cost is surfaced as extra gas units through `gasEstimateL1Component(...)`.

That is why `FeeOverhead` looks like this:

- `l1Fee`
  Extra fee already represented as a fee amount.
- `extraGas`
  Extra fee represented as gas units that must be added to the transaction gas before pricing.

This is not just a naming detail. It changes how the final recommendation is built.

### Arbitrum behavior

Arbitrum is the main reason this file exists.

For Arbitrum:

- `extraGas` is populated from `gasEstimateL1Component(...)[0]`
- `l1Fee` remains `0`
- final gas for pricing becomes `item.gasEstimate + extraGas`

That means Arbitrum's L1 posting cost is folded into the gas budget before pricing rather than attached as a separate `l1Fee`.

The `gasEstimateKind` field exists mainly to prevent double counting here:

- `raw`
  Means the provided gas estimate does not yet include Arbitrum's L1 component, so `extraGas` should be added.
- `final`
  Means the provided gas estimate is already final enough that Arbitrum's extra gas must not be added again.

If this distinction is wrong, Arbitrum fees will be wrong in one of two bad ways:

- too low because the L1 posting component was missed
- too high because the L1 component was added twice

### Buffering

The file applies chain-specific buffers through `BUFFER_CONFIGS`.

Those buffers affect:

- gas estimate
- gas price
- OP-style `l1Fee`

These are not intended to be precise market predictions. They are conservative operational buffers so the wallet is less likely to underfund a transaction between estimation and actual submission.

### Output shape

The final output is `FeeEstimate`.

Important parts:

- `l1Fee`
  Unbuffered chain overhead represented directly as fee.
- `l2Fee`
  Execution fee using total gas and selected gas price.
- `total`
  `l1Fee + l2Fee`
- `recommended`
  Wallet-oriented values:
  - `gasLimit`
  - `maxFeePerGas`
  - `maxPriorityFeePerGas`
  - `totalMaxCost`
  - `useLegacyPricing`

The caller should usually use `recommended.*` for transaction submission and `total` for user-facing fee math.

### What this file is not for

This file is not responsible for:

- obtaining the actual transaction gas estimate for every caller
- deciding which transactions belong in a composite flow
- building representative synthetic transactions for balance heuristics
- sending the transaction

Those concerns belong elsewhere.

## `depositFeeEstimation.ts`

### What this file is for

`depositFeeEstimation.ts` exists because some parts of the SDK need a conservative estimate of the native fee required for a future deposit transaction before the final deposit transaction has actually been assembled.

The main use case is usable-balance deduction for native assets. In that scenario, the SDK wants to avoid showing the full native balance as spendable when a deposit transaction still needs gas on the source chain.

### Why this file cannot be exact

At the point where this service is used, the SDK usually does not yet know the final deposit payload in full detail.

That means it may be missing things like:

- the final set of sources
- the exact request payload
- the final signature bytes
- final per-chain transaction context

So this file does not try to be exact. It tries to be:

- chain-aware
- internally consistent with the rest of the fee engine
- conservative enough to avoid overstating usable native balance

### How it works

The file builds a representative synthetic `deposit(...)` call with:

- a vault address
- a synthetic recipient
- synthetic sources and destinations
- a representative signature blob
- a small non-zero value

The number of sources is controlled by `sourceCount`, because calldata size and deposit complexity grow with the number of sources.

That representative transaction is then priced in two layers:

1. Estimate gas for the representative deposit call.
2. Reuse `feeEstimation.ts` to price that gas under the source chain's actual fee model.

This is important. Even though the transaction is synthetic, the pricing path is real:

- OP-style chains still go through `getL1Fee(...)`
- Arbitrum still goes through `gasEstimateL1Component(...)`
- default chains still use standard gas pricing

### Why there is an internal fallback gas value

`estimateGas(...)` can fail here. One common reason is that representative or RFF-style deposit estimation may happen when the account does not have enough native balance for the node to simulate the call successfully.

Because this service is used for balance deduction, failing closed is better than failing open.

So if `estimateGas(...)` fails, the service falls back to `DEFAULT_REPRESENTATIVE_DEPOSIT_GAS`.

Right now that value is intentionally conservative.

### Why there are two buffers

This file applies two distinct buffers:

1. `feeMultiplier`
   External caller-controlled multiplier. This lets higher-level balance logic stay conservative.

2. `syntheticBufferMultiplier`
   Internal buffer that exists because the representative deposit transaction is intentionally smaller and simpler than many real deposit transactions.

The second buffer is important. Without it, the representative estimate would often look more precise than it really is.

### Expected usage

This service is appropriate when the question is:

- how much native balance should be treated as reserved for a likely deposit transaction
- what is a conservative source-chain fee estimate for a future deposit

This service is not appropriate when the question is:

- what exact fee will the final assembled deposit transaction cost right now

For exact final transaction pricing, the caller should estimate the real transaction directly and then use `feeEstimation.ts` on that real transaction.

### Limitations

The main limitations are intentional:

- synthetic request, not final request
- synthetic signature, not final signature
- `sourceCount` is only a hint
- fallback gas may overestimate meaningfully on some chains

That tradeoff is acceptable for usable-balance deduction, where modest overestimation is safer than underestimating the amount of native token that must be reserved.
