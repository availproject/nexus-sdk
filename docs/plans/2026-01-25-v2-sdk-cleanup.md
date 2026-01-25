# V2 SDK Cleanup - Remove Cosmos/VSC, Use Middleware Only

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all Cosmos/VSC V1 code from SDK, keep interface unchanged, use middleware for all operations.

**Architecture:** SDK uses REST/WebSocket middleware for balance, approvals, RFF. Frontend creates viem wallet from Anvil key and passes to SDK. Swaps, execute-later, tenderly stay as-is. Mock fees/oracle/solvers for now.

**Tech Stack:** TypeScript, viem, axios, WebSocket (native), React/Vite for test app

**Anvil Chains:** Ethereum (1), Arbitrum (42161), Polygon (137), Base (8453)

---

## Phase 1: Cleanup - Remove V1/Cosmos Code

### Task 1: Remove cosmos.utils.ts

**Files:**
- Delete: `src/sdk/ca-base/utils/cosmos.utils.ts`
- Modify: `src/sdk/ca-base/utils/index.ts` (remove export)

**Step 1: Delete cosmos.utils.ts**

```bash
rm src/sdk/ca-base/utils/cosmos.utils.ts
```

**Step 2: Update utils/index.ts**

Remove the cosmos export line:
```typescript
// REMOVE: export * from './cosmos.utils';
```

**Step 3: Verify build compiles**

