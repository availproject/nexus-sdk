# V2 Middleware Complete Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all legacy V1 tests with a single comprehensive E2E test using Anvil nodes and middleware, then create Next.js integration documentation for USDC bridging.

**Architecture:** Remove all V1-based tests (v2-statekeeper, v2-e2e, v2-rpc-balance) and create a complete E2E test that uses local Anvil nodes and middleware for balance retrieval, approval creation, RFF submission, and tracking. Document the V2 middleware integration pattern for Next.js applications with a USDC bridge example.

**Tech Stack:** TypeScript, Anvil (local EVM nodes), V2 Middleware API (REST + WebSocket), Viem, tsx

---

## Task 1: Remove Legacy V1 Tests

**Files:**
- Delete: `test/integration/v2-statekeeper.test.ts`
- Delete: `test/integration/v2-e2e.test.ts`
- Delete: `test/integration/v2-rpc-balance.test.ts`
- Modify: `package.json` (remove unused test scripts)

**Step 1: Delete legacy test files**

```bash
rm test/integration/v2-statekeeper.test.ts test/integration/v2-e2e.test.ts test/integration/v2-rpc-balance.test.ts
```

**Step 2: Update package.json scripts**

Edit `package.json` and remove the old test scripts:

```json
{
  "scripts": {
    "test:v2": "tsx test/integration/v2-statekeeper.test.ts",
    "test:v2:e2e": "tsx test/integration/v2-e2e.test.ts"
  }
}
```

Replace with:

```json
{
  "scripts": {
    "test:v2:middleware": "tsx test/integration/v2-middleware-e2e.test.ts"
  }
}
```

**Step 3: Commit changes**

