---
name: nexus-core
description: Use when writing or updating code that integrates with @avail-project/nexus-core. Covers client lifecycle, hooks, operations, events, error handling, and utils subpath usage. Also covers v1 → v2 migration.
---

# Nexus SDK v2 Integration Guide

Use this skill when integrating, updating, or reviewing usage of `@avail-project/nexus-core`.

## Installation

```bash
npm install @avail-project/nexus-core
```

## Client Lifecycle

```ts
import { createNexusClient } from '@avail-project/nexus-core';

// 1. Create client
const client = createNexusClient({ network: 'mainnet' });

// 2. Initialize (fetches deployment data from middleware)
await client.initialize();

// 3. Connect wallet
await client.setEVMProvider(window.ethereum);

// 4. Use operations...

// 5. Cleanup
client.destroy(); // synchronous
```

- The client is disposable and tied to the provider/address you set.
- `initialize()` and `setEVMProvider()` are **independent**. `initialize()` is required before any chain-dependent operation (`bridge`, `swap`, `execute`, `getBalances*`, `listIntents`, …) — those throw `SDK_NOT_INITIALIZED` otherwise. `setEVMProvider()` only attaches a wallet and can be called in any order. Most apps run both at startup.
- **On account change, build a fresh client.** `setEVMProvider()` short-circuits when called with the same provider instance it already holds, so it cannot be reused to swap accounts on a single provider — instantiate a new client with `createNexusClient()` and re-run both setup steps.
- **Getting the provider.** With an injected wallet, pass `window.ethereum`. With a wallet library (wagmi/RainbowKit/Web3Modal), get the EIP-1193 provider from the active connector first — `const provider = await connector.getProvider()` — then `await client.setEVMProvider(provider as EthereumProvider)` (cast if the library's type doesn't match; the SDK only uses `request()`).

### Configuration

All `createNexusClient` options are optional. `network` defaults to `'mainnet'`; pass `'canary'` or `'testnet'` for those deployments, or a `NetworkConfig` object to point at a custom middleware.

```ts
const client = createNexusClient({
  network: 'mainnet',                    // 'mainnet' | 'canary' | 'testnet' | NetworkConfig (default 'mainnet')
  debug: false,                          // verbose logging
  forceMayan: false,                     // pin bridge/swap routing to the Mayan provider (default false)
  domain: 'app.example.com',             // optional — override ephemeral-key sign-message domain (mobile/native shells)
  analytics: {
    enabled: true,
    privacy: { anonymizeWallets: true, anonymizeAmounts: true },
  },
  devTiming: { enabled: true },          // performance tracing
});
```

Custom middleware example:

```ts
const customClient = createNexusClient({
  network: {
    MIDDLEWARE_HTTP_URL: 'https://your-middleware.example.com',
    INTENT_EXPLORER_URL: 'https://your-explorer.example.com',
    NETWORK_HINT: 'mainnet',
  },
});
```

### Client Properties

- `chainList` — dynamic chain/token catalogue (available after `initialize()`)
- `hasEvmProvider` — whether a wallet is connected
- `analytics` — analytics manager (track, identify, enable/disable)

`chainList` exposes contract-aware lookups — use it instead of bundling chain/token constants:

```ts
client.chainList.chains;                                   // Chain[]
client.chainList.getChainByID(8453);                       // Chain { id, name, nativeCurrency, blockExplorers?, ... }
client.chainList.getChainByID(8453).blockExplorers?.default?.url;   // guard — optional
client.chainList.getTokenInfoBySymbol(8453, 'USDC');       // TokenInfo { contractAddress, symbol, decimals, logo, ... }
client.chainList.getTokenByAddress(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
client.chainList.getNativeToken(8453);                     // TokenInfo
client.chainList.getChainAndTokenFromSymbol(8453, 'USDC'); // { chain, token, isNativeToken }
```

---

## Operations

### Bridge

Moves tokens cross-chain to the connected wallet.

```ts
const result = await client.bridge(
  {
    toTokenSymbol: 'USDC',
    toAmountRaw: 100_000_000n,   // 100 USDC (6 decimals)
    toChainId: 137,              // Polygon
    sources: [1, 42161],         // optional — auto-selected if omitted
    toNativeAmountRaw: 0n,       // optional — native gas on destination
    recipient: '0x...',          // optional — defaults to connected wallet
  },
  {
    onEvent: (event) => { /* BridgeEvent */ },
    hooks: {
      onIntent: ({ intent, allow, deny, refresh }) => allow(),
      // allow() needs one entry per source — map over sources to be safe
      onAllowance: ({ sources, allow, deny }) => allow(sources.map(() => 'min')),
    },
    fillTimeoutMinutes: 2, // default
  },
);
// Returns: BridgeResult { intentExplorerUrl, sourceTxs, intent }
```

### Transfer (Bridge + Send)

Bridge tokens and send to a different recipient.

