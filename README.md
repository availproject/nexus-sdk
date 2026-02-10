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
  - [NexusError Class](#nexuserror-class)
  - [Error Codes Reference](#error-codes-reference)
- [TypeScript Reference](#typescript-reference)
- [Utilities](#utilities)
- [Smart Optimizations](#smart-optimizations)
- [Analytics](#analytics)
- [Supported Networks](#supported-networks)
- [Supported Tokens](#supported-tokens)
- [Common Pitfalls](#common-pitfalls)
- [Skills Integration](#skills-integration)
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
import { NexusSDK, NEXUS_EVENTS } from '@avail-project/nexus-core';

// 1) Create and initialize the SDK
const sdk = new NexusSDK({ network: 'mainnet' });
await sdk.initialize(window.ethereum);

// 2) Set hooks for user approvals
sdk.setOnIntentHook(({ intent, allow, deny }) => {
  if (userConfirmsIntent(intent)) allow();
  else deny();
});

sdk.setOnAllowanceHook(({ sources, allow, deny }) => {
  if (userConfirmsAllowance(sources)) allow(['min']);
  else deny();
});

// 3) Fetch balances
const balances = await sdk.getBalancesForBridge();

// 4) Execute a bridge
const result = await sdk.bridge(
  {
    token: 'USDC',
    amount: 100_000_000n, // 100 USDC (6 decimals)
    toChainId: 137, // Polygon
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.STEPS_LIST) {
        initProgress(event.args);
      }
      if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
        updateProgress(event.args);
      }
    },
  }
);

console.log('Bridge complete:', result.explorerUrl);
```

---

## Core Features

- **Cross-chain bridging** — Move tokens seamlessly across 16+ chains
- **Cross-chain swaps** — Execute EXACT_IN and EXACT_OUT swaps between any supported networks
- **Unified balances** — Aggregate user assets and balances across all connected chains
- **Optimized transfers** — Automatically choose the most efficient transfer route
- **Contract execution** — Call smart contracts with automatic bridging and funding logic
- **Transaction simulation** — Estimate gas, fees, and required approvals before sending
- **Complete testnet coverage** — Full multi-chain test environment
- **Comprehensive utilities** — Address, token, and chain helpers built in

---

## Configuration

### SDK Initialization Options

```typescript
import { NexusSDK } from '@avail-project/nexus-core';

const sdk = new NexusSDK({
  // Network: 'mainnet' | 'testnet' | custom NetworkConfig
  network: 'mainnet',

  // Enable debug logging
  debug: false,

  // Chain ID for SIWE (Sign-In with Ethereum) signing
  siweChain: 1,

  // Analytics configuration (see Analytics section)
  analytics: {
    enabled: true,
    privacy: {
      anonymizeWallets: true,
      anonymizeAmounts: true,
    },
  },
});
```

### Network Configuration

```typescript
// Mainnet
const mainnetSdk = new NexusSDK({ network: 'mainnet' });

// Testnet
const testnetSdk = new NexusSDK({ network: 'testnet' });

// Custom network config (advanced)
const customSdk = new NexusSDK({
  network: {
    // Custom network configuration object
  },
});
```

---

## API Reference

### Initialization & Lifecycle

#### `initialize(provider)`

Initialize the SDK with an EVM-compatible wallet provider.

```typescript
await sdk.initialize(window.ethereum);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `EthereumProvider` | EIP-1193 compatible provider (MetaMask, WalletConnect, etc.) |

#### `setEVMProvider(provider)`

Set or update the EVM provider without full re-initialization.

```typescript
await sdk.setEVMProvider(newProvider);
```

#### `isInitialized()`

Check if SDK is fully initialized.

```typescript
if (sdk.isInitialized()) {
  // Safe to call SDK methods
}
```

#### `triggerAccountChange()`

Manually trigger account change detection (useful for some wallet integrations).

```typescript
sdk.triggerAccountChange();
```

#### `deinit()`

Clean up SDK resources. Call when unmounting your app.

```typescript
await sdk.deinit();
```

---

### Balance Operations

#### `getBalancesForBridge()`

Get user's token balances across all supported chains for bridge operations.

```typescript
const assets = await sdk.getBalancesForBridge();

// Returns UserAsset[] - array of assets with per-chain breakdown
// [
//   {
//     symbol: 'USDC',
//     balance: '1250.50',        // Total across all chains
//     balanceInFiat: 1250.50,    // USD value
//     decimals: 6,
//     icon: 'https://...',
//     breakdown: [               // Per-chain balances
//       {
//         balance: '500.00',
//         balanceInFiat: 500.00,
//         chain: { id: 1, name: 'Ethereum', logo: '...' },
//         contractAddress: '0xa0b86991...',
//         decimals: 6,
//         symbol: 'USDC',
//       },
//       {
//         balance: '750.50',
//         balanceInFiat: 750.50,
//         chain: { id: 137, name: 'Polygon', logo: '...' },
//         contractAddress: '0x3c499c54...',
//         decimals: 6,
//         symbol: 'USDC',
//       },
//     ],
//   },
//   // ... more assets (ETH, USDT, etc.)
// ]
```

**UserAsset:**

```typescript
type UserAsset = {
  symbol: string;
  balance: string;          // Total balance (human-readable)
  balanceInFiat: number;    // USD value
  decimals: number;
  icon?: string;
  breakdown: AssetBreakdown[];
};

type AssetBreakdown = {
  balance: string;
  balanceInFiat: number;
  chain: { id: number; name: string; logo: string };
  contractAddress: Hex;
  decimals: number;
  symbol: string;
};
```

#### `getBalancesForSwap(onlyNativesAndStables?)`

Get user's token balances for swap operations.

```typescript
// All swap-supported tokens
const allBalances = await sdk.getBalancesForSwap();

// Only native tokens and stablecoins
const stableBalances = await sdk.getBalancesForSwap(true);
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `onlyNativesAndStables` | `boolean` | `false` | Filter to only native tokens and stablecoins |

---

### Bridge Operations

#### `bridge(params, options?)`

Bridge tokens from one or more source chains to a destination chain.

```typescript
const result = await sdk.bridge(
  {
    token: 'USDC',
    amount: 100_000_000n, // 100 USDC
    toChainId: 137,
    recipient: '0x...', // Optional: defaults to connected wallet
    sourceChains: [1, 42161], // Optional: auto-selected if omitted
    gas: 100000n, // Optional: gas to supply on destination
  },
  {
    onEvent: (event) => {
      // Handle progress events
    },
  }
);
```

**BridgeParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | `string` | Yes | Token symbol: `'ETH'`, `'USDC'`, `'USDT'`, `'USDM'` |
| `amount` | `bigint` | Yes | Amount in smallest unit (e.g., 6 decimals for USDC) |
| `toChainId` | `number` | Yes | Destination chain ID |
| `recipient` | `Hex` | No | Recipient address (defaults to connected wallet) |
| `sourceChains` | `number[]` | No | Specific source chains to use (auto-selected if omitted) |
| `gas` | `bigint` | No | Gas amount to supply on destination chain |

**BridgeResult:**

```typescript
type BridgeResult = {
  explorerUrl: string; // Destination chain explorer URL
  sourceTxs: Array<{
    chain: { id: number; name: string; logo: string };
    hash: Hex;
    explorerUrl: string;
  }>;
  intent: ReadableIntent;
};
```

#### `simulateBridge(params)`

Simulate a bridge operation to estimate fees and preview the intent.

```typescript
const simulation = await sdk.simulateBridge({
  token: 'USDC',
  amount: 100_000_000n,
  toChainId: 137,
});

console.log('Estimated fees:', simulation.intent.fees);
console.log('Source chains:', simulation.intent.sources);
```

**SimulationResult:**

```typescript
type SimulationResult = {
  intent: ReadableIntent;
  token: TokenInfo;
};
```

#### `calculateMaxForBridge(params)`

Calculate the maximum amount that can be bridged for a given token.

```typescript
const max = await sdk.calculateMaxForBridge({
  token: 'USDC',
  toChainId: 137,
});

console.log(`Max bridgeable: ${max.amount} ${max.symbol}`);
console.log('From chains:', max.sourceChainIds);
```

**BridgeMaxResult:**

```typescript
type BridgeMaxResult = {
  amountRaw: bigint;
  amount: string; // Human-readable
  symbol: string;
  sourceChainIds: number[];
};
```

---

### Transfer Operations

#### `bridgeAndTransfer(params, options?)`

Bridge tokens and send to a specific recipient address.

```typescript
const result = await sdk.bridgeAndTransfer(
  {
    token: 'USDC',
    amount: 50_000_000n, // 50 USDC
    toChainId: 42161, // Arbitrum
    recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
    sourceChains: [1], // Optional
  },
  {
    onEvent: (event) => console.log(event),
  }
);
```

**TransferParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | `string` | Yes | Token symbol |
| `amount` | `bigint` | Yes | Amount in smallest unit |
| `toChainId` | `number` | Yes | Destination chain ID |
| `recipient` | `Hex` | Yes | Recipient address |
| `sourceChains` | `number[]` | No | Specific source chains |

**TransferResult:**

```typescript
type TransferResult = {
  transactionHash: string;
  explorerUrl: string;
};
```

#### `simulateBridgeAndTransfer(params)`

Simulate a bridge-and-transfer operation.

```typescript
const simulation = await sdk.simulateBridgeAndTransfer({
  token: 'USDC',
  amount: 50_000_000n,
  toChainId: 42161,
  recipient: '0x...',
});
```

---

### Execute Operations

#### `execute(params, options?)`

Execute a smart contract call on a destination chain.

```typescript
const result = await sdk.execute(
  {
    toChainId: 1,
    to: '0xContractAddress',
    data: '0x...', // Encoded function call
    value: 0n, // ETH value to send
    tokenApproval: {
      token: 'USDC',
      amount: 1_000_000n,
      spender: '0xSpenderAddress',
    },
    // Advanced options
    gasPrice: 'medium', // 'low' | 'medium' | 'high'
    waitForReceipt: true,
    receiptTimeout: 60000,
    requiredConfirmations: 1,
  },
  {
    onEvent: (event) => console.log(event),
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
| `gas` | `bigint` | No | Gas limit |
| `gasPrice` | `'low' \| 'medium' \| 'high'` | No | Gas price strategy |
| `tokenApproval` | `{ token, amount, spender }` | No | Token approval before execution |
| `waitForReceipt` | `boolean` | No | Wait for transaction receipt |
| `receiptTimeout` | `number` | No | Receipt wait timeout (ms) |
| `requiredConfirmations` | `number` | No | Required block confirmations |

**ExecuteResult:**

```typescript
type ExecuteResult = {
  transactionHash: string;
  explorerUrl: string;
  chainId: number;
  receipt?: TransactionReceipt;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  approvalTransactionHash?: string;
};
```

#### `simulateExecute(params)`

Simulate contract execution to estimate gas.

```typescript
const simulation = await sdk.simulateExecute({
  toChainId: 1,
  to: '0x...',
  data: '0x...',
});

console.log('Gas estimate:', simulation.gasUsed);
console.log('Gas fee:', simulation.gasFee);
```

**ExecuteSimulation:**

```typescript
type ExecuteSimulation = {
  gasUsed: bigint;
  gasPrice: bigint;
  gasFee: bigint; // gasUsed * gasPrice
};
```

#### `bridgeAndExecute(params, options?)`

Bridge tokens to a destination chain and execute a contract call.

```typescript
const result = await sdk.bridgeAndExecute(
  {
    token: 'USDC',
    amount: 100_000_000n,
    toChainId: 1,
    sourceChains: [8453], // Optional
    execute: {
      to: '0xDeFiProtocol',
      data: '0x...', // deposit() call
      tokenApproval: {
        token: 'USDC',
        amount: 100_000_000n,
        spender: '0xDeFiProtocol',
      },
    },
  },
  {
    onEvent: (event) => console.log(event),
  }
);

if (result.bridgeSkipped) {
  console.log('Used existing balance on destination');
} else {
  console.log('Bridge explorer:', result.bridgeExplorerUrl);
}
```

**BridgeAndExecuteParams:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | `string` | Yes | Token to bridge |
| `amount` | `bigint` | Yes | Amount to bridge |
| `toChainId` | `number` | Yes | Destination chain |
| `sourceChains` | `number[]` | No | Source chains to use |
| `execute` | `Omit<ExecuteParams, 'toChainId'>` | Yes | Contract execution params |

**BridgeAndExecuteResult:**

```typescript
type BridgeAndExecuteResult = {
  executeTransactionHash: string;
  executeExplorerUrl: string;
  approvalTransactionHash?: string;
  bridgeExplorerUrl?: string; // undefined if bridge was skipped
  toChainId: number;
  bridgeSkipped: boolean;
  intent?: ReadableIntent;
};
```

#### `simulateBridgeAndExecute(params)`

Simulate bridge-and-execute to estimate costs.

```typescript
const simulation = await sdk.simulateBridgeAndExecute({
  token: 'USDC',
  amount: 100_000_000n,
  toChainId: 1,
  execute: { to: '0x...', data: '0x...' },
});

console.log('Bridge simulation:', simulation.bridgeSimulation);
console.log('Execute simulation:', simulation.executeSimulation);
```

**BridgeAndExecuteSimulationResult:**

```typescript
type BridgeAndExecuteSimulationResult = {
  bridgeSimulation: SimulationResult | null; // null if bridge not needed
  executeSimulation: ExecuteSimulation;
};
```

---

### Swap Operations

#### `swapWithExactIn(input, options?)`

Swap tokens specifying the exact input amount.

```typescript
const result = await sdk.swapWithExactIn(
  {
    from: [
      { chainId: 10, amount: 1_000_000n, tokenAddress: '0xUSDC...' },
      { chainId: 42161, amount: 500_000n, tokenAddress: '0xUSDC...' },
    ],
    toChainId: 8453,
    toTokenAddress: '0xETH...',
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.SWAP_STEP_COMPLETE) {
        console.log('Swap step:', event.args);
      }
    },
  }
);
```

**ExactInSwapInput:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | `Array<{ chainId, tokenAddress, amount }>` | Yes | Source tokens and amounts |
| `toChainId` | `number` | Yes | Destination chain |
| `toTokenAddress` | `Hex` | Yes | Output token address |

#### `swapWithExactOut(input, options?)`

Swap tokens specifying the exact output amount.

```typescript
const result = await sdk.swapWithExactOut(
  {
    toChainId: 8453,
    toTokenAddress: '0xETH...',
    toAmount: 1_000_000_000_000_000_000n, // 1 ETH
  },
  {
    onEvent: (event) => console.log(event),
  }
);
```

**ExactOutSwapInput:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromSources` | `Array<{ chainId, tokenAddress }>` | No | Restrict source chains/tokens for quote routing |
| `toChainId` | `number` | Yes | Destination chain |
| `toTokenAddress` | `Hex` | Yes | Output token address |
| `toAmount` | `bigint` | Yes | Exact output amount desired |
| `toNativeAmount` | `bigint` | No | Optional native gas amount for destination chain |

**SwapResult:**

```typescript
type SwapResult = {
  success: boolean;
  result: SuccessfulSwapResult;
};
```

#### `getSwapSupportedChains()`

Get chains and tokens supported for swap operations.

```typescript
const supported = sdk.getSwapSupportedChains();
console.log('Supported chains:', supported);
```

---

### Intent Management

#### `getMyIntents(page?)`

Retrieve user's historical intents with pagination.

```typescript
const intents = await sdk.getMyIntents(1); // Page 1
console.log('My intents:', intents);
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | `number` | `1` | Page number for pagination |

#### `refundIntent(intentID: number)`

Request a refund for a failed or stuck intent.

```typescript
const intents = await sdk.getMyIntents(1);
const intentID = Number(intents[0]?.id);
await sdk.refundIntent(intentID);
```

---

## Hooks & Callbacks

Hooks are essential for building interactive UIs. They allow users to review and approve operations before execution.

### Intent Hook

Called when the SDK needs user approval for a bridge/transfer intent.

```typescript
sdk.setOnIntentHook(async ({ intent, allow, deny, refresh }) => {
  // Display intent details to user
  console.log('Source chains:', intent.sources);
  console.log('Destination:', intent.destination);
  console.log('Fees:', intent.fees);
  console.log('Total from sources:', intent.sourcesTotal);

  // User interaction
  if (userApproves) {
    allow();
  } else {
    deny(); // Throws USER_DENIED_INTENT error
  }

  // Optionally refresh with different source chains
  const refreshedIntent = await refresh([8453, 42161]);
  console.log('Refreshed intent:', refreshedIntent);
});
```

**OnIntentHookData:**

```typescript
type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: ReadableIntent;
  refresh: (selectedSources?: number[]) => Promise<ReadableIntent>;
};
```

**ReadableIntent Structure:**

```typescript
type ReadableIntent = {
  // Sources (chains funds are pulled from)
  sources: Array<{
    amount: string;
    amountRaw: bigint;
    chain: { id: number; name: string; logo: string };
    token: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
  }>;

  // All available sources (before selection)
  allSources: Array<{ /* same as sources */ }>;

  // Destination details
  destination: {
    amount: string;
    chainID: number;
    chainName: string;
    chainLogo: string | undefined;
  };

  // Fee breakdown
  fees: {
    caGas: string;      // Chain abstraction gas fee
    gasSupplied: string; // Gas supplied to destination
    protocol: string;    // Protocol fee
    solver: string;      // Solver fee
    total: string;       // Total fees
  };

  // Token being bridged
  token: {
    decimals: number;
    logo: string | undefined;
    name: string;
    symbol: string;
  };

  // Total amount from all sources
  sourcesTotal: string;
};
```

### Allowance Hook

Called when token approval is needed before a transaction.

```typescript
sdk.setOnAllowanceHook(({ sources, allow, deny }) => {
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
    current: string;     // Current allowance (human-readable)
    currentRaw: bigint;  // Current allowance (raw)
    minimum: string;     // Minimum required (human-readable)
    minimumRaw: bigint;  // Minimum required (raw)
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

Called when user approval is needed for a swap operation.

```typescript
sdk.setOnSwapIntentHook(async ({ intent, allow, deny, refresh }) => {
  console.log('Swap from:', intent.sources);
  console.log('Swap to:', intent.destination);

  if (userApproves) {
    allow();
  } else {
    deny();
  }

  // Refresh to get updated quote
  const refreshedIntent = await refresh();
  console.log('Refreshed swap intent:', refreshedIntent);
});
```

**OnSwapIntentHookData:**

```typescript
type OnSwapIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: SwapIntent;
  refresh: () => Promise<SwapIntent>;
};

type SwapIntent = {
  destination: {
    amount: string;
    chain: { id: number; logo: string; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
    gas: {
      amount: string;
      token: { contractAddress: Hex; decimals: number; symbol: string };
    };
  };
  sources: Array<{
    amount: string;
    chain: { id: number; logo: string; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
  }>;
};
```

### Event Callbacks

All main SDK operations accept an `onEvent` callback to track progress.

```typescript
sdk.bridge(params, {
  onEvent: (event) => {
    switch (event.name) {
      case NEXUS_EVENTS.STEPS_LIST: {
        // Emitted once at start with all steps
        const allSteps = event.args; // BridgeStepType[]
        initializeProgressUI(allSteps);
        break;
      }

      case NEXUS_EVENTS.STEP_COMPLETE: {
        // Emitted as each step completes
        const completedStep = event.args; // BridgeStepType
        updateProgressUI(completedStep);
        break;
      }

      case NEXUS_EVENTS.SWAP_STEP_COMPLETE: {
        // For swap operations
        const swapStep = event.args; // SwapStepType
        updateSwapProgress(swapStep);
        break;
      }
    }
  },
});
```

---

## Events & Steps

The SDK emits step-by-step progress events during operations, enabling real-time UI updates.

### Bridge Steps

Bridge operations emit the following step types:

| Step Type | Type ID | Description |
|-----------|---------|-------------|
| `INTENT_ACCEPTED` | `IA` | Intent created and accepted by solver |
| `INTENT_HASH_SIGNED` | `IHS` | User signed the intent hash |
| `INTENT_SUBMITTED` | `IS` | Intent submitted to the network |
| `INTENT_FULFILLED` | `IF` | Intent fulfilled by solver |
| `ALLOWANCE_USER_APPROVAL` | `AUA_{chainId}` | Waiting for user to approve allowance |
| `ALLOWANCE_APPROVAL_MINED` | `AAM_{chainId}` | Allowance approval transaction mined |
| `ALLOWANCE_ALL_DONE` | `AAD` | All allowances approved |
| `INTENT_DEPOSIT` | `ID_{index}` | Deposit initiated on source chain |
| `INTENT_DEPOSITS_CONFIRMED` | `UIDC` | All deposits confirmed |
| `INTENT_COLLECTION` | `IC_{index}` | Collecting funds from source |
| `INTENT_COLLECTION_COMPLETE` | `ICC` | All funds collected |
| `APPROVAL` | `AP` | Token approval for execution |
| `TRANSACTION_SENT` | `TS` | Execute transaction sent |
| `TRANSACTION_CONFIRMED` | `CN` | Execute transaction confirmed |

**Step Data Structure:**

```typescript
type BridgeStepType = {
  type: string;   // Step type name
  typeID: string; // Unique identifier
  data?: {
    // Additional data (varies by step type)
    chainID?: number;
    chainName?: string;
    amount?: string;
    explorerURL?: string;
    intentID?: number;
    txHash?: Hex;
  };
};
```

### Swap Steps

Swap operations emit the following step types:

| Step Type | Description |
|-----------|-------------|
| `SWAP_START` | Swap operation started |
| `DETERMINING_SWAP` | Calculating optimal swap route |
| `CREATE_PERMIT_EOA_TO_EPHEMERAL` | Creating permit for ephemeral wallet |
| `CREATE_PERMIT_FOR_SOURCE_SWAP` | Creating permit for source swap |
| `SOURCE_SWAP_BATCH_TX` | Executing source chain swaps |
| `SOURCE_SWAP_HASH` | Source swap transaction hash |
| `BRIDGE_DEPOSIT` | Bridge deposit for cross-chain swap |
| `RFF_ID` | Request for funds ID |
| `DESTINATION_SWAP_BATCH_TX` | Executing destination swaps |
| `DESTINATION_SWAP_HASH` | Destination swap transaction hash |
| `SWAP_COMPLETE` | Swap completed successfully |
| `SWAP_SKIPPED` | Swap skipped (sufficient balance exists) |

**Swap Step Data Structure:**

```typescript
type SwapStepType = {
  type: string;
  typeID: string;
  completed: boolean;
  chain?: { id: number; name: string };
  symbol?: string;
  explorerURL?: string;
  data?: { /* varies by step */ };
};
```

### Building Progress UIs

Example of building a progress indicator:

```typescript
import { NEXUS_EVENTS, type BridgeStepType } from '@avail-project/nexus-core';

// State for tracking progress
let steps: BridgeStepType[] = [];
let completedSteps: Set<string> = new Set();

sdk.bridge(params, {
  onEvent: (event) => {
    if (event.name === NEXUS_EVENTS.STEPS_LIST) {
      // Initialize with all expected steps
      steps = event.args;
      renderProgress();
    }

    if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
      // Mark step as complete
      completedSteps.add(event.args.typeID);
      renderProgress();

      // Handle specific steps
      if (event.args.type === 'INTENT_SUBMITTED') {
        console.log('View on explorer:', event.args.data?.explorerURL);
      }
    }
  },
});

function renderProgress() {
  steps.forEach((step, index) => {
    const isComplete = completedSteps.has(step.typeID);
    const isCurrent = index === completedSteps.size;
    console.log(`${isComplete ? '✓' : isCurrent ? '●' : '○'} ${step.type}`);
  });
}
```

---

## Error Handling

### NexusError Class

All SDK errors are thrown as `NexusError` instances:

```typescript
import { NexusError, ERROR_CODES } from '@avail-project/nexus-core';

try {
  await sdk.bridge({ token: 'USDC', amount: 1_000_000n, toChainId: 137 });
} catch (error) {
  if (error instanceof NexusError) {
    console.error(`Error Code: ${error.code}`);
    console.error(`Message: ${error.message}`);
    console.error(`Context: ${error.data?.context}`);
    console.error(`Details:`, error.data?.details);

    // Handle specific errors
    switch (error.code) {
      case ERROR_CODES.INSUFFICIENT_BALANCE:
        showInsufficientBalanceUI();
        break;
      case ERROR_CODES.USER_DENIED_INTENT:
        // User cancelled - not an error to display
        break;
      case ERROR_CODES.TRANSACTION_TIMEOUT:
        showRetryOption();
        break;
      default:
        showGenericError(error.message);
    }
  } else {
    // Unexpected error
    console.error('Unexpected error:', error);
  }
}
```

**NexusError Structure:**

```typescript
class NexusError extends Error {
  readonly code: keyof typeof ERROR_CODES;
  readonly data?: {
    context?: string;              // Where/why it happened
    cause?: unknown;               // Nested error
    details?: Record<string, unknown>; // Additional info
  };

  toJSON(): object; // Serializable format
}
```

### Error Codes Reference

| Error Code | Description | User Action |
|------------|-------------|-------------|
| **User Actions** | | |
| `USER_DENIED_INTENT` | User rejected the intent in hook | None - user cancelled |
| `USER_DENIED_ALLOWANCE` | User rejected token approval | None - user cancelled |
| `USER_DENIED_INTENT_SIGNATURE` | User rejected signature request | None - user cancelled |
| `USER_DENIED_SIWE_SIGNATURE` | User rejected SIWE signature | None - user cancelled |
| **Balance & Funds** | | |
| `INSUFFICIENT_BALANCE` | Not enough tokens for operation | Show balance, suggest deposit |
| `NO_BALANCE_FOR_ADDRESS` | No balance found for address | Verify address |
| **Validation** | | |
| `INVALID_INPUT` | Invalid parameters provided | Check input values |
| `INVALID_ADDRESS_LENGTH` | Address has wrong length | Verify address format |
| `INVALID_VALUES_ALLOWANCE_HOOK` | Invalid allowance hook values | Check allow() arguments |
| `TOKEN_NOT_SUPPORTED` | Token not supported | Use supported token |
| **Initialization** | | |
| `SDK_NOT_INITIALIZED` | SDK not initialized | Call initialize() first |
| `SDK_INIT_STATE_NOT_EXPECTED` | Unexpected init state | Re-initialize SDK |
| `WALLET_NOT_CONNECTED` | No wallet connected | Connect wallet |
| `CONNECT_ACCOUNT_FAILED` | Failed to connect account | Retry connection |
| **Chain & Network** | | |
| `CHAIN_NOT_FOUND` | Chain ID not found | Use supported chain |
| `CHAIN_DATA_NOT_FOUND` | Chain data unavailable | Check network connection |
| `VAULT_CONTRACT_NOT_FOUND` | Vault contract not found | Contact support |
| `ENVIRONMENT_NOT_SUPPORTED` | Environment not supported | Use mainnet/testnet |
| `ENVIRONMENT_NOT_KNOWN` | Unknown environment | Check configuration |
| **Transactions** | | |
| `TRANSACTION_TIMEOUT` | Transaction timed out | Retry or check explorer |
| `TRANSACTION_REVERTED` | Transaction reverted | Check contract/params |
| `TRANSACTION_CHECK_ERROR` | Error checking transaction | Retry |
| `FETCH_GAS_PRICE_FAILED` | Failed to fetch gas price | Retry |
| **Operations** | | |
| `SIMULATION_FAILED` | Simulation failed | Check parameters |
| `QUOTE_FAILED` | Failed to get quote | Retry |
| `SWAP_FAILED` | Swap operation failed | Retry or adjust params |
| `REFUND_FAILED` | Refund request failed | Contact support |
| `REFUND_CHECK_ERROR` | Error checking refund | Retry |
| **Intent & Solver** | | |
| `LIQUIDITY_TIMEOUT` | Solver liquidity timeout | Retry later |
| `RATES_CHANGED_BEYOND_TOLERANCE` | Price moved too much | Refresh and retry |
| `RFF_FEE_EXPIRED` | Request for funds expired | Retry operation |
| `DESTINATION_REQUEST_HASH_NOT_FOUND` | Destination hash not found | Contact support |
| `DESTINATION_SWEEP_ERROR` | Error sweeping funds | Contact support |
| **Allowance** | | |
| `SLIPPAGE_EXCEEDED_ALLOWANCE` | Slippage exceeded | Increase allowance |
| `ALLOWANCE_SETTING_ERROR` | Error setting allowance | Retry approval |
| **Other** | | |
| `INTERNAL_ERROR` | Internal SDK error | Contact support |
| `UNKNOWN_SIGNATURE` | Unknown signature type | Contact support |
| `ASSET_NOT_FOUND` | Asset not found | Check token address |
| `COSMOS_ERROR` | Cosmos chain error | Check Cosmos config |
| `UNIVERSE_NOT_SUPPORTED` | Universe not supported | Use supported chain |
| `FEE_GRANT_REQUESTED` | Fee grant requested | Contact support |

---

## TypeScript Reference

### Core Types

```typescript
import type {
  // SDK Configuration
  NexusNetwork,
  AnalyticsConfig,

  // Operation Parameters
  BridgeParams,
  TransferParams,
  ExecuteParams,
  BridgeAndExecuteParams,
  ExactInSwapInput,
  ExactOutSwapInput,

  // Operation Results
  BridgeResult,
  TransferResult,
  ExecuteResult,
  BridgeAndExecuteResult,
  SwapResult,
  BridgeMaxResult,

  // Simulation Results
  SimulationResult,
  ExecuteSimulation,
  BridgeAndExecuteSimulationResult,

  // Intent & Hook Types
  ReadableIntent,
  SwapIntent,
  OnIntentHook,
  OnIntentHookData,
  OnAllowanceHook,
  OnAllowanceHookData,
  AllowanceHookSources,
  OnSwapIntentHook,
  OnSwapIntentHookData,

  // Step Types
  BridgeStepType,
  SwapStepType,

  // Balance Types
  UserAsset,
  AssetBreakdown,

  // Metadata
  ChainMetadata,
  TokenMetadata,
  TokenInfo,

  // Errors
  NexusError,
  NexusErrorData,
} from '@avail-project/nexus-core';
```

### Constants

```typescript
import {
  // Event names
  NEXUS_EVENTS,

  // Chain IDs
  SUPPORTED_CHAINS,
  MAINNET_CHAIN_IDS,
  TESTNET_CHAIN_IDS,

  // Metadata
  CHAIN_METADATA,
  TOKEN_METADATA,
  TOKEN_CONTRACT_ADDRESSES,

  // Steps
  BRIDGE_STEPS,
  SWAP_STEPS,

  // Errors
  ERROR_CODES,
} from '@avail-project/nexus-core';
```

---

## Utilities

### Formatting Functions

```typescript
import {
  formatTokenBalance,
  formatTokenBalanceParts,
  formatUnits,
  parseUnits,
} from '@avail-project/nexus-core';

// Format token balance for display
const formatted = formatTokenBalance(1234567890n, 6, { symbol: 'USDC' });
// "1,234.57 USDC"

// Get formatted parts separately
const parts = formatTokenBalanceParts(1234567890n, 6);
// { integer: "1,234", decimal: "57", symbol: "USDC" }

// Convert between units
const wei = parseUnits('1.5', 18); // 1500000000000000000n
const eth = formatUnits(wei, 18);  // "1.5"
```

### Address Utilities

```typescript
import { isValidAddress, truncateAddress } from '@avail-project/nexus-core';

// Validate Ethereum address
const valid = isValidAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // true

// Truncate for display
const short = truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45');
// "0x742d...Db45"

const custom = truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45', 6, 4);
// "0x742d35...Db45"
```

### Chain & Token Info

```typescript
import { CHAIN_METADATA, getSupportedChains } from '@avail-project/nexus-core';

// Get chain metadata
const polygon = CHAIN_METADATA[137];
console.log(polygon.name);        // "Polygon"
console.log(polygon.nativeCurrency); // { name: "MATIC", symbol: "MATIC", decimals: 18 }

// Get all supported chains and tokens
const mainnet = getSupportedChains('mainnet');
const testnet = getSupportedChains('testnet');

// Via SDK instance
const chains = sdk.utils.getSupportedChains();
const isSupported = sdk.utils.isSupportedChain(137); // true
```

### Price Rates

```typescript
// Get current token prices from Coinbase
const rates = await sdk.utils.getCoinbaseRates();
console.log(rates.ETH);  // "3456.78"
console.log(rates.USDC); // "1.00"
```

---

## Smart Optimizations

### Bridge Skip Optimization

During **bridge-and-execute** operations, the SDK checks whether sufficient funds already exist on the destination chain:

- **Balance detection** — Verifies token and gas availability
- **Integrated gas supply** — Provides gas alongside bridged tokens
- **Adaptive bridging** — Skips unnecessary bridging or transfers only the shortfall
- **Seamless fallback** — Uses chain abstraction if local funds are insufficient

```typescript
const result = await sdk.bridgeAndExecute({
  token: 'USDC',
  amount: 100_000_000n,
  toChainId: 1,
  execute: { to: '0x...', data: '0x...' },
});

if (result.bridgeSkipped) {
  console.log('Executed using existing balance - no bridge needed!');
}
```

### Direct Transfer Optimization

For transfers, the SDK automatically chooses the most efficient execution path:

- **Local balance checking** — Confirms token and gas availability on the target chain
- **Direct EVM transfers** — Uses native transfers where possible (faster, cheaper)
- **Chain abstraction fallback** — Uses CA routing only when required
- **Universal compatibility** — Works with both native tokens (ETH, MATIC) and ERC-20s (USDC, USDT)

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

Note: operation metadata may include transaction context (for example, recipient or contract addresses) in tracked events.

### Disabling Analytics

```typescript
const sdk = new NexusSDK({
  network: 'mainnet',
  analytics: { enabled: false },
});
```

### Privacy Controls

```typescript
const sdk = new NexusSDK({
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
const sdk = new NexusSDK({
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
sdk.analytics.track('custom_event', { foo: 'bar' });

// Identify users
sdk.analytics.identify('user-id', { plan: 'premium' });

// Check if analytics is enabled
if (sdk.analytics.isEnabled()) {
  console.log('Analytics active');
}

// Disable/enable at runtime
sdk.analytics.disable();
sdk.analytics.enable();
```

---

## Supported Networks

### Mainnets

| Network | Chain ID | Native | Status |
|---------|----------|--------|--------|
| Ethereum | 1 | ETH | ✅ |
| Citrea Mainnet | 4114 | cBTC | ✅ |
| Monad | 143 | MON | ✅ |
| Base | 8453 | ETH | ✅ |
| Arbitrum One | 42161 | ETH | ✅ |
| Optimism | 10 | ETH | ✅ |
| Polygon | 137 | MATIC | ✅ |
| Avalanche | 43114 | AVAX | ✅ |
| Scroll | 534352 | ETH | ✅ |
| Kaia Mainnet | 8217 | KAIA | ✅ |
| BNB Smart Chain | 56 | BNB | ✅ |
| Hyper EVM | 999 | HYPE | ✅ |
| MegaETH | 4326 | ETH | ✅ |

### Testnets

| Network | Chain ID | Native | Status |
|---------|----------|--------|--------|
| Sepolia | 11155111 | ETH | ✅ |
| Base Sepolia | 84532 | ETH | ✅ |
| Arbitrum Sepolia | 421614 | ETH | ✅ |
| Optimism Sepolia | 11155420 | ETH | ✅ |
| Polygon Amoy | 80002 | MATIC | ✅ |
| Monad Testnet | 10143 | MON | ✅ |
| Citrea Testnet | 5115 | cBTC | ✅ |

---

## Supported Tokens

| Token | Name | Decimals | Networks |
|-------|------|----------|----------|
| ETH | Ethereum | 18 | All EVM chains |
| USDC | USD Coin | 6 | All supported |
| USDT | Tether USD | 6 | Most supported |
| USDM | USDm | 18 | MegaETH |

---

## Common Pitfalls

- SDK method amounts are atomic units (`bigint`), not human-readable decimal strings.
- `bridge`/`bridgeAndTransfer`/`bridgeAndExecute` use token symbols (for example, `USDC`), while swap methods use token contract addresses.
- `refundIntent` requires an `intentID` (`number`), usually from `getMyIntents()`.
- `setEVMProvider()` only updates/attaches a provider; call `initialize()` early to set up full session state.

---

## Skills Integration

This repo ships Codex/skills.sh skills under `skills/` to help agents integrate the SDK end-to-end.

### Install Skills

```bash
# Install all skills
npx skills add availproject/nexus-sdk

# Install single skill (recommended)
npx skills add https://github.com/availproject/nexus-sdk --skill nexus-sdk-integration

# Install from specific branch
npx skills add https://github.com/availproject/nexus-sdk --skill nexus-sdk-integration --ref develop
```

### Available Skills

- `nexus-sdk-integration` — Parent/orchestrator skill
- `nexus-sdk-setup` — SDK setup and configuration
- `nexus-sdk-hooks-events` — Hooks and event handling
- `nexus-sdk-bridge-flows` — Bridge operation flows
- `nexus-sdk-swap-flows` — Swap operation flows
- `nexus-sdk-balances-metadata-utils` — Balances and utilities

---

## Resources

- **GitHub:** [availproject/nexus-sdk](https://github.com/availproject/nexus-sdk)
- **Documentation:** [docs.availproject.org](https://docs.availproject.org/nexus/avail-nexus-sdk)
- **Discord:** [Avail Discord](https://discord.gg/availproject)
