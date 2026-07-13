# @avail-project/nexus-core

A **headless TypeScript SDK** for **cross-chain operations**, **token bridging**, **swapping**, and **unified balance management**.
Built for backends, CLIs, and custom UI integrations.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Features](#core-features)
- [Configuration](#configuration)
- [API Reference](#api-reference)
  - [Initialization & Lifecycle](#initialization--lifecycle)
  - [Balance Operations](#balance-operations)
  - [Bridge Operations](#bridge-operations)
  - [Transfer Operations](#transfer-operations)
  - [Execute Operations](#execute-operations)
  - [Swap Operations](#swap-operations)
  - [Intent Management](#intent-management)
- [Hooks & Callbacks](#hooks--callbacks)
  - [Intent Hook](#intent-hook)
  - [Allowance Hook](#allowance-hook)
  - [Swap Intent Hook](#swap-intent-hook)
  - [Event Callbacks](#event-callbacks)
- [Events & Steps](#events--steps)
  - [Bridge Steps](#bridge-steps)
  - [Swap Steps](#swap-steps)
  - [Building Progress UIs](#building-progress-uis)
- [Error Handling](#error-handling)
  - [NexusError Hierarchy](#nexuserror-hierarchy)
  - [Error Codes Reference](#error-codes-reference)
- [TypeScript Reference](#typescript-reference)
- [Utilities](#utilities)
- [Smart Optimizations](#smart-optimizations)
- [Analytics](#analytics)
- [Supported Networks & Tokens](#supported-networks--tokens)
- [Common Pitfalls](#common-pitfalls)
- [Resources](#resources)

---

## Prerequisites

- Node.js `>=18.0.0`
- npm `>=9.0.0`

---

## Installation

```bash
npm install @avail-project/nexus-core
```

---

## Quick Start

```typescript
import { createNexusClient } from '@avail-project/nexus-core';

// 1) Create and initialize the client
const client = createNexusClient({ network: 'mainnet' });
await client.initialize();
await client.setEVMProvider(window.ethereum);

// 2) Fetch balances
const balances = await client.getBalancesForBridge();

// 3) Execute a bridge
const result = await client.bridge(
  {
    toTokenSymbol: 'USDC',
    toAmountRaw: 100_000_000n, // 100 USDC (6 decimals)
    toChainId: 137, // Polygon
  },
  {
    onEvent: (event) => {
      if (event.type === 'status') {
        console.log('Bridge status:', event.status);
      }
      if (event.type === 'plan_preview') {
        console.log('Bridge steps:', event.plan.steps);
      }
      if (event.type === 'plan_progress') {
        console.log('Step progress:', event.step.type, event.state);
      }
    },
    hooks: {
      onIntent: ({ intent, allow, deny }) => {
        if (userConfirmsIntent(intent)) allow();
        else deny();
      },
      onAllowance: ({ sources, allow, deny }) => {
        if (userConfirmsAllowance(sources)) allow(['min']);
        else deny();
      },
    },
  }
);

console.log('Bridge complete:', result.intentExplorerUrl);
```

---

## Core Features

- **Cross-chain bridging** — Move tokens seamlessly across 14+ chains
- **Cross-chain swaps** — Execute EXACT_IN and EXACT_OUT swaps between any supported networks via LiFi, Bebop, and Fibrous aggregators
- **Unified balances** — Aggregate user assets and balances across all connected chains
- **Contract execution** — Call smart contracts with automatic bridging or swap funding logic
- **Composite operations** — Bridge + Execute or Swap + Execute, orchestrated as two sequenced operations (funding, then execution) — not a single atomic transaction
- **Transaction simulation** — Estimate gas, fees, and required approvals before sending
- **Real-time progress** — Typed event system for plan previews, step-by-step progress, and status updates
- **Complete testnet coverage** — Full multi-chain test environment
- **Comprehensive utilities** — Address, token, and chain helpers with tree-shakeable imports

---

## Configuration

### Client Configuration Options

```typescript
import { createNexusClient } from '@avail-project/nexus-core';

const client = createNexusClient({
  // Network: 'mainnet' | 'canary' | 'testnet' | custom NetworkConfig
  network: 'mainnet',

  // Enable debug logging
  debug: false,

  // Optional: override the domain used in the ephemeral-key sign message and its
  // localStorage cache key. Defaults to `window.location.host` in the browser
  // and `'localhost'` in non-browser environments. Set this for mobile wallets
  // or native shells where the auto-detected host isn't meaningful.
  domain: 'app.example.com',

  // Optional: pin every bridge (and the bridge leg of a swap) to the Mayan
  // provider, skipping the middleware's provider-selection call and asserting
  // the destination is Mayan-supported. Defaults to false (the SDK picks the
  // provider per the usual threshold logic).
  forceMayan: false,

  // Analytics configuration (see Analytics section)
  analytics: {
    enabled: true,
    privacy: {
      anonymizeWallets: true,
      anonymizeAmounts: true,
    },
  },

  // Developer timing instrumentation
  devTiming: {
    enabled: true,
    captureNetworkTiming: true,
  },
});
```

### Network Configuration

```typescript
// Mainnet
const mainnetClient = createNexusClient({ network: 'mainnet' });

// Canary (mainnet-class pre-production environment)
const canaryClient = createNexusClient({ network: 'canary' });

// Testnet
const testnetClient = createNexusClient({ network: 'testnet' });

// Custom network config (advanced)
const customClient = createNexusClient({
  network: {
    MIDDLEWARE_HTTP_URL: 'https://your-middleware.example.com',
    INTENT_EXPLORER_URL: 'https://your-explorer.example.com',
    NETWORK_HINT: 'mainnet',
  },
});
```

---

## API Reference

### Initialization & Lifecycle

#### `initialize()`

Fetches deployment data (chains, tokens, vault contracts) from the middleware. Must be called once before any chain-dependent operations.

```typescript
await client.initialize();
```

#### `setEVMProvider(provider)`

Connect or update the EVM-compatible wallet provider.

```typescript
await client.setEVMProvider(window.ethereum);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `EthereumProvider` | EIP-1193 compatible provider (MetaMask, WalletConnect, etc.) |

With an injected wallet you can pass `window.ethereum` directly. With a wallet library (wagmi, RainbowKit, Web3Modal, …), obtain the EIP-1193 provider from the active connector first — e.g. `const provider = await connector.getProvider()` — then pass it in. If your library's provider type doesn't structurally match `EthereumProvider`, cast it (`provider as EthereumProvider`); the SDK only uses the standard `request()` surface.

#### `destroy()`

Flush analytics and clean up resources. Call when the client is no longer needed.

```typescript
client.destroy();
```

#### `client.chainList`

After `initialize()` resolves, `client.chainList` exposes the deployed chain catalogue. Use it for contract-aware lookups instead of bundling chain/token constants in your app.

```typescript
type ChainListType = {
  chains: Chain[];                                              // all deployed chains
  getChainByID(id: number): Chain;
  getTokenInfoBySymbol(chainID: number, symbol: string): TokenInfo;
  getTokenByAddress(chainID: number, address: Hex): TokenInfo;
  getTokenByCurrencyId(chainID: number, currencyId: number): TokenInfo;
  getNativeToken(chainID: number): TokenInfo;
  getChainAndTokenFromSymbol(chainID: number, tokenSymbol: string): { chain: Chain; token: TokenInfo; isNativeToken: boolean };
  getChainAndTokenByAddress(chainID: number, address: Hex): { chain: Chain; token: TokenInfo; isNativeToken: boolean };
  getVaultContractAddress(chainID: number): Hex;
};

// `getChainByID` returns a Chain with name, native currency, and block-explorer info:
const chain = client.chainList.getChainByID(8453);
const explorerBase = chain.blockExplorers?.default?.url;   // e.g. build a tx link
const nativeSymbol = chain.nativeCurrency.symbol;          // e.g. "ETH"

// `getTokenInfoBySymbol` / `getTokenByAddress` return TokenInfo ({ contractAddress, symbol, decimals, logo, ... })
const usdc = client.chainList.getTokenInfoBySymbol(8453, 'USDC');
```

`Chain` and `ChainListType` are exported types; `chain.blockExplorers` is optional (`{ default: { name, url } } | undefined`), so guard it before building explorer links.

#### `client.hasEvmProvider`

Boolean getter that returns `true` once `setEVMProvider()` has resolved. Useful for guarding methods that require a connected wallet.

#### `isSupportedChain(chainId)`

Returns `true` if the configured deployment knows about the given chain ID. Accepts a plain `number`.

```typescript
client.isSupportedChain(8453); // true
```

#### Client Lifecycle Notes

The Nexus client is disposable and does not store durable user state. `initialize()` and `setEVMProvider()` are independent — `initialize()` only loads deployment data from the middleware, and `setEVMProvider()` only attaches a wallet. You can call them in either order, but most apps run both at startup so chain-dependent calls and wallet-dependent calls both work.

`setEVMProvider()` short-circuits when called with the same provider instance it already holds, so it cannot be used to swap accounts on a single provider. **On account change, build a fresh client** and re-run `initialize()` + `setEVMProvider()`.

---

### Balance Operations

#### `getBalancesForBridge()`

Get user's token balances across all supported chains for bridge operations.

```typescript
const assets = await client.getBalancesForBridge();

// Returns TokenBalance[] - array of assets with per-chain breakdown
// [
//   {
//     symbol: 'USDC',
//     name: 'USDC',
//     balance: '1250.50',          // Total across all chains
//     value: '1250.50',            // USD value (string)
//     decimals: 6,
//     logo: 'https://...',
//     currencyId: 1,
//     chainBalances: [             // Per-chain balances
//       {
//         balance: '500.00',
//         value: '500.00',
//         symbol: 'USDC',
//         chain: { id: 1, name: 'Ethereum', logo: '...' },
//         contractAddress: '0xa0b86991...',
//         decimals: 6,
//         universe: 0,
//       },
//       ...
//     ],
//   },
//   // ... more assets (ETH, USDT, etc.)
// ]
```

#### `getBalancesForSwap()`

Get the user's swap-sourced balances across supported chains. This returns the same
`TokenBalance[]` surface as `getBalancesForBridge()`, but it is sourced from the swap balance
pipeline used by swap preflight and routing.

```typescript
const assets = await client.getBalancesForSwap();

console.log(assets[0]?.symbol);
console.log(assets[0]?.chainBalances);
```

Use this when you want to inspect the balances the SDK will consider for swap planning, while still
working with the same grouped `TokenBalance[]` shape as bridge balances.

**TokenBalance:**

```typescript
type TokenBalance = {
  name: string;               // Display label (e.g. "USDC/USDM")
  symbol: string;             // Majority symbol by chain count
  logo: string;               // Token logo URL
  balance: string;            // Total balance (human-readable)
  value: string;              // USD value (string for precision)
  decimals: number;
  currencyId?: number;        // Required on BridgeTokenBalance
  chainBalances: ChainBalance[];
};

type ChainBalance = {
  balance: string;
  value: string;              // USD value (string)
  symbol: string;
  chain: { id: number; name: string; logo: string };
  contractAddress: `0x${string}`;
  decimals: number;
  universe: Universe;
};
```

---

### Bridge Operations

#### `bridge(params, options?)`

Bridge tokens from one or more source chains to a destination chain.

```typescript
const result = await client.bridge(
  {
    toTokenSymbol: 'USDC',
    toAmountRaw: 100_000_000n, // 100 USDC
    toChainId: 137,
    recipient: '0x...', // Optional: defaults to connected wallet
    sources: [1, 42161], // Optional: auto-selected if omitted
    toNativeAmountRaw: 100000n, // Optional: native token to supply on destination
  },
  {
    onEvent: (event) => {
      // Handle progress events
    },
    hooks: {
      onIntent: ({ allow }) => allow(),
      onAllowance: ({ allow }) => allow(['min']),
    },
    fillTimeoutMinutes: 2, // Default: 2
  }
);
```

**BridgeParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toTokenSymbol` | `string` | Yes | Token symbol: `'ETH'`, `'USDC'`, `'USDT'` |
| `toAmountRaw` | `bigint` | Yes | Amount in smallest unit (e.g., 6 decimals for USDC) |
| `toChainId` | `number` | Yes | Destination chain ID |
| `recipient` | `Hex` | No | Recipient address (defaults to connected wallet) |
| `sources` | `number[]` | No | Specific source chains to use (auto-selected if omitted) |
| `toNativeAmountRaw` | `bigint` | No | Native token amount to supply on destination chain |

**BridgeResult:**

```typescript
type BridgeResult = {
  intentExplorerUrl: string;
  sourceTxs: Array<{
    chain: { id: number; name: string; logo: string };
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  }>;
  intent: BridgeIntent;
};
```

#### `simulateBridge(params)`

Simulate a bridge operation to estimate fees and preview the intent.

```typescript
const simulation = await client.simulateBridge({
  toTokenSymbol: 'USDC',
  toAmountRaw: 100_000_000n,
  toChainId: 137,
});

console.log('Estimated fees:', simulation.intent.fees);
console.log('Source chains:', simulation.intent.selectedSources);
```

**BridgeSimulationResult:**

```typescript
type BridgeSimulationResult = {
  intent: BridgeIntent;
  token: TokenInfo;
};
```

---

### Transfer Operations

#### `bridgeAndTransfer(params, options?)`

Bridge tokens and send to a specific recipient address.

```typescript
const result = await client.bridgeAndTransfer(
  {
    toTokenSymbol: 'USDC',
    toAmountRaw: 50_000_000n, // 50 USDC
    toChainId: 42161, // Arbitrum
    recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
    sources: [1], // Optional
  },
  {
    onEvent: (event) => console.log(event),
    hooks: {
      onIntent: ({ allow }) => allow(),
      onAllowance: ({ allow }) => allow(['min']),
    },
  }
);
```

**TransferParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toTokenSymbol` | `string` | Yes | Token symbol |
| `toAmountRaw` | `bigint` | Yes | Amount in smallest unit |
| `toChainId` | `number` | Yes | Destination chain ID |
| `recipient` | `Hex` | Yes | Recipient address |
| `sources` | `number[]` | No | Specific source chains |

**TransferResult:**

```typescript
type TransferResult = {
  approval?: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
  execute: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
} & (
  | { bridgeSkipped: false; bridgeResult: BridgeResult }
  | { bridgeSkipped: true; bridgeResult?: undefined }
);
```

#### `simulateBridgeAndTransfer(params)`

Simulate a bridge-and-transfer operation.

```typescript
const simulation = await client.simulateBridgeAndTransfer({
  toTokenSymbol: 'USDC',
  toAmountRaw: 50_000_000n,
  toChainId: 42161,
  recipient: '0x...',
});
```

---

### Execute Operations

#### `execute(params, options?)`

Execute a smart contract call on a destination chain.

```typescript
const result = await client.execute(
  {
    toChainId: 1,
    to: '0xContractAddress',
    data: '0x...', // Encoded function call
    value: 0n, // ETH value to send
    tokenApproval: {
      toTokenSymbol: 'USDC',
      amount: 1_000_000n,
      spender: '0xSpenderAddress',
    },
    // Advanced options
    gasPrice: 'medium', // 'low' | 'medium' | 'high'
    waitForReceipt: true,
    receiptTimeout: 60000,
    requiredConfirmations: 1,
  }
);
```

**ExecuteParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toChainId` | `number` | Yes | Target chain ID |
| `to` | `Hex` | Yes | Contract address |
| `data` | `Hex` | No | Encoded function call data |
| `value` | `bigint` | No | Native token value to send |
| `gas` | `bigint` | No | Gas limit override |
| `gasPrice` | `'low' \| 'medium' \| 'high'` | No | Gas price tier strategy |
| `tokenApproval` | `{ toTokenSymbol, amount, spender }` | No | Token approval to send before execution |
| `enableTransactionPolling` | `boolean` | No | Poll for transaction inclusion via RPC instead of relying solely on receipt waiting |
| `transactionTimeout` | `number` | No | Polling timeout in milliseconds |
| `waitForReceipt` | `boolean` | No | Wait for transaction receipt before resolving |
| `receiptTimeout` | `number` | No | Receipt-wait timeout in milliseconds |
| `requiredConfirmations` | `number` | No | Required block confirmations before resolving |

**ExecuteResult:**

```typescript
type ExecuteResult = {
  approval?: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
  execute: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
  chainId: number;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
};
```

#### `simulateExecute(params)`

Simulate contract execution to estimate gas. The combined gas units and total cost include both the optional approval and the execute transaction.

```typescript
const simulation = await client.simulateExecute({
  toChainId: 1,
  to: '0x...',
  data: '0x...',
});

console.log('Gas units (approval + execute):', simulation.estimatedGasUnits);
console.log('Total cost (wei):', simulation.estimatedTotalCost);

if (simulation.feeParams.type === 'eip1559') {
  console.log('Max fee per gas:', simulation.feeParams.maxFeePerGas);
  console.log('Max priority fee per gas:', simulation.feeParams.maxPriorityFeePerGas);
} else {
  console.log('Legacy gas price:', simulation.feeParams.gasPrice);
}
```

**ExecuteSimulation:**

```typescript
type ExecuteFeeParams =
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: 'legacy'; gasPrice: bigint };

type ExecuteSimulation = {
  feeParams: ExecuteFeeParams;
  /** Combined gas units across approval (if required) and execution transaction. */
  estimatedGasUnits: bigint;
  /** Combined estimated cost across approval (if required) and execution transaction. */
  estimatedTotalCost: bigint;
};
```

#### `bridgeAndExecute(params, options?)`

Orchestrates **two distinct operations in sequence — not a single atomic transaction**:

1. **Bridge (conditional)** — funds the shortfall on the destination chain. Automatically skipped when the destination already holds enough of the token (`result.bridgeSkipped === true`).
2. **Execute + approval (execute always, approval optional)** — the contract call, preceded by an optional token approval, is **always** sent from the user's connected wallet on the destination chain.

Because the two steps run one after the other, they succeed or fail independently. This is **not** atomic: if the execute fails after a bridge, the bridged funds remain in the user's wallet on the destination chain (they are not rolled back).

```typescript
const result = await client.bridgeAndExecute(
  {
    toTokenSymbol: 'USDC',
    toAmountRaw: 100_000_000n,
    toChainId: 1,
    sources: [8453], // Optional
    execute: {
      to: '0xDeFiProtocol',
      data: '0x...', // deposit() call
      tokenApproval: {
        toTokenSymbol: 'USDC',
        amount: 100_000_000n,
        spender: '0xDeFiProtocol',
      },
    },
  },
  {
    onEvent: (event) => {
      if (event.type === 'status') {
        // preparing | intent_building | awaiting_approval | executing | completed
      }
      if (event.type === 'plan_preview' || event.type === 'plan_confirmed') {
        // event.plan.steps: typed composite bridge + execute plan
      }
      if (event.type === 'plan_progress') {
        // bridge or execute progress
      }
    },
    onIntent: ({ allow, deny, refresh, intent }) => {
      console.log('Bridge required:', intent.bridgeRequired);
      // even if bridge is skipped, allow() still gates execution
      allow();
    },
  }
);

if (result.bridgeSkipped) {
  console.log('Used existing balance on destination');
} else {
  console.log('Bridge explorer:', result.bridgeResult.intentExplorerUrl);
}
```

**BridgeAndExecuteParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toTokenSymbol` | `string` | Yes | Token to bridge |
| `toAmountRaw` | `bigint` | Yes | Amount to bridge (raw integer units) |
| `toChainId` | `number` | Yes | Destination chain |
| `sources` | `number[]` | No | Specific source chains to draw from (auto-selected if omitted) |
| `execute` | `Omit<ExecuteParams, 'toChainId'>` | Yes | Contract execution params (destination chain is inherited from the top-level `toChainId`) |
| `enableTransactionPolling` | `boolean` | No | Poll for inclusion via RPC after submission |
| `transactionTimeout` | `number` | No | Polling timeout in milliseconds |
| `waitForReceipt` | `boolean` | No | Wait for the execute receipt before resolving |
| `receiptTimeout` | `number` | No | Receipt-wait timeout in milliseconds |
| `requiredConfirmations` | `number` | No | Required block confirmations before resolving |
| `recentApprovalTxHash` | `string` | No | Hash of an approval submitted earlier in the same UI flow; lets the SDK skip a redundant approval |

**BridgeAndExecuteResult:**

```typescript
type BridgeAndExecuteResult = {
  approval?: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
  execute: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
} & (
  | { bridgeSkipped: false; bridgeResult: BridgeResult }
  | { bridgeSkipped: true; bridgeResult?: undefined }
);
```

#### `simulateBridgeAndExecute(params)`

Simulate bridge-and-execute to estimate costs.

```typescript
const simulation = await client.simulateBridgeAndExecute({
  toTokenSymbol: 'USDC',
  toAmountRaw: 100_000_000n,
  toChainId: 1,
  execute: { to: '0x...', data: '0x...' },
});

console.log('Bridge simulation:', simulation.bridgeSimulation);
console.log('Execute simulation:', simulation.executeSimulation);
```

**BridgeAndExecuteSimulationResult:**

```typescript
type BridgeAndExecuteSimulationResult = {
  bridgeSimulation: BridgeSimulationResult | null; // null if bridge not needed
  executeSimulation: ExecuteSimulation;
};
```

---

### Swap Operations

Swap APIs use raw integer units (`bigint`) for on-chain amounts and token contract addresses (not symbols).

#### `swapWithExactIn(input, options?)`

Swap tokens specifying the exact input amount from explicit sources.

```typescript
const result = await client.swapWithExactIn(
  {
    sources: [
      { chainId: 10, amountRaw: 1_000_000n, tokenAddress: '0xUSDC...' },
      { chainId: 42161, amountRaw: 500_000n, tokenAddress: '0xUSDC...' },
    ],
    toChainId: 8453,
    toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  {
    onEvent: (event) => {
      if (event.type === 'plan_progress') {
        console.log('Swap progress:', event.step.type, event.state);
      }
    },
    hooks: {
      onIntent: ({ intent, allow }) => {
        console.log('Swap intent:', intent);
        allow();
      },
    },
    slippageTolerance: 0.005, // 0.5% default
  }
);
```

**SwapExactInParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sources` | `Array<{ chainId, tokenAddress, amountRaw? }>` | No | Source tokens and amounts (raw integer units). Omit to use all available holdings. |
| `toChainId` | `number` | Yes | Destination chain |
| `toTokenAddress` | `Hex` | Yes | Output token address |

#### `swapWithExactOut(input, options?)`

Swap tokens specifying the exact output amount desired.

```typescript
const result = await client.swapWithExactOut(
  {
    toChainId: 42161,
    toTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC on Arbitrum
    toAmountRaw: 100_000_000n, // 100 USDC (6 decimals)
    // Optional: also fund destination native gas
    toNativeAmountRaw: 100_000_000_000_000n,
    // Optional: restrict route planning to specific source tokens/chains
    sources: [{ chainId: 8453, tokenAddress: '0x...' }],
  },
  {
    onEvent: (event) => {
      if (event.type === 'status') {
        console.log('Swap status:', event.status);
      }
      if (event.type === 'plan_preview') {
        console.log('Swap plan:', event.plan.steps);
        console.log('Has bridge:', event.plan.hasBridge);
        console.log('Has destination swap:', event.plan.hasDestinationSwap);
      }
    },
    hooks: {
      onIntent: ({ allow, deny, refresh, intent }) => {
        console.log('Swap intent:', intent);
        allow();
      },
    },
  }
);
```

**SwapExactOutParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sources` | `Array<{ chainId, tokenAddress }>` | No | Restrict source chains/tokens for quote routing |
| `toChainId` | `number` | Yes | Destination chain |
| `toTokenAddress` | `Hex` | Yes | Output token address |
| `toAmountRaw` | `bigint` | Yes | Exact output amount desired (raw integer units) |
| `toNativeAmountRaw` | `bigint` | No | Optional native gas amount for destination chain |

When eligible sources are already on the destination chain, EXACT_OUT can use the Path A fast path:
one atomic, bridge-less batch swaps directly to the requested token and optional native gas amounts.
It targets those raw outputs exactly, groups same-token funding into one authorization and transfer,
and safely re-quotes stale or definitively reverted batches without blindly replaying ambiguous ones.

**SwapResult:**

```typescript
type SwapResult = {
  sourceSwaps: ChainSwap[];
  intentExplorerUrl: string;
  destinationSwap: ChainSwap | null;
  intent: SwapIntent;
};

type ChainSwap = {
  chainId: number;
  swaps: Swap[];
  txHash: Hex;
};

type Swap = {
  inputAmount: bigint;
  inputContract: Hex;
  inputDecimals: number;
  outputAmount: bigint;
  outputContract: Hex;
  outputDecimals: number;
};
```

**Swap operation options:**

| Option | Type | Description |
|--------|------|-------------|
| `onEvent` | `(event: SwapEvent) => void` | Receive status, plan preview, and plan progress updates |
| `hooks.onIntent` | `(data: OnIntentHookData) => void` | Review/approve the swap intent before execution |
| `slippageTolerance` | `number` | Optional slippage override (default `0.005`, i.e. 0.5%) |

#### `calculateMaxForSwap(input)`

Calculate the maximum amount that can be swapped to a destination token across all available sources. Useful for populating a "Max" button before calling `swapWithExactIn`.

```typescript
const max = await client.calculateMaxForSwap({
  toChainId: 8453,
  toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
});

console.log(`Max swappable: ${max.maxAmount} ${max.symbol}`);
console.log('Sources used:', max.sources);
```

You can also restrict which source chains/tokens are considered:

```typescript
const max = await client.calculateMaxForSwap({
  toChainId: 8453,
  toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  sources: [
    { chainId: 10, tokenAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  ],
});
```

**SwapMaxParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toChainId` | `number` | Yes | Destination chain ID |
| `toTokenAddress` | `Hex` | Yes | Output token address |
| `sources` | `Array<{ chainId, tokenAddress }>` | No | Restrict which source tokens to consider |

**SwapMaxResult:**

```typescript
type SwapMaxResult = {
  toChainId: number;
  toTokenAddress: Hex;
  maxAmount: string;      // Human-readable decimal string
  maxAmountRaw: bigint;   // Raw amount suitable for toAmount in swapWithExactOut
  symbol: string;
  decimals: number;
  sources: {
    chainId: number;
    tokenAddress: Hex;
    symbol: string;
    decimals: number;
    amount: string;       // Human-readable portion from this source
  }[];
};
```

#### `calculateMaxForBridge(input)`

Calculate the maximum amount that can be bridged to a destination token across all same-currency holdings on other chains. Useful for populating a "Max" button before calling `bridge`.

The max is sized against the provider the bridge will actually use: the summed bridge amount is checked against the Mayan threshold (the same decision the real bridge makes), and the receivable max is computed for that provider — Nexus backs out deposit/fulfillment/protocol fees, Mayan sums the per-leg `minReceived`. A `max(3%, $3)` safety haircut is applied so the suggested amount survives fee drift before execution. The returned `provider` tells you which path was used.

```typescript
const max = await client.calculateMaxForBridge({
  toChainId: 8453,
  toTokenSymbol: 'USDC',
});

console.log(`Max bridgeable: ${max.maxAmount} ${max.symbol} via ${max.provider}`);
console.log('Sources used:', max.sources);

// Feed straight into a bridge:
await client.bridge({ toChainId: 8453, toTokenSymbol: 'USDC', toAmountRaw: max.maxAmountRaw });
```

You can also restrict which source chains are considered:

```typescript
const max = await client.calculateMaxForBridge({
  toChainId: 8453,
  toTokenSymbol: 'USDC',
  sources: [10, 42161], // only Optimism + Arbitrum balances
});
```

**BridgeMaxParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toChainId` | `number` | Yes | Destination chain ID |
| `toTokenSymbol` | `string` | Yes | Destination token symbol |
| `sources` | `number[]` | No | Restrict which source chain IDs to consider |

**BridgeMaxResult:**

```typescript
type BridgeMaxResult = {
  toChainId: number;
  toTokenSymbol: string;
  provider: 'nexus' | 'mayan';   // Provider the max was sized against
  maxAmount: string;             // Human-readable decimal string
  maxAmountRaw: bigint;          // Raw amount suitable for toAmountRaw in bridge()
  symbol: string;
  decimals: number;
  sources: {
    chainId: number;
    tokenAddress: Hex;
    symbol: string;
    decimals: number;
    amount: string;              // Human-readable portion from this source
  }[];
};
```

#### `swapAndExecute(params, options?)`

Orchestrates **two distinct operations in sequence — not a single atomic transaction**:

1. **Swap (conditional)** — funds the shortfall on the destination chain. Automatically skipped when the destination already holds enough of the token (`result.swapSkipped === true`).
2. **Execute + approval (execute always, approval optional)** — the contract call, preceded by an optional token approval, is **always** sent from the user's connected wallet on the destination chain.

Because the two steps run one after the other, they succeed or fail independently. This is **not** atomic: if the execute fails after a swap, the swapped funds remain in the user's wallet on the destination chain (they are not rolled back).

```typescript
const result = await client.swapAndExecute(
  {
    toChainId: 42161,
    toTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    toAmountRaw: 100_000_000n,
    execute: {
      to: '0x3333333333333333333333333333333333333333',
      data: '0xdeadbeef',
      gas: 100_000n,
      value: 0n,
      tokenApproval: {
        toTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        amount: 100_000_000n,
        spender: '0x3333333333333333333333333333333333333333',
      },
    },
  },
  {
    onEvent: (event) => {
      if (event.type === 'status') {
        // preparing | route_building | awaiting_approval | executing | completed
      }
    },
    onIntent: ({ allow, deny, refresh, intent }) => {
      console.log('Swap required:', intent.swapRequired);
      allow();
    },
  }
);

console.log(result.swapSkipped);
console.log(result.swapResult);
console.log(result.execute.txHash);
```

**SwapAndExecuteParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toChainId` | `number` | Yes | Destination chain ID |
| `toTokenAddress` | `Hex` | Yes | Token address on destination |
| `toAmountRaw` | `bigint` | Yes | Token amount needed (raw integer units) |
| `sources` | `Array<{ chainId, tokenAddress }>` | No | Restrict source tokens |
| `execute` | `SwapExecuteParams` | Yes | Contract execution params |

**SwapExecuteParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | `Hex` | Yes | Contract address |
| `data` | `Hex` | No | Encoded function call |
| `gas` | `bigint` | Yes | Gas limit |
| `value` | `bigint` | No | Native token value (wei) |
| `gasPrice` | `'low' \| 'medium' \| 'high'` | No | Gas price strategy |
| `tokenApproval` | `{ toTokenAddress: Hex, amount: bigint, spender: Hex }` | No | Token approval before execution |

**SwapAndExecuteResult:**

```typescript
type SwapAndExecuteResult = {
  approval?: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
  execute: {
    txHash: Hex;
    txExplorerUrl: string;
    receipt?: TransactionReceipt;
  };
} & (
  | { swapSkipped: false; swapResult: SwapResult }
  | { swapSkipped: true; swapResult?: undefined }
);
```

---

### Intent Management

#### `listIntents(params?)`

Retrieve the connected wallet's historical intents. Page size is fixed at 20 records — paginate by incrementing `page`.

```typescript
import { IntentStatus } from '@avail-project/nexus-core';

const result = await client.listIntents({
  page: 1,
  status: IntentStatus.Fulfilled, // 'created' | 'deposited' | 'fulfilled' | 'expired'
});

console.log(result.total);
for (const intent of result.intents) {
  console.log(intent.requestHash, intent.status);
  console.log(intent.destinationChain.name);
  for (const dest of intent.destinations) {
    console.log(dest.token.symbol, dest.amount);
  }
  for (const src of intent.sources) {
    console.log(src.chain.name, src.token.symbol, src.amount, '(fee:', src.fee, ')');
  }
}
```

```typescript
type ListIntentsParams = {
  page?: number;
  status?: IntentStatus;
};

type ListIntentsResult = {
  intents: IntentRecord[];
  total: number;
};

type IntentRecord = {
  requestHash: Hex;
  explorerUrl: string;
  status: IntentStatus;
  solver: Hex | null;
  createdAt?: number;
  updatedAt?: number;
  expiry: number;
  recipientAddress: Hex;
  destinationChain: { id: number; name: string; logo: string; universe: 'EVM' | 'TRON' | 'FUEL' | 'SVM' };
  destinations: Array<{
    token: { contractAddress: Hex; symbol: string; name: string; logo: string; decimals: number };
    amount: string;
    amountRaw: bigint;
  }>;
  sources: Array<{
    chain: { id: number; name: string; logo: string; universe: 'EVM' | 'TRON' | 'FUEL' | 'SVM' };
    amount: string;
    amountRaw: bigint;
    fee: string;
    feeRaw: bigint;
    token: { contractAddress: Hex; symbol: string; name: string; logo: string; decimals: number };
  }>;
};
```

---

## Hooks & Callbacks

Hooks are essential for building interactive UIs. They allow users to review and approve operations before execution.

### Intent Hook

Called when the SDK needs user approval for a bridge/transfer intent. Passed via `options.hooks.onIntent` for bridge operations.

```typescript
await client.bridge(params, {
  hooks: {
    onIntent: async ({ intent, allow, deny, refresh }) => {
      // Display intent details to user
      console.log('Source chains:', intent.selectedSources);
      console.log('Destination:', intent.destination);
      console.log('Fees:', intent.fees);
      console.log('Total from sources:', intent.sourcesTotal);

      // Optionally refresh with different source chains
      const refreshedIntent = await refresh([8453, 42161]);
      console.log('Refreshed intent:', refreshedIntent);

      // User interaction
      if (userApproves) {
        allow();
      } else {
        deny(); // Throws USER_DENIED_INTENT error
      }
    },
  },
});
```

**OnIntentHookData:**

```typescript
type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: BridgeIntent;
  refresh: (selectedSources?: number[]) => Promise<BridgeIntent>;
};
```

> **Keeping quotes fresh.** Fees and amounts drift while a confirmation modal is open. A common pattern is to stash the hook handle and poll `refresh()` on an interval (e.g. every 20s) to re-quote, re-rendering the intent each time, until the user calls `allow()` / `deny()`. `refresh()` returns the updated intent (the same shape passed to the hook). The same applies to the swap and composite intent hooks.

**BridgeIntent Structure:**

```typescript
type BridgeIntent = {
  // Bridge provider moving the funds cross-chain
  provider: 'nexus' | 'mayan';

  // Selected sources (chains funds are pulled from)
  selectedSources: Array<{
    amount: string;
    amountRaw: bigint;
    chain: { id: number; name: string; logo: string };
    token: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
    value: string;
  }>;

  // All available sources (before selection)
  availableSources: Array<{ /* same shape as selectedSources */ }>;

  // Destination details
  destination: {
    amount: string;
    amountRaw: bigint;
    chain: { id: number; name: string; logo: string };
    token: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
    value: string;
    nativeAmount: string;          // Human-readable native token amount
    nativeAmountRaw: bigint;       // Raw native token amount
    nativeAmountValue: string;     // USD value of native amount
    nativeAmountInToken: string;   // Native gas expressed in bridge token units
    nativeToken: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
  };

  // Fee breakdown
  fees: {
    caGas: string;        // Chain abstraction gas fee
    protocol: string;     // Protocol fee
    solver: string;       // Solver fee
    total: string;        // Total fees
    totalValue: string;   // Total fees in USD
  };

  // Total amount from all sources
  sourcesTotal: string;
  sourcesTotalValue: string;
};
```

### Allowance Hook

Called when token approval is needed before a transaction. Passed via `options.hooks.onAllowance` for bridge operations.

```typescript
await client.bridge(params, {
  hooks: {
    onAllowance: ({ sources, allow, deny }) => {
      // Display approval request to user
      sources.forEach((source) => {
        console.log(`Chain: ${source.chain.name}`);
        console.log(`Token: ${source.token.symbol}`);
        console.log(`Current allowance: ${source.allowance.current}`);
        console.log(`Required minimum: ${source.allowance.minimum}`);
      });

      // Approve with options:
      allow(['min']);           // Approve exact minimum needed
      allow(['max']);           // Approve unlimited (type(uint256).max)
      allow([1000000n]);        // Approve specific amount
      allow(['min', 'max']);    // Different per source (by index)

      // Or deny
      deny(); // Throws USER_DENIED_ALLOWANCE error
    },
  },
});
```

**OnAllowanceHookData:**

```typescript
type OnAllowanceHookData = {
  allow: (amounts: Array<'max' | 'min' | bigint | string>) => void;
  deny: () => void;
  sources: AllowanceHookSources;
};

type AllowanceHookSources = Array<{
  allowance: {
    current: string;       // Current allowance (human-readable)
    currentRaw: bigint;    // Current allowance (raw)
    minimum: string;       // Minimum required (human-readable)
    minimumRaw: bigint;    // Minimum required (raw)
  };
  chain: {
    id: number;
    logo: string;
    name: string;
  };
  token: {
    contractAddress: Hex;
    decimals: number;
    logo: string;
    name: string;
    symbol: string;
  };
}>;
```

### Swap Intent Hook

Called when user approval is needed for a swap operation. Passed via `options.hooks.onIntent` for `swapWithExactIn()` and `swapWithExactOut()`. The `refresh()` callback optionally takes a new `sources` list to re-quote against a different set of source tokens.

```typescript
await client.swapWithExactOut(input, {
  hooks: {
    onIntent: async ({ intent, allow, deny, refresh }) => {
      console.log('Swap from:', intent.sources);
      console.log('Swap to:', intent.destination);
      console.log('Bridge fees:', intent.feesAndBuffer.bridge); // null when no bridge needed
      console.log('Bridge provider:', intent.bridgeProvider);   // 'nexus' | 'mayan' | null
      console.log('Slippage buffer:', intent.feesAndBuffer.buffer);

      // Refresh to get an updated quote, optionally restricting sources
      const refreshedIntent = await refresh([
        { chainId: 8453, tokenAddress: '0x...' },
      ]);
      console.log('Refreshed swap intent:', refreshedIntent);

      if (userApproves) {
        allow();
      } else {
        deny();
      }
    },
  },
});
```

**SwapIntent:**

```typescript
type SwapIntent = {
  destination: {
    amount: string;          // human-readable decimal amount
    value?: string;          // optional USD value
    chain: { id: number; logo: string; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
    gas: {
      amount: string;
      value?: string;
      token: { contractAddress: Hex; decimals: number; symbol: string };
    };
  };
  feesAndBuffer: {
    buffer: string;
    bridge: { caGas: string; protocol: string; solver: string; total: string } | null;
  };
  bridgeProvider: 'nexus' | 'mayan' | null; // bridge moving COT cross-chain; null when no bridge
  sources: Array<{
    amount: string;
    value?: string;
    chain: { id: number; logo: string; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
  }>;
};

type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: SwapIntent;
  refresh: (sources?: Array<{ chainId: number; tokenAddress: Hex }>) => Promise<SwapIntent>;
};
```

### Composite Intent Hooks (Bridge + Execute / Swap + Execute)

`bridgeAndExecute()` and `swapAndExecute()` use a top-level `onIntent` hook (not nested under `hooks`). The intent data is a composite type that includes the execution requirement, available balances, and whether a bridge/swap is actually needed.

#### Bridge and Execute Intent

```typescript
await client.bridgeAndExecute(params, {
  onIntent: ({ intent, allow, deny, refresh }) => {
    // Execution requirement (always present)
    console.log('Contract:', intent.executeRequirement.to);
    console.log('Token needed:', intent.executeRequirement.token.amount, intent.executeRequirement.token.symbol);
    console.log('Gas estimate:', intent.executeRequirement.gas.estimatedGasUnits);

    // Available balances on destination
    console.log('Token on-chain:', intent.available.token.amount);
    console.log('Gas on-chain:', intent.available.gas.amount);

    if (intent.bridgeRequired) {
      // Bridge is needed — shortfall and bridge intent available
      console.log('Token shortfall:', intent.shortfall.token.amount);
      console.log('Gas shortfall:', intent.shortfall.gas.amount);
      console.log('Bridge sources:', intent.bridge.selectedSources);
      console.log('Bridge fees:', intent.bridge.fees.total);

      // Optionally refresh with different source chains
      const refreshed = await refresh([8453, 42161]);
      console.log('Refreshed bridge:', refreshed.bridgeRequired);
    } else {
      // Sufficient balance — bridge will be skipped
      console.log('No bridge needed, executing directly');
    }

    allow();
  },
});
```

**BridgeAndExecuteIntent:**

```typescript
type BridgeAndExecuteIntent = {
  executeRequirement: ExecuteRequirement;
  available: AvailableBalances;
} & (
  | { bridgeRequired: false }
  | {
      bridgeRequired: true;
      shortfall: Shortfall;
      bridge: BridgeIntent;
    }
);
```

**BridgeAndExecuteOnIntentHookData:**

```typescript
type BridgeAndExecuteOnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: BridgeAndExecuteIntent;
  refresh: (selectedSources?: number[]) => Promise<BridgeAndExecuteIntent>;
};
```

#### Swap and Execute Intent

```typescript
await client.swapAndExecute(params, {
  onIntent: ({ intent, allow, deny, refresh }) => {
    // Execution requirement (always present)
    console.log('Contract:', intent.executeRequirement.to);
    console.log('Token needed:', intent.executeRequirement.token.amount);

    if (intent.swapRequired) {
      // Swap is needed
      console.log('Token shortfall:', intent.shortfall.token.amount);
      console.log('Swap sources:', intent.swap.sources);
      console.log('Swap destination:', intent.swap.destination.amount);

      // Refresh with different sources
      const refreshed = await refresh([{ chainId: 8453, tokenAddress: '0x...' }]);
      console.log('Refreshed:', refreshed.swapRequired);
    } else {
      console.log('No swap needed, executing directly');
    }

    allow();
  },
});
```

**SwapAndExecuteIntent:**

```typescript
type SwapAndExecuteIntent = {
  executeRequirement: ExecuteRequirement;
  available: AvailableBalances;
} & (
  | { swapRequired: false }
  | {
      swapRequired: true;
      shortfall: Shortfall;
      swap: SwapIntent;
    }
);
```

**SwapAndExecuteOnIntentHookData:**

```typescript
type SwapAndExecuteOnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: SwapAndExecuteIntent;
  refresh: (sources?: Source[]) => Promise<SwapAndExecuteIntent>;
};
```

#### Shared Types

```typescript
type ExecuteFeeParams =
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: 'legacy'; gasPrice: bigint };

type ExecuteRequirement = {
  chain: { id: number; name: string; logo?: string };
  to: Hex;
  token: {
    address: Hex;
    symbol: string;
    decimals: number;
    amount: string;
    amountRaw: bigint;
    value: string;        // USD value
  };
  gas: {
    address: Hex;
    symbol: string;
    decimals: number;
    amount: string;
    amountRaw: bigint;
    value: string;
    estimatedGasUnits: string;
    feeParams: ExecuteFeeParams; // EIP-1559 or legacy (Arbitrum) pricing
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

type AvailableBalances = {
  token: { amount: string; amountRaw: bigint; value: string };
  gas: { amount: string; amountRaw: bigint; value: string };
};

type Shortfall = {
  token: { amount: string; amountRaw: bigint; value: string };
  gas: { amount: string; amountRaw: bigint; value: string };
};
```

### Event Callbacks

All main SDK operations accept an `onEvent` callback to track progress through a typed event system.

```typescript
await client.bridge(params, {
  onEvent: (event) => {
    switch (event.type) {
      case 'status':
        // Lifecycle phase: intent_building → intent_ready → awaiting_approval → ...
        console.log('Status:', event.status);
        break;

      case 'plan_preview':
        // Emitted once with the planned steps before execution
        console.log('Plan steps:', event.plan.steps);
        break;

      case 'plan_confirmed':
        // Emitted after user approval with final steps
        console.log('Confirmed plan:', event.plan.steps);
        break;

      case 'plan_progress':
        // Per-step progress: wallet_prompted → submitted → confirmed → completed
        console.log(`Step ${event.step.type}: ${event.state}`);
        break;
    }
  },
});
```

**Hook Placement by Operation:**

| Operation | `onEvent` | `onIntent` | `onAllowance` |
|-----------|-----------|------------|----------------|
| `bridge()` | `options.onEvent` | `options.hooks.onIntent` | `options.hooks.onAllowance` |
| `bridgeAndTransfer()` | `options.onEvent` | `options.hooks.onIntent` | `options.hooks.onAllowance` |
| `bridgeAndExecute()` | `options.onEvent` | `options.onIntent` (top-level) | automatic (`min`) |
| `swapWithExactIn()` | `options.onEvent` | `options.hooks.onIntent` | N/A |
| `swapWithExactOut()` | `options.onEvent` | `options.hooks.onIntent` | N/A |
| `swapAndExecute()` | `options.onEvent` | `options.onIntent` (top-level) | N/A |

Use hooks for approval-time intent and allowance data. Use the awaited return value for final result data such as `intentExplorerUrl`, `sourceTxs`, or `execute`.

---

## Events & Steps

The SDK emits typed events during operations, enabling real-time progress UIs.

### Event Types

All events follow a discriminated union pattern on `event.type`:

```typescript
type BridgeEvent =
  | BridgeStatusEvent           // { type: 'status'; status: BridgeStatus }
  | BridgePlanPreviewEvent      // { type: 'plan_preview'; plan: BridgePlan }
  | BridgePlanConfirmedEvent    // { type: 'plan_confirmed'; plan: BridgePlan }
  | BridgePlanProgressEvent;    // { type: 'plan_progress'; stepType, state, step, ... }

type BridgeStatus =
  | 'intent_building'
  | 'intent_ready'
  | 'awaiting_approval'
  | 'awaiting_allowance_selection'
  | 'approved'
  | 'executing'
  | 'completed';

// Composite bridge + execute flow adds an initial 'preparing' phase
type BridgeAndExecuteStatus = 'preparing' | BridgeStatus;

type SwapEvent =
  | SwapStatusEvent
  | SwapPlanPreviewEvent
  | SwapPlanConfirmedEvent
  | SwapPlanProgressEvent;

type SwapStatus =
  | 'route_building'
  | 'route_ready'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'completed';

// Composite swap + execute flow adds an initial 'preparing' phase
type SwapAndExecuteStatus = 'preparing' | SwapStatus;
```

### Bridge Steps

Bridge plans contain the following step types:

| Step Type | Description |
|-----------|-------------|
| `allowance_approval` | Token allowance approval on a source chain |
| `request_signing` | User signs the intent request |
| `request_submission` | Intent submitted to the network |
| `vault_deposit` | Deposit into vault on a source chain |
| `bridge_fill` | Fill received on destination chain |

### Swap Steps

Swap plans contain the following step types:

| Step Type | Description |
|-----------|-------------|
| `source_swap` | Execute a swap on a source chain (ephemeral or Safe smart-account path) |
| `eoa_to_ephemeral_transfer` | Transfer funds from EOA to ephemeral wallet on a source chain |
| `bridge_deposit` | Deposit into vault for cross-chain bridge |
| `bridge_intent_submission` | Submit the bridge intent to the network |
| `bridge_fill` | Wait for bridge fill on destination chain |
| `destination_swap` | Execute a swap on the destination chain |

**SwapPlan:**

```typescript
type SwapPlan = {
  hasBridge: boolean;
  hasDestinationSwap: boolean;
  steps: SwapPlanStep[];
};

type SwapPlanStep =
  | SwapSourceSwapStep
  | SwapEoaToEphemeralTransferStep
  | SwapBridgeDepositStep
  | SwapBridgeIntentSubmissionStep
  | BridgeFillStep
  | SwapDestinationSwapStep;
```

Each step carries contextual metadata (chain, tokens, wallet path). Progress events report per-step state transitions. The terminal success state varies by step type:

- On-chain transaction steps (`allowance_approval`, `source_swap`, `eoa_to_ephemeral_transfer`, `bridge_deposit`, `destination_swap`, `execute_approval`, `execute_transaction`) settle on `confirmed`.
- `vault_deposit` settles on `completed` — it emits `confirmed` as an on-chain intermediate, then `completed` as its terminal-success state.
- Off-chain orchestration steps (`request_signing`, `request_submission`, `bridge_intent_submission`, `bridge_fill`) settle on `completed`.
- All steps can emit `failed`.

For a robust progress UI, treat both `'confirmed'` and `'completed'` as terminal-success states.

### Progress Event Payloads

Each `plan_progress` event carries `type: 'plan_progress'`, `stepType`, `state`, and `step` (the matching step object from `plan.steps`) — plus **state-specific sibling fields** you'll want for the UI. These are fully typed: narrow a `BridgeEvent` / `SwapEvent` on (`stepType`, `state`) and TypeScript reveals the fields below (the per-step event types like `BridgeVaultDepositProgressEvent`, `ExecuteTransactionProgressEvent` are exported).

| Field | On | Meaning |
|-------|----|---------|
| `txHash` / `explorerUrl` | on-chain steps in `submitted` / `confirmed` (optional on `failed`): `allowance_approval`, `vault_deposit`, `execute_approval`, `execute_transaction`, and source/destination swap steps | The submitted transaction hash and its explorer URL — use for "View tx" links |
| `intentRequestHash` | `request_signing` (`completed`), `request_submission`, `bridge_fill` | The intent/RFF hash — use for "View intent" links |
| `error` | every `failed` state | Failure text (already inlined; the underlying cause is here) |
| `approvedAmount` / `approvedAmountRaw` | `allowance_approval` | Amount approved at this step |
| `value` / `hasData` | `execute_transaction` | Native value sent and whether calldata is present |

The **`step` object** carries the contextual metadata — and chain lives on `event.step.chain`, **not** `event.chain`:

```typescript
client.bridge(params, {
  onEvent: (event) => {
    if (event.type !== 'plan_progress') return;
    const chainName = event.step.chain?.name;            // step.chain, not event.chain
    if ((event.state === 'submitted' || event.state === 'confirmed') && 'txHash' in event) {
      console.log('tx:', event.txHash, event.explorerUrl);
    }
    if (event.state === 'failed' && 'error' in event) {
      console.error(event.step.type, 'failed:', event.error);
    }
  },
});
```

Per-step `step` shapes (all include `id` and `type`): `allowance_approval` → `chain`, `token`, `spender`, `requiredAmount`; `vault_deposit` → `chain`, `asset`, `assetType`, `submissionMode`; `bridge_fill` → `chain`, `asset`; `execute_approval` → `chain`, `token`, `spender`, `amount`; `execute_transaction` → `chain`, `to`. Swap source/destination steps carry `swaps[]` with `input`/`output` token amounts.

### Building Progress UIs

Example using the typed plan/progress event system:

```typescript
import { createNexusClient } from '@avail-project/nexus-core';
import type { BridgeEvent, BridgePlanStep } from '@avail-project/nexus-core';

let steps: BridgePlanStep[] = [];
const completedSteps = new Set<string>();

await client.bridge(params, {
  onEvent: (event: BridgeEvent) => {
    switch (event.type) {
      case 'plan_preview':
        // Initialize UI with planned steps
        steps = event.plan.steps;
        renderProgress();
        break;

      case 'plan_progress':
        // Both 'confirmed' and 'completed' are terminal success states
        if (event.state === 'confirmed' || event.state === 'completed') {
          completedSteps.add(event.step.id);
        }
        renderProgress();
        break;

      case 'status':
        if (event.status === 'completed') {
          console.log('Bridge complete!');
        }
        break;
    }
  },
  hooks: {
    onIntent: ({ allow }) => allow(),
    onAllowance: ({ allow }) => allow(['min']),
  },
});

function renderProgress() {
  steps.forEach((step) => {
    const done = completedSteps.has(step.id);
    console.log(`${done ? '✓' : '○'} ${step.type}`);
  });
}
```

---

## Error Handling

### NexusError Hierarchy

SDK errors are concrete subclasses of the abstract base `NexusError<C>`. Each subclass pins its
category and narrows the allowed `context.service` value. Switch on `error.category` (or
`instanceof`) for coarse handling; check `error.code` for the specific failure mode.

```typescript
import {
  NexusError,
  ValidationError,
  UserActionError,
  BackendError,
  ExternalServiceError,
  ExecutionError,
  ERROR_CODES,
} from '@avail-project/nexus-core';

try {
  await client.bridge({ toTokenSymbol: 'USDC', toAmountRaw: 1_000_000n, toChainId: 137 });
} catch (error) {
  if (!(error instanceof NexusError)) {
    console.error('Unexpected error:', error);
    throw error;
  }

  // Coarse handling via category
  switch (error.category) {
    case 'user_action':
      // User cancelled — typically not shown as a failure
      return;
    case 'validation':
      showValidationError(error.message);
      return;
    case 'backend':
    case 'external_service':
      showRetryableUpstreamError(error);
      return;
  }

  // Specific code handling
  switch (error.code) {
    case ERROR_CODES.INSUFFICIENT_BALANCE:
      showInsufficientBalanceUI();
      break;
    case ERROR_CODES.EXEC_TX_RECEIPT_WAIT_TIMEOUT:
      showRetryOption();
      break;
    case ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED:
      showOnChainRevert();
      break;
    default:
      showGenericError(error.message);
  }

  // Errors are flat — the underlying cause (viem revert, HTTP failure, …) is already
  // inlined into error.message. Log the queryable axes for support/forensics.
  console.error(error.code, error.message, error.context, error.details);
}
```

**Hierarchy:**

```typescript
abstract class NexusError<C extends ErrorCategory = ErrorCategory> extends Error {
  readonly category: C;
  readonly code: ErrorCode;
  readonly context: ErrorContext<C>;        // service narrowed per category
  readonly details?: Record<string, unknown>;
  toJSON(): object;                         // flat, single-level
}

class ValidationError      extends NexusError<'validation'>       {}  // no service
class UserActionError      extends NexusError<'user_action'>      {}  // wallet | hook
class SimulationError      extends NexusError<'simulation'>       {}  // rpc
class ExecutionError       extends NexusError<'execution'>        {}  // wallet | rpc
class BackendError         extends NexusError<'backend'>          {}  // middleware
class ExternalServiceError extends NexusError<'external_service'> {}  // lifi | bebop | fibrous | coinbase
class InternalError        extends NexusError<'internal'>         {}  // no service
```

Errors are flat: there is no native `cause` capture and no chain-walking
(`walk` / `find` / chain rendering). When the SDK catches an underlying error
(a viem revert, an HTTP failure), its text is inlined into `error.message`, so
`message` is self-contained for logs and toasts.

Step-bound failures are not a separate class — they're whichever subclass actually applies,
carrying `context.stepId` / `context.stepType` / `context.chainId`. Replace any prior
`error instanceof NexusStepError` check with
`error instanceof NexusError && error.context.stepId !== undefined`.

### Error Codes Reference

Codes follow `category/specific_noun_suffix`. Suffixes: `_failed`, `_timeout`, `_reverted`,
`_denied`, `_exceeded` — or no suffix for non-failure terminal states.

| Error Code | Description | User Action |
|------------|-------------|-------------|
| **user_action/*** | | |
| `user_action/intent_hook_denied` | User rejected intent via dApp hook | None — user cancelled |
| `user_action/intent_signature_denied` | User rejected EIP-191 sign in wallet | None — user cancelled |
| `user_action/allowance_approval_denied` | User rejected token approve tx | None — user cancelled |
| `user_action/siwe_signature_denied` | User rejected SIWE signature | None — user cancelled |
| `user_action/tx_send_denied` | User rejected a tx send (execute / vault deposit / atomic batch) | None — user cancelled |
| `user_action/ephemeral_key_denied` | User rejected the ephemeral-key derivation signature | None — user cancelled |
| **validation/*** | | |
| `validation/insufficient_balance` | Not enough tokens for operation | Show balance, suggest deposit |
| `validation/no_balance_for_address` | No balance found for address | Verify address |
| `validation/invalid_input` | Invalid parameters provided | Check input values |
| `validation/invalid_address_length` | Address has wrong length | Verify address format |
| `validation/invalid_allowance_hook` | Invalid allowance hook values | Check allow() arguments |
| `validation/token_not_supported` | Token not supported on chain | Use supported token |
| `validation/sdk_not_initialized` | SDK not initialized | Call initialize() first |
| `validation/sdk_init_state_unexpected` | Unexpected init state | Re-initialize SDK |
| `validation/wallet_not_connected` | No wallet connected | Connect wallet |
| `validation/chain_not_found` | Chain id not supported | Use supported chain |
| `validation/chain_data_not_found` | Chain metadata missing | Check network connection |
| `validation/vault_contract_not_found` | Vault contract missing for chain | Contact support |
| `validation/environment_not_supported` | Env not supported | Use mainnet/canary/testnet |
| `validation/environment_not_known` | Unknown env | Check configuration |
| `validation/asset_not_found` | Asset not found | Check token address |
| `validation/universe_not_supported` | Universe not supported | Use supported chain |
| **execution/*** (service=wallet for submission, service=rpc for reads/receipt polls) | | |
| `execution/tx_receipt_wait_timeout` | Receipt did not arrive in time | Retry or check explorer |
| `execution/tx_onchain_reverted` | Tx mined with `status: 0` | Check contract/params |
| `execution/tx_submission_reverted` | Wallet returned revert at submit | Check params; retry |
| `execution/tx_receipt_check_failed` | Receipt fetch errored | Retry |
| `execution/exec_tx_send_failed` | sendTransaction failed | Retry |
| `execution/exec_tx_confirm_failed` | Tx confirm polling failed | Retry |
| `execution/approval_tx_send_failed` | Approve tx send failed | Retry approval |
| `execution/approval_tx_confirm_failed` | Approve tx confirm failed | Retry approval |
| `execution/atomic_batch_status_failed` | waitForCallsStatus failed | Retry |
| `execution/gas_estimate_failed` | estimateGas/estimateFeesPerGas failed | Retry |
| `execution/gas_price_fetch_failed` | gas price recommendations failed | Retry |
| `execution/l1_fee_estimate_failed` | Arbitrum/Optimism L1 oracle failed | Retry |
| `execution/erc20_allowance_read_failed` | allowance() read failed | Retry |
| `execution/erc20_nonce_read_failed` | permit nonces() read failed | Retry |
| `execution/erc20_name_read_failed` | ERC20.name() read failed | Retry |
| `execution/intent_sign_failed` | RFF intent sign failed (technical) | Retry |
| `execution/permit_sign_failed` | EIP-712 permit sign failed (technical) | Retry |
| `execution/wallet_connect_failed` | Wallet provider init failed | Retry connection |
| `execution/chain_switch_failed` | wallet_switchEthereumChain failed | Switch manually |
| `execution/vault_deposit_send_failed` | Vault deposit submit failed | Retry |
| `execution/vault_deposit_confirm_failed` | Vault deposit confirm failed | Retry |
| `execution/destination_sweep_failed` | Post-bridge sweep failed | Contact support |
| `execution/refund_send_failed` | Refund tx submit failed | Contact support |
| `execution/refund_check_failed` | Refund receipt poll failed | Contact support |
| `execution/slippage_exceeded` | Post-execution slippage check failed | Refresh and retry |
| **backend/*** (service=middleware) | | |
| `backend/balances_fetch_failed` | Middleware balances fetch failed | Retry |
| `backend/deployment_fetch_failed` | Middleware deployment fetch failed | Retry |
| `backend/oracle_prices_fetch_failed` | Middleware oracle prices fetch failed | Retry |
| `backend/rff_submit_failed` | Middleware RFF submit failed | Retry |
| `backend/rff_fetch_failed` | Middleware RFF fetch failed | Retry |
| `backend/rff_list_failed` | Middleware RFF list failed | Retry |
| `backend/rff_status_fetch_failed` | Middleware RFF status fetch failed | Retry |
| `backend/sbc_submit_failed` | Middleware SBC submit failed | Retry |
| `backend/approvals_ws_failed` | Middleware approvals WS failed | Retry |
| `backend/simulation_bundle_failed` | Middleware bundle simulation failed | Check parameters |
| `backend/fulfilment_wait_timeout` | Bridge fulfilment did not land in window | Retry later |
| `backend/fee_grant_requested` | Fee grant requested (non-failure state) | n/a |
| `backend/get_quote_failed` | Middleware quote fetch failed | Retry |
| `backend/get_mayan_quote_failed` | Middleware Mayan quote fetch failed | Retry |
| `backend/get_bridge_provider_failed` | Middleware bridge-provider selection failed | Retry |
| `backend/report_mayan_tx_failed` | Middleware Mayan-tx report failed | Retry |
| `backend/safe_get_address_failed` | Middleware Safe address fetch failed | Retry |
| `backend/safe_ensure_failed` | Middleware Safe account ensure/deploy failed | Retry |
| `backend/safe_execute_failed` | Middleware Safe execute failed | Retry |
| **external_service/*** (service=lifi / bebop / fibrous / coinbase) | | |
| `external_service/destination_swap_quote_failed` | Destination aggregator quote failed | Retry or adjust |
| `external_service/source_swap_quote_failed` | Source aggregator quote failed | Retry or adjust |
| `external_service/swap_route_build_failed` | Aggregator route build failed | Try different sources |
| `external_service/rates_drift_exceeded` | Aggregator re-quote drifted beyond tolerance | Refresh and retry |
| `external_service/exchange_rate_fetch_failed` | Coinbase exchange-rate fetch failed | Retry |
| **simulation/*** (service=rpc) | | |
| `simulation/eth_call_failed` | RPC-side simulation failed | Check parameters |
| **internal/*** | | |
| `internal/error` | Internal SDK invariant | Contact support |
| `internal/unknown_signature` | Unhandled signature variant | Contact support |
| `internal/ephemeral_key_derive_failed` | Ephemeral key derivation invariant | Retry / contact support |
| `internal/destination_request_hash_not_found` | Expected hash missing from middleware response | Contact support |

> **Note:** v1-era SCREAMING_SNAKE code values (`INSUFFICIENT_BALANCE`, `USER_DENIED_INTENT`,
> `TRANSACTION_TIMEOUT`, etc.) are gone. Use the namespaced strings above. The TypeScript
> `ERROR_CODES` const has been renamed accordingly (e.g. `ERROR_CODES.INSUFFICIENT_BALANCE`
> still exists as a key but its value is now `'validation/insufficient_balance'`).

---

## TypeScript Reference

### Core Types

```typescript
import type {
  // SDK Configuration
  NexusNetwork,

  // Operation Parameters
  BridgeParams,
  TransferParams,
  ExecuteParams,
  BridgeAndExecuteParams,

  // Operation Results
  TxResult,
  BridgeResult,
  TransferResult,
  ExecuteResult,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,

  // Simulation Results
  BridgeSimulationResult,
  ExecuteSimulation,
  ExecuteFeeParams,

  // Intent & Hook Types
  BridgeIntent,
  BridgeIntentDraft,
  OnIntentHook,
  OnIntentHookData,
  OnAllowanceHook,
  OnAllowanceHookData,
  AllowanceHookSource,
  AllowanceHookSources,
  IntentRecord,
  IntentStatus,
  ListIntentsParams,
  ListIntentsResult,
  BridgeAndExecuteOnIntentHookData,
  BridgeAndExecuteIntent,
  SwapAndExecuteOnIntentHookData,
  SwapAndExecuteIntent,
  ExecuteRequirement,
  AvailableBalances,
  Shortfall,

  // Event Types
  BridgeEvent,
  BridgeStatus,
  BridgePlan,
  BridgePlanStep,
  BridgeAndExecuteEvent,
  BridgeAndExecuteStatus,
  BridgeAndExecutePlan,
  BridgeAndExecutePlanStep,
  SwapEvent,
  SwapStatus,
  SwapPlan,
  SwapPlanStep,
  SwapAndExecuteEvent,
  SwapAndExecuteStatus,
  SwapAndExecutePlan,
  SwapAndExecutePlanStep,

  // Balance Types
  TokenBalance,
  ChainBalance,
  BridgeTokenBalance,
  SwapTokenBalance,

  // Metadata
  ChainMetadata,
  TokenMetadata,

  // Errors
  NexusError,
  ValidationError,
  UserActionError,
  SimulationError,
  ExecutionError,
  BackendError,
  ExternalServiceError,
  InternalError,
  ErrorCategory,
  ErrorContext,
  OperationName,
  ServiceFor,
  BackendService,
  ExecutionService,
  ExternalServiceService,
  SimulationService,
  UserActionService,
} from '@avail-project/nexus-core';
```

### Swap Types

```typescript
import type {
  SwapExactInParams,
  SwapExactOutParams,
  SwapMaxParams,
  SwapMaxResult,
  SwapResult,
  SwapAndExecuteParams,
  SwapAndExecuteResult,
  SwapExecuteParams,
  SwapIntent,
  OnSwapIntentHookData,
  Source,
} from '@avail-project/nexus-core';
```

### Constants

```typescript
import { ERROR_CODES } from '@avail-project/nexus-core';
```

---

## Utilities

All utilities are tree-shakeable and available as both direct imports and via `client.utils.*`.

```typescript
import {
  formatTokenBalance,
  formatTokenBalanceParts,
  formatUnits,
  parseUnits,
  isValidAddress,
  truncateAddress,
  getCoinbaseRates,
  getSupportedChains,
} from '@avail-project/nexus-core/utils';
```

### Token Balance Formatting

Handles tiny values with zero-compression (e.g. `0.0₄8509`), thousand separators, and symbol appending.

```typescript
// Simple string output
formatTokenBalance(1.234567, { symbol: 'ETH' });              // "1.2346 ETH"
formatTokenBalance('0.00008509', { symbol: 'ETH' });          // "~0.0₄8509 ETH"
formatTokenBalance(1530000n, { decimals: 6, symbol: 'USDC' }); // "1.53 USDC"

// Structured parts for custom UI rendering (e.g. styling the subscript separately)
const parts = formatTokenBalanceParts('0.000000000000000123', { symbol: 'ETH' });
// parts.integer    → "0"
// parts.zeroCount  → 15
// parts.significant → "123"
// parts.symbol     → "ETH"
// parts.text       → "~0.0₁₅123 ETH"
```

**Options:**

| Option | Default | Description |
|---|---|---|
| `decimals` | — | Required when value is `bigint` |
| `symbol` | — | Token symbol appended to output |
| `maxFractionDigits` | `4` | Max decimals for normal values |
| `significantDigits` | `4` | Digits shown after leading zeros in tiny values |
| `tinyThresholdPower` | `-4` | Exponent threshold for tiny values — magnitudes below `10^power` use zero-compression |
| `zeroCompress` | `true` | Use subscript notation for leading zeros |
| `thousandSeparator` | `false` | Add comma separators (e.g. `12,345.67`) |
| `trimTrailingZeros` | `true` | Remove trailing zeros |
| `approxTilde` | `true` | Prefix `~` when rounding |

### Unit Conversion

```typescript
// Parse a human-readable amount to base units (bigint)
parseUnits('1.5', 18);  // 1500000000000000000n

// Format base units back to a readable string
formatUnits(1500000000000000000n, 18);  // "1.5"
```

### Address Utilities

```typescript
// Validate an EVM address
isValidAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // true

// Truncate for display: "0x742d...Db45"
truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45');
truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45', 8, 6); // custom lengths
```

### Token Logo Fallback

`getFallbackTokenLogoDataUri(symbol, size?)` returns a deterministic gradient SVG data-URI for a token/chain symbol — a stable placeholder when a real logo is missing or 404s. Unlike the formatting/address helpers above, it is exported from the **main entry**, not the `/utils` subpath:

```typescript
import { getFallbackTokenLogoDataUri } from '@avail-project/nexus-core';

const src = getFallbackTokenLogoDataUri('USDC');      // data:image/svg+xml;...
const big = getFallbackTokenLogoDataUri('ETH', 256);  // size defaults to 128
// <img src={token.logo || getFallbackTokenLogoDataUri(token.symbol)} />
```

### Pricing and Chain Info

```typescript
// Fetch live USD rates from Coinbase
const rates = await getCoinbaseRates(); // { ETH: "3245.12", USDC: "1.00", ... }
```

### Chain & Token Info

```typescript
// Query supported chains and tokens at runtime (requires network fetch)
import { getSupportedChains } from '@avail-project/nexus-core/utils';
const supported = await getSupportedChains('mainnet');

// Or via client instance (synchronous, uses cached deployment data)
const chains = client.getSupportedChains();
for (const chain of chains) {
  console.log(chain.id, chain.name, chain.tokens);
}
```

---

## Smart Optimizations

### Bridge Skip Optimization

During **bridge-and-execute** and **swap-and-execute** operations, the SDK checks whether sufficient funds already exist on the destination chain:

- **Balance detection** — Verifies token and gas availability
- **Integrated gas supply** — Provides gas alongside bridged/swapped tokens
- **Adaptive bridging** — Skips unnecessary bridging or transfers only the shortfall
- **Seamless fallback** — Uses chain abstraction if local funds are insufficient

```typescript
const result = await client.bridgeAndExecute({
  toTokenSymbol: 'USDC',
  toAmountRaw: 100_000_000n,
  toChainId: 1,
  execute: { to: '0x...', data: '0x...' },
});

if (result.bridgeSkipped) {
  console.log('Executed using existing balance - no bridge needed!');
}
```

### Swap Execution Paths

Swaps execute through a per-chain smart account, chosen automatically — there is no wallet-mode
option. The SDK never dispatches a swap directly from the EOA:

- **7702 chains** — execute through an ephemeral key delegated to Calibur (EIP-7702), batched and
  submitted to middleware.
- **non-7702 chains** — execute through a deterministic Safe owned by the ephemeral key
  (`Safe.execTransaction`).

The EOA only signs permits and pays funding approvals where needed. On top of the execution path,
the SDK still handles routing, bridge funding, and destination custody decisions.

---

## Analytics

The Nexus SDK includes **built-in analytics** powered by PostHog to help improve the SDK and understand usage patterns. Analytics are **enabled by default** but can be easily customized or disabled.

### Default Behavior

By default, the SDK sends anonymous telemetry data to Avail's PostHog instance:

- SDK initialization events
- Operation performance metrics
- Session duration and success rates
- Error tracking (without sensitive data)

The SDK does **not** automatically call `analytics.identify()`.
Transaction amounts can be anonymized via `privacy.anonymizeAmounts`, and analytics can be fully disabled via `enabled: false`.

### Disabling Analytics

```typescript
const client = createNexusClient({
  network: 'mainnet',
  analytics: { enabled: false },
});
```

### Privacy Controls

```typescript
const client = createNexusClient({
  network: 'mainnet',
  analytics: {
    enabled: true,
    privacy: {
      anonymizeWallets: true, // Hash wallet addresses
      anonymizeAmounts: true, // Exclude transaction amounts
    },
  },
});
```

### Custom Analytics (BYO PostHog)

```typescript
const client = createNexusClient({
  network: 'mainnet',
  analytics: {
    enabled: true,
    posthogApiKey: 'your-posthog-key',
    posthogApiHost: 'https://your-posthog-instance.com',
    appMetadata: {
      appName: 'My DApp',
      appVersion: '1.0.0',
      appUrl: 'https://mydapp.com',
    },
  },
});
```

### Accessing Analytics Programmatically

```typescript
// Track custom events
client.analytics.track('custom_event', { foo: 'bar' });

// Identify users
client.analytics.identify('user-id', { plan: 'premium' });

// Check if analytics is enabled
if (client.analytics.isEnabled()) {
  console.log('Analytics active');
}

// Disable/enable at runtime
client.analytics.disable();
client.analytics.enable();
```

---

## Supported Networks & Tokens

The list of supported chains and tokens is **fetched dynamically from the live middleware deployment** — the SDK ships with no hard-coded chain or token tables. Query the runtime APIs to discover what's currently available.

**Async standalone** (no initialized client required):

```typescript
import { getSupportedChains } from '@avail-project/nexus-core/utils';

const chains = await getSupportedChains('mainnet'); // or 'canary' / 'testnet'
for (const chain of chains) {
  console.log(chain.id, chain.name, chain.swapSupported);
  for (const token of chain.tokens) {
    console.log(' ', token.symbol, token.contractAddress, token.decimals);
  }
}
```

**Sync via an initialized client** (uses the network passed to `createNexusClient`):

```typescript
const chains = client.getSupportedChains();
```

**Lower-level lookups** via the chain catalogue exposed on the client:

```typescript
const usdcOnBase = client.chainList.getTokenInfoBySymbol(8453, 'USDC');
const ethNative = client.chainList.getNativeToken(1);
```

Each chain entry includes `swapSupported: boolean` — `true` unless the deployment explicitly disables swaps on that chain. Filter on it to show only the chains a swap can use as a source or destination.

Backend deployments may change which chains and tokens are live without an SDK release, so always treat the runtime API as the source of truth.

---

## Common Pitfalls

- **Amounts are raw integer units.** SDK methods expect `bigint` amounts in the token's smallest unit (e.g., `100_000_000n` for 100 USDC with 6 decimals), not human-readable decimal strings. Use `parseUnits('100', 6)` to convert.

- **Bridge uses token symbols, swap uses contract addresses.** `bridge`/`bridgeAndTransfer`/`bridgeAndExecute` take `toTokenSymbol: 'USDC'`, while `swapWithExactIn`/`swapWithExactOut`/`swapAndExecute` take `toTokenAddress: '0x...'`. The same split applies to `tokenApproval` inside `execute`: bridge `execute`/`bridgeAndExecute` use `tokenApproval.toTokenSymbol`; `swapAndExecute` uses `tokenApproval.toTokenAddress`.

- **`initialize()` and `setEVMProvider()` are independent.** `initialize()` fetches deployment data (chains, tokens, vault contracts) and is required before any chain-dependent method (`bridge`, `swap`, `execute`, `getBalances*`, `listIntents`, …) — those will throw `SDK_NOT_INITIALIZED` otherwise. `setEVMProvider()` attaches a wallet and can be called before, after, or independently of `initialize()`. Most apps just run both at startup.

- **Create a new client on account change.** The client is tied to a specific provider/address. Calling `setEVMProvider()` again with the **same** provider instance is a no-op (it short-circuits when the provider hasn't changed), so it cannot be used to swap accounts. On wallet disconnect or account switch, build a fresh client and re-run `initialize()` + `setEVMProvider()`.

- **EOA wallet operations are single-chain.** Browser wallets expose one active chain context for the connected user wallet. The SDK serializes wallet-touching work such as chain switching, prompts, permit signatures, direct approvals, and EOA transaction sends. It may still parallelize non-wallet work like quotes, public-client reads, per-chain SBC submission, and receipt waits. Avoid running multiple SDK operations against the same connected wallet at the same time unless you can tolerate wallet prompt and chain-switch contention.

- **Composite `onIntent` is top-level.** `bridgeAndExecute()` and `swapAndExecute()` use `options.onIntent`, not `options.hooks.onIntent`. Even when bridge/swap is skipped, `allow()` still gates execution.

- **Default allowance is `'min'`.** If no `onAllowance` hook is provided for bridge operations, the SDK auto-approves with `'min'` (exact amount needed).

---

## Resources

- **GitHub:** [availproject/nexus-sdk](https://github.com/availproject/nexus-sdk)
- **Documentation:** [docs.availproject.org](https://docs.availproject.org/nexus/avail-nexus-sdk)
- **Discord:** [Avail Discord](https://discord.gg/availproject)
