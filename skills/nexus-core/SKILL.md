---
name: nexus-core
description: Integrate or migrate applications using @avail-project/nexus-core API-backed Better Intent operations. Use for client lifecycle, bridge/swap/execute calls, normalized quote review hooks, intent events/results, balances/catalogs, composite funding, network behavior, and migration away from local routing, max helpers, Safe, or ephemeral-key APIs.
---

# Nexus Core integration

Use the server quote as the source of truth. Do not reconstruct routes, fees, provider selection, or
maximum amounts in application code.

## Initialize

```ts
import { createNexusClient } from '@avail-project/nexus-core';

const client = createNexusClient({ network: 'mainnet' });
await client.initialize();
await client.setEVMProvider(provider);
```

Recreate the client after provider/account changes and call `destroy()` on the old instance.

Use `mainnet` or `canary` for Better Intent on mainnet chains. Treat `testnet` as standalone-execute
only. Use `forceMayan: true` only when the application must prefer Mayan.

## Review quotes

Place intent hooks under `options.hooks` for bridge, swap, and composite methods:

```ts
const options = {
  hooks: {
    onIntent({ quote, allow, deny, refresh }) {
      renderQuote(quote);
      allow();
    },
  },
};
```

Call `refresh(sources?)` before approval to request a complete replacement quote. Use the returned
quote to refresh the UI. Do not merge old and new quote fields.

Omit the hook to auto-allow.

For bridge allowances:

```ts
hooks: {
  onAllowance({ allowances, allow }) {
    allow(allowances.map(() => 'min'));
  },
}
```

Accept `min`, `max`, raw `bigint`, or raw integer string selections. Prefer `min` unless the product
explicitly asks for another allowance policy.

## Bridge

Use symbol plus destination chain. Source selection is by chain ID and remains same-asset:

```ts
const result = await client.bridge(
  {
    toChainId: 8453,
    toTokenSymbol: 'USDC',
    toAmountRaw: 10_000_000n,
    sources: [1, 42161],
    recipient,
    toNativeAmountRaw: 0n,
  },
  options,
);
```

Use `bridgeAndTransfer` when `recipient` is required by the product flow. Use `simulateBridge` for an
API quote without wallet execution.

## Swap

For exact output, provide the destination raw amount. Omit `sources` for server selection or provide
chain/token filters:

```ts
await client.swapWithExactOut(
  {
    toChainId: 8453,
    toTokenAddress: baseUsdc,
    toAmountRaw: 10_000_000n,
    sources: [{ chainId: 1, tokenAddress: ethereumUsdc }],
  },
  options,
);
```

For exact input, provide every raw source amount explicitly:

```ts
await client.swapWithExactIn(
  {
    sources: [
      { chainId: 1, tokenAddress: ethereumUsdc, amountRaw: 5_000_000n },
      { chainId: 42161, tokenAddress: arbitrumUsdc, amountRaw: 5_000_000n },
    ],
    toChainId: 8453,
    toTokenAddress: baseUsdc,
  },
  options,
);
```

Never infer exact-input amounts or call removed max helpers.

## Handle events

Use the unified discriminated `IntentEvent`:

```ts
onEvent(event) {
  if (event.type === 'quote') renderPlan(event.quote.plan);
  if (event.type === 'step') renderStep(event.step, event.state, event.error);
  if (event.type === 'status') renderStatus(event.status, event.substatus);
}
```

Handle canonical steps: `erc20_approval`, `intent_signature`, `native_transaction`,
`intent_submission`, and `intent_fulfillment`.

Handle step states `started`, `completed`, and `failed`; handle lifecycle statuses `created`,
`deposited`, `fulfilled`, and `expired`.

Do not expect old plan-preview or plan-progress events.

## Read results

Bridge, transfer, and swap resolve with the normalized intent result:

```ts
const {
  intentId,
  intentExplorerUrl,
  quote,
  status,
  approvals,
  nativeTransactions,
} = result;
```

Read route/source/output information from `quote.input` and `quote.output`. Do not read removed
`sourceTxs`, `sourceSwaps`, or `destinationSwap` fields.

The promise resolves only after fulfillment. Handle rejection for denial, expiry, timeout, wallet,
RPC, or middleware errors.

## Use balances and catalog metadata

Use either balance method; both return chain-level `IntentBalance[]`:

```ts
const balances = await client.getBalancesForSwap();
```

Use `balanceRaw` plus the entry's own `decimals`. Respect `usable`. Group balances in the app only
for presentation.

Use `client.getSupportedChains()` and filter explicit capabilities:

```ts
const intentChains = client
  .getSupportedChains()
  .filter((chain) => chain.capabilities.intent);
```

Use catalog token `address`; never infer token identity or decimals from symbol alone.

## Execute and compose

Use standalone `execute` for a destination contract call:

```ts
await client.execute({
  toChainId,
  to,
  data,
  value,
  tokenApproval: { toTokenSymbol: 'USDC', amount, spender: to },
});
```

Use `simulateExecute` for gas estimation.

Use `swapAndExecute` or `bridgeAndExecute` when the SDK should fund a destination shortfall, wait
for fulfillment, then execute. Put `onIntent` in `hooks` and keep `beforeExecute` top-level:

```ts
await client.swapAndExecute(params, {
  hooks: { onIntent: ({ allow }) => allow() },
  beforeExecute: async () => ({ data: refreshedData }),
});
```

Check `swapSkipped` or `bridgeSkipped` before reading the optional intent result.

## Handle errors

Branch first on `NexusError` subclasses, then on `error.code` when needed:

```ts
try {
  await client.bridge(params);
} catch (error) {
  if (error instanceof UserActionError) return;
  if (error instanceof NexusError) report(error.code, error.context, error.details);
  throw error;
}
```

Do not parse message text for control flow.

## Migrate old integrations

Remove:

- `calculateMaxForSwap` and `calculateMaxForBridge`;
- Safe and ephemeral-key options/imports;
- local route/aggregator types;
- old `BridgeEvent`/`SwapEvent` handling;
- `sourceTxs`, `sourceSwaps`, and `destinationSwap` result reads;
- composite top-level `onIntent`.

Replace them with balance selection, `IntentQuote`, unified `IntentEvent`, `IntentResult`, and
`options.hooks`.
