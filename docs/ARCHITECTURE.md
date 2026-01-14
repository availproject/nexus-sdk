# Nexus SDK Architecture

> **Purpose**: Comprehensive technical documentation for SDK contributors and LLMs working on the codebase.
>
> **Version**: 1.0.0-beta.63
> **Repository**: https://github.com/availproject/nexus-sdk

---

## Table of Contents

1. [Overview & Quick Reference](#1-overview--quick-reference)
2. [Project Structure](#2-project-structure)
3. [Core Data Flows](#3-core-data-flows)
4. [Backend & API Interactions](#4-backend--api-interactions)
5. [Extending the SDK](#5-extending-the-sdk)
6. [Error Handling](#6-error-handling)
7. [Supporting Systems](#7-supporting-systems)
8. [Type Reference](#8-type-reference)
9. [ca-common Integration Reference](#9-ca-common-integration-reference)
10. [Cross-Chain Swap (XCS) Aggregators](#10-cross-chain-swap-xcs-aggregators)
11. [Protocol Internals](#11-protocol-internals)

---

## 1. Overview & Quick Reference

### What This SDK Does

The Nexus SDK is a **headless TypeScript SDK** for cross-chain operations built on Avail's Chain Abstraction (CA) infrastructure. It enables:

- **Cross-chain token bridging** - Move tokens between 17+ blockchains
- **Cross-chain swaps** - Swap any token on any chain to any other token on any chain
- **Contract execution** - Execute arbitrary smart contract calls with automatic bridging
- **Unified balance aggregation** - View balances across all supported chains

### Architecture Layers

The SDK is built on a layered architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NexusSDK (nexus-sdk)                        │
│     Public API: bridge(), swap(), execute(), bridgeAndExecute()     │
├─────────────────────────────────────────────────────────────────────┤
│                           CA Base Layer                             │
│        Core chain abstraction logic, handlers, query clients        │
├─────────────────────────────────────────────────────────────────────┤
│                      ca-common (@avail-project/ca-common)           │
│   Shared types, protocol definitions, ABIs, aggregators, permits    │
├─────────────────────────────────────────────────────────────────────┤
│                         External Libraries                          │
│  viem (EVM) | @cosmjs (Cosmos) | Protobuf | DEX Aggregator APIs    │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Concepts

#### Universe
The system supports multiple blockchain "universes" - distinct blockchain ecosystems:

```typescript
// From ca-common: src/proto/definition.ts
enum Universe {
  ETHEREUM = 0,  // All EVM chains (Ethereum, Arbitrum, Polygon, etc.)
  FUEL = 1,      // Fuel Network
  SOLANA = 2,    // Solana
  TRON = 3,      // TRON
}
```

#### OmniversalChainID
A unique identifier for any chain across all universes. Uses 36-byte binary format:

```typescript
// From ca-common: src/data/chainid.ts
class OmniversalChainID {
  universe: Universe;    // 4 bytes
  chainID: bigint;       // 32 bytes (right-aligned)

  // Examples:
  // Ethereum Mainnet: Universe.ETHEREUM (0) + chainID 1
  // Arbitrum: Universe.ETHEREUM (0) + chainID 42161
  // Solana: Universe.SOLANA (2) + chainID 0x2b6653dc
}
```

#### Intent-Based Bridging
The SDK uses an **intent-based** system for cross-chain operations:

1. **User Intent**: User declares what they want (e.g., "send 100 USDC to Arbitrum")
2. **Request For Funds (RFF)**: Intent encoded as an RFF message on Cosmos
3. **Solver Fulfillment**: Solvers compete to fulfill the intent
4. **Settlement**: Deposits are collected, solver delivers funds on destination

#### Request For Funds (RFF)
The core protocol message for cross-chain transfers:

```typescript
// From ca-common: src/proto/definition.ts
interface RequestForFunds {
  sources: RFFSource[];              // Where funds come from
  destinationUniverse: number;       // Target universe
  destinationChainID: Uint8Array;    // 32-byte chain ID
  recipientAddress: Uint8Array;      // 32-byte recipient
  destinations: RFFDestination[];    // Where funds go
  nonce: Uint8Array;                 // Unique identifier
  expiry: Long;                      // Expiration timestamp
  signatureData: SignatureData[];    // Party signatures
}
```

### Key Classes Quick Reference

#### SDK Classes (nexus-sdk)

| Class | File | Purpose |
|-------|------|---------|
| `NexusSDK` | `src/sdk/index.ts` | Main SDK entry point - extends CA |
| `CA` | `src/sdk/ca-base/ca.ts` | Chain Abstraction base layer |
| `ChainList` | `src/sdk/ca-base/chains.ts` | Chain registry and metadata |
| `BridgeHandler` | `src/sdk/ca-base/requestHandlers/bridge.ts` | Bridge operation handler |
| `BridgeAndExecuteQuery` | `src/sdk/ca-base/query/bridgeAndExecute.ts` | Bridge + execute operations |
| `SwapAndExecuteQuery` | `src/sdk/ca-base/query/swapAndExecute.ts` | Swap + execute operations |
| `AnalyticsManager` | `src/analytics/AnalyticsManager.ts` | Telemetry and analytics |
| `NexusError` | `src/sdk/ca-base/nexusError.ts` | Custom error class |
| `Errors` | `src/sdk/ca-base/errors.ts` | Error factory functions |

#### ca-common Classes (shared library)

| Class/Type | ca-common File | Purpose |
|------------|----------------|---------|
| `OmniversalChainID` | `src/data/chainid.ts` | Universal chain identifier across universes |
| `Currency` | `src/data/currency.ts` | Token representation with decimals and permit info |
| `ChainIDKeyedMap` | `src/data/chainid.ts` | Map using OmniversalChainID as keys |
| `OmniversalRFF` | `src/rff/rff.ts` | Request For Funds wrapper (protobuf ↔ EVM) |
| `QueryClientImpl` | `src/proto/grpc.ts` | gRPC client for Cosmos queries |
| `Aggregator` | `src/xcs/iface.ts` | DEX aggregator interface |
| `LiFiAggregator` | `src/xcs/lifi-agg.ts` | LiFi DEX aggregator |
| `BebopAggregator` | `src/xcs/bebop-agg.ts` | Bebop/CoW Swap aggregator |

### Quick Lookup: Common Tasks

| Task | Method/Location |
|------|-----------------|
| Initialize SDK | `new NexusSDK({ network: 'mainnet' })` then `sdk.initialize(provider)` |
| Bridge tokens | `sdk.bridge({ token, amount, toChainId })` |
| Swap tokens | `sdk.swapWithExactIn({ from, toChainId, toTokenAddress })` |
| Execute contract | `sdk.execute({ toChainId, to, data, value })` |
| Bridge + Execute | `sdk.bridgeAndExecute({ token, amount, toChainId, execute: {...} })` |
| Swap + Execute | `sdk.swapAndExecute({ toChainId, toTokenAddress, toAmount, execute: {...} })` |
| Get balances | `sdk.getBalancesForBridge()` or `sdk.getBalancesForSwap()` |
| Add new chain | Modify `src/sdk/ca-base/chains.ts` and `src/commons/constants/index.ts` |
| Add new token | Modify `TOKEN_CONTRACT_ADDRESSES` in `src/commons/constants/index.ts` |
| Handle errors | Catch `NexusError` and check `.code` property |

### SDK Initialization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    new NexusSDK(config)                         │
│                           │                                     │
│                           ▼                                     │
│    ┌─────────────────────────────────────────────────┐          │
│    │ 1. Determine network (mainnet/testnet/custom)   │          │
│    │ 2. Initialize ChainList based on environment    │          │
│    │ 3. Set up NetworkConfig (Cosmos/VSC URLs)       │          │
│    │ 4. Initialize AnalyticsManager                  │          │
│    └─────────────────────────────────────────────────┘          │
│                           │                                     │
│                           ▼                                     │
│              sdk.initialize(provider)                           │
│                           │                                     │
│                           ▼                                     │
│    ┌─────────────────────────────────────────────────┐          │
│    │ 1. Create viem WalletClient from provider       │          │
│    │ 2. Get user's EVM address                       │          │
│    │ 3. Set up Cosmos signing client                 │          │
│    │ 4. Initialize query clients (Cosmos, VSC)       │          │
│    │ 5. Set up WebSocket connections                 │          │
│    │ 6. Generate ephemeral wallet for CA operations  │          │
│    │ 7. Perform SIWE authentication                  │          │
│    └─────────────────────────────────────────────────┘          │
│                           │                                     │
│                           ▼                                     │
│                   SDK Ready for Use                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Project Structure

### Directory Layout

```
nexus-sdk/
├── src/                              # Source code
│   ├── index.ts                      # Main exports
│   ├── _polyfill.ts                  # Browser polyfills
│   │
│   ├── sdk/                          # Core SDK implementation
│   │   ├── index.ts                  # NexusSDK class
│   │   ├── utils.ts                  # Utility exports (NexusUtils)
│   │   │
│   │   └── ca-base/                  # Chain Abstraction base layer
│   │       ├── ca.ts                 # CA class (base for NexusSDK)
│   │       ├── chains.ts             # ChainList class & chain configs
│   │       ├── config.ts             # Network configuration (Coral/Folly)
│   │       ├── constants.ts          # CA-specific constants
│   │       ├── errors.ts             # Error factory functions
│   │       ├── nexusError.ts         # NexusError class & ERROR_CODES
│   │       ├── telemetry.ts          # OpenTelemetry setup
│   │       │
│   │       ├── abi/                  # Smart contract ABIs
│   │       │   └── (imported from @avail-project/ca-common)
│   │       │
│   │       ├── query/                # Query handlers
│   │       │   ├── bridgeAndExecute.ts   # BridgeAndExecuteQuery class
│   │       │   └── gasFeeHistory.ts      # Gas price recommendations
│   │       │
│   │       ├── requestHandlers/      # Operation handlers
│   │       │   └── bridge.ts         # BridgeHandler class
│   │       │
│   │       ├── swap/                 # Swap implementation
│   │       │   ├── swap.ts           # Main swap function
│   │       │   ├── route.ts          # Route determination logic
│   │       │   ├── data.ts           # Swap data types & filters
│   │       │   ├── constants.ts      # Swap constants (API keys)
│   │       │   ├── rff.ts            # Request For Funds logic
│   │       │   ├── utils.ts          # Swap utilities
│   │       │   └── ob/               # Order book handlers
│   │       │       ├── index.ts
│   │       │       ├── bridge.ts         # BridgeHandler
│   │       │       ├── destinationSwap.ts # DestinationSwapHandler
│   │       │       └── sourceSwaps.ts    # SourceSwapsHandler
│   │       │
│   │       └── utils/                # Utility functions
│   │           ├── index.ts          # Re-exports all utils
│   │           ├── api.utils.ts      # API helpers (Coinbase, Ankr)
│   │           ├── balance.utils.ts  # Balance fetching
│   │           ├── common.utils.ts   # Common utilities
│   │           ├── contract.utils.ts # Contract interaction helpers
│   │           ├── cosmos.utils.ts   # Cosmos-specific utilities
│   │           ├── platform.utils.ts # Platform detection (browser/node)
│   │           ├── rff.utils.ts      # RFF utilities
│   │           └── tron.utils.ts     # TRON-specific utilities
│   │
│   ├── analytics/                    # Analytics system
│   │   ├── AnalyticsManager.ts       # Main analytics orchestrator
│   │   ├── events.ts                 # Event name constants
│   │   ├── performance.ts            # Performance tracking
│   │   ├── session.ts                # Session management
│   │   ├── types.ts                  # Analytics types
│   │   ├── utils.ts                  # Analytics utilities
│   │   └── providers/                # Analytics providers
│   │       ├── AnalyticsProvider.ts  # Provider interface
│   │       ├── NoOpProvider.ts       # No-op provider (disabled)
│   │       └── PostHogProvider.ts    # PostHog implementation
│   │
│   ├── commons/                      # Shared utilities & types
│   │   ├── index.ts                  # Re-exports
│   │   ├── types/                    # Type definitions
│   │   │   ├── index.ts              # Main types
│   │   │   ├── bridge-steps.ts       # Bridge step definitions
│   │   │   ├── swap-steps.ts         # Swap step definitions
│   │   │   ├── swap-types.ts         # Swap-specific types
│   │   │   ├── contract-types.ts     # Contract types
│   │   │   └── integration-types.ts  # Integration types
│   │   ├── constants/                # Constants
│   │   │   └── index.ts              # SUPPORTED_CHAINS, TOKEN_*, etc.
│   │   └── utils/                    # Common utilities
│   │       ├── format.ts             # Token formatting
│   │       └── logger.ts             # Logging utilities
│   │
│   └── integrations/                 # External integrations
│       ├── tenderly.ts               # Tenderly simulation client
│       └── types.ts                  # Integration types
│
├── examples/                         # Usage examples
│   ├── node/                         # Node.js examples
│   │   ├── balances/                 # Balance checking
│   │   └── basic-execution/          # CLI runner
│   └── web/                          # Browser examples
│       ├── bridge/                   # Simple bridge UI
│       ├── bridge-and-transfer/      # Bridge + transfer
│       ├── swap-with-exact-in/       # Exact input swap
│       ├── swap-with-exact-out/      # Exact output swap
│       └── wasm/                     # Rust/WASM integration
│
├── .ci-tests/                        # CI bundler tests
│   ├── esbuild-test/
│   ├── webpack-test/
│   ├── vite-test/
│   └── nextjs-test/
│
├── package.json                      # Dependencies & scripts
├── tsconfig.json                     # TypeScript config
├── rollup.config.mjs                 # Build configuration
└── biome.jsonc                       # Linter/formatter config
```

### Key Dependencies

#### Blockchain Libraries

```typescript
// EVM interactions (primary)
import { WalletClient, PublicClient, createWalletClient, createPublicClient } from 'viem';

// Cosmos interactions
import { SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

// TRON interactions (optional)
import TronWeb from 'tronweb';
import type { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';

// Chain Abstraction Common (Avail's shared library)
import {
  Environment,
  Universe,
  ChaindataMap,
  OmniversalChainID,
  EVMVaultABI,
  // ... many more
} from '@avail-project/ca-common';
```

#### Utility Libraries

```typescript
import Decimal from 'decimal.js';        // Arbitrary precision math
import Long from 'long';                  // 64-bit integers
import axios from 'axios';                // HTTP client
import { pack, unpack } from 'msgpackr';  // MessagePack serialization
```

#### Analytics

```typescript
import posthog from 'posthog-js';         // PostHog analytics
import { LoggerProvider } from '@opentelemetry/sdk-logs';  // OpenTelemetry
```

### Build Output

The SDK produces three output formats:

```
dist/
├── index.js        # CommonJS (for Node.js require())
├── index.esm.js    # ES Module (for modern bundlers)
└── index.d.ts      # TypeScript declarations
```

---

## 3. Core Data Flows

### 3.1 Bridge Operation

The bridge operation moves tokens from one or more source chains to a destination chain using Avail's intent-based system.

#### Entry Point

**File**: `src/sdk/index.ts:bridge()`

```typescript
/**
 * Bridge tokens to another chain
 * @param params - Bridge parameters
 * @param options - Optional event callbacks
 * @returns Promise<BridgeResult>
 */
public async bridge(
  params: BridgeParams,
  options?: OnEventParam
): Promise<BridgeResult> {
  // Validation
  if (!this._isInitialized()) {
    throw Errors.sdkNotInitialized();
  }

  // Delegate to CA base class
  return this._bridge(params, options);
}
```

**Parameters**:
```typescript
interface BridgeParams {
  recipient?: Hex;           // Optional: defaults to user's address
  token: string;             // 'ETH' | 'USDC' | 'USDT'
  amount: bigint;            // Amount in smallest units (wei, etc.)
  toChainId: number;         // Destination chain ID
  gas?: bigint;              // Optional: gas to supply on destination
  sourceChains?: number[];   // Optional: restrict source chains
}
```

#### Bridge Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         sdk.bridge(params)                              │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  1. VALIDATION                                        │            │
│    │     - Check SDK initialized                           │            │
│    │     - Validate token is supported                     │            │
│    │     - Validate destination chain exists               │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  2. BALANCE CHECK                                     │            │
│    │     - Fetch unified balances from VSC                 │            │
│    │     - Check if destination already has enough         │            │
│    │     - If sufficient → Skip bridge, return early       │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼ (insufficient balance)                 │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  3. INTENT CREATION                                   │            │
│    │     - Fetch protocol fees from Cosmos                 │            │
│    │     - Fetch solver routes                             │            │
│    │     - Fetch oracle prices                             │            │
│    │     - Calculate optimal source allocation             │            │
│    │     - Build Intent object with fees                   │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  4. INTENT HOOK (User Approval)                       │            │
│    │     - Call onIntentHook callback                      │            │
│    │     - User can: allow(), deny(), refresh()            │            │
│    │     - If denied → throw USER_DENIED_INTENT            │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼ (allowed)                              │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  5. ALLOWANCE CHECK & APPROVAL                        │            │
│    │     - Check ERC20 allowances for each source          │            │
│    │     - Call onAllowanceHook if approvals needed        │            │
│    │     - User chooses: 'max', 'min', or custom amount    │            │
│    │     - Execute approval transactions (EIP-2612 permit  │            │
│    │       or standard approve)                            │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  6. INTENT SIGNATURE                                  │            │
│    │     - Create RFF (Request For Funds) structure        │            │
│    │     - Sign intent hash with user's wallet             │            │
│    │     - If rejected → throw USER_DENIED_INTENT_SIGNATURE│            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  7. INTENT SUBMISSION                                 │            │
│    │     - Submit RFF to Cosmos chain via VSC              │            │
│    │     - Receive intent ID                               │            │
│    │     - Store intent hash locally for recovery          │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  8. DEPOSIT COLLECTION                                │            │
│    │     - For each source chain:                          │            │
│    │       - Switch to chain                               │            │
│    │       - Execute deposit to vault contract             │            │
│    │       - Wait for transaction confirmation             │            │
│    │       - Create double-check tx on Cosmos              │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  9. WAIT FOR FULFILLMENT                              │            │
│    │     - Listen to vault contract events                 │            │
│    │     - OR poll Cosmos for fill status                  │            │
│    │     - Timeout after configured duration               │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  10. RETURN RESULT                                    │            │
│    │     {                                                 │            │
│    │       explorerUrl: string,                            │            │
│    │       sourceTxs: SourceTxs[],                         │            │
│    │       intent: ReadableIntent                          │            │
│    │     }                                                 │            │
│    └───────────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Step-by-Step Code Walkthrough

**Step 1: Validation** (`src/sdk/index.ts`)

```typescript
public async bridge(
  params: BridgeParams,
  options?: OnEventParam
): Promise<BridgeResult> {
  if (!this._isInitialized()) {
    throw Errors.sdkNotInitialized();
  }
  return this._bridge(params, options);
}
```

**Step 2-3: Balance Check & Intent Creation** (`src/sdk/ca-base/requestHandlers/bridge.ts`)

```typescript
export default class BridgeHandler {
  constructor(
    private params: BridgeParams,
    private options: IBridgeOptions,
    private analytics?: AnalyticsManager
  ) {}

  private async createIntent(): Promise<Intent> {
    // Fetch required data in parallel
    const [feeStore, balances, oraclePrices] = await Promise.all([
      getFeeStore(this.options.cosmosQueryClient),
      this.options.vscClient.getEVMBalancesForAddress(this.options.evm.address),
      this.options.cosmosQueryClient.fetchPriceOracle(),
    ]);

    // Get token info
    const { chain: dstChain, token } = this.options.chainList.getChainAndTokenFromSymbol(
      this.params.toChainId,
      this.params.token
    );

    if (!token) {
      throw Errors.tokenNotFound(this.params.token, this.params.toChainId);
    }

    // Build intent with source allocation
    const intent = buildIntent({
      token,
      amount: this.params.amount,
      destination: {
        chainID: this.params.toChainId,
        universe: dstChain.universe,
      },
      balances,
      feeStore,
      oraclePrices,
      sourceChains: this.params.sourceChains,
    });

    return intent;
  }
}
```

**Step 4: Intent Hook** (`src/sdk/ca-base/ca.ts`)

```typescript
// In CA base class
private async waitForIntentApproval(intent: Intent): Promise<void> {
  return new Promise((resolve, reject) => {
    const allow = () => resolve();
    const deny = () => reject(Errors.userDeniedIntent());

    const refresh = async (selectedSources?: number[]) => {
      // Recalculate intent with new source selection
      return this.recalculateIntent(intent, selectedSources);
    };

    // Call user-provided hook
    this.onIntentHook({
      allow,
      deny,
      intent: convertIntent(intent, token, this.chainList),
      refresh,
    });
  });
}
```

**Step 5: Allowance Handling** (`src/sdk/ca-base/requestHandlers/bridge.ts`)

```typescript
private async handleAllowances(intent: Intent): Promise<void> {
  const sourcesNeedingApproval: IntentSourceForAllowance[] = [];

  for (const source of intent.sources) {
    // Skip native tokens (no approval needed)
    if (isNativeAddress(source.universe, source.tokenContract)) {
      continue;
    }

    const currentAllowance = await erc20GetAllowance(
      {
        contractAddress: source.tokenContract,
        spender: this.getVaultContract(source.chainID),
        owner: source.holderAddress,
      },
      this.getPublicClient(source.chainID)
    );

    const requiredAllowance = mulDecimals(source.amount, token.decimals);

    if (currentAllowance < requiredAllowance) {
      sourcesNeedingApproval.push({
        chainID: source.chainID,
        currentAllowance,
        requiredAllowance,
        token,
      });
    }
  }

  if (sourcesNeedingApproval.length > 0) {
    await this.requestAllowanceApprovals(sourcesNeedingApproval);
  }
}
```

**Step 6: Intent Signature** (`src/sdk/ca-base/utils/common.utils.ts`)

```typescript
const createRequestEVMSignature = async (
  evmRFF: EVMRFF,
  evmAddress: `0x${string}`,
  client: WalletClient | PrivateKeyAccount
) => {
  const abi = getAbiItem({ abi: EVMVaultABI, name: 'deposit' });

  // Encode the RFF structure
  const msg = encodeAbiParameters(abi.inputs[0].components, [
    evmRFF.sources,
    evmRFF.destinationUniverse,
    evmRFF.destinationChainID,
    evmRFF.recipientAddress,
    evmRFF.destinations,
    evmRFF.nonce,
    evmRFF.expiry,
    evmRFF.parties,
  ]);

  const hash = keccak256(msg, 'bytes');

  // Sign the hash
  const signature = toBytes(
    await client
      .signMessage({
        account: evmAddress,
        message: { raw: hash },
      })
      .catch((e) => {
        if (e instanceof UserRejectedRequestError) {
          throw Errors.userRejectedIntentSignature();
        }
        throw e;
      })
  );

  return { requestHash: hashMessage({ raw: hash }), signature };
};
```

**Step 7-8: Intent Submission & Deposit Collection**

```typescript
// Submit RFF to VSC
const { id: intentID } = await this.options.vscClient.vscPublishRFF(rffID);

// Store for recovery
storeIntentHashToStore(this.options.evm.address, intentID.toNumber());

// Collect deposits from each source chain
for (const source of intent.sources) {
  await switchChain(this.options.evm.client, sourceChain);

  const depositTxHash = await this.executeDeposit(source);

  // Wait for confirmation
  await waitForTxReceipt(depositTxHash, publicClient);

  // Emit step complete event
  this.emit(BRIDGE_STEPS.INTENT_DEPOSITS_CONFIRMED);

  // Create double-check on Cosmos
  await createDepositDoubleCheckTx(chainID, cosmos, intentID)();
}
```

**Step 9: Wait for Fulfillment** (`src/sdk/ca-base/utils/common.utils.ts`)

```typescript
const evmWaitForFill = async (
  vaultContractAddress: `0x${string}`,
  publicClient: PublicClient<WebSocketTransport>,
  requestHash: `0x${string}`,
  intentID: Long,
  cosmosQueryClient: CosmosQueryClient
) => {
  const ac = new AbortController();

  // Race between:
  // 1. WebSocket event from vault contract
  // 2. Timeout (3 minutes default)
  // 3. Cosmos fill check polling
  await Promise.race([
    waitForIntentFulfilment(publicClient, vaultContractAddress, requestHash, ac),
    requestTimeout(3, ac),
    cosmosFillCheck(intentID, cosmosQueryClient, ac),
  ]);
};
```

#### Events Emitted

| Event | When | Step Constant |
|-------|------|---------------|
| `STEPS_LIST` | At start, list of all steps | `NEXUS_EVENTS.STEPS_LIST` |
| `STEP_COMPLETE` | After intent accepted | `BRIDGE_STEPS.INTENT_ACCEPTED` |
| `STEP_COMPLETE` | After intent hash signed | `BRIDGE_STEPS.INTENT_HASH_SIGNED` |
| `STEP_COMPLETE` | After intent submitted | `BRIDGE_STEPS.INTENT_SUBMITTED` |
| `STEP_COMPLETE` | When allowance needed | `BRIDGE_STEPS.ALLOWANCE_APPROVAL_REQUEST` |
| `STEP_COMPLETE` | After allowance mined | `BRIDGE_STEPS.ALLOWANCE_APPROVAL_MINED` |
| `STEP_COMPLETE` | After all allowances done | `BRIDGE_STEPS.ALLOWANCE_COMPLETE` |
| `STEP_COMPLETE` | When deposit requested | `BRIDGE_STEPS.INTENT_DEPOSIT_REQUEST` |
| `STEP_COMPLETE` | After deposits confirmed | `BRIDGE_STEPS.INTENT_DEPOSITS_CONFIRMED` |
| `STEP_COMPLETE` | During collection | `BRIDGE_STEPS.INTENT_COLLECTION` |
| `STEP_COMPLETE` | Collection complete | `BRIDGE_STEPS.INTENT_COLLECTION_COMPLETE` |
| `STEP_COMPLETE` | Intent fulfilled | `BRIDGE_STEPS.INTENT_FULFILLED` |

#### Error Scenarios

| Condition | Error Code | Recovery |
|-----------|------------|----------|
| SDK not initialized | `SDK_NOT_INITIALIZED` | Call `initialize()` first |
| Invalid chain ID | `CHAIN_NOT_FOUND` | Check `SUPPORTED_CHAINS` |
| Token not supported | `TOKEN_NOT_SUPPORTED` | Use ETH, USDC, or USDT |
| Insufficient balance | `INSUFFICIENT_BALANCE` | Add funds or reduce amount |
| User denies intent | `USER_DENIED_INTENT` | User must approve in hook |
| User denies allowance | `USER_DENIED_ALLOWANCE` | User must approve in hook |
| User denies signature | `USER_DENIED_INTENT_SIGNATURE` | User must sign in wallet |
| Fill timeout | `LIQUIDITY_TIMEOUT` | Retry or request refund |

---

### 3.2 Swap Operation

The swap operation converts tokens on any source chain(s) to any token on any destination chain using aggregators (LiFi, Bebop).

#### Entry Point

**File**: `src/sdk/index.ts`

```typescript
/**
 * Swap with exact input amount (know what you're spending)
 */
public async swapWithExactIn(
  input: ExactInSwapInput,
  options?: OnEventParam
): Promise<SwapResult> {
  if (!this._isInitialized()) {
    throw Errors.sdkNotInitialized();
  }
  return this._swapWithExactIn(input, options);
}

/**
 * Swap with exact output amount (know what you're receiving)
 */
public async swapWithExactOut(
  input: ExactOutSwapInput,
  options?: OnEventParam
): Promise<SwapResult> {
  if (!this._isInitialized()) {
    throw Errors.sdkNotInitialized();
  }
  return this._swapWithExactOut(input, options);
}
```

**Parameters**:

```typescript
// Exact In: "I want to spend X tokens"
type ExactInSwapInput = {
  from: {
    chainId: number;
    amount: bigint;
    tokenAddress: Hex;
  }[];
  toChainId: number;
  toTokenAddress: Hex;
};

// Exact Out: "I want to receive X tokens"
type ExactOutSwapInput = {
  fromSources?: Source[];     // Optional: restrict source chains/tokens
  toChainId: number;
  toTokenAddress: Hex;
  toAmount: bigint;           // Exact amount you want to receive
  toNativeAmount?: bigint;    // Optional: also need gas on destination
};
```

#### Swap Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    sdk.swapWithExactIn/Out(input)                       │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  1. DETERMINE SWAP ROUTE                              │            │
│    │     File: src/sdk/ca-base/swap/route.ts               │            │
│    │                                                       │            │
│    │     - Fetch user balances                             │            │
│    │     - Fetch fee store & oracle prices                 │            │
│    │     - Calculate COT (Currency of Transfer = USDC)     │            │
│    │     - Determine source swaps needed                   │            │
│    │     - Determine if bridge is needed                   │            │
│    │     - Determine destination swap needed               │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  2. SWAP INTENT HOOK (User Approval)                  │            │
│    │     - Call onSwapIntentHook callback                  │            │
│    │     - Show: source assets, destination amount, fees   │            │
│    │     - User can: allow(), deny(), refresh()            │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼ (allowed)                              │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  3. SOURCE SWAPS (if needed)                          │            │
│    │     File: src/sdk/ca-base/swap/ob/sourceSwaps.ts      │            │
│    │                                                       │            │
│    │     - For each source token not already COT:          │            │
│    │       - Get quote from aggregator (LiFi/Bebop)        │            │
│    │       - Execute swap on source chain                  │            │
│    │       - Result: all sources now in COT (USDC)         │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  4. BRIDGE (if cross-chain)                           │            │
│    │     File: src/sdk/ca-base/swap/ob/bridge.ts           │            │
│    │                                                       │            │
│    │     - Create RFF with COT amounts from each source    │            │
│    │     - Execute deposits on each source chain           │            │
│    │     - Wait for fulfillment on destination             │            │
│    │     - Result: COT on destination chain                │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  5. DESTINATION SWAP                                  │            │
│    │     File: src/sdk/ca-base/swap/ob/destinationSwap.ts  │            │
│    │                                                       │            │
│    │     - Create permit for ephemeral wallet              │            │
│    │     - Get quote from aggregator for COT → target      │            │
│    │     - Execute swap via VSC (sponsored tx)             │            │
│    │     - Transfer result to user's EOA                   │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  6. RETURN RESULT                                     │            │
│    │     {                                                 │            │
│    │       explorerUrl: string,                            │            │
│    │       sourceTxs: [...],                               │            │
│    │       destinationTxHash: string,                      │            │
│    │       swapRoute: SwapRoute                            │            │
│    │     }                                                 │            │
│    └───────────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Route Determination Logic

**File**: `src/sdk/ca-base/swap/route.ts`

```typescript
export const determineSwapRoute = async (
  input: SwapData,
  options: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  }
): Promise<SwapRoute> => {
  return input.mode === SwapMode.EXACT_OUT
    ? _exactOutRoute(input.data, options)
    : _exactInRoute(input.data, options);
};
```

**Exact Out Route** (user specifies desired output):

```typescript
const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID }
): Promise<SwapRoute> => {

  // 1. Fetch data in parallel
  const [feeStore, { balances }, oraclePrices, dstTokenInfo] = await Promise.all([
    getFeeStore(params.cosmosQueryClient),
    getBalancesForSwap({
      evmAddress: params.address.eoa,
      chainList: params.chainList,
      filterWithSupportedTokens: true,  // Only stable + native for exact out
      allowedSources: input.fromSources,
      removeSources,
    }),
    params.cosmosQueryClient.fetchPriceOracle(),
    getTokenInfo(input.toTokenAddress, publicClient, dstChain),
  ]);

  // 2. Determine destination swap (working backwards from desired output)
  // COT = Currency of Transfer (USDC)
  const destinationSwap = await determineDestinationSwaps(
    userAddressInBytes,
    dstOmniversalChainID,
    {
      amount: BigInt(input.toAmount),
      tokenAddress: convertTo32Bytes(input.toTokenAddress),
    },
    params.aggregators
  );

  // 3. Calculate how much COT we need for destination swap + fees
  const min = destinationSwap.inputAmount.add(gasInCOT);
  const max = applyBuffer(min, BUFFER_EXACT_OUT.DESTINATION_SWAP); // +5% buffer

  // 4. Auto-select sources to provide required COT amount
  const { quotes: sourceSwapQuotes } = await autoSelectSourcesV2(
    userAddressInBytes,
    sortedBalances.map(/* ... */),
    sourceSwapOutputRequired,
    params.aggregators
  );

  // 5. Determine if bridge is needed
  const isBridgeRequired = !(
    sourceSwapQuotes.every(q => q.chainID === input.toChainId) &&
    usedCOTs.every(q => q.chainID === input.toChainId)
  );

  return {
    source: { swaps: sourceSwaps, creationTime },
    bridge: isBridgeRequired ? bridgeInput : null,
    destination: { type: 'EXACT_OUT', swap: destinationSwap, ... },
    extras: { assetsUsed, aggregators, oraclePrices, balances, cotSymbol },
  };
};
```

#### Swap Aggregators

**File**: `src/sdk/ca-base/swap/constants.ts`

```typescript
// API keys (public, rate-limited)
export const LIFI_API_KEY = '...';
export const BEBOP_API_KEY = '...';
```

**Aggregator initialization** (`src/sdk/ca-base/swap/swap.ts`):

```typescript
const aggregators: Aggregator[] = [
  new LiFiAggregator(LIFI_API_KEY),
  new BebopAggregator(BEBOP_API_KEY),
];
```

The aggregators implement a common interface from `@avail-project/ca-common`:

```typescript
interface Aggregator {
  getQuote(request: QuoteRequest): Promise<Quote>;
  executeSwap(quote: Quote, wallet: WalletClient): Promise<Hex>;
}
```

#### Events Emitted

| Event | Step Constant |
|-------|---------------|
| Start | `SWAP_STEPS.SWAP_START` |
| Determining route | `SWAP_STEPS.DETERMINING_SWAP()` |
| Route determined | `SWAP_STEPS.DETERMINING_SWAP(true)` |
| Source swap executing | `SWAP_STEPS.SOURCE_SWAP()` |
| Source swap complete | `SWAP_STEPS.SOURCE_SWAP(true)` |
| Bridge starting | `SWAP_STEPS.BRIDGE()` |
| Bridge complete | `SWAP_STEPS.BRIDGE(true)` |
| Destination swap | `SWAP_STEPS.DESTINATION_SWAP()` |
| Swap complete | `SWAP_STEPS.DESTINATION_SWAP(true)` |

---

### 3.3 Execute Operation

Execute an arbitrary smart contract call on a destination chain, with optional automatic bridging.

#### Entry Point

**File**: `src/sdk/index.ts`

```typescript
/**
 * Execute contract call (no bridging)
 */
public async execute(
  params: ExecuteParams,
  options?: OnEventParam
): Promise<ExecuteResult> {
  if (!this._isInitialized()) {
    throw Errors.sdkNotInitialized();
  }
  return this._execute(params, options);
}
```

**Parameters**:

```typescript
interface ExecuteParams {
  toChainId: number;              // Chain to execute on
  to: Hex;                        // Contract address
  value?: bigint;                 // ETH value to send
  data?: Hex;                     // Encoded function call
  gas?: bigint;                   // Gas limit (auto-estimated if not provided)
  gasPrice?: bigint;              // Gas price (auto-estimated if not provided)
  waitForReceipt?: boolean;       // Wait for confirmation (default: true)
  receiptTimeout?: number;        // Timeout in ms (default: 300000)
  requiredConfirmations?: number; // Confirmations to wait for (default: 1)
  tokenApproval?: {               // Optional: approve tokens before execute
    token: string;
    amount: bigint;
    spender: Hex;
  };
}
```

#### Execute Flow

**File**: `src/sdk/ca-base/query/bridgeAndExecute.ts`

```typescript
public async execute(params: ExecuteParams, options?: OnEventParam) {
  const address = (await this.evmClient.getAddresses())[0];

  // 1. Create transaction(s)
  const { dstPublicClient, dstChain, approvalTx, tx } = await this.createTxsForExecute(
    params,
    address
  );

  // 2. Send transaction(s)
  const executeResponse = await this.sendTx(
    { approvalTx, tx },
    {
      emit: options?.onEvent,
      chain: dstChain,
      dstPublicClient,
      address,
      receiptTimeout: params.receiptTimeout,
      requiredConfirmations: params.requiredConfirmations,
      waitForReceipt: params.waitForReceipt,
      client: this.evmClient,
    }
  );

  // 3. Return result
  return {
    chainId: params.toChainId,
    explorerUrl: createExplorerTxURL(executeResponse.txHash, dstChain.blockExplorers.default.url),
    transactionHash: executeResponse.txHash,
    approvalTransactionHash: executeResponse.approvalHash,
    receipt: executeResponse.receipt,
    confirmations: params.requiredConfirmations,
    gasUsed: String(executeResponse.receipt?.gasUsed ?? 0n),
  };
}
```

**Transaction Sending** (`sendTx` method):

```typescript
private async sendTx(
  params: { tx: Tx; approvalTx: Tx | null; gasPrice?: bigint },
  options: { /* ... */ }
) {
  // Switch to destination chain
  await switchChain(options.client, options.chain);

  // Send approval if needed
  let approvalHash: Hex | undefined;
  if (params.approvalTx) {
    approvalHash = await options.client.sendTransaction({
      ...params.approvalTx,
      account: options.address,
      chain: options.chain,
    });
    await waitForTxReceipt(approvalHash, options.dstPublicClient, 1);

    options.emit?.({
      name: NEXUS_EVENTS.STEP_COMPLETE,
      args: BRIDGE_STEPS.EXECUTE_APPROVAL_STEP,
    });
  }

  // Send main transaction
  const txHash = await options.client.sendTransaction({
    ...params.tx,
    account: options.address,
    chain: options.chain,
  });

  options.emit?.({
    name: NEXUS_EVENTS.STEP_COMPLETE,
    args: BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
  });

  // Wait for receipt
  let receipt: TransactionReceipt | undefined;
  if (options.waitForReceipt) {
    receipt = await waitForTxReceipt(
      txHash,
      options.dstPublicClient,
      options.requiredConfirmations,
      options.receiptTimeout
    );

    options.emit?.({
      name: NEXUS_EVENTS.STEP_COMPLETE,
      args: BRIDGE_STEPS.EXECUTE_TRANSACTION_CONFIRMED,
    });
  }

  return { txHash, receipt, approvalHash };
}
```

---

### 3.4 Bridge and Execute Operation

Combines bridging and contract execution in a single operation. Automatically bridges only what's needed.

#### Entry Point

**File**: `src/sdk/index.ts`

```typescript
public async bridgeAndExecute(
  params: BridgeAndExecuteParams,
  options?: OnEventParam & BeforeExecuteHook
): Promise<BridgeAndExecuteResult> {
  if (!this._isInitialized()) {
    throw Errors.sdkNotInitialized();
  }
  return this._bridgeAndExecute(params, options);
}
```

**Parameters**:

```typescript
interface BridgeAndExecuteParams {
  toChainId: number;
  token: string;                  // Token for execute (ETH, USDC, USDT)
  amount: bigint;                 // Amount needed for execute
  sourceChains?: number[];        // Optional: restrict source chains
  execute: Omit<ExecuteParams, 'toChainId'>;  // The contract call
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
}
```

#### Flow

**File**: `src/sdk/ca-base/query/bridgeAndExecute.ts`

```typescript
public async bridgeAndExecute(
  params: BridgeAndExecuteParams,
  options?: OnEventParam & BeforeExecuteHook
): Promise<BridgeAndExecuteResult> {

  // 1. Estimate what's needed
  const {
    dstPublicClient,
    dstChain,
    address,
    token,
    skipBridge,
    tx,
    approvalTx,
    amount,
    gas,
    gasPrice,
  } = await this.estimateBridgeAndExecute(params);

  // 2. Bridge if needed
  let bridgeResult: BridgeResult | null = null;
  if (!skipBridge) {
    bridgeResult = await this.bridgeWrapper(
      {
        token: token.symbol,
        amount: amount.token,
        toChainId: params.toChainId,
        sourceChains: params.sourceChains,
        gas: amount.gas,
      },
      {
        onEvent: (event) => {
          // Combine bridge steps with execute steps
          if (event.name === NEXUS_EVENTS.STEPS_LIST) {
            options?.onEvent?.({
              name: NEXUS_EVENTS.STEPS_LIST,
              args: event.args.concat(executeSteps),
            });
          } else {
            options?.onEvent?.(event);
          }
        },
      }
    );
  }

  // 3. Allow dynamic data modification before execute
  if (options?.beforeExecute) {
    const response = await options.beforeExecute();
    if (response.data) tx.data = response.data;
    if (response.value) tx.value = response.value;
    if (response.gas) tx.gas = response.gas;
  }

  // 4. Execute the transaction
  const executeResponse = await this.sendTx(
    { approvalTx, tx, gasPrice },
    { /* ... */ }
  );

  // 5. Return combined result
  return {
    executeTransactionHash: executeResponse.txHash,
    executeExplorerUrl: createExplorerTxURL(executeResponse.txHash, dstChain.blockExplorers.default.url),
    approvalTransactionHash: executeResponse.approvalHash,
    bridgeExplorerUrl: bridgeResult?.explorerUrl,
    toChainId: params.toChainId,
    bridgeSkipped: skipBridge,
    intent: bridgeResult?.intent,
  };
}
```

**Optimal Bridge Amount Calculation**:

```typescript
private async calculateOptimalBridgeAmount(
  chain: Chain,
  tokenAddress: Hex,
  tokenDecimals: number,
  requiredTokenAmount: bigint,
  requiredGasAmount: bigint,
  assets: UserAssetDatum[]
): Promise<{ skipBridge: boolean; tokenAmount: bigint; gasAmount: bigint }> {

  let skipBridge = true;
  let tokenAmount = requiredTokenAmount;
  let gasAmount = requiredGasAmount;

  const assetList = new UserAssets(assets);
  const { destinationAssetBalance, destinationGasBalance } = assetList.getAssetDetails(
    chain,
    tokenAddress
  );

  const destinationTokenAmount = mulDecimals(destinationAssetBalance, tokenDecimals);
  const destinationGasAmount = mulDecimals(destinationGasBalance, chain.nativeCurrency.decimals);

  // For native tokens (ETH), combine token + gas requirements
  if (isNativeAddress(Universe.ETHEREUM, tokenAddress)) {
    const totalRequired = requiredGasAmount + requiredTokenAmount;
    if (destinationGasAmount < totalRequired) {
      skipBridge = false;
      const difference = totalRequired - destinationGasAmount;

      const missingToken = requiredTokenAmount > destinationTokenAmount
        ? requiredTokenAmount - destinationTokenAmount
        : 0n;

      tokenAmount = missingToken;
      gasAmount = difference > missingToken ? difference - missingToken : 0n;
    }
  } else {
    // For ERC20 tokens, check separately
    const isGasBridgeRequired = destinationGasAmount < requiredGasAmount;
    const isTokenBridgeRequired = destinationTokenAmount < requiredTokenAmount;

    if (isGasBridgeRequired || isTokenBridgeRequired) {
      skipBridge = false;
      tokenAmount = isTokenBridgeRequired ? requiredTokenAmount - destinationTokenAmount : 0n;
      gasAmount = isGasBridgeRequired ? requiredGasAmount - destinationGasAmount : 0n;
    }
  }

  return { skipBridge, tokenAmount, gasAmount };
}
```

### 3.5 Swap and Execute Operation

The `swapAndExecute` operation combines a cross-chain swap with arbitrary contract execution. Unlike `bridgeAndExecute` which bridges a specific token, this operation swaps any token from your unified balance to a specific token on the destination chain, then executes a contract call.

#### Entry Point

**File**: `src/sdk/index.ts:swapAndExecute()`

```typescript
public swapAndExecute = this._swapAndExecute;
```

**Delegates to**: `src/sdk/ca-base/ca.ts:_swapAndExecute()`

```typescript
protected _swapAndExecute = async (input: SwapAndExecuteParams, options?: OnEventParam) => {
  return this.withReinit(async () => {
    return new SwapAndExecuteQuery(
      this.chainList,
      this._evm!.client,
      this._getBalancesForSwap,
      this._swapWithExactOut
    ).swapAndExecute(input, options);
  });
};
```

#### Parameters

```typescript
interface SwapAndExecuteParams {
  toChainId: number;           // Destination chain ID
  toTokenAddress: Hex;         // Token address needed for execution
  toAmount: bigint;            // Amount of token needed (in atomic units)
  fromSources?: Source[];      // Optional: restrict source chains/tokens
  execute: SwapExecuteParams;  // Contract call details
}

interface SwapExecuteParams {
  to: Hex;                     // Contract address to call
  value?: bigint;              // Native value to send (optional)
  data?: Hex;                  // Calldata for the contract
  gas: bigint;                 // Gas limit for execution
  gasPrice?: 'low' | 'medium' | 'high' | 'ultraHigh';
  tokenApproval?: {            // Optional: approve tokens before execute
    token: Hex;
    amount: bigint;
    spender: Hex;
  };
}
```

#### Swap and Execute Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    sdk.swapAndExecute(params)                           │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  1. ESTIMATION                                        │            │
│    │     - Create execute transaction                      │            │
│    │     - Check if token approval needed                  │            │
│    │     - Estimate gas for approval + execution           │            │
│    │     - Fetch gas price recommendations                 │            │
│    │     - Fetch unified swap balances                     │            │
│    │     - Get destination token info                      │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  2. CALCULATE OPTIMAL SWAP AMOUNT                     │            │
│    │     - Check destination chain token balance           │            │
│    │     - Check destination chain native balance          │            │
│    │     - Determine: skipSwap, tokenAmount, gasAmount     │            │
│    │     - If sufficient balance → skip swap entirely      │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  3. SWAP (if needed)                                  │            │
│    │     - Uses swapWithExactOut internally                │            │
│    │     - Swaps to exact token amount needed              │            │
│    │     - Also bridges native gas if required             │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  4. EXECUTE                                           │            │
│    │     - Switch to destination chain                     │            │
│    │     - Execute approval tx (if tokenApproval set)      │            │
│    │     - Execute main contract call                      │            │
│    │     - Wait for transaction receipt                    │            │
│    └───────────────────────────────────────────────────────┘            │
│                                │                                        │
│                                ▼                                        │
│    ┌───────────────────────────────────────────────────────┐            │
│    │  5. RETURN RESULT                                     │            │
│    │     { txHash, receipt, approvalHash }                 │            │
│    └───────────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Implementation Details

**File**: `src/sdk/ca-base/query/swapAndExecute.ts`

**Step 1-2: Estimation and Optimal Amount Calculation**

```typescript
private async estimateSwapAndExecute(params: SwapAndExecuteParams) {
  const { toChainId, toAmount, execute } = params;
  const address = (await this.evmClient.getAddresses())[0];

  // Create transaction objects
  const { tx, approvalTx, dstChain, dstPublicClient } = await this.createTxsForExecute(
    execute,
    toChainId,
    address
  );

  // Fetch gas, prices, balances in parallel
  const [gasUsed, gasPriceRecommendations, balances, dstTokenInfo] = await Promise.all([
    Promise.resolve({
      approvalGas: approvalTx ? 70_000n : 0n,
      txGas: params.execute.gas,
    }),
    getGasPriceRecommendations(dstPublicClient),
    this.getBalancesForSwap(),
    getTokenInfo(params.toTokenAddress, dstPublicClient, dstChain),
  ]);

  // Add gas buffer (chain-specific, typically 30%)
  const pctBuffer = getPctGasBufferByChain(toChainId);
  const approvalGas = pctAdditionToBigInt(gasUsed.approvalGas, pctBuffer);
  const txGas = pctAdditionToBigInt(gasUsed.txGas, pctBuffer);

  const gasPrice = gasPriceRecommendations[params.execute.gasPrice ?? 'high'];
  const gasFee = (approvalGas + txGas) * gasPrice;

  // Calculate how much needs to be swapped
  const { skipSwap, tokenAmount, gasAmount } = await this.calculateOptimalSwapAmount(
    dstTokenInfo.contractAddress,
    dstTokenInfo.decimals,
    toAmount,
    gasFee,
    balances.balances
  );

  return { dstPublicClient, dstChain, address, skipSwap, tx, approvalTx, amount: { token: tokenAmount, gas: gasAmount }, gas: { tx: txGas, approval: approvalGas }, gasPrice };
}
```

**Step 3-4: Swap and Execute**

```typescript
public async swapAndExecute(params: SwapAndExecuteParams, options?: OnEventParam) {
  const { dstPublicClient, dstChain, address, skipSwap, tx, approvalTx, amount, gas, gasPrice } =
    await this.estimateSwapAndExecute(params);

  // Set gas limits
  if (approvalTx) approvalTx.gas = gas.approval;
  tx.gas = gas.tx;

  // Perform swap if needed
  if (!skipSwap) {
    await this.swap(
      {
        fromSources: params.fromSources,
        toTokenAddress: params.toTokenAddress,
        toAmount: amount.token,
        toNativeAmount: amount.gas === 0n ? -1n : amount.gas,  // -1n = don't bridge gas
        toChainId: params.toChainId,
      },
      options
    );
  }

  // Execute the contract call
  return await this.sendTx(
    { approvalTx, tx, gasPrice },
    { emit: options?.onEvent, chain: dstChain, dstPublicClient, address, client: this.evmClient }
  );
}
```

#### Key Differences from bridgeAndExecute

| Aspect | bridgeAndExecute | swapAndExecute |
|--------|------------------|----------------|
| Input token | Specific token (ETH, USDC, USDT) | Any token in unified balance |
| Output token | Same as input | Any supported token |
| Amount | Exact amount to bridge | Exact amount needed on destination |
| Gas handling | Automatic via RFF | Explicit via swap |
| Use case | Bridge + call contract | Swap to specific token + call |

#### Example Usage

```typescript
// Swap to get 1000 USDC on Arbitrum, then call a DeFi contract
await sdk.swapAndExecute({
  toChainId: 42161,  // Arbitrum
  toTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // USDC on Arbitrum
  toAmount: 1000_000000n,  // 1000 USDC (6 decimals)
  execute: {
    to: '0xDeFiContractAddress',
    data: '0x...',  // Encoded function call
    gas: 300_000n,
    gasPrice: 'high',
    tokenApproval: {  // Approve USDC to the DeFi contract
      token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amount: 1000_000000n,
      spender: '0xDeFiContractAddress',
    },
  },
});
```

#### Events Emitted

| Event | When | Payload |
|-------|------|---------|
| All swap events | During swap phase | See [3.2 Swap Operation](#32-swap-operation) |
| `STEP_COMPLETE` | After approval tx | `EXECUTE_APPROVAL_STEP` |
| `STEP_COMPLETE` | After execute tx sent | `EXECUTE_TRANSACTION_SENT` |
| `STEP_COMPLETE` | After receipt confirmed | `EXECUTE_TRANSACTION_CONFIRMED` |

---

## 4. Backend & API Interactions

### 4.1 Overview

The SDK interacts with multiple backend services:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nexus SDK                               │
└─────────────────────────────────────────────────────────────────┘
              │              │              │              │
              ▼              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
     │   Cosmos   │  │    VSC     │  │  Tenderly  │  │ Aggregators│
     │ Query API  │  │  Backend   │  │ Simulation │  │ LiFi/Bebop │
     └────────────┘  └────────────┘  └────────────┘  └────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Fees, RFF  │  │ Balances,  │  │ Gas Est,   │  │ Swap       │
     │ Intent     │  │ Sponsored  │  │ Tx Sim     │  │ Quotes     │
     │ Status     │  │ Tx         │  │            │  │            │
     └────────────┘  └────────────┘  └────────────┘  └────────────┘
```

### 4.2 Network Configuration

**File**: `src/sdk/ca-base/config.ts`

```typescript
// Mainnet (Coral)
const CORAL_CONFIG: NetworkConfig = {
  COSMOS_REST_URL: 'https://cosmos01-testnet.arcana.network',
  COSMOS_RPC_URL: 'https://cosmos01-testnet.arcana.network:26650',
  COSMOS_WS_URL: 'wss://cosmos01-testnet.arcana.network:26650/websocket',
  COSMOS_GRPC_URL: 'https://grpcproxy-testnet.arcana.network',
  VSC_BASE_URL: 'https://vsc1-testnet.arcana.network',
  VSC_WS_URL: 'wss://vsc1-testnet.arcana.network',
  INTENT_EXPLORER_URL: 'https://explorer.nexus.availproject.org',
  NETWORK_HINT: Environment.CORAL,
};

// Testnet (Folly)
const FOLLY_CONFIG: NetworkConfig = {
  COSMOS_REST_URL: 'https://cosmos04-dev.arcana.network',
  COSMOS_RPC_URL: 'https://cosmos04-dev.arcana.network:26650',
  COSMOS_WS_URL: 'wss://cosmos04-dev.arcana.network:26650/websocket',
  COSMOS_GRPC_URL: 'https://grpc-folly.arcana.network',
  VSC_BASE_URL: 'https://vsc1-folly.arcana.network',
  VSC_WS_URL: 'wss://vsc1-folly.arcana.network',
  INTENT_EXPLORER_URL: 'https://explorer.nexus-folly.availproject.org',
  NETWORK_HINT: Environment.FOLLY,
};

const getNetworkConfig = (network?: NexusNetwork): NetworkConfig => {
  if (typeof network === 'object' && isNetworkConfig(network)) {
    return network;  // Custom config
  }
  switch (network) {
    case 'testnet':
      return FOLLY_CONFIG;
    default:
      return CORAL_CONFIG;
  }
};
```

### 4.3 Cosmos Query Client

**Interface** (`src/commons/types/index.ts`):

```typescript
type CosmosQueryClient = {
  fetchMyIntents: (address: string, page?: number) => Promise<RequestForFunds[]>;
  fetchProtocolFees: () => Promise<QueryGetProtocolFeesResponse>;
  fetchSolverData: () => Promise<QueryAllSolverDataResponse>;
  fetchPriceOracle: () => Promise<OraclePriceResponse>;
  checkIntentFilled: (intentID: Long) => Promise<string>;
  getAccount: (address: string) => Promise<void>;
  waitForCosmosFillEvent: (intentID: Long, ac: AbortController) => Promise<string>;
};
```

**Usage Example**:

```typescript
// Fetch protocol fees
const fees = await cosmosQueryClient.fetchProtocolFees();
// Returns: { collection: [...], fulfilment: [...], protocol: { feeBP: string } }

// Fetch oracle prices
const prices = await cosmosQueryClient.fetchPriceOracle();
// Returns: [{ chainId, priceUsd, tokenAddress, tokensPerUsd }, ...]

// Check if intent was fulfilled
const status = await cosmosQueryClient.checkIntentFilled(intentID);
// Returns: transaction hash if filled
```

### 4.4 VSC Client

**Interface** (`src/commons/types/index.ts`):

```typescript
type VSCClient = {
  // Balance fetching
  getEVMBalancesForAddress: (address: Hex) => Promise<UnifiedBalanceResponseData[]>;
  getTronBalancesForAddress: (address: Hex) => Promise<UnifiedBalanceResponseData[]>;

  // Fee grants
  vscCreateFeeGrant: (address: string) => Promise<unknown>;

  // RFF (Request For Funds) operations
  vscPublishRFF: (id: Long) => Promise<{ id: Long }>;
  vscCreateRFF: (
    id: Long,
    onStatusUpdate: (s: { current: number; total: number; txHash: Hex; chainId: number }) => void,
    expectedCollections: { index: number; chainId: number }[]
  ) => Promise<void>;

  // Sponsored transactions
  vscCreateSponsoredApprovals: (input: SponsoredApprovalDataArray) => Promise<{ chainId: number; hash: Hex }[]>;
  vscSBCTx: (input: SBCTx[]) => Promise<[bigint, Hex][]>;
};
```

**Balance Response Format**:

```typescript
type UnifiedBalanceResponseData = {
  chain_id: Uint8Array;        // 32-byte chain ID
  currencies: {
    balance: string;           // Balance as string (decimal)
    token_address: Uint8Array; // 32-byte token address
    value: string;             // USD value
  }[];
  total_usd: string;
  universe: Universe;
  errored: boolean;
};
```

### 4.5 Tenderly Simulation

**File**: `src/integrations/tenderly.ts`

```typescript
export class BackendSimulationClient {
  private readonly baseUrl: string;

  constructor(config: BackendConfig) {
    this.baseUrl = config.baseUrl;  // https://nexus-backend.avail.so
  }

  async simulateBundleV2(request: BundleSimulationRequest) {
    const { data } = await axios.post<BackendBundleResponse>(
      new URL('/api/gas-estimation/bundleV2', this.baseUrl).href,
      request
    );

    if (!data.success || !data.data) {
      throw Errors.simulationError(data.message ?? 'Bundle simulation failed');
    }

    return { gas: data.data.map((d) => BigInt(d.gasLimit)) };
  }
}
```

**Request Format**:

```typescript
interface BundleSimulationRequest {
  chainId: string;
  simulations: {
    type: string;
    from: Hex;
    to: Hex;
    data: Hex;
    value: Hex;
    stepId: string;
    enableStateOverride: boolean;
    stateOverride: StateOverride;
  }[];
}
```

### 4.6 Swap Aggregators

**LiFi API** (via `@avail-project/ca-common`):

```typescript
// Base URL: https://li.quest/v1
// Endpoints:
// - /quote: Get swap quote
// - /status: Check transaction status

const lifiAggregator = new LiFiAggregator(LIFI_API_KEY);
const quote = await lifiAggregator.getQuote({
  fromChain: chainId,
  toChain: chainId,
  fromToken: inputToken,
  toToken: outputToken,
  fromAmount: amount,
  fromAddress: userAddress,
});
```

**Bebop API** (via `@avail-project/ca-common`):

```typescript
// Similar interface to LiFi
const bebopAggregator = new BebopAggregator(BEBOP_API_KEY);
```

### 4.7 Chain RPC Endpoints

**File**: `src/sdk/ca-base/chains.ts`

Each chain has multiple RPC endpoints for redundancy:

```typescript
// Example: Base mainnet
{
  id: SUPPORTED_CHAINS.BASE,
  name: 'Base',
  rpcUrls: {
    default: {
      http: ['https://rpcs.avail.so/base'],           // Primary (Avail's RPC)
      publicHttp: ['https://mainnet.base.org', 'https://1rpc.io/base'],  // Fallbacks
      webSocket: ['wss://rpcs.avail.so/base'],
    },
  },
}
```

**Public Client Creation with Fallback**:

```typescript
const createPublicClientWithFallback = (chain: Chain): PublicClient => {
  const urls = [
    ...chain.rpcUrls.default.http,
    ...(chain.rpcUrls.default.publicHttp ?? []),
  ];

  return createPublicClient({
    transport: fallback(urls.map(url => http(url))),
  });
};
```

---

## 5. Extending the SDK

### 5.1 Adding a New Chain

To add support for a new EVM chain, follow these steps:

#### Step 1: Add Chain ID Constant

**File**: `src/commons/constants/index.ts`

```typescript
export const SUPPORTED_CHAINS = {
  // Existing chains...
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  // ... etc

  // Add your new chain
  MY_NEW_CHAIN: 12345,  // Replace with actual chain ID
} as const;
```

#### Step 2: Add Token Contract Addresses

**File**: `src/commons/constants/index.ts`

```typescript
export const TOKEN_CONTRACT_ADDRESSES = {
  USDC: {
    // Existing chains...
    [SUPPORTED_CHAINS.ETHEREUM]: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    [SUPPORTED_CHAINS.BASE]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    // ... etc

    // Add your new chain's USDC address
    [SUPPORTED_CHAINS.MY_NEW_CHAIN]: '0x...your_usdc_address...',
  },
  USDT: {
    // Similar pattern for USDT
    [SUPPORTED_CHAINS.MY_NEW_CHAIN]: '0x...your_usdt_address...',
  },
} as const;
```

#### Step 3: Add Chain Configuration

**File**: `src/sdk/ca-base/chains.ts`

Add to `MAINNET_CHAINS` or `TESTNET_CHAINS` array:

```typescript
const MAINNET_CHAINS: Chain[] = [
  // ... existing chains

  {
    blockExplorers: {
      default: {
        name: 'MyChain Explorer',
        url: 'https://explorer.mychain.io',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/XXXX/large/mychain.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.MY_NEW_CHAIN],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.MY_NEW_CHAIN],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
      ],
    },
    id: SUPPORTED_CHAINS.MY_NEW_CHAIN,
    name: 'My New Chain',
    ankrName: 'mychain',  // Ankr API name, or '' if not supported
    nativeCurrency: {
      decimals: 18,
      name: 'MyToken',
      symbol: 'MYT',
    },
    rpcUrls: {
      default: {
        http: ['https://rpc.mychain.io'],
        publicHttp: ['https://public-rpc.mychain.io'],
        webSocket: ['wss://ws.mychain.io'],
      },
    },
    universe: Universe.ETHEREUM,  // Use ETHEREUM for EVM chains
  },
];
```

#### Step 4: Add Balance Storage Slot (for simulation)

**File**: `src/sdk/ca-base/utils/balance.utils.ts`

If the new chain has different storage slots for token balances:

```typescript
const storageSlotMapping: Record<number, Record<string, number>> = {
  [SUPPORTED_CHAINS.BNB]: {
    ETH: 0,
    USDC: 1,
    USDT: 1,
  },
  // Add your chain if it uses non-standard slots
  [SUPPORTED_CHAINS.MY_NEW_CHAIN]: {
    ETH: 0,
    USDC: 9,   // Standard ERC20
    USDT: 2,   // May vary
  },
};
```

#### Step 5: Update Gas Buffer (if needed)

**File**: `src/sdk/ca-base/utils/contract.utils.ts`

If the chain needs different gas estimation buffers:

```typescript
export const getPctGasBufferByChain = (chainId: number): number => {
  // Some chains need higher gas buffers
  switch (chainId) {
    case SUPPORTED_CHAINS.SCROLL:
      return 0.5;  // 50% buffer for Scroll
    case SUPPORTED_CHAINS.MY_NEW_CHAIN:
      return 0.3;  // 30% buffer for new chain
    default:
      return 0.3;  // Default 30%
  }
};
```

#### Step 6: Register with CA Common (Backend Requirement)

The chain must also be registered in `@avail-project/ca-common` for the backend to support it. This includes:
- Adding to `ChaindataMap`
- Deploying vault contracts
- Configuring solver routes

**Note**: This step requires coordination with the Avail team.

---

### 5.2 Adding a New Token

#### Step 1: Add Token Contract Addresses

**File**: `src/commons/constants/index.ts`

```typescript
export const TOKEN_CONTRACT_ADDRESSES = {
  // Existing tokens...
  USDC: { /* ... */ },
  USDT: { /* ... */ },

  // Add your new token
  DAI: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0x6B175474E89094C44Da98b954EesderF3DC3Eb87F',
    [SUPPORTED_CHAINS.BASE]: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    // Add for each supported chain
  },
} as const;
```

#### Step 2: Add Token Metadata

**File**: `src/commons/constants/index.ts`

```typescript
export const TOKEN_METADATA = {
  // Existing tokens...
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    icon: 'https://...',
    coingeckoId: 'usd-coin',
  },

  // Add your new token
  DAI: {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,  // DAI uses 18 decimals
    icon: 'https://assets.coingecko.com/coins/images/9956/large/dai-multi-collateral-mcd.png',
    coingeckoId: 'dai',
  },
} as const;
```

#### Step 3: Add to Chain's Known Tokens

**File**: `src/sdk/ca-base/chains.ts`

For each chain that supports the token:

```typescript
{
  id: SUPPORTED_CHAINS.ETHEREUM,
  custom: {
    knownTokens: [
      // Existing tokens...
      {
        contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.ETHEREUM],
        decimals: 6,
        logo: getLogoFromSymbol('USDC'),
        name: 'USD Coin',
        symbol: 'USDC',
      },
      // Add your token
      {
        contractAddress: TOKEN_CONTRACT_ADDRESSES.DAI[SUPPORTED_CHAINS.ETHEREUM],
        decimals: 18,
        logo: getLogoFromSymbol('DAI'),
        name: 'Dai Stablecoin',
        symbol: 'DAI',
      },
    ],
  },
}
```

#### Step 4: Add Logo Helper

**File**: `src/sdk/ca-base/constants.ts`

```typescript
export const getLogoFromSymbol = (symbol: string): string => {
  const logos: Record<string, string> = {
    ETH: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    USDC: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
    USDT: 'https://assets.coingecko.com/coins/images/325/large/Tether.png',
    // Add your token
    DAI: 'https://assets.coingecko.com/coins/images/9956/large/dai-multi-collateral-mcd.png',
  };
  return logos[symbol.toUpperCase()] ?? '';
};
```

#### Step 5: Update Type Definitions

**File**: `src/commons/types/index.ts`

```typescript
export type SUPPORTED_TOKENS = 'ETH' | 'USDC' | 'USDT' | 'DAI';  // Add DAI
```

#### Step 6: Update Token Validation

**File**: `src/sdk/utils.ts`

```typescript
export const isSupportedToken = (token: string): boolean => {
  const supportedTokens = ['ETH', 'USDC', 'USDT', 'DAI'];  // Add DAI
  return supportedTokens.includes(token.toUpperCase());
};
```

---

### 5.3 Adding a New Swap Aggregator

#### Step 1: Implement Aggregator Interface

Create a new file following the pattern in `@avail-project/ca-common`:

```typescript
// src/sdk/ca-base/swap/aggregators/myAggregator.ts

import { Aggregator, Quote, QuoteRequest } from '@avail-project/ca-common';

export class MyAggregator implements Aggregator {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.myaggregator.io';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getQuote(request: QuoteRequest): Promise<Quote> {
    const response = await fetch(`${this.baseUrl}/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        fromChainId: request.fromChain,
        toChainId: request.toChain,
        fromToken: request.fromToken,
        toToken: request.toToken,
        amount: request.fromAmount.toString(),
        slippage: request.slippage || 0.5,
      }),
    });

    const data = await response.json();

    return {
      inputAmount: BigInt(data.inputAmount),
      outputAmountMinimum: BigInt(data.minOutput),
      outputAmountLikely: BigInt(data.expectedOutput),
      route: data.route,
      aggregatorData: data,
    };
  }

  async executeSwap(quote: Quote, wallet: WalletClient): Promise<Hex> {
    // Implementation depends on aggregator's API
    const txData = quote.aggregatorData.tx;

    const txHash = await wallet.sendTransaction({
      to: txData.to,
      data: txData.data,
      value: BigInt(txData.value),
    });

    return txHash;
  }
}
```

#### Step 2: Add API Key

**File**: `src/sdk/ca-base/swap/constants.ts`

```typescript
export const LIFI_API_KEY = '...';
export const BEBOP_API_KEY = '...';
export const MY_AGGREGATOR_API_KEY = '...';  // Add your key
```

#### Step 3: Register Aggregator

**File**: `src/sdk/ca-base/swap/swap.ts`

```typescript
import { MyAggregator } from './aggregators/myAggregator';

const aggregators: Aggregator[] = [
  new LiFiAggregator(LIFI_API_KEY),
  new BebopAggregator(BEBOP_API_KEY),
  new MyAggregator(MY_AGGREGATOR_API_KEY),  // Add your aggregator
];
```

#### Step 4: Handle Aggregator-Specific Errors

**File**: `src/sdk/ca-base/errors.ts`

```typescript
export const Errors = {
  // ... existing errors

  myAggregatorQuoteFailed: (message: string) =>
    createError(ERROR_CODES.QUOTE_FAILED, `MyAggregator quote failed: ${message}`),
};
```

---

## 6. Error Handling

### 6.1 NexusError Class

**File**: `src/sdk/ca-base/nexusError.ts`

```typescript
export interface NexusErrorData {
  context?: string;              // Where or why it happened
  cause?: unknown;               // Optional nested error
  details?: Record<string, unknown>;  // Specific structured info
}

export class NexusError extends Error {
  readonly code: ErrorCode;
  readonly data?: NexusErrorData;

  constructor(code: ErrorCode, message: string, data?: NexusErrorData) {
    super(message);
    this.name = 'NexusError';
    this.code = code;
    this.data = data;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }
}
```

### 6.2 Complete Error Code Reference

**File**: `src/sdk/ca-base/nexusError.ts`

```typescript
export const ERROR_CODES = {
  // === SDK State Errors ===
  SDK_NOT_INITIALIZED: 'SDK_NOT_INITIALIZED',
  SDK_INIT_STATE_NOT_EXPECTED: 'SDK_INIT_STATE_NOT_EXPECTED',

  // === Chain/Token Errors ===
  CHAIN_NOT_FOUND: 'CHAIN_NOT_FOUND',
  CHAIN_DATA_NOT_FOUND: 'CHAIN_DATA_NOT_FOUND',
  TOKEN_NOT_SUPPORTED: 'TOKEN_NOT_SUPPORTED',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',

  // === Balance/Allowance Errors ===
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  NO_BALANCE_FOR_ADDRESS: 'NO_BALANCE_FOR_ADDRESS',
  INVALID_VALUES_ALLOWANCE_HOOK: 'INVALID_VALUES_ALLOWANCE_HOOK',
  SLIPPAGE_EXCEEDED_ALLOWANCE: 'SLIPPAGE_EXCEEDED_ALLOWANCE',
  ALLOWANCE_SETTING_ERROR: 'ALLOWANCE_SETTING_ERROR',

  // === User Action Errors ===
  USER_DENIED_INTENT: 'USER_DENIED_INTENT',
  USER_DENIED_ALLOWANCE: 'USER_DENIED_ALLOWANCE',
  USER_DENIED_INTENT_SIGNATURE: 'USER_DENIED_INTENT_SIGNATURE',
  USER_DENIED_SIWE_SIGNATURE: 'USER_DENIED_SIWE_SIGNATURE',

  // === Transaction Errors ===
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',
  TRANSACTION_REVERTED: 'TRANSACTION_REVERTED',
  TRANSACTION_CHECK_ERROR: 'TRANSACTION_CHECK_ERROR',

  // === Network/API Errors ===
  COSMOS_ERROR: 'COSMOS_ERROR',
  FETCH_GAS_PRICE_FAILED: 'FETCH_GAS_PRICE_FAILED',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  QUOTE_FAILED: 'QUOTE_FAILED',
  SWAP_FAILED: 'SWAP_FAILED',

  // === TRON-Specific Errors ===
  TRON_DEPOSIT_FAIL: 'TRON_DEPOSIT_FAIL',
  TRON_APPROVAL_FAIL: 'TRON_APPROVAL_FAIL',

  // === Intent/RFF Errors ===
  LIQUIDITY_TIMEOUT: 'LIQUIDITY_TIMEOUT',
  REFUND_FAILED: 'REFUND_FAILED',
  REFUND_CHECK_ERROR: 'REFUND_CHECK_ERROR',
  RFF_FEE_EXPIRED: 'RFF_FEE_EXPIRED',
  DESTINATION_REQUEST_HASH_NOT_FOUND: 'DESTINATION_REQUEST_HASH_NOT_FOUND',
  DESTINATION_SWEEP_ERROR: 'DESTINATION_SWEEP_ERROR',

  // === Validation Errors ===
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_ADDRESS_LENGTH: 'INVALID_ADDRESS_LENGTH',
  RATES_CHANGED_BEYOND_TOLERANCE: 'RATES_CHANGED_BEYOND_TOLERANCE',

  // === Connection Errors ===
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  CONNECT_ACCOUNT_FAILED: 'CONNECT_ACCOUNT_FAILED',

  // === Environment Errors ===
  UNIVERSE_NOT_SUPPORTED: 'UNIVERSE_NOT_SUPPORTED',
  ENVIRONMENT_NOT_SUPPORTED: 'ENVIRONMENT_NOT_SUPPORTED',
  ENVIRONMENT_NOT_KNOWN: 'ENVIRONMENT_NOT_KNOWN',

  // === Contract Errors ===
  VAULT_CONTRACT_NOT_FOUND: 'VAULT_CONTRACT_NOT_FOUND',
  UNKNOWN_SIGNATURE: 'UNKNOWN_SIGNATURE',

  // === Internal Errors ===
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
```

### 6.3 Error Factory Functions

**File**: `src/sdk/ca-base/errors.ts`

```typescript
export const Errors = {
  // SDK State
  sdkNotInitialized: () =>
    createError(ERROR_CODES.SDK_NOT_INITIALIZED, 'SDK is not initialized()'),

  sdkInitStateNotExpected: (state: string) =>
    createError(ERROR_CODES.SDK_INIT_STATE_NOT_EXPECTED, 'Unexpected init SDK state', {
      details: { state },
    }),

  // Chain/Token
  chainNotFound: (chainId: number | bigint) =>
    createError(ERROR_CODES.CHAIN_NOT_FOUND, `Chain not found: ${chainId}`, {
      details: { chainId },
    }),

  tokenNotSupported: (address?: string, chainId?: number, additionalMessage?: string) =>
    createError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token with address ${address} is not supported on chain ${chainId}.\n${additionalMessage}`,
      { details: { address, chainId } }
    ),

  // Balance
  insufficientBalance: (msg?: string) =>
    createError(ERROR_CODES.INSUFFICIENT_BALANCE, `Insufficient balance to proceed. ${msg}`),

  // User Actions
  userDeniedIntent: () =>
    createError(ERROR_CODES.USER_DENIED_INTENT, 'User rejected the intent.'),

  userRejectedAllowance: () =>
    createError(ERROR_CODES.USER_DENIED_ALLOWANCE, 'User rejected the allowance.'),

  userRejectedIntentSignature: () =>
    createError(ERROR_CODES.USER_DENIED_INTENT_SIGNATURE, 'User rejected signing the intent hash.'),

  // Transactions
  transactionTimeout: (timeout: number) =>
    createError(
      ERROR_CODES.TRANSACTION_TIMEOUT,
      `Timeout: Transaction not confirmed within ${timeout}s`
    ),

  transactionReverted: (txHash: string) =>
    createError(ERROR_CODES.TRANSACTION_REVERTED, `Transaction reverted: ${txHash}`),

  // API/Network
  simulationError: (msg: string) =>
    createError(ERROR_CODES.SIMULATION_FAILED, `tenderly simulation failed: ${msg}`),

  quoteFailed: (message: string) =>
    createError(ERROR_CODES.QUOTE_FAILED, `Quote failed: ${message}`),

  swapFailed: (message: string) =>
    createError(ERROR_CODES.SWAP_FAILED, `Swap failed: ${message}`),

  // Internal
  internal: (msg: string, details?: Record<string, unknown>) =>
    createError(ERROR_CODES.INTERNAL_ERROR, `Internal error: ${msg}`, { details }),
};
```

### 6.4 Error Propagation Paths

#### Bridge Operation Errors

```
sdk.bridge()
    │
    ├─▶ SDK not initialized?
    │       └─▶ throw SDK_NOT_INITIALIZED
    │
    ├─▶ Invalid chain ID?
    │       └─▶ throw CHAIN_NOT_FOUND
    │
    ├─▶ Token not supported?
    │       └─▶ throw TOKEN_NOT_SUPPORTED
    │
    ├─▶ Insufficient balance?
    │       └─▶ throw INSUFFICIENT_BALANCE
    │
    ├─▶ User denies intent hook?
    │       └─▶ throw USER_DENIED_INTENT
    │
    ├─▶ User denies allowance hook?
    │       └─▶ throw USER_DENIED_ALLOWANCE
    │
    ├─▶ User rejects wallet signature?
    │       └─▶ throw USER_DENIED_INTENT_SIGNATURE
    │
    ├─▶ Cosmos submission fails?
    │       └─▶ throw COSMOS_ERROR
    │
    ├─▶ Deposit transaction reverts?
    │       └─▶ throw TRANSACTION_REVERTED
    │
    └─▶ Fill timeout?
            └─▶ throw LIQUIDITY_TIMEOUT
```

#### Swap Operation Errors

```
sdk.swapWithExactIn/Out()
    │
    ├─▶ SDK not initialized?
    │       └─▶ throw SDK_NOT_INITIALIZED
    │
    ├─▶ Destination chain not found?
    │       └─▶ throw CHAIN_NOT_FOUND
    │
    ├─▶ No balances found?
    │       └─▶ throw NO_BALANCE_FOR_ADDRESS
    │
    ├─▶ Quote request fails?
    │       └─▶ throw QUOTE_FAILED
    │
    ├─▶ User denies swap intent?
    │       └─▶ throw USER_DENIED_INTENT (via swap hook)
    │
    ├─▶ Source swap fails?
    │       └─▶ throw SWAP_FAILED
    │
    ├─▶ Bridge component fails?
    │       └─▶ (see Bridge errors above)
    │
    └─▶ Destination swap fails?
            └─▶ throw SWAP_FAILED
```

### 6.5 Error Handling Best Practices

```typescript
import { NexusSDK, NexusError, ERROR_CODES } from '@avail-project/nexus-core';

async function performBridge() {
  try {
    const result = await sdk.bridge({
      token: 'USDC',
      amount: parseUnits('100', 6),
      toChainId: 8453, // Base
    });
    console.log('Success:', result.explorerUrl);
  } catch (error) {
    if (error instanceof NexusError) {
      console.error(`[${error.code}] ${error.message}`);

      switch (error.code) {
        case ERROR_CODES.USER_DENIED_INTENT:
        case ERROR_CODES.USER_DENIED_ALLOWANCE:
          // User rejected - show retry UI
          showRetryPrompt();
          break;

        case ERROR_CODES.INSUFFICIENT_BALANCE:
          // Not enough funds - show balance
          showInsufficientFundsMessage(error.data?.details);
          break;

        case ERROR_CODES.LIQUIDITY_TIMEOUT:
          // Solver didn't fill - offer refund
          offerRefundOption();
          break;

        case ERROR_CODES.TRANSACTION_REVERTED:
          // Transaction failed on-chain
          showTransactionFailedMessage(error.data?.details);
          break;

        default:
          // Generic error handling
          showGenericError(error.message);
      }

      // Always log for debugging
      console.error('Error details:', error.toJSON());
    } else {
      // Non-Nexus errors (network, library, etc.)
      console.error('Unexpected error:', error);
    }
  }
}
```

---

## 7. Supporting Systems

### 7.1 Analytics System

**File**: `src/analytics/AnalyticsManager.ts`

The SDK includes built-in analytics via PostHog (opt-out by default).

#### Configuration

```typescript
const sdk = new NexusSDK({
  network: 'mainnet',
  analytics: {
    enabled: true,                    // Default: true (opt-out system)
    posthogApiKey: 'custom-key',      // Optional: use your own PostHog
    posthogApiHost: 'https://your.posthog.com',
    appMetadata: {
      appName: 'My dApp',
      appVersion: '1.0.0',
      appUrl: 'https://mydapp.com',
    },
    privacy: {
      anonymizeWallets: true,         // Hash wallet addresses
      anonymizeAmounts: true,         // Exclude amounts from events
    },
    sessionRecording: false,          // Disable session recording
    debug: false,
  },
});
```

#### Disabling Analytics

```typescript
// Method 1: At construction
const sdk = new NexusSDK({ analytics: { enabled: false } });

// Method 2: At runtime
sdk.analytics.disable();
```

#### Data Collected

- Session metrics (duration, success rates)
- Operation performance (timing, errors)
- Wallet type (NOT addresses unless identified)
- Network/chain usage patterns
- Error occurrences and types

#### AnalyticsManager Methods

```typescript
class AnalyticsManager {
  // Track custom event
  track(event: string, properties?: Record<string, unknown>): void;

  // Identify user (typically wallet address)
  async identify(userId: string, properties?: Record<string, unknown>): Promise<void>;

  // Track error with context
  trackError(operation: string, error: Error | unknown, context?: Record<string, unknown>): void;

  // Performance tracking
  startOperation(operationName: string, metadata?: Record<string, unknown>): string;
  endOperation(operationId: string, result: { success: boolean; error?: Error }): void;

  // Wrap async operation with automatic tracking
  async trackOperation<T>(
    operationName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T>;

  // Control
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  reset(): void;

  // Session
  getSessionId(): string;
  trackSessionEnd(): void;
}
```

### 7.2 Event System

The SDK emits events during operations to enable UI progress tracking.

#### Event Constants

**File**: `src/commons/constants/index.ts`

```typescript
export const NEXUS_EVENTS = {
  STEP_COMPLETE: 'STEP_COMPLETE',           // Bridge/Execute step completed
  SWAP_STEP_COMPLETE: 'SWAP_STEP_COMPLETE', // Swap step completed
  STEPS_LIST: 'STEPS_LIST',                 // List of all steps at start
} as const;
```

#### Bridge Steps

**File**: `src/commons/types/bridge-steps.ts`

```typescript
export const BRIDGE_STEPS = {
  // Intent lifecycle
  INTENT_ACCEPTED: { typeID: 'INTENT_ACCEPTED', message: 'Intent accepted' },
  INTENT_HASH_SIGNED: { typeID: 'INTENT_HASH_SIGNED', message: 'Intent hash signed' },
  INTENT_SUBMITTED: { typeID: 'INTENT_SUBMITTED', message: 'Intent submitted' },

  // Allowance
  ALLOWANCE_APPROVAL_REQUEST: { typeID: 'ALLOWANCE_APPROVAL_REQUEST', message: 'Requesting approval' },
  ALLOWANCE_APPROVAL_MINED: { typeID: 'ALLOWANCE_APPROVAL_MINED', message: 'Approval confirmed' },
  ALLOWANCE_COMPLETE: { typeID: 'ALLOWANCE_COMPLETE', message: 'All approvals complete' },

  // Deposit
  INTENT_DEPOSIT_REQUEST: { typeID: 'INTENT_DEPOSIT_REQUEST', message: 'Depositing to vault' },
  INTENT_DEPOSITS_CONFIRMED: { typeID: 'INTENT_DEPOSITS_CONFIRMED', message: 'Deposits confirmed' },

  // Collection & Fulfillment
  INTENT_COLLECTION: { typeID: 'INTENT_COLLECTION', message: 'Collecting deposits' },
  INTENT_COLLECTION_COMPLETE: { typeID: 'INTENT_COLLECTION_COMPLETE', message: 'Collection complete' },
  INTENT_FULFILLED: { typeID: 'INTENT_FULFILLED', message: 'Intent fulfilled' },

  // Execute (for bridgeAndExecute)
  EXECUTE_APPROVAL_STEP: { typeID: 'EXECUTE_APPROVAL_STEP', message: 'Token approval' },
  EXECUTE_TRANSACTION_SENT: { typeID: 'EXECUTE_TRANSACTION_SENT', message: 'Transaction sent' },
  EXECUTE_TRANSACTION_CONFIRMED: { typeID: 'EXECUTE_TRANSACTION_CONFIRMED', message: 'Transaction confirmed' },
} as const;
```

#### Swap Steps

**File**: `src/commons/types/swap-steps.ts`

```typescript
export const SWAP_STEPS = {
  SWAP_START: { typeID: 'SWAP_START', message: 'Starting swap' },
  DETERMINING_SWAP: (complete = false) => ({
    typeID: 'DETERMINING_SWAP',
    message: complete ? 'Route determined' : 'Determining route',
  }),
  SOURCE_SWAP: (complete = false) => ({
    typeID: 'SOURCE_SWAP',
    message: complete ? 'Source swap complete' : 'Executing source swap',
  }),
  BRIDGE: (complete = false) => ({
    typeID: 'BRIDGE',
    message: complete ? 'Bridge complete' : 'Bridging tokens',
  }),
  DESTINATION_SWAP: (complete = false) => ({
    typeID: 'DESTINATION_SWAP',
    message: complete ? 'Swap complete' : 'Executing destination swap',
  }),
} as const;
```

#### Listening to Events

```typescript
sdk.bridge(params, {
  onEvent: (event) => {
    if (event.name === NEXUS_EVENTS.STEPS_LIST) {
      // Initialize progress bar with all steps
      const steps = event.args;
      initProgressBar(steps);
    }

    if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
      // Update progress
      const step = event.args;
      updateProgress(step.typeID, step.message);
    }
  },
});
```

### 7.3 Hook Callbacks

The SDK uses hooks to enable user interaction during operations.

#### Intent Hook

```typescript
type OnIntentHook = (data: OnIntentHookData) => void;

type OnIntentHookData = {
  allow: () => void;              // Approve the intent
  deny: () => void;               // Reject the intent
  intent: ReadableIntent;          // Intent details
  refresh: (selectedSources?: number[]) => Promise<ReadableIntent>;  // Recalculate
};
```

**Usage**:

```typescript
sdk.setOnIntentHook((data) => {
  // Show intent to user
  showIntentModal({
    sources: data.intent.sources,
    destination: data.intent.destination,
    fees: data.intent.fees,
    onApprove: () => data.allow(),
    onReject: () => data.deny(),
    onRefresh: async (newSources) => {
      const updated = await data.refresh(newSources);
      updateModalWithNewIntent(updated);
    },
  });
});
```

#### Allowance Hook

```typescript
type OnAllowanceHook = (data: OnAllowanceHookData) => void;

type OnAllowanceHookData = {
  allow: (amounts: Array<'max' | 'min' | bigint | string>) => void;
  deny: () => void;
  sources: AllowanceHookSources;
};

type AllowanceHookSources = {
  allowance: {
    current: string;
    currentRaw: bigint;
    minimum: string;
    minimumRaw: bigint;
  };
  chain: { id: number; logo: string; name: string };
  token: {
    contractAddress: Hex;
    decimals: number;
    logo: string;
    name: string;
    symbol: string;
  };
}[];
```

**Usage**:

```typescript
sdk.setOnAllowanceHook((data) => {
  showAllowanceModal({
    sources: data.sources.map((s) => ({
      chain: s.chain.name,
      token: s.token.symbol,
      current: s.allowance.current,
      required: s.allowance.minimum,
    })),
    onApprove: (choices) => {
      // choices: ['max', 'max'] or ['min', '1000'] etc.
      data.allow(choices);
    },
    onReject: () => data.deny(),
  });
});
```

#### Swap Intent Hook

```typescript
type OnSwapIntentHook = (data: {
  intent: SwapIntent;
  allow: () => void;
  deny: () => void;
  refresh: (fromSources?: Source[]) => Promise<SwapIntent>;
}) => void;
```

### 7.4 Telemetry (OpenTelemetry)

**File**: `src/sdk/ca-base/telemetry.ts`

The SDK includes optional OpenTelemetry logging:

```typescript
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

// Telemetry is used for error logging to Avail's backend
export const telemetryLogger = setupTelemetry();
```

Errors are automatically logged via `createError()`:

```typescript
export function createError(code: ErrorCode, message: string, data?: NexusErrorData): NexusError {
  const nexusError = new NexusError(code, message, data);
  try {
    telemetryLogger?.emit({
      body: message,
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      attributes: {
        data: nexusError.data,
        cause: code,
        stackTrace: nexusError.stack,
      },
    });
  } catch {}
  return nexusError;
}
```

### 7.5 Polyfill Handling (Browser Compatibility)

Both the Nexus SDK and ca-common include polyfills to ensure browser compatibility. These polyfills address missing Node.js APIs in browser environments.

#### Why Polyfills Are Needed

The SDK uses Node.js `Buffer` APIs extensively for:
- Binary encoding/decoding of chain IDs (36-byte format)
- Protobuf message serialization
- Cryptographic operations
- RFF structure encoding

Browsers don't natively support `Buffer`, and some polyfill libraries (like the `buffer` npm package) may be missing certain methods.

#### Nexus SDK Polyfill

**File**: `src/_polyfill.ts`

**Imported at**: `src/index.ts` (line 1) - must be first import

```typescript
import './_polyfill';  // MUST be first import
```

**What it polyfills:**

1. **Global Buffer**: Ensures `globalThis.Buffer` exists
2. **Buffer.prototype methods**: Adds missing uint32 read/write methods
3. **Global process**: Ensures `globalThis.process.env` exists

```typescript
// From nexus-sdk/src/_polyfill.ts

import { Buffer as _Buffer } from 'buffer';

// 1. Ensure Buffer is on globalThis
if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = _Buffer;
}

// 2. Add missing Buffer methods
const proto = _Buffer.prototype as any;
if (proto && typeof proto.writeUint32BE !== 'function') {
  if (typeof proto.writeUInt32BE === 'function') {
    // Alias the capital I versions (writeUInt32BE → writeUint32BE)
    proto.writeUint32BE = proto.writeUInt32BE;
    proto.writeUint32LE = proto.writeUInt32LE;
    proto.readUint32BE = proto.readUInt32BE;
    proto.readUint32LE = proto.readUInt32LE;
  } else {
    // Fallback implementations (manual byte manipulation)
    proto.writeUint32BE = function (value: number, offset = 0) {
      offset = offset >>> 0;
      const normalized = Number(value) >>> 0;
      this[offset] = (normalized >>> 24) & 0xff;
      this[offset + 1] = (normalized >>> 16) & 0xff;
      this[offset + 2] = (normalized >>> 8) & 0xff;
      this[offset + 3] = normalized & 0xff;
      return offset + 4;
    };
    // ... similar for writeUint32LE, readUint32BE, readUint32LE
  }
}

// 3. Ensure process.env exists (for libraries that check NODE_ENV)
if (!(globalThis as any).process) {
  (globalThis as any).process = { env: { NODE_ENV: 'production' } };
}
```

#### ca-common Polyfill

**File**: `ca-common/src/_polyfill.ts` (197 lines)

**Imported at**:
- `ca-common/src/index.ts` (line 1)
- `ca-common/src/data/chainid.ts` (line 1) - explicit call for safety

The ca-common polyfill is more robust and handles edge cases:

```typescript
// From ca-common/src/_polyfill.ts

export function ensureBufferPolyfill(): void {
  if (patched) return;  // Only run once

  // 1. Collect all possible Buffer constructors
  const candidates = collectBufferCtors();
  // Checks: DefaultBuffer, mod.Buffer, mod.default, globalScope.Buffer

  // 2. Patch all found Buffer prototypes
  candidates.forEach(patchPrototype);

  // 3. Set globalThis.Buffer to best candidate
  const preferred = candidates[0];
  if (preferred && typeof globalScope.Buffer !== 'function') {
    globalScope.Buffer = preferred;
  }

  // 4. Ensure process.env exists
  ensureProcessEnv();

  patched = true;
}

// Auto-execute on import
ensureBufferPolyfill();
```

**Key improvements in ca-common:**

1. **Multiple Buffer sources**: Handles different bundler behaviors
2. **Idempotent**: Uses `patched` flag to prevent re-execution
3. **Explicit exports**: `ensureBufferPolyfill()` can be called manually
4. **Better error handling**: Validates offsets, throws proper errors

```typescript
// ca-common validates offsets before read/write
function assertOffset(buffer: BufferInstance, offset: unknown): number {
  const numericOffset = Number(offset);
  if (!Number.isFinite(numericOffset)) {
    throw new TypeError("Offset must be a finite number");
  }
  const normalized = numericOffset >>> 0;
  if (normalized !== numericOffset) {
    throw new RangeError("Offset must be a non-negative integer");
  }
  if (normalized + 4 > buffer.length) {
    throw new RangeError("Offset out of bounds");
  }
  return normalized;
}
```

#### Polyfilled Methods

| Method | Purpose | Used For |
|--------|---------|----------|
| `writeUint32BE` | Write 32-bit uint (big-endian) | Universe encoding in OmniversalChainID |
| `writeUint32LE` | Write 32-bit uint (little-endian) | Various binary protocols |
| `readUint32BE` | Read 32-bit uint (big-endian) | Decoding chain IDs |
| `readUint32LE` | Read 32-bit uint (little-endian) | Various binary protocols |

#### Import Order Requirements

**Critical**: Polyfills must be imported before any other code that uses Buffer.

```typescript
// ✅ CORRECT - polyfill first
import './_polyfill';
import { OmniversalChainID } from '@avail-project/ca-common';

// ❌ WRONG - Buffer may be used before polyfill
import { OmniversalChainID } from '@avail-project/ca-common';
import './_polyfill';
```

#### Bundler Configuration

For browser builds, ensure your bundler includes the `buffer` polyfill:

**Vite** (`vite.config.ts`):
```typescript
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process'],
    }),
  ],
});
```

**Webpack** (`webpack.config.js`):
```javascript
module.exports = {
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
  ],
};
```

**esbuild**:
```javascript
import { build } from 'esbuild';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';