```ts
const result = await client.bridgeAndTransfer(
  {
    toTokenSymbol: 'USDC',
    toAmountRaw: 50_000_000n,
    toChainId: 42161,
    recipient: '0x742d...',   // required
    sources: [1],             // optional
  },
  options, // same as bridge
);
// Returns: TransferResult (= BridgeAndExecuteResult) { approval?, execute, bridgeSkipped, bridgeResult? }
```

### Execute (Smart Contract Call)

Execute a transaction on a specific chain.

```ts
const result = await client.execute(
  {
    toChainId: 1,
    to: '0xContractAddress',
    data: '0x...',                  // encoded calldata
    value: 0n,                      // optional ETH to send
    gas: 100_000n,                  // optional gas limit override
    gasPrice: 'medium',             // 'low' | 'medium' | 'high'
    tokenApproval: {                // optional bridge-style approval (uses symbols)
      toTokenSymbol: 'USDC',
      amount: 1_000_000n,
      spender: '0x...',
    },
    enableTransactionPolling: true, // optional — poll RPC for inclusion
    transactionTimeout: 60_000,     // optional — polling timeout (ms)
    waitForReceipt: true,           // optional
    receiptTimeout: 60_000,         // optional — receipt-wait timeout (ms)
    requiredConfirmations: 1,       // optional — block confirmations to wait
  },
  { onEvent: (event) => {} },
);
// Returns: ExecuteResult { approval?, execute, chainId, confirmations?, gasUsed?, effectiveGasPrice? }
```

### Bridge + Execute (Composite)

**Two operations orchestrated in sequence, NOT one atomic transaction:** (1) a bridge that funds the shortfall on the destination chain — skipped when the destination already holds enough (`bridgeSkipped: true`); then (2) the execute (plus an optional token approval), which **always** runs from the user's connected wallet on the destination chain. The two steps succeed/fail independently — a failed execute does not roll back the bridge; the bridged funds stay in the user's wallet on the destination chain.

```ts
const result = await client.bridgeAndExecute(
  {
    toChainId: 1,
    toTokenSymbol: 'USDC',
    toAmountRaw: 100_000_000n,
    sources: [42161],                            // optional
    execute: { to: '0x...', data: '0x...' },     // execute is Omit<ExecuteParams, 'toChainId'> — DO NOT set toChainId here
    enableTransactionPolling: true,              // optional
    transactionTimeout: 60_000,                  // optional
    waitForReceipt: true,                        // optional
    receiptTimeout: 60_000,                      // optional
    requiredConfirmations: 1,                    // optional
    recentApprovalTxHash: '0x...',               // optional — skip a redundant approval already submitted in the same flow
  },
  {
    onEvent: (event) => { /* BridgeAndExecuteEvent */ },
    onIntent: ({ intent, allow, deny }) => allow(),   // top-level, NOT hooks.onIntent
    beforeExecute: async () => ({ value: 0n }),        // optional — patch value/data/gas right before execute
    fillTimeoutMinutes: 2,                             // optional
  },
);
// Returns: BridgeAndExecuteResult { approval?, execute, bridgeSkipped, bridgeResult? }
```

**Important:** `bridgeAndExecute` and `swapAndExecute` use **top-level** `onIntent`, not nested under `hooks`. `BridgeAndExecuteParams.execute` is `Omit<ExecuteParams, 'toChainId'>` — passing `execute.toChainId` is a type error; the destination chain is inherited from the top-level `toChainId`.

### Swap (Cross-Chain Token Swap)

Swaps use **token contract addresses** (not symbols). For source tokens known to the SDK, resolve addresses via `client.chainList`. The destination token (`toTokenAddress`) can be **any ERC20 token** — there is no master list. The app is responsible for determining the destination contract address.

**Exact Input** — caller specifies the input amounts:

```ts
// Resolve source token address from chainList (for SDK-known tokens)
const { token: srcToken } = client.chainList.getChainAndTokenFromSymbol(10, 'USDC');

// Destination token is any ERC20 — the app provides the address
const exactInResult = await client.swapWithExactIn(
  {
    sources: [                    // optional — auto-selected if omitted
      { chainId: 10, tokenAddress: srcToken.contractAddress, amountRaw: 1_000_000n },
    ],
    toChainId: 8453,
    toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  },
  {
    slippageTolerance: 0.005,             // optional
    onEvent: (event) => { /* SwapEvent */ },
    hooks: {
      onIntent: ({ intent, allow, deny }) => allow(),
    },
  },
);
// Returns: SwapResult { sourceSwaps, intentExplorerUrl, destinationSwap }
```

**Exact Output** — caller specifies the desired output amount:

```ts
const exactOutResult = await client.swapWithExactOut(
  {
    toChainId: 42161,
    toTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    toAmountRaw: 100_000_000n,
    toNativeAmountRaw: 100_000_000_000_000n,           // optional — destination native gas top-up
    sources: [{ chainId: 8453, tokenAddress: '0x...' }], // optional — restrict source tokens
  },
  {
    slippageTolerance: 0.005,
    onEvent: (event) => { /* SwapEvent */ },
    hooks: {
      onIntent: ({ intent, allow, deny }) => allow(),
    },
  },
);
// Returns: SwapResult { sourceSwaps, intentExplorerUrl, destinationSwap }
```

