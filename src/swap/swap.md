# Swap flow

This document describes the current swap architecture. The implementation and tests remain the
authority when this document and code disagree.

## Core account model

Safe V2 is the only account that executes aggregator swaps. A bridge route with no source swaps uses
the connected EOA as its source holder and signer, matching the normal bridge flow. A chain's
`swapSupported` deployment flag controls whether the chain can participate in routing; it does not
select an execution mode.

For a connected EOA and the SDK ephemeral account, the SDK predicts one deterministic Safe address:

- owners: `[EOA, ephemeral]`
- threshold: `1`
- version: Safe 1.4.1 / V2 account contract set
- salt: `SAFE_V2_SALT_NONCE`

The address is the same on every chain with the canonical Safe contracts. Both owners can authorize
a Safe transaction, but normal sponsored execution is signed by the ephemeral owner. The connected
EOA still provides user-facing permits, direct approvals when a token cannot be permitted, and native
value for payable Safe transactions.

The ephemeral address is not an execution wallet. On routes that require source swaps, it remains
relevant as:

- a Safe owner and SafeTx signer;
- the signing identity for bridge intents and token permits;
- the remote source-chain bridge settlement holder, where required by the bridge protocol.

## Public flow

The public client exposes:

- `swapWithExactIn({ sources?, toChainId, toTokenAddress })`
- `swapWithExactOut({ sources?, toChainId, toTokenAddress, toAmountRaw, toNativeAmountRaw? })`
- `swapAndExecute(...)`
- `calculateMaxForSwap(...)`

Public amounts are raw `bigint` values. Plans and results may also contain human-readable strings.
The `onIntent` hook gates execution and can refresh source selection before approval.

The high-level flow is:

```text
buildSwapPreflight
  -> determineSwapRoute
  -> createSwapIntent + createSwapPlan
  -> start allowance, permit-capability, and Safe-code cache reads
  -> await onIntent approval
  -> ensure missing Safes on every Safe execution chain
  -> prepareSwapExecution (await the accepted route's cache)
  -> executeSwapRoute
       -> source swaps or direct-destination swap
       -> bridge deposits and fill
       -> destination swap
       -> failure cleanup when needed
  -> finalize result
```

Cache warming starts immediately before the intent is exposed to `onIntent`, so its read-only RPC
work overlaps the user's review time. It includes one bytecode lookup for the derived Safe on each
Safe execution chain. Bridge source chains without source swaps do not require this lookup. A refreshed intent
reuses the existing warmup when its query data is unchanged; a changed query set starts a new
warmup. Wallet signatures, approvals, and transactions remain gated behind intent acceptance.

## Deployment-before-wallet-prompt invariant

Immediately after intent approval, `startSafeDeploymentsForChains` starts one idempotent
`ensureSafeForEphemeral` promise for every chain that may execute through the Safe:

- every source execution chain;
- every bridge deposit chain that also requires a source swap;
- the destination chain when a destination token or gas swap exists.

After the shared cache warmup resolves, every chain reads its cached deployment state. Already
deployed Safes skip middleware; missing Safes are ensured concurrently. Their promises are stored by
chain ID and reused for the rest of the operation.

Before the SDK asks for a permit, direct approval, chain switch, or transaction on a chain, it awaits
that chain's deployment promise. Execution also awaits the same promise before dispatch. This order
is mandatory: a wallet must observe deployed code at the Safe spender address before showing an
approval prompt. Otherwise wallets commonly warn that the approval targets an EOA or undeployed
address, defeating the safety benefit of the Safe path.

The flow derives the Safe address once before preflight and uses it for routing, cache checks,
preparation, and execution. If cached bytecode is absent, the ephemeral owner signs the V2 ensure
authorization and middleware deploys the Safe through the canonical factory. A successful ensure
marks that chain deployed in the same cache, so later execution and cleanup reuse the result without
another bytecode lookup.

## Routing identities

All aggregator taker/executor addresses are the predicted Safe.

Source swap receivers depend on what happens next:

- destination-chain source with no destination swap: output goes directly to the EOA;
- remote source whose output must bridge: output goes to the ephemeral bridge holder;
- destination-chain source followed by a destination swap: output remains at the Safe.

Bridge fill receivers are:

- EOA when the destination needs no token or gas swap;
- predicted Safe when destination execution is required.

Destination swaps always execute from the Safe and deliver requested token/native output to the EOA.

For a bridge route without source swaps, each source remains in the EOA. The EOA signs the RFF, its
address is the RFF party, and ERC-20 allowance targets the chain's vault. No EOA-to-ephemeral transfer
or source-chain Safe deployment is prepared. Nexus and Mayan use the normal bridge
allowance/executor path; Mayan ERC-20 collection remains middleware-sponsored, while native deposits
are sent by the EOA. The bridge fills the destination Safe if a destination swap follows and the EOA
otherwise.

## Route families

`determineSwapRoute` selects among these shapes:

- direct destination: existing destination-chain assets swap directly to the requested output;
- same-token bridge: the same asset crosses chains without a COT conversion;
- COT route: source assets convert to the selected common output token, bridge, then optionally swap
  on the destination;
- destination-local fast paths: destination balances satisfy part or all of the requested output or
  native gas requirement.

Exact In maximizes destination output from the selected raw input. Exact Out selects enough source
value to satisfy a fixed destination amount and optional native-gas amount, including configured
buffers and bridge fees. Its destination buffer is the smaller of 5% or $1. When the requested
token is already the destination COT and only native gas needs a swap, that buffer applies only to
the gas-swap input; the requested COT amount remains exact. Its source buffer depends on the rough
selected source prefix: zero when every source already matches the selected settlement token, the
smaller of 0.5% or $0.25 for stable-only conversions, and the smaller of 2% or $1 when any
non-stable conversion is required. Provider selection happens only for route-relevant remote value;
direct destination routes do not request a bridge provider.

An Exact Out same-token bridge can include a positive native-gas requirement in the bridge intent.
Routing accounts for that gas in the selected source amount, omits a destination gas swap, and sets
the bridge receiver to the EOA.

EOA-funded bridge routing includes provider-specific vault collection fees. Exact In deducts those fees
from delivery; Exact Out adds them to the selected EOA debit while keeping the requested output
exact. The public swap intent shape is unchanged.

For general COT routes, the SDK deterministically chooses between USDC and USDT before requesting
aggregator quotes. Each source that is not already the candidate costs one leg, and a
candidate different from the requested output costs one destination leg. Destination-chain holdings
already equal to the Exact-In output are excluded. Exact In scores all selected holdings; priced
Exact Out (including `swapAndExecute`) scores its rough eligible prefix but requires the candidate on
every usable source chain. ETH remains available to the same-token bridge path but is not a general
settlement candidate. Equal scores keep the current COT; an unavailable bridge quote fails routing.

Mixed Exact-In routes leave destination-chain holdings already denominated in the requested token
untouched. That identity output is included in `onIntent`, `assetsUsed`, and `calculateMaxForSwap`,
but creates no plan step or transaction. Max-amount haircuts apply only to the routed portion.

## Preparation

`prepareSwapExecution` uses the Safe derived at flow start as the owner/spender for every swap quote.
The pre-intent cache batches only the reads still needed by Safe execution:

- ERC-20 allowances;
- token permit support and version;
- Safe deployment bytecode on each execution chain.

For ERC-20 value held by the EOA, preparation builds a deterministic transfer authorization:

- permit when supported;
- direct ERC-20 approval otherwise.

The Safe consumes the authorization with `transferFrom`. Source and destination funding moves into
the Safe. Bridge funding after a source swap may send from the EOA to the ephemeral bridge holder
while the Safe remains the spender. Bridge routes without source swaps skip this preparation and use
the bridge allowance service to authorize the vault from the EOA.

Native input does not use an allowance. It is carried by the outer EOA transaction that calls the
Safe.

## Safe dispatch

Safe calls use one of two dispatch forms:

### Sponsored token-only execution

When a batch carries no native value:

1. read the Safe nonce;
2. build one `CALL` or a `MultiSendCallOnly` delegatecall;
3. sign the SafeTx with the ephemeral owner;
4. send the V2 request to `createSafeExecuteTx` middleware;
5. await the returned transaction receipt where the stage requires confirmation.

### EOA-submitted native execution

When a batch carries native value:

1. build and sign the same SafeTx;
2. encode `Safe.execTransaction` as the EOA transaction calldata;
3. simulate that exact EOA transaction;
4. await Safe deployment for the chain;
5. emit the wallet-prompt event, switch chains, and send the transaction.

For a single call, the inner call value must equal the outer native value. For MultiSend, the sum of
inner values must equal the outer native value. The SDK rejects mismatches before prompting.

## Stage behavior

### Source swaps

Each chain groups its source legs into one Safe batch. ERC-20 legs prepend prepared funding and
aggregator allowance calls as needed. Native legs are EOA-submitted Safe transactions. Failed source
execution may trigger a bounded requote when the failure is known to be safe to retry.

### Bridge deposits

For composed routes, Nexus ERC-20 deposits execute funding, ephemeral-to-vault permit, and deposit
calls through the Safe. Mayan ERC-20 funding and permit calls also execute through the Safe, and
native deposits are EOA-submitted Safe transactions. Bridge routes without source swaps reuse normal
bridge execution instead: the EOA authorizes the vault, owns and signs the RFF, and sends any native
vault deposit directly. The bridge intent is signed and submitted only after required allowance work.

### Destination swaps

Destination token and gas swaps execute through `Safe.execTransaction`. Exact In first resizes the
quote against the measured settlement balance. Exact Out keeps its original maximum-input bound.
Output goes directly to the EOA; leftover settlement tokens are transferred to the EOA from the Safe.

## Cleanup and refunds

Cleanup never falls back to another execution account:

- balances held by the Safe transfer directly from the Safe;
- remote COT or refund tokens held by the ephemeral account are pulled by the Safe with a signed
  permit and `transferFrom`;
- native value held by the Safe can be returned through a Safe call;
- native value held only by the separate ephemeral account cannot be pulled by the Safe and is
  intentionally skipped.

As a temporary migration exception, the one-shot initialization refund sweep also checks the
legacy single-owner V1 Safe. It reads bridge-family ERC-20 and native balances for the ephemeral,
V1 Safe, and V2 Safe in one multicall per chain, and dispatches only a positive V1 Safe balance
through the legacy Safe middleware endpoint. Active swaps and failure cleanup remain V2-only.

User callbacks are emitted through the non-blocking progress pattern and cannot break cleanup or the
main flow.

## Concurrency and retries

The connected browser wallet is a single mutable chain context. The SDK serializes every operation
that can switch chains, prompt the wallet, request a user signature, write an approval, or send an EOA
transaction.

Safe deployments, quotes, public-client reads, sponsored Safe requests, and receipt waits may run in
parallel. Deployment promises start concurrently but are awaited per chain at the wallet boundary.

Retries are deliberately narrow:

- transient permit-preparation RPC errors may retry up to three total attempts;
- user rejection and direct approval failures are terminal;
- ambiguous middleware submission failures are not replayed;
- a safely retryable source swap is re-quoted across the route's aggregators, excluding the failed
  router only from its original aggregator, and uses the quote with the highest output;
- destination requotes remain bounded by their original route constraints.

## Key invariants

- `WalletPath` has one value: `'safe'`.
- No swap call is executed from the EOA or ephemeral account directly.
- The EOA only submits a swap transaction when native value must enter the Safe.
- The Safe is deployed before any approval or permit prompt that names it as spender.
- Bridge sources without source swaps name the vault as spender and do not require a source-chain
  Safe or ephemeral custody.
- `swapSupported` gates routing availability, not execution mode.
- Remote bridge custody at the ephemeral address does not make it an execution wallet.
- Native gas reserve is deducted before source selection; the SDK never consumes 100% of native
  balance when later gas is required.
- External responses are normalized before business logic consumes them.
- Public and on-chain amounts stay in raw integer units until an explicit display conversion.

## Tests

The main coverage lives under:

- `tests/swap/safe/` for prediction, signatures, V2 wire contracts, and middleware clients;
- `tests/swap/execution/` for Safe source, bridge, destination, direct-destination, and cleanup calls;
- `tests/swap/characterization/` for complete route call ordering and failure behavior;
- `tests/flows/characterization/` for composite lifecycle behavior;
- `tests/public-api.test.ts` and `tests/types/` for exported surface guardrails.

Any execution-path change should run source and test typechecks, the full test suite, lint, dependency
direction checks, and the production build.