build({
  plugins: [NodeModulesPolyfillPlugin()],
  define: {
    global: 'globalThis',
  },
});
```

#### Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `Buffer is not defined` | Polyfill not loaded | Ensure `import './_polyfill'` is first import |
| `writeUint32BE is not a function` | Incomplete Buffer polyfill | Use SDK's polyfill or call `ensureBufferPolyfill()` |
| `process is not defined` | Missing process polyfill | Polyfill auto-handles this; check bundler config |
| `Cannot read property 'prototype' of undefined` | Buffer import failed | Check bundler's `buffer` package resolution |

---

## 8. Type Reference

### 8.1 Core Operation Types

```typescript
// Bridge
interface BridgeParams {
  recipient?: Hex;
  token: string;
  amount: bigint;
  toChainId: number;
  gas?: bigint;
  sourceChains?: number[];
}

type BridgeResult = {
  explorerUrl: string;
  sourceTxs: SourceTxs;
  intent: ReadableIntent;
};

// Transfer (bridge to different recipient)
interface TransferParams {
  token: string;
  amount: bigint;
  toChainId: number;
  recipient: `0x${string}`;
  sourceChains?: number[];
}

// Execute
interface ExecuteParams {
  toChainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval?: {
    token: string;
    amount: bigint;
    spender: Hex;
  };
}