```bash
pnpm build
```
Expected: Build errors showing what depends on cosmos utils (we'll fix in next tasks)

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: remove cosmos.utils.ts"
```

---

### Task 2: Clean up ca.ts - Remove Cosmos/SIWE Initialization

**Files:**
- Modify: `src/sdk/ca-base/ca.ts`

**Step 1: Remove cosmos-related imports**

Remove these imports at top of file:
```typescript
// REMOVE:
import {
  createCosmosClient,
  createCosmosWallet,
  Environment,
  Universe,
} from '@avail-project/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import { createSiweMessage } from 'viem/siwe';
```

Keep:
```typescript
import { createWalletClient, custom, Hex, UserRejectedRequestError, WalletClient } from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
```

**Step 2: Remove cosmos class members**

Remove from CA class:
```typescript
// REMOVE these properties:
#cosmos?: CosmosOptions & {
  wallet: DirectSecp256k1Wallet;
};
#ephemeralWallet?: PrivateKeyAccount;
private readonly _siweChain;
```

And remove from constructor:
```typescript
// REMOVE:
this._siweChain = ...
```

**Step 3: Remove SIWE constant**

```typescript
// REMOVE:
const SIWE_STATEMENT = 'Sign in to enable Nexus';
```

**Step 4: Simplify _init() method**

Replace the `_init()` method - remove all cosmos wallet creation logic:

```typescript
protected async _init() {
  // V2: No cosmos wallet or SIWE needed
  // Just set up EVM address
  if (!this._evm) {
    throw Errors.notInitialized('EVM provider not set');
  }

  // Clear any pending refund interval (V1 leftover)
  if (this._refundInterval) {
    clearInterval(this._refundInterval);
    this._refundInterval = undefined;
  }

  logger.debug('_init:complete', {
    evmAddress: this._evm.address,
    useV2Middleware: this._networkConfig.useV2Middleware
  });
}
```

**Step 5: Remove _createCosmosWallet() method**

Delete entire method (~30 lines).

**Step 6: Remove _getCosmosWallet() method**

Delete entire method (~10 lines).

**Step 7: Remove _signatureForLogin() method**

Delete entire SIWE signature generation method (~45 lines).

**Step 8: Remove _checkPendingRefunds() method**

Delete entire method (~20 lines).

**Step 9: Remove _refundInterval property and related code**

Remove property declaration and any setInterval calls.

**Step 10: Remove cosmos-related imports from utils**

```typescript
// REMOVE these from utils import:
cosmosFeeGrant,
refundExpiredIntents,
retrieveSIWESignatureFromLocalStorage,
storeSIWESignatureToLocalStorage,
getCosmosURL,
```

**Step 11: Build and fix any remaining errors**

```bash
pnpm build
```

**Step 12: Commit**

```bash
git add -A && git commit -m "refactor: remove cosmos/SIWE initialization from ca.ts"
```

---

### Task 3: Clean up bridge.ts - Remove V1 execute() Path

**Files:**
- Modify: `src/sdk/ca-base/requestHandlers/bridge.ts`

**Step 1: Remove V1-only imports**

Remove:
```typescript
// REMOVE:
import { cosmosCreateRFF } from '../utils/cosmos.utils';
import { vscCreateRFF, vscPublishRFF, vscCreateSponsoredApprovals } from '../utils/api.utils';
```

**Step 2: Remove execute() method (V1 cosmos path)**

Delete the entire `execute()` method that uses cosmos chain. This is the V1 path.
Keep `executeV2()` and `executeV2ViaMiddleware()`.

**Step 3: Remove processRFF() method**

Delete entire method - it's for V1 cosmos RFF creation.

**Step 4: Remove waitForFill() cosmos-based polling**

Delete the V1 waitForFill that uses cosmos queries. Keep V2 statekeeper polling.

**Step 5: Remove setAllowances() V1 path**

The current `setAllowances()` has both VSC and direct approval paths. Simplify to only use middleware path for sponsored approvals. Keep direct approval for Ethereum (chain 1).

**Step 6: Rename executeV2() to execute()**

Since there's only one path now:
```typescript
// Rename executeV2ViaMiddleware() to execute()
public async execute(): Promise<BridgeResponse> {
  // ... middleware-based execution
}
```

**Step 7: Build and verify**

```bash
pnpm build
```

**Step 8: Commit**

```bash
git add -A && git commit -m "refactor: remove V1 cosmos bridge execution path"
```

---

### Task 4: Clean up api.utils.ts - Remove VSC Functions

**Files:**
- Modify: `src/sdk/ca-base/utils/api.utils.ts`

**Step 1: Remove VSC WebSocket functions**

Delete:
- `vscCreateRFF()` - WebSocket to /create-rff
- `vscCreateSponsoredApprovals()` - WebSocket to /create-sponsored-approvals
- `vscPublishRFF()` - POST /publish-rff
- `vscCreateFeeGrant()` - POST /create-feegrant

**Step 2: Remove msgpack-related code**

Delete msgpack imports and encoding/decoding if only used by VSC functions.

**Step 3: Keep HTTP utilities**

Keep axios client setup and any generic HTTP utilities.

**Step 4: Remove getEVMBalancesForAddress V1 function**

This called VSC `/balance` endpoint. Remove it - we now use middleware.

**Step 5: Build and verify**

```bash
pnpm build
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: remove VSC service functions from api.utils.ts"
```

---

### Task 5: Update balance.utils.ts - Remove V1 Conditional

**Files:**
- Modify: `src/sdk/ca-base/utils/balance.utils.ts`

**Step 1: Remove V1 balance fetching path**

Remove the conditional and always use middleware:
```typescript
// BEFORE:
input.useV2Middleware && input.middlewareUrl
  ? getEVMBalancesForAddressV2(input.middlewareUrl, input.evmAddress)
  : getEVMBalancesForAddress(input.vscDomain, input.evmAddress)

// AFTER:
getEVMBalancesForAddressV2(input.middlewareUrl!, input.evmAddress)
```

**Step 2: Remove useV2Middleware parameter**

It's always V2 now, remove the conditional parameter.

**Step 3: Make middlewareUrl required**

Update function signature to require middlewareUrl.

**Step 4: Build and verify**

```bash
pnpm build
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove V1 balance path, always use middleware"
```

---

### Task 6: Update sdk/index.ts - Remove V1 Conditional

**Files:**
- Modify: `src/sdk/index.ts`

**Step 1: Remove executeV2() conditional**

```typescript
// BEFORE:
const result = await (this._networkConfig.useV2Middleware
  ? handler.executeV2()
  : handler.execute());

