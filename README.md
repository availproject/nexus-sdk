# `@avail-project/nexus-core`

Headless TypeScript SDK for API-routed cross-chain intents and EVM contract execution.

The Better Intent middleware owns asset discovery, route selection, provider selection, fees, and
quotes. The SDK owns validation, wallet approvals, permit and intent signatures, required source transactions,
intent submission, fulfillment polling, and optional destination contract execution.

## Install

```bash
npm install @avail-project/nexus-core
```

The package requires an EIP-1193 Ethereum provider and supports EVM wallets through viem.

## Initialize a client

```ts
import { createNexusClient } from '@avail-project/nexus-core';

const client = createNexusClient({ clientId: 'your-app-name', network: 'mainnet' });

await client.initialize();
await client.setEVMProvider(window.ethereum);
```

`clientId` is required and must be a non-empty, stable identifier for your application.
The SDK sends it as `x-nexus-client-id`, along with `x-nexus-surface: nexus-sdk`,
on every Better Intent middleware request.

Create a new client after the connected account or provider changes. Call `destroy()` when the
client is no longer used.

Supported built-in network names are:

- `mainnet` — Better Intent enabled against mainnet chains
- `canary` — Better Intent enabled against mainnet chains
- `testnet` — standalone execute support only; intent operations reject with
  `ENVIRONMENT_NOT_SUPPORTED`

A custom `NetworkConfig` can also provide middleware and explorer URLs plus a network hint.

The middleware can route an intent through `nexus-v2`, `mayan`, or `relay`. It selects the provider
per quote, and `IntentQuote.provider`, `IntentStatus.provider`, and every catalog entry name the
provider that applies. Treat the `IntentProvider` union as open to growth: render an unknown provider
generically rather than assuming Nexus or Mayan.

Set `forceMayan: true` to restrict the supported intent catalog and balances to Mayan and prefer
Mayan for quotes. The SDK loads chain metadata from `/chains` and all pages from `/tokens`,
joining tokens to chains by chain ID. Token selection uses chain IDs and contract addresses.

## Intent lifecycle

Swap methods use one server-driven lifecycle:

1. The SDK asks the middleware for a quote.
2. `hooks.onIntent` may review, refresh, allow, or deny it.
3. The SDK signs quoted EIP-712 permits for sponsored approvals, or sends quoted ERC-20 approval
   transactions when required. Wallet prompts run one at a time; each broadcast starts its receipt
   check while the SDK proceeds to the next approval prompt.
4. After all required approvals confirm, the SDK checks quote expiry again and the wallet signs the
   intent with `personal_sign`.
5. The SDK sends quoted native source transactions, if any.
6. The SDK submits the intent and approval signatures in the middleware's `signatures[]` envelope.
7. The SDK polls until the intent is `fulfilled`.

The returned promise rejects when a user denies a required action, a quote expires, fulfillment
times out, or a wallet/middleware operation fails. It never resolves with an incomplete intent.

If no hooks are supplied, the quote is accepted automatically and allowances use their minimum
required values.

## Exact-output swap

Swaps also handle same-asset cross-chain moves: select the asset's contract address on each chain.


```ts
const result = await client.swapWithExactOut(
  {
    toChainId: 8453,
    toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    toAmountRaw: 10_000_000n,
    sources: [
      {
        chainId: 1,
        tokenAddress: '0xA0b86991c6218b36c1d19d4a2e9eb0cE3606eB48',
      },
    ],
  },
  {
    hooks: {
      onIntent({ quote, allow }) {
        console.log(`Provider: ${quote.provider}`);
        allow();
      },
    },
  },
);
```

Omit `sources` to let the middleware choose from usable balances.

## Exact-input swap

Exact-input is explicit: every source includes its token and raw amount.

```ts
const result = await client.swapWithExactIn({
  sources: [
    {
      chainId: 1,
      tokenAddress: '0xA0b86991c6218b36c1d19d4a2e9eb0cE3606eB48',
      amountRaw: 5_000_000n,
    },
    {
      chainId: 42161,
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amountRaw: 5_000_000n,
    },
  ],
  toChainId: 8453,
  toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
});
```

## Quote refresh

`refresh()` requests a complete replacement quote. An optional `IntentSource[]` can replace the
selected sources before approval.

```ts
hooks: {
  async onIntent({ quote, refresh, allow }) {
    let current = quote;
    if (shouldChangeSources) {
      current = await refresh([
        { chainId: 42161, tokenAddress: arbitrumUsdc },
      ]);
    }
    renderQuote(current);
    allow();
  },
}
```