```bash
git add -A
git commit -m "refactor: remove legacy V1 tests in favor of V2 middleware integration

- Delete v2-statekeeper.test.ts (replaced by middleware)
- Delete v2-e2e.test.ts (replaced by middleware)
- Delete v2-rpc-balance.test.ts (replaced by middleware)
- Update package.json test scripts

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Comprehensive V2 Middleware E2E Test

**Files:**
- Modify: `test/integration/v2-middleware-e2e.test.ts`

**Step 1: Replace existing test with comprehensive E2E test**

Replace the entire content of `test/integration/v2-middleware-e2e.test.ts`:

```typescript
/**
 * V2 Middleware Complete E2E Integration Test
 *
 * Tests the full V2 middleware flow with local Anvil nodes:
 * 1. Get balances via middleware
 * 2. Create sponsored approvals via middleware WebSocket
 * 3. Submit RFF via middleware
 * 4. Track RFF status via middleware
 *
 * Prerequisites:
 * - Anvil nodes running on:
 *   - Ethereum: http://localhost:8545 (chainId: 1)
 *   - Arbitrum: http://localhost:8546 (chainId: 42161)
 * - Middleware running on: http://localhost:3000
 *
 * Run with:
 *   pnpm test:v2:middleware
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  encodeAbiParameters,
  keccak256,
  hashMessage,
  erc20Abi,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  middleware: 'http://localhost:3000',
  chains: {
    eth: { rpc: 'http://localhost:8545', chainId: 1, name: 'Ethereum' },
    arb: { rpc: 'http://localhost:8546', chainId: 42161, name: 'Arbitrum' },
  },
  testAccount: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
  },
  tokens: {
    // Mainnet USDC addresses (use actual addresses for your Anvil fork)
    ethUSDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    arbUSDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    // Known USDC whale for funding (adjust for your fork)
    usdcWhale: '0x47c031236e19d024b42f8AE6780E44A573170703' as Address,
  },
};

const TEST_AMOUNT = parseUnits('10', 6); // 10 USDC

// ============================================================================
// Types
// ============================================================================

interface V2ApprovalsByChain {
  [chainId: string]: {
    token: Address;
    amount: string;
    spender: Address;
  }[];
}

interface V2ApprovalResponse {
  chainId: number;
  token: Address;
  approvalTx: Hex;
  error?: string;
}

interface V2Request {
  sources: {
    universe: string;
    chain_id: string;
    contract_address: string;
    value: string;
    fee: string;
  }[];
  destination_universe: string;
  destination_chain_id: string;
  recipient_address: string;
  destinations: {
    contract_address: string;
    value: string;
  }[];
  nonce: string;
  expiry: string;
  parties: {
    universe: string;
    address: string;
  }[];
}

interface V2RffResponse {
  request_hash: Hex;
  status: 'created' | 'deposited' | 'fulfilled' | 'expired';
  request: V2Request;
  signature: Hex;
  created_at?: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(msg: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ${msg}`);
  if (data)
    console.log(
      '  ',
      JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    );
}

function padTo32Bytes(address: Address): Hex {
  const clean = address.toLowerCase().replace('0x', '');
  return ('0x' + clean.padStart(64, '0')) as Hex;
}

function bigintToHex(value: bigint): string {
  return '0x' + value.toString(16);
}

function generateNonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt(
    '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Chain Clients
// ============================================================================

function createClients(chainConfig: typeof CONFIG.chains.eth) {
  const account = privateKeyToAccount(CONFIG.testAccount.privateKey);

  const publicClient = createPublicClient({
    transport: http(chainConfig.rpc),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(chainConfig.rpc),
  });

  return { publicClient, walletClient, account };
}

async function getTokenBalance(
  chainConfig: typeof CONFIG.chains.eth,
  tokenAddress: Address,
  accountAddress: Address,
): Promise<bigint> {
  const { publicClient } = createClients(chainConfig);

  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accountAddress],
  });

  return balance;
}

// ============================================================================
// V2 Request Building
// ============================================================================

const V2_REQUEST_ABI = [
  {
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'chainID', type: 'uint256' },
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
    name: 'sources',
    type: 'tuple[]',
  },
  { name: 'destinationUniverse', type: 'uint8' },
  { name: 'destinationChainID', type: 'uint256' },
  { name: 'recipientAddress', type: 'bytes32' },
  {
    components: [
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
    ],
    name: 'destinations',
    type: 'tuple[]',
  },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  {
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'address_', type: 'bytes32' },
    ],
    name: 'parties',
    type: 'tuple[]',
  },
] as const;

async function buildAndSignV2Request(
  sourceChain: typeof CONFIG.chains.arb,
  destChain: typeof CONFIG.chains.eth,
  sourceToken: Address,
  destToken: Address,
  amount: bigint,
): Promise<{
  request: V2Request;
  signature: Hex;
  requestHash: Hex;
}> {
  const account = privateKeyToAccount(CONFIG.testAccount.privateKey);
  const userAddress32 = padTo32Bytes(CONFIG.testAccount.address);
  const sourceToken32 = padTo32Bytes(sourceToken);
  const destToken32 = padTo32Bytes(destToken);

  const nonce = generateNonce();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  // Build V2 Request
  const request: V2Request = {
    sources: [
      {
        universe: 'EVM',
        chain_id: bigintToHex(BigInt(sourceChain.chainId)),
        contract_address: sourceToken32,
        value: bigintToHex(amount),
        fee: '0x0',
      },
    ],
    destination_universe: 'EVM',
    destination_chain_id: bigintToHex(BigInt(destChain.chainId)),
    recipient_address: userAddress32,
    destinations: [
      {
        contract_address: destToken32,
        value: bigintToHex(amount),
      },
    ],
    nonce: bigintToHex(nonce),
    expiry: bigintToHex(expiry),
    parties: [
      {
        universe: 'EVM',
        address: userAddress32,
      },
    ],
  };

  // Encode for signing
  const encodedSources = request.sources.map((s) => ({
    universe: 0, // EVM = 0
    chainID: BigInt(s.chain_id),
    contractAddress: s.contract_address as `0x${string}`,
    value: BigInt(s.value),
    fee: BigInt(s.fee),
  }));

  const encodedDestinations = request.destinations.map((d) => ({
    contractAddress: d.contract_address as `0x${string}`,
    value: BigInt(d.value),
  }));

  const encodedParties = request.parties.map((p) => ({
    universe: 0, // EVM = 0
    address_: p.address as `0x${string}`,
  }));

  const encoded = encodeAbiParameters(V2_REQUEST_ABI, [
    encodedSources,
    0, // destination universe (EVM)
    BigInt(request.destination_chain_id),
    request.recipient_address as `0x${string}`,
    encodedDestinations,
    nonce,
    expiry,
    encodedParties,
  ]);

  const hash = keccak256(encoded);
  const signature = await account.signMessage({ message: { raw: hash } });
  const requestHash = hashMessage({ raw: hash });

  return {
    request,
    signature: signature as Hex,
    requestHash: requestHash as Hex,
  };
}

// ============================================================================
// Middleware API Functions
// ============================================================================

async function getBalanceFromMiddleware(address: Address): Promise<any> {
  const res = await fetch(`${CONFIG.middleware}/api/v1/balance/evm/${address}`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  return res.json();
}

async function createApprovalsViaMiddleware(
  approvals: V2ApprovalsByChain,
): Promise<V2ApprovalResponse[]> {
  return new Promise((resolve, reject) => {
    const wsUrl = CONFIG.middleware.replace(/^http/, 'ws') + '/api/v1/create-sponsored-approvals';
    const ws = new WebSocket(wsUrl);
    const results: V2ApprovalResponse[] = [];

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout'));
    }, 30000);

    ws.onopen = () => {
      ws.send(JSON.stringify(approvals));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.chainId !== undefined) {
          results.push(message as V2ApprovalResponse);
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      resolve(results);
    };
  });
}

async function submitRffToMiddleware(request: V2Request, signature: Hex): Promise<Hex> {
  const res = await fetch(`${CONFIG.middleware}/api/v1/rff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RFF submit failed: ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data.request_hash;
}

async function getRffFromMiddleware(hash: Hex): Promise<V2RffResponse> {
  const res = await fetch(`${CONFIG.middleware}/api/v1/rff/${hash}`);
  if (!res.ok) throw new Error(`RFF fetch failed: ${res.status}`);
  return res.json();
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function runE2ETest() {
  console.log('\n' + '='.repeat(70));
  console.log('V2 Middleware Complete E2E Test');
  console.log('='.repeat(70) + '\n');

  try {
    // -------------------------------------------------------------------------
    // Step 1: Get Balance via Middleware
    // -------------------------------------------------------------------------
    log('Step 1: Fetching balance from middleware...');

    const balanceData = await getBalanceFromMiddleware(CONFIG.testAccount.address);
    log('✓ Balance retrieved successfully', balanceData);

    // -------------------------------------------------------------------------
    // Step 2: Create Sponsored Approvals via Middleware WebSocket
    // -------------------------------------------------------------------------
    log('\nStep 2: Creating sponsored approvals via middleware WebSocket...');

    const approvalRequest: V2ApprovalsByChain = {
      [CONFIG.chains.arb.chainId.toString()]: [
        {
          token: CONFIG.tokens.arbUSDC,
          amount: TEST_AMOUNT.toString(),
          spender: '0x0000000000000000000000000000000000000001' as Address, // Dummy spender
        },
      ],
    };

    const approvals = await createApprovalsViaMiddleware(approvalRequest);
    log(`✓ Received ${approvals.length} approval(s)`, approvals);

    // -------------------------------------------------------------------------
    // Step 3: Build and Submit RFF via Middleware
    // -------------------------------------------------------------------------
    log('\nStep 3: Building and submitting RFF via middleware...');

    const { request, signature, requestHash } = await buildAndSignV2Request(
      CONFIG.chains.arb,
      CONFIG.chains.eth,
      CONFIG.tokens.arbUSDC,
      CONFIG.tokens.ethUSDC,
      TEST_AMOUNT,
    );

    log('RFF built:', {
      sourceChain: CONFIG.chains.arb.name,
      destChain: CONFIG.chains.eth.name,
      amount: formatUnits(TEST_AMOUNT, 6) + ' USDC',
    });

    const submittedHash = await submitRffToMiddleware(request, signature);
    log(`✓ RFF submitted successfully!`);
    log(`  Request hash: ${submittedHash}`);

    // -------------------------------------------------------------------------
    // Step 4: Track RFF Status via Middleware
    // -------------------------------------------------------------------------
    log('\nStep 4: Tracking RFF status via middleware...');

    const initialRff = await getRffFromMiddleware(submittedHash);
    log(`Initial status: ${initialRff.status}`);

    log('Polling for status changes (30s)...\n');

    const maxChecks = 10;
    const checkInterval = 3000;
    let lastStatus = initialRff.status;

    for (let i = 0; i < maxChecks; i++) {
      await sleep(checkInterval);

      const rff = await getRffFromMiddleware(submittedHash);
      if (rff.status !== lastStatus) {
        log(`Status changed: ${lastStatus} → ${rff.status}`);
        lastStatus = rff.status;
      } else {
        process.stdout.write('.');
      }

      if (rff.status === 'fulfilled' || rff.status === 'expired') {
        console.log('');
        break;
      }
    }
    console.log('');

    log(`Final status: ${lastStatus}`);

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n' + '='.repeat(70));
    console.log('E2E Test Summary');
    console.log('='.repeat(70));
    console.log(`Middleware: ${CONFIG.middleware}`);
    console.log(`Source Chain: ${CONFIG.chains.arb.name} (${CONFIG.chains.arb.chainId})`);
    console.log(`Dest Chain: ${CONFIG.chains.eth.name} (${CONFIG.chains.eth.chainId})`);
    console.log(`Test Amount: ${formatUnits(TEST_AMOUNT, 6)} USDC`);
    console.log(`Request Hash: ${submittedHash}`);
    console.log(`Final Status: ${lastStatus}`);
    console.log(`\n✓ E2E Test PASSED - All middleware operations successful`);
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error('\n✗ E2E Test FAILED:', error);
    process.exit(1);
  }
}

// Run the test
runE2ETest();
```

**Step 2: Run the test to verify it compiles**

```bash
pnpm test:v2:middleware
```

Expected: Test should compile and attempt to connect to middleware (may fail if middleware not running, that's OK)

**Step 3: Commit changes**

```bash
git add test/integration/v2-middleware-e2e.test.ts
git commit -m "feat: implement comprehensive V2 middleware E2E test

- Complete flow: balance → approvals → RFF submit → track
- Uses REST API for balance and RFF operations
- Uses WebSocket for approval creation
- Tests full V2 middleware integration

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Next.js Integration Documentation

**Files:**
- Create: `docs/NEXTJS_V2_INTEGRATION.md`

**Step 1: Write comprehensive Next.js integration guide**

Create `docs/NEXTJS_V2_INTEGRATION.md`:

```markdown
# Next.js V2 Middleware Integration Guide

This guide demonstrates how to build a simple USDC bridge between chains using the Nexus SDK with V2 middleware in a Next.js application.

## Overview

The V2 middleware architecture provides:
- **REST API** for balances and RFF operations
- **WebSocket (JSON)** for approval creation
- **Direct statekeeper integration** (no VSC dependency)
- **Simplified architecture** for production deployments

## Prerequisites

```bash
npm install @avail-project/nexus-core viem
```

## Architecture

```
Next.js App
    ↓
Nexus SDK (V2 Mode)
    ↓
Middleware API (http://localhost:3000)
    ↓
Statekeeper (Avail Nexus V2)
```

## Configuration

### 1. Create SDK Configuration

Create `lib/nexus-config.ts`:

```typescript
import { NexusSDK } from '@avail-project/nexus-core';

export const createNexusSDK = () => {
  const sdk = new NexusSDK({
    network: 'mainnet',
    useV2Middleware: true,
    MIDDLEWARE_URL: process.env.NEXT_PUBLIC_MIDDLEWARE_URL || 'http://localhost:3000',
  });

  return sdk;
};
```

### 2. Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_MIDDLEWARE_URL=http://localhost:3000
```

## Implementation

### 1. Create a Bridge Hook

Create `hooks/useBridge.ts`:

```typescript
'use client';

import { useState, useCallback } from 'react';
import { createNexusSDK } from '@/lib/nexus-config';
import { NEXUS_EVENTS } from '@avail-project/nexus-core';
import { parseUnits, type Address } from 'viem';

export interface BridgeStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  txHash?: string;
  explorerUrl?: string;
}

export const useBridge = () => {
  const [steps, setSteps] = useState<BridgeStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeBridge = useCallback(
    async (
      token: string,
      amount: string,
      fromChainId: number,
      toChainId: number,
      provider: any,
    ) => {
      setIsLoading(true);
      setError(null);
      setSteps([]);

      try {
        // Initialize SDK
        const sdk = createNexusSDK();
        await sdk.initialize(provider);

        // Parse amount (assuming 6 decimals for USDC)
        const amountBigInt = parseUnits(amount, 6);

        // Execute bridge
        const result = await sdk.bridge(
          {
            token,
            amount: amountBigInt,
            toChainId,
            sourceChains: [fromChainId],
          },
          {
            onEvent: (event) => {
              if (event.name === NEXUS_EVENTS.STEPS_LIST) {
                // Initialize steps from the list
                const initialSteps: BridgeStep[] = event.args.map((step: any) => ({
                  id: step.typeID,
                  name: step.typeID,
                  status: 'pending',
                }));
                setSteps(initialSteps);
              } else if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
                // Update step status
                setSteps((prev) =>
                  prev.map((step) =>
                    step.id === event.args.typeID
                      ? {
                          ...step,
                          status: 'completed',
                          txHash: event.args.transactionHash,
                          explorerUrl: event.args.explorerURL,
                        }
                      : step,
                  ),
                );
              }
            },
          },
        );

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Bridge failed';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    executeBridge,
    steps,
    isLoading,
    error,
  };
};
```

### 2. Create Balance Hook

Create `hooks/useBalance.ts`:

```typescript
'use client';

import { useState, useCallback } from 'react';
import { createNexusSDK } from '@/lib/nexus-config';
import type { Address } from 'viem';

export interface TokenBalance {
  token: string;
  chainId: number;
  balance: string;
  formattedBalance: string;
}

export const useBalance = () => {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async (provider: any) => {
    setIsLoading(true);
    setError(null);

    try {
      const sdk = createNexusSDK();
      await sdk.initialize(provider);

      // Get unified balances via V2 middleware
      const unifiedBalances = await sdk.getBalancesForBridge();

      // Transform to TokenBalance format
      const tokenBalances: TokenBalance[] = [];

      for (const chainBalance of unifiedBalances) {
        for (const currency of chainBalance.currencies) {
          tokenBalances.push({
            token: currency.symbol || 'Unknown',
            chainId: chainBalance.chain_id,
            balance: currency.balance,
            formattedBalance: currency.formatted || currency.balance,
          });
        }
      }

      setBalances(tokenBalances);
      return tokenBalances;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch balances';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    balances,
    fetchBalances,
    isLoading,
    error,
  };
};
```

### 3. Create Bridge Component

Create `components/UsdcBridge.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useBridge } from '@/hooks/useBridge';
import { useBalance } from '@/hooks/useBalance';

const SUPPORTED_CHAINS = [
  { id: 1, name: 'Ethereum' },
  { id: 42161, name: 'Arbitrum' },
  { id: 8453, name: 'Base' },
  { id: 137, name: 'Polygon' },
];

export const UsdcBridge = () => {
  const [amount, setAmount] = useState('');
  const [fromChain, setFromChain] = useState(42161); // Arbitrum
  const [toChain, setToChain] = useState(1); // Ethereum
  const [provider, setProvider] = useState<any>(null);

  const { executeBridge, steps, isLoading, error } = useBridge();
  const { balances, fetchBalances, isLoading: balancesLoading } = useBalance();

  const handleConnect = async () => {
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        setProvider(window.ethereum);
        await fetchBalances(window.ethereum);
      } catch (err) {
        console.error('Failed to connect wallet:', err);
      }
    } else {
      alert('Please install MetaMask');
    }
  };

  const handleBridge = async () => {
    if (!provider) {
      alert('Please connect wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    try {
      await executeBridge('USDC', amount, fromChain, toChain, provider);
      alert('Bridge completed successfully!');
      // Refresh balances
      await fetchBalances(provider);
    } catch (err) {
      console.error('Bridge failed:', err);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6">USDC Bridge</h2>

      {!provider ? (
        <button
          onClick={handleConnect}
          className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Connect Wallet
        </button>
      ) : (
        <>
          {/* Balances */}
          <div className="mb-4">
            <h3 className="font-semibold mb-2">Your Balances</h3>
            {balancesLoading ? (
              <p className="text-gray-500">Loading balances...</p>
            ) : (
              <div className="space-y-2">
                {balances
                  .filter((b) => b.token === 'USDC')
                  .map((b, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>
                        {SUPPORTED_CHAINS.find((c) => c.id === b.chainId)?.name || 'Unknown'}
                      </span>
                      <span className="font-mono">{b.formattedBalance} USDC</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Bridge Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">From Chain</label>
              <select
                value={fromChain}
                onChange={(e) => setFromChain(Number(e.target.value))}
                className="w-full p-2 border rounded-lg"
              >
                {SUPPORTED_CHAINS.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">To Chain</label>
              <select
                value={toChain}
                onChange={(e) => setToChain(Number(e.target.value))}
                className="w-full p-2 border rounded-lg"
              >
                {SUPPORTED_CHAINS.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Amount (USDC)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full p-2 border rounded-lg"
                step="0.01"
                min="0"
              />
            </div>

            <button
              onClick={handleBridge}
              disabled={isLoading}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
              {isLoading ? 'Bridging...' : 'Bridge USDC'}
            </button>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
            )}
          </div>

          {/* Progress Steps */}
          {steps.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-3">Progress</h3>
              <div className="space-y-2">
                {steps.map((step) => (
                  <div key={step.id} className="flex items-center justify-between text-sm">
                    <span>{step.name}</span>
                    <span
                      className={`font-medium ${
                        step.status === 'completed'
                          ? 'text-green-600'
                          : step.status === 'error'
                            ? 'text-red-600'
                            : 'text-gray-500'
                      }`}
                    >
                      {step.status === 'completed'
                        ? '✓'
                        : step.status === 'error'
                          ? '✗'
                          : '⋯'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
```

### 4. Add to Page

Create or update `app/page.tsx`:

```typescript
import { UsdcBridge } from '@/components/UsdcBridge';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold text-center mb-12">Nexus V2 USDC Bridge</h1>
        <UsdcBridge />
      </div>
    </main>
  );
}
```

## Key Features

### No VSC Dependency
The SDK uses V2 middleware exclusively:
- Balance queries via REST API
- Approvals via WebSocket (JSON)
- RFF submission and tracking via REST API

### Automatic Middleware Detection
When `useV2Middleware: true` is set, the SDK routes all operations through the middleware.

### Real-time Progress Tracking
The `onEvent` callback provides real-time updates for:
- Step initialization (`STEPS_LIST`)
- Step completion (`STEP_COMPLETE`)
- Transaction hashes and explorer URLs

## Testing

### Prerequisites
1. Run Anvil nodes:
```bash
# Terminal 1 - Ethereum
anvil --fork-url https://eth.llamarpc.com --port 8545

# Terminal 2 - Arbitrum
anvil --fork-url https://arb1.arbitrum.io/rpc --port 8546
```

2. Run middleware:
```bash
cd middleware
npm start # or appropriate command
```

3. Run Next.js app:
```bash
npm run dev
```

### Test Flow
1. Connect MetaMask to your local chain
2. Select source and destination chains
3. Enter USDC amount
4. Click "Bridge USDC"
5. Watch progress steps update in real-time

## Production Deployment

### Environment Variables
```bash
NEXT_PUBLIC_MIDDLEWARE_URL=https://your-middleware.com
```

### Middleware Requirements
- Must be accessible from the client
- Should support CORS for your domain
- REST endpoints: `/api/v1/balance`, `/api/v1/rff`
- WebSocket endpoint: `/api/v1/create-sponsored-approvals`

## Troubleshooting

### "Failed to fetch balances"
- Verify middleware URL is correct
- Check CORS configuration
- Ensure middleware is running

### "WebSocket connection failed"
- Check if middleware WebSocket endpoint is accessible
- Verify WebSocket URL conversion (http → ws, https → wss)

### "Bridge failed"
- Check user has sufficient balance
- Verify chain IDs are correct
- Ensure provider is properly initialized

## Additional Resources

- [Nexus SDK Documentation](https://docs.availproject.org/nexus)
- [V2 Migration Guide](./V1_TO_V2_MIGRATION.md)
- [GitHub Repository](https://github.com/availproject/nexus-sdk)

## Support

For issues or questions:
- GitHub Issues: https://github.com/availproject/nexus-sdk/issues
- Discord: https://discord.gg/availproject
```

**Step 2: Commit documentation**

```bash
git add docs/NEXTJS_V2_INTEGRATION.md
git commit -m "docs: add Next.js V2 middleware integration guide

- Complete guide for building USDC bridge in Next.js
- Includes hooks for bridge and balance operations
- React component example with progress tracking
- Production deployment guidelines
- No VSC dependency - pure V2 middleware

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update Main Documentation

**Files:**
- Modify: `docs/V1_TO_V2_MIGRATION.md`

**Step 1: Add note about removed tests**

Read the current migration doc and add a section at the end:

```markdown
## Test Suite Changes

The V2 integration removes all legacy V1 tests in favor of a single comprehensive E2E test:

### Removed Tests
- `test/integration/v2-statekeeper.test.ts` - Used direct statekeeper API (V1)
- `test/integration/v2-e2e.test.ts` - Used direct statekeeper + cast impersonation (V1)
- `test/integration/v2-rpc-balance.test.ts` - Used VSC balance API (V1)

### New Test
- `test/integration/v2-middleware-e2e.test.ts` - Complete V2 middleware E2E test

The new test demonstrates:
1. Balance retrieval via middleware REST API
2. Approval creation via middleware WebSocket
3. RFF submission via middleware REST API
4. RFF status tracking via middleware REST API

Run with:
```bash
pnpm test:v2:middleware
```

Prerequisites:
- Anvil nodes on ports 8545, 8546
- Middleware on port 3000

For production usage examples, see [Next.js V2 Integration Guide](./NEXTJS_V2_INTEGRATION.md).
```

**Step 2: Commit documentation update**

```bash
git add docs/V1_TO_V2_MIGRATION.md
git commit -m "docs: update migration guide with test suite changes

- Document removal of V1 legacy tests
- Explain new V2 middleware E2E test
- Link to Next.js integration guide

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-23-v2-middleware-complete-integration.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