// AFTER:
const result = await handler.execute();
```

**Step 2: Build and verify**

```bash
pnpm build
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: remove V1/V2 conditional in SDK bridge"
```

---

### Task 7: Update config.ts - Simplify Network Config

**Files:**
- Modify: `src/sdk/ca-base/config.ts`

**Step 1: Make MIDDLEWARE_URL required**

Update NetworkConfig interface:
```typescript
interface NetworkConfig {
  // Required for V2
  MIDDLEWARE_URL: string;
  STATEKEEPER_URL: string;

  // Keep for reference/explorer links
  COSMOS_URL: string;
  EXPLORER_URL: string;
  GRPC_URL: string;

  // Remove or deprecate
  // VSC_DOMAIN: string;  // No longer used

  // Remove flag - always V2
  // useV2Middleware: boolean;  // Always true now
}
```

**Step 2: Update network configs**

Update JADE, CORAL, FOLLY configs with required middleware URLs.

**Step 3: Build and verify**

```bash
pnpm build
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: simplify network config for V2"
```

---

### Task 8: Remove Cosmos Dependencies from package.json

**Files:**
- Modify: `package.json`

**Step 1: Remove cosmos packages**

```bash
pnpm remove @cosmjs/proto-signing @cosmjs/stargate
```

**Step 2: Remove starkware if only used for key derivation**

```bash
pnpm remove @starkware-industries/starkware-crypto-utils
```

**Step 3: Remove msgpackr if no longer used**

Check if anything still uses msgpackr. If not:
```bash
pnpm remove msgpackr
```

**Step 4: Install and verify**

```bash
pnpm install
pnpm build
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove cosmos dependencies"
```

---

## Phase 2: Mock Missing Features

### Task 9: Add Mocked Protocol Fees, Oracle, Solvers

**Files:**
- Create: `src/sdk/ca-base/utils/mocks.ts`
- Modify: Files that call these services

**Step 1: Create mocks.ts**

```typescript
// src/sdk/ca-base/utils/mocks.ts

import { logger } from '../../../commons/utils/logger';

/**
 * MOCKED: Protocol fees - in production, fetched from middleware/statekeeper
 */
export const getProtocolFees = async (): Promise<{
  baseFee: bigint;
  percentFee: number;
}> => {
  logger.warn('MOCK: getProtocolFees - using hardcoded values');
  return {
    baseFee: 0n,
    percentFee: 0.001, // 0.1%
  };
};

/**
 * MOCKED: Oracle prices - in production, fetched from price oracle
 */
export const getOraclePrices = async (tokens: string[]): Promise<Record<string, number>> => {
  logger.warn('MOCK: getOraclePrices - using hardcoded USDC=1');
  const prices: Record<string, number> = {};
  for (const token of tokens) {
    prices[token] = 1.0; // Assume all tokens = $1 (USDC-like)
  }
  return prices;
};

/**
 * MOCKED: Solver data - in production, fetched from solver registry
 */
export const getSolverData = async (): Promise<{
  solvers: { id: string; name: string; active: boolean }[];
}> => {
  logger.warn('MOCK: getSolverData - using default solver');
  return {
    solvers: [
      { id: 'default', name: 'Default Solver', active: true },
    ],
  };
};
```

**Step 2: Export from utils/index.ts**

```typescript
export * from './mocks';
```

**Step 3: Update callers to use mocks**

Find places that fetch fees/oracle/solvers and replace with mock calls.

**Step 4: Build and verify**

```bash
pnpm build
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add mocked protocol fees, oracle, solvers"
```

---

## Phase 3: Documentation Cleanup

### Task 10: Create V2 Flow Diagram Doc

**Files:**
- Create: `docs/V2_FLOW.md`
- Delete: All old docs except this and the mocked items doc

**Step 1: Write V2_FLOW.md**

```markdown
# Nexus SDK V2 Architecture

## Overview

The SDK uses a REST/WebSocket middleware for all cross-chain operations. No Cosmos chain interaction is required.

## Flow Diagram