interface ExecuteResult {
  transactionHash: string;
  explorerUrl: string;
  chainId: number;
  receipt?: TransactionReceipt;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  approvalTransactionHash?: string;
}

// Bridge and Execute
interface BridgeAndExecuteParams {
  toChainId: number;
  token: string;
  amount: bigint;
  sourceChains?: number[];
  execute: Omit<ExecuteParams, 'toChainId'>;
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
}

type BridgeAndExecuteResult = {
  executeTransactionHash: string;
  executeExplorerUrl: string;
  approvalTransactionHash?: string;
  bridgeExplorerUrl?: string;
  toChainId: number;
  bridgeSkipped: boolean;
  intent?: ReadableIntent;
};
```

### 8.2 Swap Types

```typescript
// Exact In (know what you spend)
type ExactInSwapInput = {
  from: {
    chainId: number;
    amount: bigint;
    tokenAddress: Hex;
  }[];
  toChainId: number;
  toTokenAddress: Hex;
};

// Exact Out (know what you receive)
type ExactOutSwapInput = {
  fromSources?: Source[];
  toChainId: number;
  toTokenAddress: Hex;
  toAmount: bigint;
  toNativeAmount?: bigint;
};

type Source = {
  chainId: number;
  tokenAddress: Hex;
};

type SwapResult = {
  explorerUrl: string;
  sourceTxs: SourceTxs[];
  destinationTxHash?: string;
  swapRoute: SwapRoute;
};
```

### 8.3 Intent Types

```typescript
type ReadableIntent = {
  allSources: {
    amount: string;
    chainID: number;
    chainLogo: string | undefined;
    chainName: string;
    contractAddress: `0x${string}`;
  }[];
  destination: {
    amount: string;
    chainID: number;
    chainLogo: string | undefined;
    chainName: string;
  };
  fees: {
    caGas: string;
    gasSupplied: string;
    protocol: string;
    solver: string;
    total: string;
  };
  sources: {
    amount: string;
    chainID: number;
    chainLogo: string | undefined;
    chainName: string;
    contractAddress: `0x${string}`;
  }[];
  sourcesTotal: string;
  token: {
    decimals: number;
    logo: string | undefined;
    name: string;
    symbol: string;
  };
};
```

### 8.4 Balance Types

```typescript
type UserAssetDatum = {
  abstracted?: boolean;
  balance: string;
  balanceInFiat: number;
  breakdown: AssetBreakdown[];
  decimals: number;
  icon?: string;
  symbol: string;
};

