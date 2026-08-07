# Migration to API-backed Better Intent

This release replaces client-side route and quote calculation with the Better Intent middleware.
High-level operation names remain, but intent results, hooks, events, balances, supported-chain
metadata, and exact-input parameters use one normalized API-backed model.

## Client setup

Client creation is unchanged:

```ts
const client = createNexusClient({ network: 'mainnet' });
await client.initialize();
await client.setEVMProvider(provider);
```

`mainnet` and `canary` support Better Intent against mainnet chains. `testnet` retains standalone
execute only.

The old `domain` option and Safe-specific configuration were removed.

## Removed APIs

Remove calls and imports for:

- `calculateMaxForSwap`
- `calculateMaxForBridge`
- Safe clients/constants/types
- ephemeral-key configuration/types
- local route/quote/aggregator types
- old feature-specific bridge/swap progress types

Use `getBalancesForSwap()` or `getBalancesForBridge()` to populate source selection, then review the
server quote through `hooks.onIntent`.

## Hook shape

Before, bridge and swap hooks exposed different locally built intent models. They now receive the
same `IntentHookData`:

```ts
hooks: {
  onIntent({ quote, allow, deny, refresh }) {
    renderReview(quote);
    allow();
  },
}
```

`refresh(sources?)` returns a complete replacement `IntentQuote`.

Composite methods now also place `onIntent` under `options.hooks`:

```ts
await client.swapAndExecute(params, {
  hooks: { onIntent: ({ allow }) => allow() },
  beforeExecute,
});
```

Bridge allowance hooks receive `allowances`, not source intent objects:

```ts
onAllowance({ allowances, allow }) {
  allow(allowances.map(() => 'min'));
}
```

## Events

Replace `BridgeEvent`, `SwapEvent`, plan-preview, and plan-progress handling with `IntentEvent`:

```ts
onEvent(event) {
  if (event.type === 'quote') renderPlan(event.quote.plan);
  if (event.type === 'step') renderStep(event.step, event.state);
  if (event.type === 'status') renderStatus(event.status, event.substatus);
}
```

Canonical step types are `erc20_approval`, `intent_signature`, `native_transaction`,
`intent_submission`, and `intent_fulfillment`.

## Results

Bridge, transfer, and swap now return `IntentResult` (their stable result names are aliases):

```ts
const {
  intentId,
  intentExplorerUrl,
  quote,
  status,
  approvals,
  nativeTransactions,
} = await client.bridge(params);
```

Replace reads of `sourceTxs`, `sourceSwaps`, and `destinationSwap` with the normalized quote inputs,
output, and transaction arrays.

The operation resolves only at `fulfilled`; expiry and timeout reject.

## Exact-input swap

Every exact-input source now requires its raw amount:

```ts
await client.swapWithExactIn({
  sources: [
    { chainId: 1, tokenAddress: ethereumUsdc, amountRaw: 5_000_000n },
  ],
  toChainId: 8453,
  toTokenAddress: baseUsdc,
});
```

There is no SDK-side source inference for exact-input.

## Balances

Both balance methods return chain-level `IntentBalance[]`:

```ts
type IntentBalance = {
  chainId: number;
  tokenAddress: `0x${string}`;
  symbol: string;
  decimals: number;
  balanceRaw: bigint;
  valueUsd: number | null;
  usable: boolean;
  // token metadata and provider support omitted
};
```

Group balances in the application if the UI needs a symbol-level portfolio view. The browser
example includes such an adapter while preserving its existing design.

## Supported chains

`getSupportedChains()` returns merged intent and execute metadata. Replace `swapSupported` checks
with explicit capabilities:

```ts
chain.capabilities.intent;
chain.capabilities.execute;
```

Catalog tokens use `address`, not the deployment-only `contractAddress` field.

## Simulation

- `simulateBridge` and `simulateBridgeAndTransfer` return `IntentQuote`.
- `simulateBridgeAndExecute` returns `{ intentQuote, executeSimulation }`.
- standalone `simulateExecute` is unchanged in purpose.

## Execution ownership

Applications no longer receive or execute local source-swap/destination-swap routes. The SDK
executes only the wallet actions instructed by the approved Better Intent quote, submits the intent,
waits for fulfillment, and then runs an optional composite destination transaction.

See [README](README.md) for complete examples.