```
┌─────────────────┐
│   Frontend App  │
│  (React/Vite)   │
└────────┬────────┘
         │ initialize(provider) or initializeWithKey()
         ▼
┌─────────────────┐
│    Nexus SDK    │
│   (TypeScript)  │
└────────┬────────┘
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
┌─────────────────┐                   ┌─────────────────┐
│   Middleware    │◄─────────────────►│   Statekeeper   │
│  (REST + WS)    │                   │   (REST API)    │
│ localhost:3000  │                   │ localhost:9080  │
└────────┬────────┘                   └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│                    Anvil Nodes                       │
├─────────────┬─────────────┬────────────┬────────────┤
│ Ethereum(1) │ Arbitrum    │ Polygon    │ Base       │
│ :8545       │ (42161):8546│ (137):8547 │ (8453):8548│
└─────────────┴─────────────┴────────────┴────────────┘
```

## SDK Operations

### 1. Get Unified Balances

```typescript
const sdk = new NexusSDK({ network: config });
await sdk.initialize(provider);
const balances = await sdk.getUnifiedBalances();
```

**Flow:**
1. SDK calls middleware `GET /api/v1/balance/evm/{address}`
2. Middleware queries all Anvil nodes for token balances
3. Returns aggregated balances by chain

### 2. Bridge Tokens

```typescript
const result = await sdk.bridge({
  token: 'USDC',
  amount: '100000000', // 100 USDC (6 decimals)
  toChainId: 137, // Polygon
  sourceChains: [42161, 8453], // Arbitrum, Base
});
```

**Flow:**
1. SDK builds intent from source chains
2. Creates approval signatures (permit for supported chains)
3. Sends approvals to middleware via WebSocket `/create-sponsored-approvals`
4. Submits RFF to middleware `POST /api/v1/rff`
5. Polls statekeeper `GET /rff/{hash}` for fulfillment
6. Returns when fulfilled

### 3. Edge Cases

- **Ethereum (chain 1):** No sponsored approvals - user signs direct ERC20 approve()
- **Polygon USDC:** Uses meta-transactions (variant 2) instead of permit
- **Token collection:** Handled automatically by solver (V2)

## Configuration

```typescript
const config = {
  MIDDLEWARE_URL: 'http://localhost:3000',
  STATEKEEPER_URL: 'http://localhost:9080',
  COSMOS_URL: 'https://cosmos-mainnet.availproject.org',  // For explorer links
  EXPLORER_URL: 'http://localhost:3000/explorer',
  GRPC_URL: 'https://grpcproxy-mainnet.availproject.org',
  NETWORK_HINT: 'mainnet',
};
```

## Test App Usage

