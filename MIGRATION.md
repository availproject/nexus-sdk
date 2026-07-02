# Migrating from Nexus SDK v1 to v2

This guide covers every breaking change between `@avail-project/nexus-core` (v1) and `@avail-project/nexus-core@2.0.0` (v2).

---

## Installation

```diff
- npm install @avail-project/nexus-core
+ npm install @avail-project/nexus-core@2.0.0
```

All imports change accordingly:

```diff
- import { NexusSDK, ... } from '@avail-project/nexus-core';
+ import { createNexusClient, ... } from '@avail-project/nexus-core';
```

---

## Initialization

v1 used a class constructor + `initialize(provider)`. v2 uses a factory function with a two-step init.

```typescript
// v1
const sdk = new NexusSDK({ network: 'mainnet', debug: true });
await sdk.initialize(provider);

// v2
const client = createNexusClient({ network: 'mainnet', debug: true });
await client.initialize();            // fetches deployment info
await client.setEVMProvider(provider); // connects wallet (can be called later)
```

### Constructor config changes

| v1 field | v2 field | Notes |
|----------|----------|-------|
| `network` | `network` | Same |
| `debug` | `debug` | Same |
| `siweChain` | — | Removed |
| `analytics` | `analytics` | Same shape |
| — | `devTiming` | New — performance tracing |

---

## Teardown

```typescript
// v1
await sdk.deinit();

// v2
client.destroy();  // synchronous
```

---

## Parameter renames (applies across all operations)

The most common breaking change is consistent parameter renaming across bridge, transfer, and execute inputs.

| v1 field | v2 field | Affected types |
|----------|----------|----------------|
| `token` | `toTokenSymbol` | `BridgeParams`, `TransferParams`, `BridgeAndExecuteParams` |
| `amount` | `toAmountRaw` | `BridgeParams`, `TransferParams`, `BridgeAndExecuteParams` |
| `sourceChains` | `sources` | `BridgeParams`, `TransferParams`, `BridgeAndExecuteParams` |
| `gas` | — | Removed from `BridgeParams` |
| — | `toNativeAmountRaw` | New optional field on `BridgeParams` |

### Bridge example

```typescript
// v1
await sdk.bridge({
  token: 'USDC',
  amount: 1000000n,
  toChainId: 8453,
  sourceChains: [1, 42161],
});

// v2
await client.bridge({
  toTokenSymbol: 'USDC',
  toAmountRaw: 1000000n,
  toChainId: 8453,
  sources: [1, 42161],
});
```

### Transfer example

```typescript
// v1
await sdk.bridgeAndTransfer({
  token: 'USDC',
  amount: 1000000n,
  toChainId: 8453,
  recipient: '0x...',
  sourceChains: [1],
});

// v2
await client.bridgeAndTransfer({
  toTokenSymbol: 'USDC',
  toAmountRaw: 1000000n,
  toChainId: 8453,
  recipient: '0x...',
  sources: [1],
});
```

### Bridge & Execute example

```typescript
// v1
await sdk.bridgeAndExecute({
  token: 'USDC',
  amount: 1000000n,
  toChainId: 8453,
  sourceChains: [1],
  execute: { to: '0x...', data: '0x...', toChainId: 8453 },
});

// v2 — execute now omits toChainId; the destination chain is inherited from the top-level toChainId
await client.bridgeAndExecute({
  toTokenSymbol: 'USDC',
  toAmountRaw: 1000000n,
  toChainId: 8453,
  sources: [1],
  execute: { to: '0x...', data: '0x...' },
});
```

> v2's `BridgeAndExecuteParams.execute` is `Omit<ExecuteParams, 'toChainId'>`. Setting `execute.toChainId` will fail type-checking.

---

## Execute — tokenApproval change

```typescript
// v1
await sdk.execute({
  toChainId: 8453,
  to: '0x...',
  data: '0x...',
  tokenApproval: { token: 'USDC', amount: 1000000n, spender: '0x...' },
});

// v2
await client.execute({
  toChainId: 8453,
  to: '0x...',
  data: '0x...',
  tokenApproval: { toTokenSymbol: 'USDC', amount: 1000000n, spender: '0x...' },
});
```

### ExecuteSimulation restructured

v2 replaces scalar fee fields with a discriminated `feeParams` union that correctly represents EIP-1559 vs legacy (Arbitrum) pricing:

```typescript
// v1
type ExecuteSimulation = { gasUsed: bigint; gasPrice: bigint; gasFee: bigint };

// v2
type ExecuteFeeParams =
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: 'legacy'; gasPrice: bigint };

type ExecuteSimulation = {
  feeParams: ExecuteFeeParams;
  estimatedGasUnits: bigint;
  estimatedTotalCost: bigint;
};
```

### ExecuteRequirement (new in v2)

`ExecuteRequirement` is a new v2 type passed to the composite-intent hooks for `bridgeAndExecute` and `swapAndExecute`. It exposes the chain, target contract, token requirement, gas estimate, optional native value, and optional token approval the SDK plans to make. Like `ExecuteSimulation`, the `gas` field uses the `feeParams` discriminated union for EIP‑1559 vs legacy (Arbitrum) pricing — there are no separate `gasPrice` / `maxFeePerGas` / `maxPriorityFeePerGas` fields.