**Calculate Maximum Swappable** — populate a "Max" button before calling `swapWithExactIn`:

```ts
const max = await client.calculateMaxForSwap({
  toChainId: 8453,
  toTokenAddress: '0x...',
  sources: [{ chainId: 10, tokenAddress: '0x...' }], // optional
});
// Returns: SwapMaxResult { maxAmount, maxAmountRaw, symbol, decimals, sources[] }
```

**Calculate Maximum Bridgeable** — populate a "Max" button before calling `bridge`:

```ts
const max = await client.calculateMaxForBridge({
  toChainId: 8453,
  toTokenSymbol: 'USDC',
  sources: [10, 42161], // optional — restrict source chain IDs
});
// Returns: BridgeMaxResult { provider, maxAmount, maxAmountRaw, symbol, decimals, sources[] }
// `provider` ('nexus' | 'mayan') is the path the max was sized against; a max(3%, $3)
// safety haircut is applied so the amount survives fee drift before execution.
```

### Swap + Execute (Composite)

**Two operations orchestrated in sequence, NOT one atomic transaction:** (1) a swap that funds the shortfall on the destination chain — skipped when the destination already holds enough (`swapSkipped: true`); then (2) the execute (plus an optional token approval), which **always** runs from the user's connected wallet on the destination chain. The two steps succeed/fail independently — a failed execute does not roll back the swap; the swapped funds stay in the user's wallet on the destination chain.

```ts
const result = await client.swapAndExecute(
  {
    toChainId: 42161,
    toTokenAddress: '0x...',
    toAmountRaw: 100_000_000n,
    sources: [{ chainId: 8453, tokenAddress: '0x...' }],
    execute: {
      to: '0x...',
      data: '0x...',
      gas: 100_000n,
      tokenApproval: { toTokenAddress: '0x...', amount: 1_000_000n, spender: '0x...' },
    },
  },
  {
    onEvent: (event) => { /* SwapAndExecuteEvent */ },
    onIntent: ({ intent, allow, deny }) => allow(), // top-level
    slippageTolerance: 0.005,                       // optional (default 0.5%)
  },
);
// Returns: SwapAndExecuteResult { approval?, execute, swapSkipped, swapResult? }
```

### Simulations

Pre-flight check gas, fees, and approvals without executing. Each `simulate*` takes the same params as its action counterpart:

```ts
const bridgeSim = await client.simulateBridge(bridgeParams);
// → BridgeSimulationResult { intent, token }

const transferSim = await client.simulateBridgeAndTransfer(transferParams);
// → BridgeAndExecuteSimulationResult { bridgeSimulation, executeSimulation }

const bridgeAndExecuteSim = await client.simulateBridgeAndExecute(bridgeAndExecuteParams);
// → BridgeAndExecuteSimulationResult { bridgeSimulation, executeSimulation }

const executeSim = await client.simulateExecute(executeParams);
// → ExecuteSimulation { feeParams, estimatedGasUnits, estimatedTotalCost }
```

### Balances

```ts
const bridgeAssets = await client.getBalancesForBridge();  // TokenBalance[]
const swapAssets = await client.getBalancesForSwap();      // TokenBalance[]
```

### Intent Listing (Page-Based)

```ts
import { IntentStatus } from '@avail-project/nexus-core';

const { intents, total } = await client.listIntents({
  page: 1,                            // optional, default 1; page size is fixed at 20
  status: IntentStatus.Fulfilled,     // optional: Created | Deposited | Fulfilled | Expired (or the matching string literals)
});

// IntentRecord shape:
//   { requestHash, explorerUrl, status, solver, createdAt?, updatedAt?, expiry,
//     recipientAddress, destinationChain, destinations[], sources[] }
// destinations[] and sources[] are arrays — each carries token { contractAddress, symbol, name, logo, decimals },
// amount/amountRaw, and (sources only) fee/feeRaw.
```

### Other Utilities on Client

```ts
client.isSupportedChain(chainId);                              // boolean
client.getSupportedChains();                                   // SupportedChainsAndTokensResult
client.convertTokenReadableAmountToBigInt('1.5', 'USDC', 8453); // bigint
```

---

## Hooks (Per-Operation)

Hooks are passed via the `options` parameter of each operation. If omitted, the SDK **auto-approves** (intents allowed, allowances set to `'min'`).

### Intent Hook

```ts
hooks: {
  onIntent: ({ intent, allow, deny, refresh }) => {
    // inspect intent details
    console.log(intent.selectedSources, intent.destination);

    // optionally refresh with different source chains
    const refreshed = await refresh([8453, 42161]);

    allow();  // proceed
    // deny(); // throws UserActionError with code 'user_action/intent_hook_denied' (service='hook')
  },
}
```

### Allowance Hook

The array passed to `allow()` **must have the same length as `sources`** — otherwise the SDK throws `INVALID_VALUES_ALLOWANCE_HOOK`. Each entry can be `'min'` (exact amount needed), `'max'` (unlimited / `type(uint256).max`), or a literal amount (`bigint` or decimal string).