```typescript
import { NexusSDK } from '@anthropic/nexus-sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// Create provider from Anvil test key (no MetaMask needed)
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const client = createWalletClient({
  account,
  chain: mainnet,
  transport: http('http://localhost:8545'),
});

// Initialize SDK
const sdk = new NexusSDK({ network: config });
await sdk.initialize(client);

// Use SDK
const balances = await sdk.getUnifiedBalances();
const result = await sdk.bridge({ ... });
```
```

**Step 2: Delete old docs**

```bash
rm docs/NEXTJS_V2_INTEGRATION.md
rm docs/V1_TO_V2_MIGRATION.md
rm docs/V2_MIDDLEWARE_INTEGRATION_GAPS.md
rm docs/V2_IMPLEMENTATION_SUMMARY.md
rm docs/V2_BUGS_FIXED.md
rm docs/plans/*.md  # Old plans
rm V2_INTEGRATION_COMPLETE.md
rm FINAL_SUMMARY.md
rm TEST_APP_CREATED.md
```

**Step 3: Commit**

```bash
git add -A && git commit -m "docs: add V2 flow diagram, remove old docs"
```

---

### Task 11: Create Mocked Features Doc

**Files:**
- Create: `docs/MOCKED_FEATURES.md`

**Step 1: Write MOCKED_FEATURES.md**

```markdown
# Mocked Features in V2 SDK

These features are mocked for local development/testing. In production, they will be connected to real services.

## Currently Mocked

### 1. Protocol Fees
- **Location:** `src/sdk/ca-base/utils/mocks.ts`
- **Current behavior:** Returns 0 base fee, 0.1% percent fee
- **Production:** Fetch from statekeeper/middleware

### 2. Oracle Prices
- **Location:** `src/sdk/ca-base/utils/mocks.ts`
- **Current behavior:** Returns $1.00 for all tokens (assumes USDC-like)
- **Production:** Fetch from price oracle service

### 3. Solver Data
- **Location:** `src/sdk/ca-base/utils/mocks.ts`
- **Current behavior:** Returns single default solver
- **Production:** Fetch from solver registry

## Working Features

### Fully Implemented
- ✅ Unified balance fetching (via middleware)
- ✅ Sponsored approvals (via middleware WebSocket)
- ✅ RFF creation and submission (via middleware)
- ✅ RFF status tracking (via statekeeper)
- ✅ Direct approvals for Ethereum (chain 1)
- ✅ Meta-transactions for Polygon USDC (variant 2)

### Unchanged from V1
- ✅ Swaps (internal chain swaps)
- ✅ Execute-later functionality
- ✅ Tenderly simulation (via nexusv2 backend)

## Local Development

### Required Services
1. **Middleware:** `http://localhost:3000`
2. **Statekeeper:** `http://localhost:9080`
3. **Anvil nodes:**
   - Ethereum: `http://localhost:8545` (chainId: 1)
   - Arbitrum: `http://localhost:8546` (chainId: 42161)
   - Polygon: `http://localhost:8547` (chainId: 137)
   - Base: `http://localhost:8548` (chainId: 8453)

### Test Account
- Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- ⚠️ **Never use on mainnet - publicly known key**
```

**Step 2: Commit**

```bash
git add -A && git commit -m "docs: add mocked features documentation"
```

---

## Phase 4: Test App - Frontend with Anvil Key

### Task 12: Update Test App - Use Anvil Key (No MetaMask)

**Files:**
- Modify: `test-app/src/components/BridgeUI.tsx`

**Step 1: Add viem wallet creation from private key**

```typescript
import { createWalletClient, http, custom, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, polygon, base } from 'viem/chains';

// Anvil test account
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Chain configs for local Anvil
const ANVIL_CHAINS = {
  1: { chain: mainnet, rpc: 'http://localhost:8545' },
  42161: { chain: arbitrum, rpc: 'http://localhost:8546' },
  137: { chain: polygon, rpc: 'http://localhost:8547' },
  8453: { chain: base, rpc: 'http://localhost:8548' },
};
```

**Step 2: Create EIP-1193 compatible provider from viem client**

```typescript
const createAnvilProvider = () => {
  const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);

  // Create wallet client for primary chain (Arbitrum for bridge source)
  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(ANVIL_CHAINS[42161].rpc),
  });

  // Create EIP-1193 compatible provider
  const provider = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account.address];
        case 'eth_chainId':
          return '0xa4b1'; // 42161 in hex (Arbitrum)
        case 'personal_sign':
          return walletClient.signMessage({ message: params![0] });
        case 'eth_signTypedData_v4':
          return walletClient.signTypedData(JSON.parse(params![1]));
        case 'eth_sendTransaction':
          return walletClient.sendTransaction(params![0]);
        default:
          // Delegate to wallet client
          return walletClient.request({ method, params } as any);
      }
    },
  };

  return provider;
};
```

**Step 3: Update initializeSDK to use Anvil provider**

```typescript
const initializeSDK = async () => {
  try {
    setLoading(true);
    setError(null);

    // Create provider from Anvil key (no MetaMask)
    const provider = createAnvilProvider();

    // Initialize SDK
    const sdkInstance = new NexusSDK({ network: V2_CONFIG });
    await sdkInstance.initialize(provider as any);

    setSdk(sdkInstance);
    setAddress(ANVIL_ADDRESS);
    setConnected(true);

    // Load balances
    await loadBalances(sdkInstance);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to initialize SDK');
  } finally {
    setLoading(false);
  }
};
```

**Step 4: Remove MetaMask connection button, auto-initialize**

```typescript
useEffect(() => {
  initializeSDK();
}, []);
```

**Step 5: Build and test**

```bash
cd test-app && pnpm build && pnpm dev
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: test app uses Anvil key directly, no MetaMask"
```

---

### Task 13: Test Bridge Flow End-to-End

**Files:**
- N/A (manual testing)

**Step 1: Start all services**

```bash
# Terminal 1: Anvil nodes (4 chains)
anvil --fork-url $ETH_RPC --port 8545 --chain-id 1 &
anvil --fork-url $ARB_RPC --port 8546 --chain-id 42161 &
anvil --fork-url $POLYGON_RPC --port 8547 --chain-id 137 &
anvil --fork-url $BASE_RPC --port 8548 --chain-id 8453 &

# Terminal 2: Middleware
cd middleware && cargo run

# Terminal 3: Statekeeper
cd statekeeper && cargo run

# Terminal 4: Test app
cd test-app && pnpm dev
```

**Step 2: Open browser**

Navigate to `http://localhost:5174`

**Step 3: Verify balances load**

- Should show USDC balances across 4 chains
- Address should be `0xf39F...92266`

**Step 4: Test bridge**

- Select USDC token
- Enter amount (e.g., 10 USDC)
- Select source chains (Arbitrum, Base)
- Select destination (Polygon)
- Click Bridge
- Verify steps progress
- Verify fulfillment

**Step 5: Document any issues**

Create issue in repo if bugs found.

---

## Phase 5: Final Cleanup

### Task 14: Remove Deprecated Tests

**Files:**
- Delete old test files

**Step 1: Remove deprecated tests**

```bash
rm -rf test/integration/v1-*.test.ts
rm test/integration/sdk-v2-balance-test.ts  # Superseded by e2e
```

**Step 2: Keep V2 e2e tests**

Keep:
- `test/integration/v2-middleware-e2e.test.ts`
- `test/integration/sdk-v2-middleware-e2e.test.ts`

**Step 3: Update test scripts in package.json**

```json
{
  "scripts": {
    "test:e2e": "tsx test/integration/v2-middleware-e2e.test.ts",
    "test:sdk": "tsx test/integration/sdk-v2-middleware-e2e.test.ts"
  }
}
```

**Step 4: Commit**

```bash
git add -A && git commit -m "test: remove deprecated V1 tests"
```

---

### Task 15: Remove Extra Root-Level Files

**Files:**
- Delete unnecessary root files

**Step 1: Remove extra files**

```bash
rm FINAL_SUMMARY.md
rm TEST_APP_CREATED.md
rm V2_INTEGRATION_COMPLETE.md
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove extra root-level files"
```

---

### Task 16: Final Build and Verify

**Step 1: Clean install**

```bash
rm -rf node_modules
pnpm install
```

**Step 2: Build SDK**

```bash
pnpm build
```

**Step 3: Build test app**

```bash
cd test-app && pnpm build
```

**Step 4: Run linter**

```bash
pnpm lint
```

**Step 5: Commit final state**

```bash
git add -A && git commit -m "chore: final V2 cleanup complete"
```

---

## Summary

### Files Deleted
- `src/sdk/ca-base/utils/cosmos.utils.ts`
- `docs/*.md` (old docs)
- `docs/plans/*.md` (old plans)
- `test/integration/v1-*.ts` (old tests)
- Root-level extra `.md` files

### Files Modified
- `src/sdk/ca-base/ca.ts` - Remove cosmos initialization
- `src/sdk/ca-base/requestHandlers/bridge.ts` - Remove V1 path
- `src/sdk/ca-base/utils/api.utils.ts` - Remove VSC functions
- `src/sdk/ca-base/utils/balance.utils.ts` - Remove V1 conditional
- `src/sdk/ca-base/config.ts` - Simplify config
- `src/sdk/index.ts` - Remove V1/V2 conditional
- `package.json` - Remove cosmos deps
- `test-app/src/components/BridgeUI.tsx` - Use Anvil key

### Files Created
- `src/sdk/ca-base/utils/mocks.ts` - Mocked fees/oracle/solvers
- `docs/V2_FLOW.md` - Architecture diagram
- `docs/MOCKED_FEATURES.md` - What's mocked

### Dependencies Removed
- `@cosmjs/proto-signing`
- `@cosmjs/stargate`
- `@starkware-industries/starkware-crypto-utils`
- `msgpackr` (if unused)