```typescript
type ExecuteRequirement = {
  chain: { id: number; name: string; logo?: string };
  to: Hex;
  token: { address: Hex; symbol: string; decimals: number; amount: string; amountRaw: bigint; value: string };
  gas: {
    address: Hex;
    symbol: string;
    decimals: number;
    amount: string;
    amountRaw: bigint;
    value: string;
    estimatedGasUnits: string;
    feeParams: ExecuteFeeParams;
    l1Fee: string;
    priceTier: 'low' | 'medium' | 'high';
  };
  nativeValue: { amount: string; amountRaw: bigint; value: string } | null;
  tokenApproval: {
    token: { address: Hex; symbol: string; decimals: number };
    amount: string;
    amountRaw: bigint;
    spender: Hex;
  } | null;
};
```

---

## Hooks — global setters → per-operation options

v1 registered hooks globally on the SDK instance. v2 passes them per-operation in the options object.

```typescript
// v1
sdk.setOnIntentHook((data) => { data.allow(); });
sdk.setOnAllowanceHook((data) => { data.allow(data.sources.map(() => 'min')); });
sdk.setOnSwapIntentHook((data) => { data.allow(); });

await sdk.bridge(params);

// v2
await client.bridge(params, {
  hooks: {
    onIntent: (data) => { data.allow(); },
    onAllowance: (data) => { data.allow(data.sources.map(() => 'min')); },
  },
});

await client.swapWithExactIn(params, {
  hooks: {
    onIntent: (data) => { data.allow(); },
  },
});
```

When no hooks are provided, v2 auto-approves: intents are allowed and allowances use `'min'`.

### Composite operation hooks

`bridgeAndExecute` and `swapAndExecute` pass their hook at the top level of options:

```typescript
// v2
await client.bridgeAndExecute(params, {
  onIntent: (data) => { data.allow(); },
  beforeExecute: async () => ({ value: 0n }),
});

await client.swapAndExecute(params, {
  onIntent: (data) => { data.allow(); },
});
```

### fillTimeoutMinutes

v2 adds a `fillTimeoutMinutes` option (default: 2) on bridge and transfer operations:

```typescript
await client.bridge(params, { fillTimeoutMinutes: 5 });
```

---

## Event system — step callbacks → plan-based events

v1 used a flat `{ name, args }` event union. v2 uses a typed discriminated union with plan lifecycle events.

```typescript
// v1
await sdk.bridge(params, {
  onEvent: (event) => {
    switch (event.name) {
      case 'STEPS_LIST':     // BridgeStepType[]
      case 'STEP_COMPLETE':  // BridgeStepType
      case 'SWAP_STEP_COMPLETE': // SwapStepType
    }
  },
});

// v2
await client.bridge(params, {
  onEvent: (event) => {
    switch (event.type) {
      case 'status':          // { status: 'intent_building' | 'intent_ready' | ... }
      case 'plan_preview':    // { plan: BridgePlan }   — list of steps about to run
      case 'plan_confirmed':  // { plan: BridgePlan }   — after approval
      case 'plan_progress':   // { stepType, state, step } — granular progress
    }
  },
});
```

### Bridge event step types

Each `plan_progress` event has a `stepType` discriminant:

| v2 stepType | Granular states |
|-------------|-----------------|
| `allowance_approval` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |
| `request_signing` | `wallet_prompted`, `completed`, `failed` |
| `request_submission` | `started`, `completed`, `failed` |
| `vault_deposit` | `started`, `wallet_prompted`, `submitted`, `confirmed`, `completed`, `failed` |
| `bridge_fill` | `waiting`, `completed`, `failed` |

`bridgeAndExecute` plans add two more step types from the execute phase:

| v2 stepType | Granular states |
|-------------|-----------------|
| `execute_approval` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |
| `execute_transaction` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |

### Swap event step types

| v2 stepType | Granular states |
|-------------|-----------------|
| `source_swap` | `wallet_prompted`, `started`, `submitted`, `confirmed`, `failed` |
| `eoa_to_ephemeral_transfer` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |
| `bridge_deposit` | `started`, `submitted`, `confirmed`, `failed` |
| `bridge_intent_submission` | `started`, `completed`, `failed` |
| `bridge_fill` | `waiting`, `completed`, `failed` |
| `destination_swap` | `wallet_prompted`, `started`, `submitted`, `confirmed`, `failed` |

`swapAndExecute` plans append the same `execute_approval` / `execute_transaction` steps as `bridgeAndExecute`.

### Status flow

Bridge: `intent_building` → `intent_ready` → `awaiting_approval` → `approved` → `awaiting_allowance_selection` → `executing` → `completed`

Bridge & Execute: `preparing` → `intent_building` → `intent_ready` → `awaiting_approval` → `approved` → `executing` → `completed`

Swap: `route_building` → `route_ready` → `awaiting_approval` → `approved` → `executing` → `completed`

Swap & Execute: `preparing` → `route_building` → `route_ready` → `awaiting_approval` → `approved` → `executing` → `completed`

### v1 step events → v2 progress mapping