```ts
hooks: {
  onAllowance: ({ sources, allow, deny }) => {
    // sources[i] has: chain, token, allowance.current, allowance.minimum
    allow(sources.map(() => 'min'));            // exact minimum on every source — safest default
    allow(sources.map(() => 'max'));            // unlimited on every source
    allow(sources.map(() => 1_000_000n));       // a specific bigint amount per source
    // mixed example: max for chain 1, min everywhere else
    allow(sources.map((s) => (s.chain.id === 1 ? 'max' : 'min')));
    // deny(); // throws UserActionError with code 'user_action/allowance_approval_denied' (service='wallet')
  },
}
```

### Composite Operation Hooks

`bridgeAndExecute()` and `swapAndExecute()` use a **top-level** `onIntent` (not `hooks.onIntent`):

```ts
await client.bridgeAndExecute(params, {
  onIntent: ({ intent, allow, deny }) => allow(),
  beforeExecute: async () => ({ value: 0n }),
});
```

---

## Event System

All operations emit typed events via `onEvent`. Events are a discriminated union on `type`.

### Event Types

```ts
onEvent: (event) => {
  switch (event.type) {
    case 'status':         // { status: 'intent_building' | 'executing' | ... }
    case 'plan_preview':   // { plan: BridgePlan }   — steps about to run
    case 'plan_confirmed': // { plan: BridgePlan }   — after user approval
    case 'plan_progress':  // { stepType, state, step } — per-step updates
  }
}
```

### Bridge Status Flow

`intent_building` → `intent_ready` → `awaiting_approval` → `approved` → `awaiting_allowance_selection` → `executing` → `completed`

### Bridge Step Types & States

| stepType | states |
|---|---|
| `allowance_approval` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |
| `request_signing` | `wallet_prompted`, `completed`, `failed` |
| `request_submission` | `started`, `completed`, `failed` |
| `vault_deposit` | `started`, `wallet_prompted`, `submitted`, `confirmed`, `completed`, `failed` |
| `bridge_fill` | `waiting`, `completed`, `failed` |

### Swap Status Flow

`route_building` → `route_ready` → `awaiting_approval` → `approved` → `executing` → `completed`

### Swap Step Types & States

| stepType | states |
|---|---|
| `source_swap` | `wallet_prompted`, `started`, `submitted`, `confirmed`, `failed` |
| `eoa_to_ephemeral_transfer` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |
| `bridge_deposit` | `started`, `submitted`, `confirmed`, `failed` |
| `bridge_intent_submission` | `started`, `completed`, `failed` |
| `bridge_fill` | `waiting`, `completed`, `failed` |
| `destination_swap` | `wallet_prompted`, `started`, `submitted`, `confirmed`, `failed` |

### Execute Step Types & States (used in composite flows)

| stepType | states |
|---|---|
| `execute_approval` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |
| `execute_transaction` | `wallet_prompted`, `submitted`, `confirmed`, `failed` |

### Composite Status Flows

**Bridge + Execute:** `preparing` → `intent_building` → `intent_ready` → `awaiting_approval` → `approved` → `executing` → `completed`

**Swap + Execute:** `preparing` → `route_building` → `route_ready` → `awaiting_approval` → `approved` → `executing` → `completed`

Composite events include all bridge/swap steps above plus execute steps. Plans include `bridgeRequired`/`swapRequired` booleans to indicate whether the bridge/swap phase is needed.

### Progress Event Payloads

Each `plan_progress` event carries `stepType`, `state`, and `step` (the step object) **plus state-specific fields** — these are fully typed, so narrow on (`stepType`, `state`) to access them:

- `txHash` / `explorerUrl` — on-chain steps in `submitted`/`confirmed` (optional on `failed`): `allowance_approval`, `vault_deposit`, `execute_approval`, `execute_transaction`, source/destination swaps. Use for "View tx" links.
- `intentRequestHash` — `request_signing` (completed), `request_submission`, `bridge_fill`. Use for "View intent" links.
- `error` — on every `failed` state.
- `approvedAmount`/`approvedAmountRaw` (`allowance_approval`); `value`/`hasData` (`execute_transaction`).