type AssetBreakdown = {
  balance: string;
  balanceInFiat: number;
  chain: {
    id: number;
    logo: string;
    name: string;
  };
  contractAddress: `0x${string}`;
  decimals: number;
  universe: Universe;
};
```

### 8.5 Configuration Types

```typescript
type NexusNetwork = 'mainnet' | 'testnet' | NetworkConfig;

type NetworkConfig = {
  COSMOS_REST_URL: string;
  COSMOS_RPC_URL: string;
  COSMOS_WS_URL: string;
  COSMOS_GRPC_URL: string;
  VSC_BASE_URL: string;
  VSC_WS_URL: string;
  INTENT_EXPLORER_URL: string;
  NETWORK_HINT: Environment;
};

interface AnalyticsConfig {
  enabled?: boolean;
  posthogApiKey?: string;
  posthogApiHost?: string;
  appMetadata?: {
    appName?: string;
    appVersion?: string;
    appUrl?: string;
  };
  privacy?: {
    anonymizeWallets?: boolean;
    anonymizeAmounts?: boolean;
  };
  sessionRecording?: boolean;
  debug?: boolean;
}
```

### 8.6 Chain & Token Types

```typescript
type Chain = {
  blockExplorers: {
    default: { name: string; url: string };
  };
  custom: {
    icon: string;
    knownTokens: TokenInfo[];
  };
  id: number;
  name: string;
  ankrName: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: {
    default: {
      grpc?: string[];
      http: string[];
      publicHttp?: string[];
      webSocket: string[];
    };
  };
  universe: Universe;
};