In v1, your completion signal was the `args.type` string carried by `STEP_COMPLETE` / `SWAP_STEP_COMPLETE`. v2 replaces these with `plan_progress` events keyed on (`stepType`, `state`). The common v1 signals map as follows:

| v1 (`event.name` / `event.args.type`) | v2 (`event.type` / `stepType` + `state`) |
|---|---|
| `STEPS_LIST` / `SWAP_STEPS_LIST` | `plan_preview` → `event.plan.steps` |
| `STEP_COMPLETE` / `SWAP_STEP_COMPLETE` | `plan_progress` → `event.stepType` + `event.state` |
| `args.type === 'INTENT_HASH_SIGNED'` | `request_signing` + `completed` |
| `args.type === 'INTENT_SUBMITTED'` | `request_submission` + `completed` (carries `explorerUrl`) |
| `args.type === 'INTENT_FULFILLED'` | `bridge_fill` + `completed` |
| `args.type === 'TRANSACTION_CONFIRMED'` | `execute_transaction` + `confirmed` |
| `args.type === 'SWAP_COMPLETE'` | terminal `status` = `completed` (last `source_swap`/`destination_swap` settles on `confirmed`) |
| `SWAP_SKIPPED` event | **gone** — read `result.swapSkipped` (and composite `intent.swapRequired`) |