Chain/token metadata lives on **`event.step`** (e.g. `event.step.chain.name`, `event.step.asset`, `event.step.token`), **not** on `event` directly. See [README → Progress Event Payloads](../../README.md#progress-event-payloads).

---

## Error Handling

All SDK errors are concrete subclasses of the abstract base `NexusError<C>`. Switch on `instanceof <Subclass>` (or `error.category`) for coarse handling, and on `error.code` (a stable `category/specific_noun_suffix` string) for fine-grained handling. Errors are flat — there's no `cause` chain and no chain-walking. When the SDK catches an underlying error (a viem revert, an HTTP failure), its text is inlined into `error.message`, so `message` is self-contained for logs and toasts.

### Hierarchy

| Subclass | `category` | required `context.service` values |
|---|---|---|
| `ValidationError` | `validation` | _(none — caller input / preconditions)_ |
| `UserActionError` | `user_action` | `'wallet'` (sign denial) or `'hook'` (dApp hook denial) |
| `SimulationError` | `simulation` | `'rpc'` |
| `ExecutionError` | `execution` | `'wallet'` (submit/sign) or `'rpc'` (read/receipt) |
| `BackendError` | `backend` | `'middleware'` (Avail backend) |
| `ExternalServiceError` | `external_service` | `'lifi'`, `'bebop'`, `'fibrous'`, or `'coinbase'` |
| `InternalError` | `internal` | _(none — SDK invariants only)_ |

Every `NexusError` carries:

- `category` — pinned literal per subclass
- `code` — stable string, e.g. `'validation/insufficient_balance'`, `'execution/tx_onchain_reverted'`
- `context: { operation?, service?, stepId?, stepType?, chainId? }` — typed; `service` is narrowed to the subclass's allowed values
- `details?` — additional structured context
- `toJSON()` — flat, single-level serialization (`name`, `message`, `category`, `code`, `context`, `details`)

`NexusStepError` and the old `error.data?.*` envelope are **gone**. Step metadata now lives on `error.context` of whichever subclass actually applies — see the "Step-bound failures" section below.

### Handling pattern

```ts
import {
  NexusError,
  ValidationError,
  UserActionError,
  BackendError,
  ExecutionError,
  ExternalServiceError,
  ERROR_CODES,
} from '@avail-project/nexus-core';

try {
  await client.bridge(params, options);
} catch (error) {
  if (!(error instanceof NexusError)) {
    // Unexpected non-SDK error
    throw error;
  }

  // Coarse handling by subclass
  if (error instanceof UserActionError) {
    // User cancelled — typically not shown as a failure
    return;
  }
  if (error instanceof ValidationError) {
    showValidationError(error.message);
    return;
  }
  if (error instanceof BackendError || error instanceof ExternalServiceError) {
    showRetryableUpstreamError(error.code, error.context.service);
    return;
  }

  // Fine-grained by specific code
  switch (error.code) {
    case ERROR_CODES.INSUFFICIENT_BALANCE:
      showInsufficientBalanceUI();
      break;
    case ERROR_CODES.EXEC_TX_RECEIPT_WAIT_TIMEOUT:
      showRetryOption();
      break;
    case ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED:
      showOnChainRevert(error.context.chainId);
      break;
    case ERROR_CODES.BACKEND_FULFILMENT_WAIT_TIMEOUT:
      showFulfillmentTimeout();
      break;
    case ERROR_CODES.EXEC_SLIPPAGE_EXCEEDED:
      showRetryWithHigherSlippage();
      break;
    default:
      showGenericError(error.message);
  }

  // Errors are flat — the underlying cause text is already inlined into error.message.
  console.error(error.code, error.message, error.context, error.details);
}
```

### Step-bound failures

There is no `NexusStepError` anymore. Step-bound failures are whichever subclass actually applies, carrying `context.stepId` / `context.stepType` / `context.chainId`:

```ts
if (error instanceof NexusError && error.context.stepId !== undefined) {
  console.log(
    'Step failed:',
    error.context.stepType,
    'on chain',
    error.context.chainId,
  );
}
```

`error.code` still identifies the specific failure (e.g. `EXEC_VAULT_DEPOSIT_SEND_FAILED`, `BACKEND_FULFILMENT_WAIT_TIMEOUT`), independent of the step.

### Common Error Codes

Codes follow `category/specific_noun_suffix`. Suffixes: `_failed`, `_timeout`, `_reverted`, `_denied`, `_exceeded`, or no suffix for terminal non-failure states.

**User actions (`UserActionError`, service `'wallet'` or `'hook'`):**
- `user_action/intent_hook_denied` — denied via the dApp's intent hook (service=`'hook'`)
- `user_action/intent_signature_denied` — rejected EIP-191 sign in wallet
- `user_action/allowance_approval_denied` — rejected ERC20 approve tx
- `user_action/siwe_signature_denied` — rejected SIWE signature
- `user_action/tx_send_denied` — rejected a tx send (execute / vault deposit / atomic batch)
- `user_action/ephemeral_key_denied` — rejected the ephemeral-key derivation signature

**Validation (`ValidationError`, no service):**
- `validation/insufficient_balance`
- `validation/no_balance_for_address`
- `validation/invalid_input`, `validation/invalid_address_length`, `validation/invalid_allowance_hook`
- `validation/token_not_supported`, `validation/chain_not_found`, `validation/chain_data_not_found`, `validation/asset_not_found`
- `validation/sdk_not_initialized`, `validation/wallet_not_connected`, `validation/sdk_init_state_unexpected`
- `validation/environment_not_supported`, `validation/environment_not_known`, `validation/universe_not_supported`, `validation/vault_contract_not_found`

**Execution (`ExecutionError`, service `'wallet'` or `'rpc'`):**
- `execution/tx_onchain_reverted` (rpc) — tx mined with status=0
- `execution/tx_submission_reverted` (wallet) — wallet returned revert reason at submit time
- `execution/tx_receipt_wait_timeout` (rpc) — receipt didn't arrive in time
- `execution/exec_tx_send_failed` (wallet) / `execution/exec_tx_confirm_failed` (rpc)
- `execution/approval_tx_send_failed` (wallet) / `execution/approval_tx_confirm_failed` (rpc)
- `execution/intent_sign_failed` / `execution/permit_sign_failed` (wallet, technical — distinct from user-denial codes above)
- `execution/wallet_connect_failed`, `execution/chain_switch_failed` (wallet)
- `execution/gas_estimate_failed`, `execution/gas_price_fetch_failed`, `execution/l1_fee_estimate_failed` (rpc)
- `execution/erc20_allowance_read_failed`, `execution/erc20_nonce_read_failed`, `execution/erc20_name_read_failed` (rpc)
- `execution/atomic_batch_status_failed` (rpc) — `waitForCallsStatus` poll failed
- `execution/vault_deposit_send_failed` / `execution/vault_deposit_confirm_failed`
- `execution/destination_sweep_failed`, `execution/refund_send_failed`, `execution/refund_check_failed`
- `execution/slippage_exceeded` — post-execution slippage guard tripped

**Backend (`BackendError`, service=`'middleware'`):**
- `backend/balances_fetch_failed`, `backend/deployment_fetch_failed`, `backend/oracle_prices_fetch_failed`
- `backend/rff_submit_failed`, `backend/rff_fetch_failed`, `backend/rff_status_fetch_failed`, `backend/rff_list_failed`
- `backend/sbc_submit_failed`, `backend/approvals_ws_failed`
- `backend/simulation_bundle_failed`
- `backend/fulfilment_wait_timeout` — bridge fulfilment didn't land in window

**External service (`ExternalServiceError`, service `'lifi'`, `'bebop'`, `'fibrous'`, or `'coinbase'`):**
- `external_service/destination_swap_quote_failed`
- `external_service/source_swap_quote_failed`
- `external_service/swap_route_build_failed`
- `external_service/rates_drift_exceeded` — aggregator re-quote drifted beyond tolerance
- `external_service/exchange_rate_fetch_failed` — Coinbase pricing (service=`'coinbase'`)

**Simulation (`SimulationError`, service=`'rpc'`):**
- `simulation/eth_call_failed`

**Internal (`InternalError`, no service):**
- `internal/error` (catch-all SDK invariant)
- `internal/unknown_signature`, `internal/ephemeral_key_derive_failed`, `internal/destination_request_hash_not_found`

The full code surface is on the `ERROR_CODES` const — use IDE autocomplete on `ERROR_CODES.` to discover every constant. Constant names use SCREAMING_SNAKE (e.g. `ERROR_CODES.INSUFFICIENT_BALANCE`); the string values are the namespaced forms above.

### Observability (OTel)

Every failure at a public method boundary emits one OTel log record with stable attributes — usable directly in SigNoz, Honeycomb, Grafana, etc.:

- `operation`, `operation.id` (PostHog tracker id, or `'no_analytics'` for utility helpers)
- `error.name`, `error.category`, `error.code`, `error.service`
- `error.message`, `error.context.{stepId,stepType,chainId}`, `error.details` (sanitized)
- Errors are flat — there is no `error.chain` / `error.rootCause.*`. The underlying cause text is inlined into `error.message`.
- Flattened sanitized params/options on top-level attributes from a stable allow-list: `params.toChainId`, `params.toTokenSymbol`, `params.toAmountRaw`, `params.recipient`, `options.fillTimeoutMinutes`, `options.slippageTolerance`, etc. Full sanitized blobs are also retained as `params.raw` / `options.raw`.

This makes precise alert rules possible without log-message string matching, e.g. `error.code = "backend/balances_fetch_failed" AND count(5m) > 5` or `error.service = "middleware" AND rate(5m) > 0.1`. Telemetry init failures are swallowed — your SDK calls won't reject just because the underlying OTel exporter couldn't set up.

---

## Utils (Tree-Shakeable Subpath)

Import utilities from the `utils` subpath — they are NOT exported from the main entry point.

```ts
import {
  formatTokenBalance,
  formatTokenBalanceParts,
  parseUnits,
  formatUnits,
  isValidAddress,
  truncateAddress,
  getCoinbaseRates,
  getSupportedChains,
} from '@avail-project/nexus-core/utils';
```

### Examples

```ts
parseUnits('100', 6);                // 100_000_000n (USDC)
formatUnits(100_000_000n, 6);        // "100"

formatTokenBalance(1.234567, { symbol: 'ETH' });       // "1.2346 ETH"
formatTokenBalance(1530000n, { decimals: 6, symbol: 'USDC' }); // "1.53 USDC"

isValidAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // true
truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // "0x742d...Db45"

const rates = await getCoinbaseRates(); // { ETH: "3245.12", USDC: "1.00", ... }
```

**Exception — `getFallbackTokenLogoDataUri`** is exported from the **main entry** (not `/utils`). It returns a deterministic gradient SVG data-URI for a token/chain symbol — a stable placeholder for missing logos:

```ts
import { getFallbackTokenLogoDataUri } from '@avail-project/nexus-core';
const src = token.logo || getFallbackTokenLogoDataUri(token.symbol); // size defaults to 128
```

---

## Key Pitfalls

1. **Amounts are always `bigint` in raw token units** — use `parseUnits('100', 6)` for 100 USDC, not `100`.
2. **Bridge uses token symbols, swap uses contract addresses.** `bridge`/`bridgeAndTransfer`/`bridgeAndExecute` take `toTokenSymbol: 'USDC'` and `tokenApproval.toTokenSymbol`. `swapWithExactIn`/`swapWithExactOut`/`swapAndExecute` take `toTokenAddress: '0x...'` and `tokenApproval.toTokenAddress`.
3. **Composite hooks are top-level** — `bridgeAndExecute` and `swapAndExecute` use `options.onIntent`, not `options.hooks.onIntent`.
4. **`bridgeAndExecute().execute` omits `toChainId`.** `BridgeAndExecuteParams.execute` is `Omit<ExecuteParams, 'toChainId'>`; setting it is a type error. The destination chain is inherited from the top-level `toChainId`.
5. **Default auto-approval** — if no hooks are provided, intents are allowed and allowances use `'min'`. When you do provide an `onAllowance` hook, the array passed to `allow()` must have the same length as `sources` (otherwise the SDK throws `INVALID_VALUES_ALLOWANCE_HOOK`); the safest pattern is `allow(sources.map(() => 'min'))`.
6. **`initialize()` and `setEVMProvider()` are independent.** `initialize()` is required before any chain-dependent method; `setEVMProvider()` only attaches a wallet and can be called in any order.
7. **Create a new client on account change.** `setEVMProvider()` short-circuits when called with the same provider instance, so it cannot be reused to swap accounts. Rebuild with `createNexusClient()` and re-run both setup steps.
8. **Bridge skip optimization** — `bridgeAndExecute` and `swapAndExecute` may skip the bridge/swap if the destination chain already has enough funds; always branch on `result.bridgeSkipped` / `result.swapSkipped` before reading `result.bridgeResult` / `result.swapResult`.

---

## Migrating from v1

If you are migrating from `@avail-project/nexus-core` (v1), see `MIGRATION.md` at the repo root for the full guide. Key breaking changes:

### Package & Initialization

```diff
- import { NexusSDK } from '@avail-project/nexus-core';
- const sdk = new NexusSDK({ network: 'mainnet' });
- await sdk.initialize(provider);
+ import { createNexusClient } from '@avail-project/nexus-core';
+ const client = createNexusClient({ network: 'mainnet' });
+ await client.initialize();
+ await client.setEVMProvider(provider);
```

### Teardown

```diff
- await sdk.deinit();
+ client.destroy(); // synchronous
```

### Parameter Renames (All Operations)

| v1 | v2 | Where |
|---|---|---|
| `token` | `toTokenSymbol` | `BridgeParams`, `TransferParams`, `BridgeAndExecuteParams` |
| `amount` | `toAmountRaw` | `BridgeParams`, `TransferParams`, `BridgeAndExecuteParams` |
| `sourceChains` | `sources` | `BridgeParams`, `TransferParams`, `BridgeAndExecuteParams` |
| `tokenApproval.token` | `tokenApproval.toTokenSymbol` | `execute()` and `bridgeAndExecute().execute` (bridge execute uses symbols) |
| `tokenApproval.token` | `tokenApproval.toTokenAddress` | `swapAndExecute().execute` (swap execute uses contract addresses) |
| `fromSources` / `toAmount` | `sources` / `toAmountRaw` | `swapAndExecute()` |

### Hooks: Global → Per-Operation

```diff
- sdk.setOnIntentHook((data) => data.allow());
- sdk.setOnAllowanceHook((data) => data.allow(data.sources.map(() => 'min')));
- await sdk.bridge(params);
+ await client.bridge(params, {
+   hooks: {
+     onIntent: (data) => data.allow(),
+     onAllowance: (data) => data.allow(data.sources.map(() => 'min')),
+   },
+ });
```

### Events: Flat → Plan-Based

```diff
- onEvent: (event) => { switch (event.name) { case 'STEPS_LIST': ... } }
+ onEvent: (event) => { switch (event.type) { case 'plan_preview': ... } }
```

### Swap Types Renamed

| v1 type | v2 type | Key field changes |
|---|---|---|
| `ExactInSwapInput` | `SwapExactInParams` | `from[]` → `sources[]`; `from[].amount` → `sources[].amountRaw` |
| `ExactOutSwapInput` | `SwapExactOutParams` | `fromSources` → `sources`; `toAmount` → `toAmountRaw`; `toNativeAmount` → `toNativeAmountRaw` |
| `MaxSwapInput` | `SwapMaxParams` | `fromSources` → `sources` |
| `SuccessfulSwapResult` | `SwapResult` | `explorerURL` → `intentExplorerUrl`; `swapRoute` removed |
| `MaxSwapResult` | `SwapMaxResult` | (renamed only) |
| `OnSwapIntentHook` | `OnIntentHookData` | Now passed via `options.hooks.onIntent` instead of a global setter |

### Swap Results: Union → Throw

```diff
- const result = await sdk.swapWithExactIn(input);
- if (result.success) { console.log(result.result.explorerURL); }
+ const result = await client.swapWithExactIn(input); // throws on failure
+ console.log(result.intentExplorerUrl);
```

### Balance APIs

The call shape is unchanged (still async, still returns the array directly), but the element type was renamed from `UserAssetDatum` to `TokenBalance` (and `AssetBreakdown` → `ChainBalance`). `getBalancesForSwap()` no longer accepts the `onlyNativesAndStables` filter argument.

```diff
- const assets: UserAssetDatum[] = await sdk.getBalancesForBridge();
+ const assets: TokenBalance[] = await client.getBalancesForBridge();
```

### Intent Listing

v1 took a positional `page` number and returned a flat array of `RFF`. v2 takes an options object and returns `{ intents, total }` with restructured `IntentRecord` items (page size is fixed at 20).

```diff
- const rffs = await sdk.getMyIntents(1);
+ const { intents, total } = await client.listIntents({ page: 1, status: IntentStatus.Fulfilled });
```

### Removed / replaced APIs

- `isInitialized` — removed.
- `triggerAccountChange` — removed. **On account change, build a fresh client** (`createNexusClient()`) and re-run `initialize()` + `setEVMProvider()`. `setEVMProvider()` is **not** a substitute: it short-circuits when called with the same provider instance.
- `refundIntent` — removed from the SDK surface.
- `getSwapSupportedChains` — removed; `getSupportedChains()` now includes per-chain token info.
- `setOnIntentHook` / `setOnSwapIntentHook` / `setOnAllowanceHook` — replaced by per-operation `hooks.onIntent` / `hooks.onAllowance`.
- `getMyIntents(page)` — replaced by `listIntents({ page, status })`.
- `deinit()` — replaced by synchronous `destroy()`.

### Removed Exports

Static constants (`CHAIN_METADATA`, `TOKEN_METADATA`, `MAINNET_CHAINS`, `TESTNET_CHAINS`, `SUPPORTED_CHAINS`, `TOKEN_CONTRACT_ADDRESSES`, `NEXUS_EVENTS`, `BRIDGE_STEPS`, `SWAP_STEPS`, etc.) are gone. Discover supported chains/tokens dynamically via `client.chainList`, `client.getSupportedChains()`, or the async `getSupportedChains(env)` from `@avail-project/nexus-core/utils`. Utility functions (`formatTokenBalance`, `parseUnits`, `truncateAddress`, …) moved to the `/utils` subpath.

The v1 `Environment` runtime enum is also removed: v2's `NexusNetwork` is a TypeScript type only — pass the string literal `'mainnet'` / `'testnet'` (or a custom `NetworkConfig`) to `createNexusClient({ network })`.

For the full migration checklist, see `MIGRATION.md`.

---

## Type Imports Reference

```ts
// Main entry — client, error hierarchy, and all domain types
import {
  createNexusClient,
  // Error hierarchy (NexusStepError no longer exists — use NexusError + context.stepId)
  NexusError,
  ValidationError,
  UserActionError,
  SimulationError,
  ExecutionError,
  BackendError,
  ExternalServiceError,
  InternalError,
  ERROR_CODES,
  IntentStatus,
  type NexusClient,
  type BridgeParams,
  type BridgeResult,
  type BridgeEvent,
  type BridgeIntent,
  type BridgePlan,
  type BridgeSimulationResult,
  type TransferParams,
  type ExecuteParams,
  type ExecuteResult,
  type ExecuteSimulation,
  type ExecuteFeeParams,
  type BridgeAndExecuteParams,
  type BridgeAndExecuteResult,
  type BridgeAndExecuteEvent,
  type SwapExactInParams,
  type SwapExactOutParams,
  type SwapMaxParams,
  type SwapResult,
  type SwapMaxResult,
  type SwapEvent,
  type SwapAndExecuteParams,
  type SwapAndExecuteResult,
  type SwapAndExecuteEvent,
  type TokenBalance,
  type ChainBalance,
  type IntentRecord,
  type ListIntentsParams,
  type ListIntentsResult,
  type OnIntentHookData,
  type OnAllowanceHookData,
  type AllowanceHookSource,
  // Error model types — useful for typed consumers writing strongly-typed handlers
  type ErrorCategory,
  type ErrorCode,
  type ErrorContext,
  type OperationName,
  type ServiceFor,
  type BackendService,
  type ExecutionService,
  type ExternalServiceService,
  type SimulationService,
  type UserActionService,
} from '@avail-project/nexus-core';

// Utils subpath
import {
  formatTokenBalance,
  formatTokenBalanceParts,
  parseUnits,
  formatUnits,
  isValidAddress,
  truncateAddress,
  getCoinbaseRates,
  getSupportedChains,
} from '@avail-project/nexus-core/utils';
```