type TokenInfo = {
  contractAddress: `0x${string}`;
  decimals: number;
  logo: string;
  name: string;
  symbol: string;
};

interface ChainMetadata {
  id: number;
  name: string;
  shortName: string;
  logo: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  coingeckoId: string;
  isNative?: boolean;
}
```

### 8.7 Hook Types

```typescript
type OnIntentHook = (data: OnIntentHookData) => void;

type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: ReadableIntent;
  refresh: (selectedSources?: number[]) => Promise<ReadableIntent>;
};

type OnAllowanceHook = (data: OnAllowanceHookData) => void;

type OnAllowanceHookData = {
  allow: (s: Array<'max' | 'min' | bigint | string>) => void;
  deny: () => void;
  sources: AllowanceHookSources;
};

type OnSwapIntentHook = (data: {
  intent: SwapIntent;
  allow: () => void;
  deny: () => void;
  refresh: (fromSources?: Source[]) => Promise<SwapIntent>;
}) => void;
```

### 8.8 Event Types

```typescript
type EventUnion =
  | { name: 'STEPS_LIST'; args: BridgeStepType[] }
  | { name: 'SWAP_STEP_COMPLETE'; args: SwapStepType }
  | { name: 'STEP_COMPLETE'; args: BridgeStepType };

type OnEventParam = {
  onEvent?: (event: EventUnion) => void;
};

