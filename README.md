# `@avail-project/nexus-core`

Headless TypeScript SDK for API-routed cross-chain intents and EVM contract execution.

The Better Intent middleware owns asset discovery, route selection, provider selection, fees, and
quotes. The SDK owns validation, wallet approvals, `personal_sign`, required source transactions,
intent submission, fulfillment polling, and optional destination contract execution.

## Install

```bash
npm install @avail-project/nexus-core
```

The package requires an EIP-1193 Ethereum provider and supports EVM wallets through viem.

## Initialize a client

```ts
import { createNexusClient } from '@avail-project/nexus-core';

const client = createNexusClient({ network: 'mainnet' });

await client.initialize();
await client.setEVMProvider(window.ethereum);
```

Create a new client after the connected account or provider changes. Call `destroy()` when the
client is no longer used.

Supported built-in network names are:

- `mainnet` — Better Intent enabled against mainnet chains
- `canary` — Better Intent enabled against mainnet chains
- `testnet` — standalone execute support only; intent operations reject with
  `ENVIRONMENT_NOT_SUPPORTED`

A custom `NetworkConfig` can also provide middleware and explorer URLs plus a network hint.

Set `forceMayan: true` to restrict the supported intent catalog and balances to Mayan and prefer
Mayan for quotes. The SDK derives cross-chain fungible asset groups from the filtered `/chains`
response using `coingeckoId`.

## Intent lifecycle

Bridge and swap methods share one server-driven lifecycle:

1. The SDK asks the middleware for a quote.
2. `hooks.onIntent` may review, refresh, allow, or deny it.
3. The SDK performs quoted ERC-20 approvals.
4. The wallet signs the intent with `personal_sign`.
5. The SDK sends quoted native source transactions, if any.
6. The signed intent is submitted.
7. The SDK polls until the intent is `fulfilled`.

The returned promise rejects when a user denies a required action, a quote expires, fulfillment
times out, or a wallet/middleware operation fails. It never resolves with an incomplete intent.

If no hooks are supplied, the quote is accepted automatically and allowances use their minimum
required values.

## Bridge

Bridge is a same-asset exact-output operation. `sources` contains source chain IDs; the middleware
selects the balances and route within those chains.

```ts
const result = await client.bridge(
  {
    toChainId: 8453,
    toTokenSymbol: 'USDC',
    toAmountRaw: 10_000_000n,
    sources: [1, 42161],
  },
  {
    slippageBps: 50,
    hooks: {
      onIntent({ quote, allow, deny, refresh }) {
        console.log(quote.input, quote.output, quote.fees, quote.expiresAt);
        allow();
      },
      onAllowance({ allowances, allow }) {
        allow(allowances.map(() => 'min'));
      },
    },
  },
);

console.log(result.intentId, result.intentExplorerUrl, result.status);
```

`bridgeAndTransfer` uses the same flow and requires a destination `recipient`.

`simulateBridge` and `simulateBridgeAndTransfer` return an API-backed `IntentQuote` without wallet
transactions or submission.

## Exact-output swap

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
      console.log(event.step.id, event.step.type, event.state, event.error);
      break;
    case 'status':
      console.log(event.intentId, event.status, event.substatus);
      break;
  }
};
```

Canonical plan step types are:

- `erc20_approval`
- `intent_signature`
- `native_transaction`
- `intent_submission`
- `intent_fulfillment`

Step states are `started`, `completed`, or `failed`. Lifecycle statuses are `created`, `deposited`,
`fulfilled`, and `expired`. Callback failures are isolated and do not break the operation.

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

`IntentQuote` exposes normalized inputs, output, minimum output, fees, allowances, expiry, provider,
trade type, and the canonical execution plan. Raw RFF payloads, signing payload internals, ABIs, and
submit serialization stay private to the transport layer.

`BridgeResult`, `SwapResult`, and `TransferResult` are stable aliases of `IntentResult`.

## Balances and catalog

Both balance methods use the same Better Intent holdings source:

```ts
const balances = await client.getBalancesForSwap();
// same normalized IntentBalance[] model:
const bridgeBalances = await client.getBalancesForBridge();
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

Composite methods inspect destination balances and estimated execution gas, request only the
shortfall through Better Intent, wait for fulfillment, then execute the destination transaction.

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

`bridgeAndExecute` accepts bridge-style token/source fields plus an `ExecuteParams`-compatible
`execute` object. A composite result indicates whether funding was skipped and includes the final
execute transaction.

`simulateBridgeAndExecute` returns the optional intent quote plus execute gas simulation.

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
    onAllowance?: (data: IntentAllowanceHookData) => void | Promise<void>;
  };
  slippageBps?: number | 'auto'; // default: 50
  fillTimeoutMinutes?: number;   // default: 2
  pollingIntervalMs?: number;    // default: 2000
};
```

Swap operations expose `onIntent`; bridge operations also expose `onAllowance`. Composite options
add `beforeExecute`.

Set `forceMayan: true` when creating the client to request Mayan as the preferred provider.

## Errors

All SDK errors extend `NexusError` and expose:

- `category`
- `code`
- `context`
- optional `details`

Use subclasses such as `ValidationError`, `UserActionError`, `ExecutionError`, and `BackendError`
for broad handling, and stable `ERROR_CODES` for specific cases.

```ts
try {
  await client.bridge(params);
} catch (error) {
  if (error instanceof UserActionError) {
    // Quote, approval, signature, or transaction was denied.
  }
}
```

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