v2 is finer-grained — it adds `allowance_approval`, `vault_deposit`, `eoa_to_ephemeral_transfer`, `execute_approval`, etc.; see the step tables above for the full set, and [README → Progress Event Payloads](README.md#progress-event-payloads) for the `txHash`/`explorerUrl`/`error`/`intentRequestHash` fields each progress event carries. **The v1 `*_SKIPPED` events no longer exist**: detect a skipped bridge/swap via `result.bridgeSkipped` / `result.swapSkipped` (and the composite `onIntent`'s `intent.bridgeRequired` / `intent.swapRequired`), not via an event.

---

## Swap types renamed

| v1 type | v2 type | Key field changes |
|---------|---------|-------------------|
| `ExactInSwapInput` | `SwapExactInParams` | `from` → `sources`; `from[].amount` → `sources[].amountRaw` |
| `ExactOutSwapInput` | `SwapExactOutParams` | `fromSources` → `sources`; `toAmount` → `toAmountRaw`; `toNativeAmount` → `toNativeAmountRaw` |
| `MaxSwapInput` | `SwapMaxParams` | `fromSources` → `sources` |
| `SwapAndExecuteParams` | `SwapAndExecuteParams` | `fromSources` → `sources`; `toAmount` → `toAmountRaw` |
| `SwapExecuteParams` | `SwapExecuteParams` | `tokenApproval.token` → `tokenApproval.toTokenAddress` (still a contract address; symbol is used for bridge execute, not swap execute) |
| `OnSwapIntentHook` | `OnIntentHookData` (callback) | Now passed via `options.hooks.onIntent` |

### SwapExactInParams

```typescript
// v1
await sdk.swapWithExactIn({
  from: [
    { chainId: 1, tokenAddress: '0x...', amount: 1000000n },
  ],
  toChainId: 8453,
  toTokenAddress: '0x...',
});

// v2
await client.swapWithExactIn({
  sources: [
    { chainId: 1, tokenAddress: '0x...', amountRaw: 1000000n },
  ],
  toChainId: 8453,
  toTokenAddress: '0x...',
});
```

### SwapExactOutParams

```typescript
// v1
await sdk.swapWithExactOut({
  fromSources: [{ chainId: 1, tokenAddress: '0x...' }],
  toChainId: 8453,
  toTokenAddress: '0x...',
  toAmount: 1000000n,
});

// v2
await client.swapWithExactOut({
  sources: [{ chainId: 1, tokenAddress: '0x...' }],
  toChainId: 8453,
  toTokenAddress: '0x...',
  toAmountRaw: 1000000n,
});
```

### SwapAndExecuteParams

```typescript
// v1
await sdk.swapAndExecute({
  toChainId: 8453,
  toTokenAddress: '0x...',
  toAmount: 1000000n,
  fromSources: [{ chainId: 1, tokenAddress: '0x...' }],
  execute: {
    to: '0x...',
    data: '0x...',
    gas: 100000n,
    tokenApproval: { token: '0x...', amount: 1000000n, spender: '0x...' },
  },
});

// v2
await client.swapAndExecute({
  toChainId: 8453,
  toTokenAddress: '0x...',
  toAmountRaw: 1000000n,
  sources: [{ chainId: 1, tokenAddress: '0x...' }],
  execute: {
    to: '0x...',
    data: '0x...',
    gas: 100000n,
    tokenApproval: { toTokenAddress: '0x...', amount: 1000000n, spender: '0x...' },
  },
});
```

### Swap return type

v1 returned a success/error union. v2 returns the result directly and throws on failure.

```typescript
// v1
const result = await sdk.swapWithExactIn(input);
if (result.success) {
  console.log(result.result.explorerURL);
} else {
  console.error(result.error);
}

// v2
try {
  const result = await client.swapWithExactIn(input);
  console.log(result.intentExplorerUrl);
} catch (error) {
  // v2 throws typed `NexusError` subclasses. Branch on `error.category`
  // (e.g. 'user_action' for a wallet rejection) or `error.code`.
  if (error instanceof NexusError) {
    console.error(error.category, error.code, error.message);
  }
}
```

v2 errors are flat — there's no cause chain and no `NexusStepError`. The underlying failure
text is inlined into `error.message`, and the queryable axes are `error.category` / `error.code`
/ `error.context`. See [README → Error Handling](README.md#error-handling) for the full model and
the code reference.

### SuccessfulSwapResult

```typescript
// v1
type SuccessfulSwapResult = {
  sourceSwaps: ChainSwap[];
  explorerURL: string;
  destinationSwap: ChainSwap | null;
  swapRoute?: SwapRoute;
};

// v2
type SwapResult = {
  sourceSwaps: ChainSwap[];
  intentExplorerUrl: string;     // renamed from explorerURL
  destinationSwap: ChainSwap | null;
  // swapRoute removed
};
```

### Operation results use nested transaction objects

Bridge, execute, transfer, and composite flows expose transaction data through nested objects now:

```typescript
type TxResult = {
  txHash: Hex;
  txExplorerUrl: string;
  receipt?: TransactionReceipt;
};

type ExecuteResult = {
  approval?: TxResult;
  execute: TxResult;
  chainId: number;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
};

type BridgeAndExecuteResult = {
  approval?: TxResult;
  execute: TxResult;
} & (
  | { bridgeSkipped: false; bridgeResult: BridgeResult }
  | { bridgeSkipped: true; bridgeResult?: undefined }
);

type SwapAndExecuteResult = {
  approval?: TxResult;
  execute: TxResult;
} & (
  | { swapSkipped: false; swapResult: SwapResult }
  | { swapSkipped: true; swapResult?: undefined }
);
```

### Operation result field renames

Beyond the nesting change above, individual result fields were renamed. TypeScript catches most of these — but if your v1 code cast results (`as BridgeResult`, `as { executeResponse }`, …), the breaks are **silent at runtime**, so audit every result reader:

| Operation | v1 field | v2 field |
|---|---|---|
| `bridge` | `result.explorerUrl` | `result.intentExplorerUrl` |
| `bridge` | `result.sourceTxs` (single object) | `result.sourceTxs` (**array**) |
| `bridge` | `result.sourceTxs.hash` | `result.sourceTxs[].txHash` |
| `bridge` | `result.sourceTxs.explorerUrl` | `result.sourceTxs[].txExplorerUrl` |
| `bridgeAndExecute` | `result.executeTransactionHash` | `result.execute.txHash` |
| `bridgeAndExecute` | `result.executeExplorerUrl` | `result.execute.txExplorerUrl` |
| `bridgeAndExecute` | `result.bridgeExplorerUrl` | `result.bridgeResult?.intentExplorerUrl` |
| `swapAndExecute` | `result.executeResponse` | `result.execute` |
| `swapAndExecute` | `result.executeResponse.txHash` | `result.execute.txHash` |
| `swapWithExactIn` / `swapWithExactOut` | `result.explorerURL` | `result.intentExplorerUrl` |

### Swap options (new in v2)

```typescript
await client.swapWithExactIn(input, {
  slippageTolerance: 0.005,                   // new
  hooks: { onIntent: (data) => data.allow() },
  onEvent: (event) => { /* SwapEvent */ },
});
```

---

## Balance APIs

### getBalancesForBridge — return type renamed

The call shape is unchanged (still async, still returns the array directly), but the element type is now `TokenBalance` (specifically `BridgeTokenBalance` — see [UserAsset → TokenBalance](#userasset--tokenbalance) below).

```typescript
// v1
const assets = await sdk.getBalancesForBridge(); // UserAssetDatum[]

// v2
const assets = await client.getBalancesForBridge(); // TokenBalance[]
```

### getBalancesForSwap — filter param removed

```typescript
// v1
const assets = await sdk.getBalancesForSwap(true); // onlyNativesAndStables filter

// v2
const assets = await client.getBalancesForSwap(); // no filter param
```

### UserAsset → TokenBalance

The balance item type was renamed and restructured.

```diff
- import type { UserAsset } from '@avail-project/nexus-core';
+ import type { TokenBalance, ChainBalance } from '@avail-project/nexus-core';
```

Key field changes:

| v1 field | v2 field | Notes |
|----------|----------|-------|
| `icon?: string` | `logo: string` | Now required |
| `balanceInFiat: number` | `value: string` | String for precision |
| `breakdown: AssetBreakdown[]` | `chainBalances: ChainBalance[]` | Renamed |
| — | `name: string` | New display label (e.g. "USDC/USDM") |
| — | `symbol: string` | Majority symbol by chain count |
| — | `currencyId?: number` | Optional (required on `BridgeTokenBalance`) |
| `abstracted?: boolean` | — | Removed |

`ChainBalance` (was `AssetBreakdown`):

| v1 field | v2 field |
|----------|----------|
| `balanceInFiat: number` | `value: string` |
| — | `symbol: string` (new) |
| — | `universe: Universe` (new) |

---

## convertTokenReadableAmountToBigInt — unchanged

The signature is **identical** in v1 and v2 — `(amount, tokenSymbol, chainId)`, looking up the token's decimals internally. Only the call target changed (`sdk.` → `client.`); do not "fix" the argument list.

```typescript
// v1
sdk.convertTokenReadableAmountToBigInt('1.5', 'USDC', 8453);

// v2 — same arguments
client.convertTokenReadableAmountToBigInt('1.5', 'USDC', 8453);
```

---

## getSupportedChains

v2 offers two ways to fetch supported chains, both producing the same `SupportedChainsAndTokensResult` shape.

**v1** — synchronous, returned hard-coded metadata, available either as an instance method or as a standalone import:

```typescript
// Instance method
const chains = sdk.utils.getSupportedChains();
```

```typescript
// Standalone import
import { getSupportedChains } from '@avail-project/nexus-core';

const chains = getSupportedChains('mainnet');
```

**v2 (instance)** — synchronous, uses the configured network from `createNexusClient`:

```typescript
const chains = client.getSupportedChains();
```

**v2 (standalone)** — async, fetches the live deployment from the middleware. Available from the `/utils` subpath, or via `client.utils.getSupportedChains`:

```typescript
import { getSupportedChains } from '@avail-project/nexus-core/utils';

const chains = await getSupportedChains('mainnet');
```

Note that the v2 list is sourced from the live middleware deployment, so it may grow or shrink between releases without an SDK update.

> **Static-constant callers, take note.** v1 code that used `SUPPORTED_CHAINS.BASE` (etc.) or `CHAIN_METADATA[id]` as **compile-time object keys** cannot use the async/runtime `getSupportedChains()` in their place — a runtime list can't key a literal. Switch those to plain numeric chain IDs (`8453`, …) or look the chain up at runtime via `client.chainList.getChainByID(id)`. Likewise, v1 module-level helpers that called the synchronous standalone `getSupportedChains()` with no client now need either an initialized `client` threaded in (`client.getSupportedChains()`) or the async `await getSupportedChains(env)` from `@avail-project/nexus-core/utils`.

---

## Intent listing — `getMyIntents` → `listIntents`

The method for querying past intents has been renamed and restructured. v1 took a positional page number and returned a flat array; v2 takes an options object and returns `{ intents, total }`.

```typescript
// v1
const rffs = await sdk.getMyIntents(1); // page number, defaults to 1

// v2
const { intents, total } = await client.listIntents({ page: 1, status: 'fulfilled' });
```

Page size in v2 is fixed at 20 (not configurable via params).

### ListIntentsParams (new)

| Field | Type | Notes |
|-------|------|-------|
| `page` | `number` | Optional, defaults to 1. Must be integer ≥ 1. |
| `status` | `IntentStatus` | Optional filter: `'created' \| 'deposited' \| 'fulfilled' \| 'expired'` |

### IntentRecord (was `RFF`)

The intent record type has been restructured. `destinationChain`, `destinations[]`, `sources[]`, `expiry`, and `explorerUrl` carry over from v1 (with field renames inside each entry).

| v1 field | v2 field | Notes |
|----------|----------|-------|
| `id: number` | `requestHash: Hex` | Renamed and retyped to the on-chain request hash |
| `deposited` / `fulfilled` / `refunded` (booleans) | `status: IntentStatus` | Collapsed into `'created' \| 'deposited' \| 'fulfilled' \| 'expired'` |
| `sources[].value` / `valueRaw` | `sources[].amount` / `amountRaw` | Renamed |
| `sources[].token.address` | `sources[].token.contractAddress` | Renamed |
| — | `sources[].token.name` / `logo` | New fields |
| — | `sources[].feeRaw` / `fee` | New per-source fee fields |
| `destinations[].value` / `valueRaw` | `destinations[].amount` / `amountRaw` | Renamed (still a plural array) |
| `destinations[].token.address` | `destinations[].token.contractAddress` | Renamed |
| — | `destinations[].token.name` / `logo` | New fields |
| — | `solver` | New — solver address (nullable) |
| — | `recipientAddress` | New — recipient address |
| — | `createdAt` / `updatedAt` | New timestamps |
| `explorerUrl` | `explorerUrl` | Preserved |
| `expiry` | `expiry` | Preserved |
| `destinationChain` | `destinationChain` | Preserved |

---

## Removed / replaced APIs

| v1 method | Notes |
|-----------|-------|
| `isInitialized()` | Removed. |
| `triggerAccountChange()` | Removed. On account change, **create a fresh client** and re-run `initialize()` + `setEVMProvider()`. Calling `setEVMProvider()` with the same provider instance is a no-op (it short-circuits when `state.evm.provider === provider`), so it cannot be used to swap accounts on the same provider. |
| `refundIntent(intentID)` | Removed from the SDK surface. |
| `getSwapSupportedChains()` | Removed. Use `getSupportedChains()`, which now includes per-chain token info. |
| `setOnIntentHook(cb)` | Replaced by per-operation `hooks.onIntent`. |
| `setOnSwapIntentHook(cb)` | Replaced by per-operation `hooks.onIntent` on swap operations. |
| `setOnAllowanceHook(cb)` | Replaced by per-operation `hooks.onAllowance`. |
| `getMyIntents(page)` | Replaced by `listIntents({ page, status })`, returning `{ intents, total }`. |
| `deinit()` | Replaced by synchronous `destroy()`. |

The following methods are **preserved** in v2 with the new param shapes documented above: `bridge`, `bridgeAndTransfer`, `bridgeAndExecute`, `execute`, `simulateBridge`, `simulateBridgeAndTransfer`, `simulateBridgeAndExecute`, `simulateExecute`, `swapWithExactIn`, `swapWithExactOut`, `swapAndExecute`, `calculateMaxForSwap`, `calculateMaxForBridge`, `getBalancesForBridge`, `getBalancesForSwap`, `getSupportedChains`, `isSupportedChain`, `convertTokenReadableAmountToBigInt`, `setEVMProvider`, `hasEvmProvider`.

> `calculateMaxForBridge` returns to v2 with a new shape: it takes `{ toChainId, toTokenSymbol, sources? }` (source chain IDs) and returns a `BridgeMaxResult` including the `provider` (`'nexus'` or `'mayan'`) the max was sized against — see the [README](./README.md#calculatemaxforbridgeinput).

---

## Removed exports

These constants/values are no longer exported from the package entry point:

| v1 export | Notes |
|-----------|-------|
| `Environment` | Was a runtime enum re-exported from `@avail-project/ca-common`. v2 has no runtime equivalent — pass the string literal `'mainnet'`, `'canary'`, or `'testnet'` (or a custom `NetworkConfig` object) to `createNexusClient({ network })`. The v2 `NexusNetwork` export is a TypeScript type only, not a value. |
| `BRIDGE_STEPS` | Replaced by typed `BridgePlanStep` events. |
| `SWAP_STEPS` | Replaced by typed `SwapPlanStep` events. |
| `CHAIN_METADATA` | Chain metadata is now dynamic via `client.chainList`. |
| `TOKEN_METADATA` | Token metadata is now dynamic via `client.chainList`. |
| `TESTNET_TOKEN_METADATA` | Use `client.chainList` instead. |
| `TOKEN_CONTRACT_ADDRESSES` | Use `client.chainList.getTokenInfoBySymbol()`. |
| `DESTINATION_SWAP_TOKENS` | Internal to swap routing. |
| `MAINNET_CHAINS` | Use `client.getSupportedChains()`. |
| `TESTNET_CHAINS` | Use `client.getSupportedChains()`. |
| `SUPPORTED_CHAINS` | Use `client.getSupportedChains()`. |
| `NEXUS_EVENTS` | Replaced by typed event discriminants. |
| `sortSourcesByPriority` | Removed from public API. |
| `NexusSDK` (class) | Replaced by `createNexusClient` factory. |
| `SUPPORTED_CHAINS_IDS` | Type removed. Use `number` instead. |
| `SUPPORTED_TOKENS` | Type removed. |
| `DynamicParamBuilder` | Type removed. |
| `EventListener` | Type removed. |
| `AllowanceResponse` | Type removed. |
| `aggregateBySpanName` | Analytics utility removed from public API. |
| `aggregateDurations` | Analytics utility removed from public API. |
| `computePercentile` | Analytics utility removed from public API. |
| `installAxiosNetworkTiming` | Analytics utility removed from public API. |
| `PerformanceAggregates` | Analytics type removed from public API. |
| `AnalyticsProvider`, `BalanceProperties`, `BaseEventProperties`, `ErrorProperties`, `PerformanceProperties`, `SessionProperties`, `TransactionProperties`, `WalletProperties` | Analytics types removed. |
| `formatTokenBalance`, `formatTokenBalanceParts`, `formatUnits`, `parseUnits` | Moved to `@avail-project/nexus-core/utils` subpath export. |
| `getCoinbaseRates` | Moved to `@avail-project/nexus-core/utils` subpath export. |
| `getSupportedChains` (standalone) | Moved to `@avail-project/nexus-core/utils` subpath export. Now async (`getSupportedChains(env): Promise<...>`). The instance method `client.getSupportedChains()` remains a synchronous alternative for code that already has a configured client. |
| `isSupportedToken` | Removed. Use `client.getSupportedChains()` to check token support per chain. |
| `isValidAddress` | Moved to `@avail-project/nexus-core/utils` subpath export. |
| `truncateAddress` | Moved to `@avail-project/nexus-core/utils` subpath export. |

---

## New exports (v2 only)

| Export | Description |
|--------|-------------|
| `createNexusClient` | Factory function replacing `NexusSDK` class |
| `NexusError` + 7 subclasses | Typed error hierarchy (`ValidationError`, `UserActionError`, `SimulationError`, `ExecutionError`, `BackendError`, `ExternalServiceError`, `InternalError`). Flat — no cause chain, no `NexusStepError`; step failures carry `context.stepId` / `context.stepType` / `context.chainId`. |
| `ERROR_CODES`, `ErrorCategory`, `ErrorContext`, `ServiceFor` | Error code constants and supporting types (see [README → Error Codes Reference](README.md#error-codes-reference)). |
| `DevTimingConfig` | Performance tracing configuration type |
| `SpanProperties` | Span data for performance analysis |
| Bridge event types | `BridgeEvent`, `BridgeStatusEvent`, `BridgePlanPreviewEvent`, `BridgePlanProgressEvent`, etc. |
| Swap event types | `SwapEvent`, `SwapStatusEvent`, `SwapPlanPreviewEvent`, `SwapPlanProgressEvent`, etc. |
| Composite event types | `BridgeAndExecuteEvent`, `SwapAndExecuteEvent`, and all sub-types |
| Plan types | `BridgePlan`, `SwapPlan`, `BridgeAndExecutePlan`, `SwapAndExecutePlan` |
| Fee types | `ExecuteFeeParams` — discriminated union for EIP-1559 vs legacy pricing |
| Balance types | `TokenBalance`, `ChainBalance`, `BridgeTokenBalance`, `SwapTokenBalance` |
| Intent types | `BridgeIntent`, `BridgeIntentDraft`, `BridgeAndExecuteIntent`, `SwapAndExecuteIntent`, `AvailableBalances`, `Shortfall`, `ExecuteRequirement` |
| Intent listing types | `IntentRecord`, `IntentStatus`, `ListIntentsParams`, `ListIntentsResult` |
| Hook data types | `BridgeAndExecuteOnIntentHookData`, `SwapAndExecuteOnIntentHookData`, `OnSwapIntentHookData` |
| Swap param types | `SwapExactInParams`, `SwapExactOutParams`, `SwapMaxParams`, `SwapExecuteParams`, `Source` |

---

## Type renames

| v1 type | v2 type | Notes |
|---------|---------|-------|
| `SimulationResult` | `BridgeSimulationResult` | Return type of `simulateBridge()` |
| `SuccessfulSwapResult` | `SwapResult` | Return type of `swapWithExactIn()`, `swapWithExactOut()` |
| `MaxSwapResult` | `SwapMaxResult` | Return type of `calculateMaxForSwap()` |
| `IBridgeOptions` | `BridgeOptions` | Removed `I` prefix |
| `onAllowanceHookSource` | `AllowanceHookSource` | Proper PascalCase |
| `RFF` | `IntentRecord` | Complete restructure (see [Intent listing](#intent-listing--getmyintents--listintents)) |

---

## ReadableIntent → BridgeIntent

The `ReadableIntent` type has been renamed to `BridgeIntent` and restructured.

```diff
- import type { ReadableIntent } from '@avail-project/nexus-core';
+ import type { BridgeIntent } from '@avail-project/nexus-core';
```

Key changes:

| v1 field | v2 field | Notes |
|----------|----------|-------|
| `sources` | `selectedSources` | Renamed |
| `allSources` | `availableSources` | Renamed |
| `sources[].chainID` | `selectedSources[].chain.id` | Restructured into `chain: { id, name, logo }` |
| `sources[].chainName` | `selectedSources[].chain.name` | Moved into `chain` object |
| `sources[].contractAddress` | `selectedSources[].token.contractAddress` | Moved into `token` object |
| — | `selectedSources[].amountRaw` | New raw bigint amount |
| `destination.chainID` | `destination.chain.id` | Restructured into `chain` object |
| — | `destination.amountRaw` | New raw bigint amount |
| — | `destination.nativeAmount` | New — human-readable native gas amount |
| — | `destination.nativeAmountRaw` | New — raw native gas bigint |
| — | `destination.nativeAmountValue` | New — USD value of native gas |
| — | `destination.nativeAmountInToken` | New — native gas in bridge token units |
| — | `destination.nativeToken` | New — `{ decimals, symbol, logo, contractAddress }` |
| `fees.gasSupplied` | — | Removed (native amounts now on destination) |
| `token` (top-level) | — | Removed (token info is on each source/destination) |
| — | `sourcesTotalValue` | New — fiat value of total sourced |
| — | `fees.totalValue` | New — fiat value of total fees |

---

## `isSupportedChain` — moved off `utils`, parameter type simplified

```typescript
// v1 — lived on sdk.utils, parameter typed against SUPPORTED_CHAINS_IDS branded union
sdk.utils.isSupportedChain(chainId);

// v2 — promoted to a top-level client method, parameter is plain number
client.isSupportedChain(chainId);
```

---

## Error code key renames

v2 keeps SCREAMING_SNAKE `ERROR_CODES.*` keys, but the **values** are now namespaced `category/snake` strings, and several keys were renamed. The user-denial keys most apps branch on:

| v1 key | v2 key | v2 value |
|---|---|---|
| `USER_DENIED_INTENT` | `USER_INTENT_HOOK_DENIED` | `user_action/intent_hook_denied` |
| `USER_DENIED_ALLOWANCE` | `USER_ALLOWANCE_APPROVAL_DENIED` | `user_action/allowance_approval_denied` |
| `USER_DENIED_INTENT_SIGNATURE` | `USER_INTENT_SIGNATURE_DENIED` | `user_action/intent_signature_denied` |
| `USER_DENIED_SIWE_SIGNATURE` | `USER_SIWE_SIGNATURE_DENIED` | `user_action/siwe_signature_denied` |

In practice you can replace all four `error.code` comparisons with a single `error instanceof UserActionError` check — every user-denial path is a `UserActionError`. See [README → Error Handling](README.md#error-handling) for the full code surface.

---

## Quick migration checklist

- [ ] Update package name in `package.json`
- [ ] Replace `new NexusSDK(config)` → `createNexusClient(config)`
- [ ] Split `initialize(provider)` → `initialize()` + `setEVMProvider(provider)`
- [ ] Replace `deinit()` → `destroy()`
- [ ] Rename `token` → `toTokenSymbol` in all bridge/transfer/execute params
- [ ] Rename `amount` → `toAmountRaw` in all bridge/transfer params
- [ ] Rename `sourceChains` → `sources` in all bridge/transfer params
- [ ] Rename `tokenApproval.token` → `tokenApproval.toTokenSymbol` in `execute()` / `bridgeAndExecute()` (bridge execute uses symbols)
- [ ] Rename `tokenApproval.token` → `tokenApproval.toTokenAddress` in `swapAndExecute()` (swap execute uses contract addresses)
- [ ] Rename `swapAndExecute()` params: `fromSources` → `sources`; `toAmount` → `toAmountRaw`
- [ ] Move `setOnIntentHook` / `setOnAllowanceHook` / `setOnSwapIntentHook` → per-operation `hooks` option
- [ ] Update swap input types: `ExactInSwapInput` → `SwapExactInParams`, field renames
- [ ] Update swap result handling: remove `result.success` check, use try/catch
- [ ] Update `explorerURL` → `intentExplorerUrl` in swap results
- [ ] Update operation result handling to nested `approval?` / `execute` transaction objects
- [ ] Update event handlers from `{ name, args }` → typed `{ type, ... }` events
- [ ] Update balance types from `UserAssetDatum`/`UserAsset` → `TokenBalance` (or `BridgeTokenBalance`/`SwapTokenBalance`), and `AssetBreakdown` → `ChainBalance`
- [ ] Update balance fields: `icon` → `logo`, `balanceInFiat` → `value`, `breakdown` → `chainBalances`
- [ ] Update intent types: `ReadableIntent` → `BridgeIntent`, `sources` → `selectedSources`, `allSources` → `availableSources`
- [ ] Update intent fields: `chainID`/`chainName`/`chainLogo` → `chain: { id, name, logo }`, add `amountRaw`, remove `fees.gasSupplied`
- [ ] Remove `onlyNativesAndStables` arg from `getBalancesForSwap()`
- [ ] `convertTokenReadableAmountToBigInt` signature is **unchanged** (`(amount, tokenSymbol, chainId)`) — only `sdk.` → `client.`
- [ ] Update operation result readers for renamed fields (`explorerUrl`→`intentExplorerUrl`, `executeResponse`→`execute`, `executeTransactionHash`→`execute.txHash`, `bridgeExplorerUrl`→`bridgeResult.intentExplorerUrl`, `sourceTxs.hash`→`sourceTxs[].txHash`)
- [ ] Rewrite progress UI: v1 `STEP_COMPLETE`/`args.type` signals → v2 `plan_progress` (`stepType`+`state`); detect skip via `result.bridgeSkipped`/`swapSkipped`, not `*_SKIPPED` events
- [ ] Rename user-denial `ERROR_CODES` keys (`USER_DENIED_*` → `USER_*_DENIED`) or switch to `error instanceof UserActionError`
- [ ] Replace `sdk.utils.getSupportedChains()` / standalone `getSupportedChains(env)` → `client.getSupportedChains()` (sync, configured network) or `await getSupportedChains(env)` from `@avail-project/nexus-core/utils`
- [ ] Replace any `CHAIN_METADATA` / `TOKEN_METADATA` constant usage → `client.chainList`
- [ ] Update `ExecuteSimulation` usage: `gasUsed` → `estimatedGasUnits`, `gasFee` → `estimatedTotalCost`, `gasPrice` → `feeParams`
- [ ] Remove references to deleted APIs (`isInitialized`, `triggerAccountChange`, `refundIntent`)
- [ ] Replace `getMyIntents(page)` → `listIntents({ page, status })` and unpack `{ intents, total }` from the result
- [ ] Update `RFF` / `RequestForFunds` references → `IntentRecord` (booleans collapsed into `status`, `value`/`valueRaw` → `amount`/`amountRaw`, `address` → `contractAddress`, `id` → `requestHash`)
- [ ] Rename `SimulationResult` → `BridgeSimulationResult`
- [ ] Rename `SuccessfulSwapResult` → `SwapResult`
- [ ] Rename `MaxSwapResult` → `SwapMaxResult`
- [ ] Rename `IBridgeOptions` → `BridgeOptions`
- [ ] Rename `onAllowanceHookSource` → `AllowanceHookSource`
- [ ] Move `isSupportedChain()` calls from `sdk.utils.isSupportedChain(...)` → `client.isSupportedChain(...)`; parameter type is now `number` (was `SUPPORTED_CHAINS_IDS`)
- [ ] Update utility imports (`formatTokenBalance`, `formatUnits`, `parseUnits`, `truncateAddress`, `isValidAddress`, etc.) from main entry to `@avail-project/nexus-core/utils`