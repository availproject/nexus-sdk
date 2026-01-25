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
import { NexusSDK, Network, type NetworkConfig } from '@avail-project/nexus-core';

export const createNexusSDK = () => {
  // Option 1: Use string shorthand for standard networks (mainnet, canary, testnet)
  // Note: This defaults to V1 middleware. For V2, use Option 2.
  // const sdk = new NexusSDK({ network: 'mainnet' });

  // Option 2: Full NetworkConfig for V2 middleware (recommended)
  const networkConfig: NetworkConfig = {
    COSMOS_URL: 'https://cosmos-mainnet.availproject.org',
    EXPLORER_URL: 'https://nexus-explorer.availproject.org',
    GRPC_URL: 'https://grpcproxy-mainnet.availproject.org',
    NETWORK_HINT: Network.JADE,
    VSC_DOMAIN: 'vsc-mainnet.availproject.org',
    STATEKEEPER_URL: 'http://localhost:9080',
    MIDDLEWARE_URL: process.env.NEXT_PUBLIC_MIDDLEWARE_URL || 'http://localhost:3000',
    useV2Middleware: true,  // Enable V2 middleware
  };

  const sdk = new NexusSDK({
    network: networkConfig,
    debug: process.env.NODE_ENV === 'development',
  });

  return sdk;
};
```

**For Testnet (Folly):**

```typescript
import { NexusSDK, Network, type NetworkConfig } from '@avail-project/nexus-core';

const networkConfig: NetworkConfig = {
  COSMOS_URL: 'https://cosmos04-dev.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus-folly.availproject.org',
  GRPC_URL: 'https://grpc-folly.arcana.network',
  NETWORK_HINT: Network.FOLLY,
  VSC_DOMAIN: 'vsc1-folly.arcana.network',
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: process.env.NEXT_PUBLIC_MIDDLEWARE_URL || 'http://localhost:3000',
  useV2Middleware: true,
};

export const createNexusSDK = () => {
  return new NexusSDK({ network: networkConfig, debug: true });
};
```

### 2. Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_MIDDLEWARE_URL=http://localhost:3000
```

### 3. Understanding the SDK Constructor

The `NexusSDK` constructor accepts a configuration object with the following signature:

```typescript
constructor(config?: {
  network?: NexusNetwork;  // 'mainnet' | 'canary' | 'testnet' | NetworkConfig
  debug?: boolean;
  siweChain?: number;
})
```

**Key Points:**
- `network` can be either:
  - A string shorthand: `'mainnet'`, `'canary'`, or `'testnet'` (uses default V1 config)
  - A full `NetworkConfig` object (required for V2 middleware configuration)
- `useV2Middleware` and `MIDDLEWARE_URL` are **NOT** direct constructor parameters
- They are part of the `NetworkConfig` object passed to the `network` parameter
- When using V2 middleware, you must provide a full `NetworkConfig` object

**NetworkConfig Type:**
```typescript
import { Network } from '@avail-project/nexus-core';

type NetworkConfig = {
  COSMOS_URL: string;
  EXPLORER_URL: string;
  GRPC_URL: string;
  NETWORK_HINT: Network;  // Network.JADE, Network.CORAL, or Network.FOLLY
  VSC_DOMAIN: string;
  STATEKEEPER_URL: string;
  MIDDLEWARE_URL: string;
  useV2Middleware?: boolean;  // Set to true for V2
};
```

**Available Network values:**
- `Network.JADE` - Mainnet
- `Network.CORAL` - Canary
- `Network.FOLLY` - Testnet

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