type BridgeStepType = {
  typeID: string;
  message: string;
};

type SwapStepType = {
  typeID: string;
  message: string;
};
```

---

## Appendix A: Supported Chains

### Mainnet

| Chain | ID | Native | Tokens |
|-------|-----|--------|--------|
| Ethereum | 1 | ETH | USDC, USDT |
| Base | 8453 | ETH | USDC |
| Arbitrum | 42161 | ETH | USDC, USDT |
| Optimism | 10 | ETH | USDC, USDT |
| Polygon | 137 | POL | USDC, USDT |
| Avalanche | 43114 | AVAX | USDC, USDT |
| Scroll | 534352 | ETH | USDC, USDT |
| BNB | 56 | BNB | USDC, USDT, ETH |
| Sophon | 50104 | SOPH | USDC, USDT, ETH |
| Kaia | 8217 | KAIA | USDT |
| HyperEVM | 999 | HYPE | USDC, USDT |
| Monad | TBD | MON | USDC |

### Testnet

| Chain | ID | Native | Tokens |
|-------|-----|--------|--------|
| Sepolia | 11155111 | ETH | USDC |
| Base Sepolia | 84532 | ETH | USDC |
| Arbitrum Sepolia | 421614 | ETH | USDC, USDT |
| Optimism Sepolia | 11155420 | ETH | USDC, USDT |
| Polygon Amoy | 80002 | POL | USDC |
| Monad Testnet | 10143 | MON | USDC, USDT |

---

## Appendix B: API Reference Quick Links

### SDK Methods

| Method | Purpose | Docs Section |
|--------|---------|--------------|
| `new NexusSDK(config)` | Create SDK instance | [1. Overview](#1-overview--quick-reference) |
| `initialize(provider)` | Initialize with wallet | [1. Overview](#1-overview--quick-reference) |
| `bridge(params, options?)` | Bridge tokens | [3.1 Bridge](#31-bridge-operation) |
| `swapWithExactIn(input, options?)` | Swap (fixed input) | [3.2 Swap](#32-swap-operation) |
| `swapWithExactOut(input, options?)` | Swap (fixed output) | [3.2 Swap](#32-swap-operation) |
| `execute(params, options?)` | Execute contract | [3.3 Execute](#33-execute-operation) |
| `bridgeAndExecute(params, options?)` | Bridge + Execute | [3.4 Bridge and Execute](#34-bridge-and-execute-operation) |
| `swapAndExecute(params, options?)` | Swap + Execute | [3.5 Swap and Execute](#35-swap-and-execute-operation) |
| `getBalancesForBridge()` | Get bridgeable balances | [4.4 VSC Client](#44-vsc-client) |
| `getBalancesForSwap()` | Get swappable balances | [4.4 VSC Client](#44-vsc-client) |
| `setOnIntentHook(callback)` | Set intent approval hook | [7.3 Hook Callbacks](#73-hook-callbacks) |
| `setOnAllowanceHook(callback)` | Set allowance hook | [7.3 Hook Callbacks](#73-hook-callbacks) |
| `setOnSwapIntentHook(callback)` | Set swap hook | [7.3 Hook Callbacks](#73-hook-callbacks) |
| `deinit()` | Cleanup SDK | [1. Overview](#1-overview--quick-reference) |

---

## 9. ca-common Integration Reference

The `@avail-project/ca-common` package provides the foundational layer for the Nexus SDK. This section documents all types, utilities, and patterns from ca-common that SDK developers need to understand.

### 9.1 Package Overview

**Package**: `@avail-project/ca-common`
**Version**: 1.0.0-beta.9
**Repository**: https://github.com/availproject/ca-common

**What ca-common provides:**
- Protocol type definitions (Protobuf-generated)
- Chain and currency metadata
- Contract ABIs (ERC20, Vault)
- Permit signing utilities (EIP-2612 variants)
- DEX aggregator interfaces
- Cosmos SDK integration
- gRPC client implementations
- Balance query APIs

### 9.2 OmniversalChainID (Universal Chain Identifier)

**File**: `ca-common/src/data/chainid.ts`

The `OmniversalChainID` class uniquely identifies any blockchain across all supported universes using a 36-byte binary format.

```typescript
import { OmniversalChainID, Universe } from '@avail-project/ca-common';