Once allowed, the executable quote is fixed.

## Events

All intent operations emit the same `IntentEvent` union:

```ts
const onEvent = (event: IntentEvent) => {
  switch (event.type) {
    case 'quote':
      console.log(event.quote.plan.steps);
      break;
    case 'step':
      console.log(
        event.step.id,
        event.step.type,
        event.state,
        event.committed,
        event.errorDetails,
      );
      break;
    case 'status':
      console.log(event.intentId, event.status, event.substatus, event.legs);
      break;
  }
};
```

Canonical plan step types are:

- `erc20_approval`
- `source_approval_signature`
- `intent_signature`
- `native_transaction`
- `intent_submission`
- `intent_fulfillment`

Step states are `started`, `completed`, or `failed`. Lifecycle statuses are `created`, `deposited`,
`fulfilled`, and `expired`. Status events also expose one normalized leg per source, including its
`sourceIndex`, lifecycle status, transaction links, and provider error when available. Callback
failures are isolated and do not break the operation.

Step events include `committed`, which follows the intent commitment boundary: an ERC-20 intent is
committed after its intent signature succeeds, while a native-token source is committed when the
wallet submits its deposit transaction. Failed steps expose a structured `errorDetails` object with
the SDK category, code, service, step context, and middleware details when available. The legacy
`error` message remains available for backwards compatibility.

## Results and quotes

`IntentResult` contains:

```ts
type IntentResult = {
  intentId: `0x${string}`;
  intentExplorerUrl: string;
  quote: IntentQuote;
  status: IntentStatusResponse;
  approvals: IntentTransaction[];
  nativeTransactions: IntentTransaction[];
};
```

`status.legs` contains the final per-source status snapshot returned by the middleware. This lets an
app distinguish an overall intent stage from the progress or failure of an individual source leg.

`IntentQuote` exposes normalized inputs, output, minimum output, fees, allowances, expiry, provider,
trade type, and the canonical execution plan. Raw RFF payloads, signing payload internals, ABIs, and
submit serialization stay private to the transport layer.

`SwapResult` is an alias of `IntentResult`.

## Balances and catalog

`getBalancesForSwap()` returns normalized `IntentBalance[]` holdings from Better Intent:

```ts
const balances = await client.getBalancesForSwap();
```

Each `IntentBalance` includes chain/token identity, raw balance, decimals, optional USD value,
provider support, price source, and a `usable` flag.

```ts
const chains = client.getSupportedChains();

for (const chain of chains) {
  console.log(chain.id, chain.capabilities.intent, chain.capabilities.execute);
}
```

The returned list merges the Better Intent catalog with deployment metadata used by standalone
execute. Token addresses and decimals are chain-specific; never infer decimals from a symbol.

Token `asSource` and `asDestination` arrays describe general provider support. A listed token does
not guarantee a route exists; the quote request determines whether the selected swap is supported.
`getSupportedChainsForRoute()` forwards route constraints to `/chains`, so its chain-level support
is constrained. Its tokens remain the provider-filtered catalog from `/tokens`.

```ts
const destinationOptions = await client.getSupportedChainsForRoute({
  sources: [{ chainId: 10, tokenAddress: optimismUsdc, amountRaw: 1_000_000n }],
});
```

Use `valueUsd`, source `amountRaw` values, or destination `amountRaw` values as one sizing mode per
request. Quote results expose `sourceVerdicts`; quote failures can be inspected without parsing
messages using `getIntentQuoteFailure(error)`.
The helper also exposes structured balance, approval-gas, price, and routing failures through its
`subcode`, `details`, and `errorId` fields.

Tokens expose optional `permit` and `sponsoredApproval` metadata for discovery. The quote determines
which approvals actually need permits. `IntentAllowance.authorizationType` and plan steps describe
the required action; `IntentResult.approvals` contains only approval transactions submitted by the
user. A denied permit signature stops execution.

Provider `currencyId` values may be numbers or strings. Balance `priceSource` values include
`oracle`, `indexer`, `coingecko`, `relay`, or `null`. Quote fees expose `depositRaw`, `fulfillmentRaw`,
`protocolRaw`, and `solverRaw`; the removed middleware `caGas` fee is no longer exposed as `caGasRaw`.

## Execute

Standalone execute remains local wallet/contract execution:

```ts
const result = await client.execute({
  toChainId: 8453,
  to: contract,
  data,
  value: 0n,
  tokenApproval: {
    toTokenSymbol: 'USDC',
    amount: 10_000_000n,
    spender: contract,
  },
});

const simulation = await client.simulateExecute({
  toChainId: 8453,
  to: contract,
  data,
});
```

Public inputs and on-chain calls use raw `bigint` units.

## Intent plus execute

`swapAndExecute` inspects destination balances and estimated execution gas, requests only the
shortfall through Better Intent, waits for fulfillment, then executes the destination transaction.

```ts
const result = await client.swapAndExecute(
  {
    toChainId: 8453,
    toTokenAddress: baseUsdc,
    toAmountRaw: 10_000_000n,
    execute: {
      to: lendingPool,
      data: supplyCalldata,
      tokenApproval: {
        toTokenAddress: baseUsdc,
        amount: 10_000_000n,
        spender: lendingPool,
      },
    },
  },
  {
    hooks: { onIntent: ({ allow }) => allow() },
    beforeExecute: async () => ({ data: refreshedCalldata }),
  },
);
```

The result indicates whether funding was skipped and includes the final execute transaction.

## History

```ts
const history = await client.listIntents({
  page: 1,
  status: 'fulfilled',
});
```

History merges Nexus and external-provider Better Intent records, newest first.

## Options

Intent operation options support:

```ts
type IntentOperationOptions = {
  onEvent?: (event: IntentEvent) => void;
  hooks?: {
    onIntent?: (data: IntentHookData) => void | Promise<void>;
  };
  slippageBps?: number | 'auto'; // default: 50
  fillTimeoutMinutes?: number;   // default: 2
  pollingIntervalMs?: number;    // default: 2000
};
```

Swap operations expose `onIntent` and use minimum required ERC-20 approvals. `swapAndExecute`
options add `beforeExecute`.

Set `forceMayan: true` when creating the client to request Mayan as the preferred provider.

## Errors

All SDK errors extend `NexusError` and expose:

- `category`
- `code`
- `context`
- optional `details`

Use subclasses such as `ValidationError`, `UserActionError`, `ExecutionError`, and `BackendError`
for broad handling, and stable `ERROR_CODES` for specific cases.

If an approval fails or a later approval prompt is rejected, the SDK finishes receipt checks for
all approvals already broadcast before rejecting. `error.details.approvals` lists their `chainId`,
`tokenAddress`, `spender`, `txHash`, `txExplorerUrl`, and `state` (`confirmed`, `reverted`, or
`unconfirmed`). An RPC failure or timeout leaves a transaction `unconfirmed`; it may still confirm.
The SDK checks the known hash again if receipt waiting fails, but does not automatically resend
transactions or reopen rejected prompts. Check unconfirmed hashes before retrying. Start a new swap
with a fresh quote to account for allowances that already confirmed.

```ts
try {
  await client.swapWithExactOut(params);
} catch (error) {
  if (error instanceof UserActionError) {
    // Quote, approval, signature, or transaction was denied.
  }
}
```

## Migration from bridge APIs

This is a breaking release. The SDK no longer exposes `bridge`, `bridgeAndTransfer`,
`bridgeAndExecute`, their simulation methods, `getBalancesForBridge`, bridge/transfer parameter
and result types, or bridge/transfer analytics events. The bridge-only `onAllowance` hook and its
selection types are also removed.

Use `swapWithExactOut` or `swapWithExactIn` for same-asset or cross-asset intents, `swapAndExecute`
for destination contract calls, and `getBalancesForSwap` for holdings. Identify tokens by chain ID
and contract address rather than symbol. There is no replacement recipient override or standalone
swap simulation method; review quotes through `onIntent`.

## Migration from the local router

This SDK no longer exposes or runs:

- `calculateMaxForSwap` or `calculateMaxForBridge`
- client-side route and quote calculation
- aggregator-specific public route types
- Safe-specific clients/configuration
- ephemeral-key configuration or execution
- old bridge/swap plan-progress event unions

Use balance selection plus a reviewed `IntentQuote`; the middleware is the source of truth for the
executable route and fees.

## Development

```bash
npm run typecheck
npm run typecheck:tests
npm run test
npm run lint
npm run lint:deps
npm run build
```

See [Architecture](docs/ARCHITECTURE.md), [Conventions](docs/CONVENTIONS.md), and the preserved
[browser example](example/browser).