// Creating chain IDs
const ethereum = new OmniversalChainID(Universe.ETHEREUM, 1);
const arbitrum = new OmniversalChainID(Universe.ETHEREUM, 42161);
const solana = new OmniversalChainID(Universe.SOLANA, 0x2b6653dc);

// Methods
ethereum.toString();        // "ETHEREUM_1"
ethereum.toBytes();         // Buffer (36 bytes)
ethereum.equals(arbitrum);  // false
ethereum.toJSON();          // { universe: "ETHEREUM", chainID: "0x01" }

// Decoding from bytes
const decoded = OmniversalChainID.fromChainID36(buffer);
```

**Binary Format (36 bytes):**
```
┌─────────────────┬─────────────────────────────────────┐
│   Universe (4)  │         Chain ID (32)               │
├─────────────────┼─────────────────────────────────────┤
│   0x00000000    │  0x00000000...00000001 (Ethereum)   │
│   0x00000000    │  0x00000000...0000a4b1 (Arbitrum)   │
│   0x00000002    │  0x00000000...2b6653dc (Solana)     │
└─────────────────┴─────────────────────────────────────┘
```

### 9.3 ChainIDKeyedMap (Efficient Chain Lookups)

**File**: `ca-common/src/data/chainid.ts`

A generic Map using `OmniversalChainID` as keys:

```typescript
import { ChainIDKeyedMap, OmniversalChainID, Universe } from '@avail-project/ca-common';

// Create map with entries
const rpcMap = new ChainIDKeyedMap<string>([
  [new OmniversalChainID(Universe.ETHEREUM, 1), "https://eth.rpc.url"],
  [new OmniversalChainID(Universe.ETHEREUM, 42161), "https://arb.rpc.url"],
]);

// Usage
const chainId = new OmniversalChainID(Universe.ETHEREUM, 1);
const rpcUrl = rpcMap.get(chainId);  // "https://eth.rpc.url"

// Can also lookup by raw 36-byte buffer
const rpcUrl2 = rpcMap.getFromChainID36(buffer36bytes);

// Iterate entries
for (const [chainId, url] of rpcMap.entries()) {
  console.log(chainId.toString(), url);
}
```

### 9.4 Currency Class (Token Representation)

**File**: `ca-common/src/data/currency.ts`

The `Currency` class represents tokens with their metadata, decimals, and permit capabilities:

```typescript
import { Currency, CurrencyID, PermitVariant } from '@avail-project/ca-common';

// CurrencyID enum
enum CurrencyID {
  USDC = 1,
  USDT = 2,
  ETH = 3,
  POL = 4,
  AVAX = 5,
  BNB = 6,
  HYPE = 0x10,
  KAIA = 0x11,
  SOPH = 0x12,
  TRX = 0x13,
  MON = 0x14,
}

// Creating a currency
const usdc = new Currency(
  CurrencyID.USDC,
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  // Token address
  6,                                              // Decimals
  PermitVariant.EIP2612Canonical,                 // Permit type
  undefined,                                      // Contract version (optional)
  false                                           // Is gas token
);

// Convert between atomic units and decimal amounts
const atomicUnits = 1_000_000n;  // 1 USDC in smallest units
const decimalAmount = usdc.convertUnitsToAmountDecimal(atomicUnits);
// decimalAmount = Decimal("1")

const backToUnits = usdc.convertAmountToUnitsInBinary(decimalAmount);
// backToUnits = Buffer containing 1000000
```

### 9.5 PermitVariant (Token Approval Types)

**File**: `ca-common/src/permitutils/index.ts`

Different EVM chains use different permit (gasless approval) standards:

```typescript
enum PermitVariant {
  Unsupported = 0,      // Must use regular approve()
  EIP2612Canonical = 1, // Standard EIP-2612 (most chains)
  DAI = 2,              // MakerDAO DAI-style permit
  Polygon2612 = 3,      // Polygon's EIP2612 variant (uses salt)
  PolygonEMT = 4,       // Polygon meta-transaction (USDT on Polygon)
}
```

**Which variant to use by chain/token:**

| Chain | USDC | USDT | Native |
|-------|------|------|--------|
| Ethereum | EIP2612Canonical | Unsupported | - |
| Arbitrum | EIP2612Canonical | EIP2612Canonical | - |
| Optimism | EIP2612Canonical | EIP2612Canonical | - |
| Base | EIP2612Canonical | EIP2612Canonical | - |
| Polygon | Polygon2612 | PolygonEMT | - |
| Avalanche | EIP2612Canonical | EIP2612Canonical | - |

**Signing permits:**

```typescript
import { signPermitForAddressAndValue, Currency } from '@avail-project/ca-common';

const permitData = await signPermitForAddressAndValue(
  currency,           // Currency object with permit variant
  walletClient,       // viem WalletClient
  account,            // Account to sign with
  vaultAddress,       // Spender (vault contract)
  amount,             // Amount to approve
  contract,           // Optional: existing contract instance
  deadline            // Optional: permit expiration
);

// Returns: { v, r, s, deadline, nonce } or variant-specific data
```

### 9.6 Chaindata (Network Configuration)

**File**: `ca-common/src/data/chaindata.ts`

Pre-configured data for all supported chains:

```typescript
import {
  Chaindata,
  ChaindataMap,
  RPCURLMap,
  ChainDatum,
  Universe,
  OmniversalChainID
} from '@avail-project/ca-common';

// ChainDatum structure
interface ChainDatum {
  ChainID: OmniversalChainID;
  Universe: Universe;
  ChainID32: Buffer;           // 32-byte chain ID
  Currencies: Currency[];      // Supported tokens on this chain
  CurrencyMap: CurrencyMap;    // Quick currency lookup
}

// All supported chains
const allChains: ChainDatum[] = Chaindata;

// Lookup by OmniversalChainID
const arbitrumChainId = new OmniversalChainID(Universe.ETHEREUM, 42161);
const arbitrumData: ChainDatum = ChaindataMap.get(arbitrumChainId);

// Get RPC URL for a chain
const rpcUrl: string = RPCURLMap.get(arbitrumChainId);
// "https://rpcs.avail.so/arbitrum"
```

**Supported Networks in Chaindata:**

| Network | Chain ID | Universe | Tokens |
|---------|----------|----------|--------|
| Ethereum Mainnet | 1 | ETHEREUM | USDC, USDT, ETH |
| Arbitrum One | 42161 | ETHEREUM | USDC, USDT, ETH |
| Optimism | 10 | ETHEREUM | USDC, USDT, ETH |
| Base | 8453 | ETHEREUM | USDC, USDT, ETH |
| Polygon | 137 | ETHEREUM | USDC, USDT, POL, ETH |
| Avalanche | 43114 | ETHEREUM | USDC, USDT, AVAX |
| BSC | 56 | ETHEREUM | USDC, USDT, BNB |
| Scroll | 534352 | ETHEREUM | USDC, USDT, ETH |
| Kaia | 8217 | ETHEREUM | USDC, USDT, KAIA |
| Sophon | 50104 | ETHEREUM | USDC, USDT, SOPH |
| HyperEVM | 999 | ETHEREUM | USDC, USDT, HYPE |
| Monad | 143 | ETHEREUM | USDC, USDT, MON |
| MegaETH | 4326 | ETHEREUM | USDC, USDT, ETH |

### 9.7 Vault Contracts

**File**: `ca-common/src/vaultcontracts/vaultcontracts.ts`

Vault contracts per environment:

```typescript
import {
  Environment,
  getVaultContractMap,
  ChainIDKeyedMap
} from '@avail-project/ca-common';

enum Environment {
  FOLLY = 0,   // Development testnet
  CERISE = 1,  // Development mainnet
  CORAL = 2,   // Production testnet
  JADE = 3,    // Production mainnet
}

// Get vault addresses for production mainnet
const vaultMap: ChainIDKeyedMap<Buffer> = getVaultContractMap(Environment.JADE);

// All chains use the same vault address per environment
// JADE: 0x00000000ac0ac9d69424fA5Adc291D75Ec4a0F11
// CORAL: 0xC0DED5d7F424276c821AF21F68E1e663bC671C3D
```

### 9.8 Contract ABIs

**Files**: `ca-common/src/evmabi/`

Pre-exported ABIs for contract interactions:

```typescript
import {
  ERC20ABI,       // Standard ERC20 with permit
  EVMVaultABI,    // Vault contract for deposits/settlements
  YakAggregatorABI // Yield Yak (Avalanche DEX)
} from '@avail-project/ca-common';

// Using with viem
import { getContract } from 'viem';

const erc20 = getContract({
  address: tokenAddress,
  abi: ERC20ABI,
  client: publicClient,
});

const balance = await erc20.read.balanceOf([userAddress]);
```

**ERC20ABI includes:**
- Standard: `transfer`, `transferFrom`, `approve`, `allowance`, `balanceOf`
- Permit: `permit`, `nonces`, `DOMAIN_SEPARATOR`
- Metadata: `name`, `symbol`, `decimals`, `totalSupply`

**EVMVaultABI includes:**
- Deposit functions
- Settlement execution
- Fee management
- RFF nonce tracking

### 9.9 Protobuf Types (Protocol Messages)

**File**: `ca-common/src/proto/definition.ts` (4,757 lines)

Auto-generated Protobuf types for the chain abstraction protocol:

```typescript
import {
  // Enums
  Universe,
  RFFSourceState,
  SettlementState,

  // Core messages
  RequestForFunds,
  RFFSource,
  RFFDestination,
  SignatureData,
  Settlement,
  SolverData,

  // Cosmos messages
  MsgCreateRequestForFunds,
  MsgRefundReq,
  MsgDoubleCheckTx,

  // Query types
  QueryGetRequestForFundsRequest,
  QueryGetRequestForFundsResponse,
  QueryAllRequestForFundsRequest,
  QueryAllRequestForFundsResponse,
} from '@avail-project/ca-common';

// RFFSource structure
interface RFFSource {
  universe: number;
  chainID: Uint8Array;           // 32 bytes
  contractAddress: Uint8Array;   // 32 bytes (token)
  tokenDecimals: number;
  value: Uint8Array;             // Amount in atomic units
  state: RFFSourceState;
}

// RFFDestination structure
interface RFFDestination {
  contractAddress: Uint8Array;   // 32 bytes
  value: Uint8Array;             // Amount
}

// RFFSourceState enum
enum RFFSourceState {
  WAITING = 0,    // Awaiting deposit
  DEPOSITED = 1,  // Deposit confirmed
}
```

### 9.10 gRPC Client

**Files**: `ca-common/src/proto/grpc.ts`, `ca-common/src/proto/client.ts`

gRPC client for querying the Cosmos chain:

```typescript
import {
  createGrpcWebImpl,
  QueryClientImpl,
  Query
} from '@avail-project/ca-common';

// Create gRPC implementation
const grpcImpl = createGrpcWebImpl(
  "https://rpc.avail.so",  // gRPC endpoint
  { debug: false }
);

// Create query client
const queryClient: Query = new QueryClientImpl(grpcImpl);

// Available queries
const rff = await queryClient.RequestForFunds({
  index: rffIndex
});

const allRffs = await queryClient.RequestForFundsAll({
  pagination: { limit: 100n, offset: 0n }
});

const userRffs = await queryClient.RequestForFundsByAddress({
  address: userAddress
});

const solverData = await queryClient.SolverData({
  index: solverIndex
});

const settlement = await queryClient.Settlement({
  index: settlementIndex
});

const fees = await queryClient.ProtocolFees({});

const prices = await queryClient.PriceOracleData({});
```

### 9.11 OmniversalRFF (RFF Wrapper)

**File**: `ca-common/src/rff/rff.ts`

Bridges Protobuf RFF and EVM-compatible format:

```typescript
import { OmniversalRFF, RequestForFunds, EVMRFF } from '@avail-project/ca-common';

// Create from protobuf
const rff = new OmniversalRFF(protobufRFF);

// Convert to EVM format (for vault contract calls)
const evmRFF: EVMRFF = rff.asEVMRFF();

// EVMRFF structure
interface EVMRFF {
  sources: readonly {
    universe: number;
    chainID: bigint;
    contractAddress: `0x${string}`;
    value: bigint;
  }[];
  destinationUniverse: number;
  destinationChainID: bigint;
  recipientAddress: `0x${string}`;
  destinations: readonly {
    contractAddress: `0x${string}`;
    value: bigint;
  }[];
  nonce: bigint;
  expiry: bigint;
  parties: readonly {
    universe: number;
    address_: `0x${string}`;
  }[];
}
```

### 9.12 Cosmos Integration

**File**: `ca-common/src/cosmos/index.ts`

Cosmos wallet and client creation:

```typescript
import {
  createCosmosWallet,
  createCosmosClient,
  Registry
} from '@avail-project/ca-common';

// Create wallet from private key
const wallet = await createCosmosWallet(privateKeyHex);
// Uses "arcana" address prefix

// Create signing client with pre-registered message types
const client = await createCosmosClient(
  wallet,
  "https://rpc.cosmos.avail.so"
);

// Pre-registered message types:
// - /xarchain.chainabstraction.MsgCreateSolverData
// - /xarchain.chainabstraction.MsgUpdateSolverData
// - /xarchain.chainabstraction.MsgCreateRequestForFunds
// - /xarchain.chainabstraction.MsgRefundReq
// - /xarchain.chainabstraction.MsgDoubleCheckTx
```

### 9.13 Balance Query API

**File**: `ca-common/src/balances/ub-api.ts`

Query user balances across chains:

```typescript
import { getBalances, BalanceOnChain, Universe } from '@avail-project/ca-common';

const balances: BalanceOnChain[] = await getBalances(
  "https://vsc.avail.so",           // VSC API endpoint
  Universe.ETHEREUM,                 // Universe to query
  userAddressBytes                   // 20-byte address
);

// BalanceOnChain structure
interface BalanceOnChain {
  chainID: OmniversalChainID;
  totalValue: Decimal;              // Total USD value
  currencywise: {
    tokenAddress: Buffer;
    amount: Decimal;
    value: Decimal;                 // USD value of this token
  }[];
}
```

### 9.14 Data Conversion Utilities

**File**: `ca-common/src/data/utils.ts`

```typescript
import {
  convertToBufferIfNecessary,
  zeroExtendBufToGivenSize,
  ezPadTo32Hex,
  convertDecimalToBigInt,
  convertBigIntToDecimal,
  maxByBigInt,
  minByBigInt,
} from '@avail-project/ca-common';

// Convert Uint8Array to Buffer
const buffer = convertToBufferIfNecessary(uint8Array);

// Left-pad to 32 bytes
const padded = zeroExtendBufToGivenSize(address, 32);
// 0xAbCd... → 0x000000000000000000000000AbCd...

// Pad any value to 32-byte hex
const hex32 = ezPadTo32Hex(chainId);

// Decimal ↔ BigInt
const bigint = convertDecimalToBigInt(new Decimal("123.456"));
// Rounds up: 124n

const decimal = convertBigIntToDecimal(1000000n);
// Decimal("1000000")

// Find max/min by bigint value
const bestQuote = maxByBigInt(quotes, q => q.outputAmount);
const cheapestQuote = minByBigInt(quotes, q => q.inputAmount);
```

---

## 10. Cross-Chain Swap (XCS) Aggregators

The XCS (Cross-Chain Swap) module in ca-common provides a unified interface for DEX aggregators used by the SDK's swap operations.

### 10.1 Aggregator Interface

**File**: `ca-common/src/xcs/iface.ts`

```typescript
import {
  Aggregator,
  Quote,
  QuoteType,
  QuoteSeriousness,
  QuoteRequestExactInput,
  QuoteRequestExactOutput,
} from '@avail-project/ca-common';

// Quote types
enum QuoteType {
  EXACT_IN,   // Fixed input amount, variable output
  EXACT_OUT,  // Variable input, fixed output amount
}

// Quote seriousness
enum QuoteSeriousness {
  PRICE_SURVEY,  // Non-binding estimate (for UI display)
  SERIOUS,       // Binding quote (for execution)
}

// Quote request for exact input
interface QuoteRequestExactInput {
  userAddress: Bytes;
  chain: OmniversalChainID;
  inputToken: Bytes;           // Token address (32 bytes)
  outputToken: Bytes;          // Token address (32 bytes)
  seriousness: QuoteSeriousness;
  type: QuoteType.EXACT_IN;
  inputAmount: bigint;         // Amount to swap
}

// Quote request for exact output
interface QuoteRequestExactOutput {
  userAddress: Bytes;
  chain: OmniversalChainID;
  inputToken: Bytes;
  outputToken: Bytes;
  seriousness: QuoteSeriousness;
  type: QuoteType.EXACT_OUT;
  outputAmount: bigint;        // Desired output amount
}

// Quote response
interface Quote {
  originalResponse: unknown;   // Raw aggregator response
  type: QuoteType;
  inputAmount: bigint;
  outputAmountMinimum: bigint; // Worst case (with slippage)
  outputAmountLikely: bigint;  // Expected output
}

// Aggregator interface
interface Aggregator {
  getQuotes(
    requests: (QuoteRequestExactInput | QuoteRequestExactOutput)[],
  ): Promise<(Quote | null)[]>;
}
```

### 10.2 Available Aggregators

| Aggregator | File | Supported Chains | Best For |
|------------|------|------------------|----------|
| LiFi | `lifi-agg.ts` | All EVM chains | General swaps, cross-chain |
| Bebop | `bebop-agg.ts` | Major EVM chains | Intent-based swaps |
| 0x | `0x-agg.ts` | Major EVM chains | DEX aggregation |
| Yield Yak | `yieldyak-agg.ts` | Avalanche only | Avalanche-specific |

### 10.3 LiFi Aggregator

**File**: `ca-common/src/xcs/lifi-agg.ts`

```typescript
import { LiFiAggregator } from '@avail-project/ca-common';

const lifi = new LiFiAggregator(apiKey);

const quotes = await lifi.getQuotes([
  {
    userAddress: addressBytes,
    chain: new OmniversalChainID(Universe.ETHEREUM, 42161),
    inputToken: usdcAddress,
    outputToken: wethAddress,
    seriousness: QuoteSeriousness.SERIOUS,
    type: QuoteType.EXACT_IN,
    inputAmount: 1000_000000n,  // 1000 USDC
  }
]);

// Returns swap calldata for execution
const quote = quotes[0];
if (quote) {
  console.log("Output:", quote.outputAmountLikely);
  // originalResponse contains LiFi-specific transaction data
}
```

### 10.4 Bebop Aggregator

**File**: `ca-common/src/xcs/bebop-agg.ts`

```typescript
import { BebopAggregator } from '@avail-project/ca-common';

const bebop = new BebopAggregator(apiKey);

// Bebop uses intent-based trading (CoW Swap style)
const quotes = await bebop.getQuotes([...requests]);
```

### 10.5 Multi-Aggregator Selection

**File**: `ca-common/src/xcs/autochoice.ts`

Automatically select the best quote across multiple aggregators:

```typescript
import {
  aggregateAggregators,
  AggregateAggregatorsMode,
  LiFiAggregator,
  BebopAggregator,
} from '@avail-project/ca-common';

// Create aggregators
const aggregators = [
  new LiFiAggregator(lifiKey),
  new BebopAggregator(bebopKey),
];

// Get best quotes from all aggregators
const results = await aggregateAggregators(
  requests,
  aggregators,
  AggregateAggregatorsMode.BEST  // Select best per request
);

// Results include which aggregator won
for (const { quote, aggregator } of results) {
  if (quote) {
    console.log("Best output:", quote.outputAmountLikely);
    console.log("From:", aggregator.constructor.name);
  }
}
```

**Selection Logic:**
- For `EXACT_IN`: Selects aggregator with maximum output
- For `EXACT_OUT`: Selects aggregator with minimum input
- Applies 2.5% safety multiplier to account for price movement

### 10.6 Integration with SDK Swap

The SDK's swap operations use XCS aggregators internally:

```typescript
// In nexus-sdk: src/sdk/ca-base/swap/route.ts

async function _exactInRoute(params, options) {
  // 1. Determine if source swap needed
  const needsSourceSwap = params.fromToken !== 'USDC';

  // 2. Get quote from aggregator
  if (needsSourceSwap) {
    const quote = await aggregator.getQuotes([{
      type: QuoteType.EXACT_IN,
      chain: sourceChainId,
      inputToken: fromTokenAddress,
      outputToken: usdcAddress,
      inputAmount: params.amount,
      seriousness: QuoteSeriousness.SERIOUS,
    }]);

    // Use quote.originalResponse for swap calldata
  }

  // 3. Bridge USDC via RFF
  // 4. Destination swap if needed
}
```

---

## 11. Protocol Internals

This section documents the internal protocol mechanics for advanced SDK development.

### 11.1 RFF Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        REQUEST FOR FUNDS LIFECYCLE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. CREATION                                                            │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │ User signs RFF with sources, destinations, nonce, expiry    │    │
│     │ RFF submitted to Cosmos via MsgCreateRequestForFunds        │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                    │                                    │
│                                    ▼                                    │
│  2. DEPOSITS                                                            │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │ For each source:                                            │    │
│     │   - User deposits tokens to Vault contract                  │    │
│     │   - Vault emits Deposit event                               │    │
│     │   - Cosmos receives MsgDoubleCheckTx to confirm             │    │
│     │   - Source state: WAITING → DEPOSITED                       │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                    │                                    │
│                                    ▼                                    │
│  3. SOLVER FULFILLMENT                                                  │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │ Solver sees RFF with all deposits confirmed                 │    │
│     │ Solver delivers funds to recipient on destination chain     │    │
│     │ Solver submits settlement proof to Cosmos                   │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                    │                                    │
│                                    ▼                                    │
│  4. SETTLEMENT                                                          │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │ Cosmos verifies settlement                                  │    │
│     │ Solver receives deposited funds (minus protocol fee)        │    │
│     │ RFF marked as complete                                      │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Vault Contract Interactions

**Deposit Flow:**

```typescript
// From SDK: Execute deposit to vault
const vaultContract = getContract({
  address: vaultAddress,
  abi: EVMVaultABI,
  client: walletClient,
});

// For ERC20 tokens with permit
await vaultContract.write.depositWithPermit([
  evmRFF,              // EVMRFF structure
  sourceIndex,         // Which source in the RFF
  permitData.v,
  permitData.r,
  permitData.s,
  permitData.deadline,
]);

// For native tokens (ETH, POL, etc.)
await vaultContract.write.depositNative([
  evmRFF,
  sourceIndex,
], { value: amount });

// For tokens without permit support
// First: token.approve(vaultAddress, amount)
await vaultContract.write.deposit([
  evmRFF,
  sourceIndex,
]);
```

### 11.3 Double-Check Transaction

After depositing, the SDK confirms the deposit on Cosmos:

```typescript
// Submit double-check to Cosmos
const msg: MsgDoubleCheckTx = {
  creator: cosmosAddress,
  txHash: depositTxHash,
  sourceChainID: chainID32bytes,
  rffIndex: rffIndexOnCosmos,
};

await cosmosClient.signAndBroadcast(
  cosmosAddress,
  [{ typeUrl: '/xarchain.chainabstraction.MsgDoubleCheckTx', value: msg }],
  fee
);
```

### 11.4 Protocol Fees

Fees are queried from Cosmos and applied to intents:

```typescript
// Query protocol fees
const feesResponse = await queryClient.ProtocolFees({});
const fees = feesResponse.protocolFees;

// Fee structure
interface ProtocolFees {
  baseFee: bigint;           // Flat fee in basis points
  variableFee: bigint;       // Percentage fee
  minFee: bigint;            // Minimum fee amount
  solverReward: bigint;      // Solver incentive
}

// Fee calculation (simplified)
const feeAmount = max(
  (amount * variableFee / 10000) + baseFee,
  minFee
);
```

### 11.5 Price Oracle

The protocol uses on-chain price oracles for fee calculation and value normalization:

```typescript
// Query oracle prices
const pricesResponse = await queryClient.PriceOracleData({});

// Returns prices for all supported tokens
// Used to:
// 1. Calculate USD values of deposits
// 2. Normalize fees across different tokens
// 3. Determine solver profitability
```

### 11.6 Solver System

Solvers are third-party actors that fulfill RFFs:

```typescript
// Solver data structure
interface SolverData {
  creator: string;              // Cosmos address
  reputationScore: Long;        // Performance score
  settlementAddress: Uint8Array; // Where to receive funds
  supportedChains: Uint8Array[];
  minAmount: Uint8Array;
  maxAmount: Uint8Array;
  feeRate: number;              // Solver's fee rate
}

// Query solvers
const solvers = await queryClient.SolverDataAll({});
```

### 11.7 Nonce Management

Each RFF has a unique nonce to prevent replay attacks:

```typescript
// Nonce generation (in SDK)
function generateRFFNonce(): bigint {
  // Combines:
  // - Current timestamp (milliseconds)
  // - Random bytes
  // - User address hash
  return nonce;
}

// Nonce is included in RFF signature
const rffHash = keccak256(encode([
  sources,
  destinations,
  nonce,        // Unique per RFF
  expiry,
  // ...
]));
```

### 11.8 Message Pack Serialization

Backend communication uses MessagePack for efficiency:

```typescript
// From ca-common: src/types/msgpack-axios.ts
import { msgpackableAxios } from '@avail-project/ca-common';

// Automatically serializes/deserializes msgpack
const response = await msgpackableAxios.post(
  'https://vsc.avail.so/api/balances',
  { address: userAddress }
);

// Request: application/msgpack
// Response: application/msgpack
// Automatically converted to/from JavaScript objects
```

---

## Appendix C: ca-common Quick Reference

### Imports Cheatsheet

```typescript
// Chain identification
import {
  Universe,
  OmniversalChainID,
  ChainIDKeyedMap
} from '@avail-project/ca-common';

// Chain and token data
import {
  Chaindata,
  ChaindataMap,
  RPCURLMap,
  Currency,
  CurrencyID
} from '@avail-project/ca-common';

// Vault contracts
import {
  Environment,
  getVaultContractMap
} from '@avail-project/ca-common';

// Contract ABIs
import {
  ERC20ABI,
  EVMVaultABI
} from '@avail-project/ca-common';

// Protocol types
import {
  RequestForFunds,
  RFFSource,
  RFFDestination,
  Settlement,
  SolverData,
  MsgCreateRequestForFunds
} from '@avail-project/ca-common';

// RFF wrapper
import {
  OmniversalRFF,
  EVMRFF
} from '@avail-project/ca-common';

// gRPC client
import {
  createGrpcWebImpl,
  QueryClientImpl
} from '@avail-project/ca-common';

// Permit utilities
import {
  PermitVariant,
  signPermitForAddressAndValue
} from '@avail-project/ca-common';

// DEX aggregators
import {
  Aggregator,
  Quote,
  QuoteType,
  LiFiAggregator,
  BebopAggregator,
  aggregateAggregators
} from '@avail-project/ca-common';

// Cosmos integration
import {
  createCosmosWallet,
  createCosmosClient
} from '@avail-project/ca-common';

// Balance queries
import {
  getBalances,
  BalanceOnChain
} from '@avail-project/ca-common';

// Utilities
import {
  convertToBufferIfNecessary,
  zeroExtendBufToGivenSize,
  ezPadTo32Hex,
  convertDecimalToBigInt,
  convertBigIntToDecimal
} from '@avail-project/ca-common';
```

### Environment Variables

```bash
# For LiFi aggregator
LIFI_API_KEY=your_lifi_api_key

# For Bebop aggregator
BEBOP_API_KEY=your_bebop_api_key

# For 0x aggregator
ZEROX_API_KEY=your_0x_api_key
```

---

*Last updated: 2026-01-13*
*SDK Version: 1.0.0-beta.63*
*ca-common Version: 1.0.0-beta.9*
