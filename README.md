# Avail Nexus SDK

A powerful TypeScript SDK for cross-chain operations, token bridging, and unified balance management across multiple EVM chains. It provides a simplified interface for complex cross-chain interactions.

## Installation

```bash
npm install @avail-project/nexus@dev
```

## Quick Start

```typescript
import { NexusSDK } from '@avail-project/nexus';

// Initialize SDK
const sdk = new NexusSDK();
await sdk.initialize(provider); // Your Web3 provider

// Or initialize with specific network environment
const nexusSdk = new NexusSDK({
  network: 'testnet', // Testnet
});
await nexusSdk.initialize(provider);

// Get unified balances
const balances = await sdk.getUnifiedBalances();
console.log('All balances:', balances);

// Bridge tokens
const bridgeResult = await sdk.bridge({
  token: 'USDC',
  amount: 100,
  chainId: 137, // to Polygon
});

// Transfer tokens
const transferResult = await sdk.transfer({
  token: 'ETH',
  amount: 0.1,
  chainId: 1,
  recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
});

// Execute smart contract interactions
const executeResult = await sdk.execute({
  toChainId: 1,
  contractAddress: '0x...',
  contractAbi: [...],
  functionName: 'deposit',
  functionParams: [amount, userAddress],
});
```

## Core Features

- 🔄 **Cross-chain bridging** - Seamless token bridging between 16 chains
- 💰 **Unified balances** - Aggregated portfolio view across all chains
- 🔐 **Allowance management** - Efficient token approval handling
- 🌉 **Direct transfers** - Send tokens to any address on any chain
- ⚡ **Smart execution** - Direct smart contract interactions
- 🧪 **Full testnet support** - Complete development environment
- 📊 **Transaction simulation** - Preview costs before execution
- 🛠️ **Rich utilities** - Address validation, formatting, and metadata

## Supported Networks & Tokens

### Mainnet Chains

| Network   | Chain ID | Native Currency | Status |
| --------- | -------- | --------------- | ------ |
| Ethereum  | 1        | ETH             | ✅     |
| Optimism  | 10       | ETH             | ✅     |
| Polygon   | 137      | MATIC           | ✅     |
| Arbitrum  | 42161    | ETH             | ✅     |
| Avalanche | 43114    | AVAX            | ✅     |
| Base      | 8453     | ETH             | ✅     |
| Scroll    | 534352   | ETH             | ✅     |

### Testnet Chains

| Network          | Chain ID | Native Currency | Status |
| ---------------- | -------- | --------------- | ------ |
| Optimism Sepolia | 11155420 | ETH             | ✅     |
| Polygon Amoy     | 80002    | MATIC           | ✅     |
| Arbitrum Sepolia | 421614   | ETH             | ✅     |
| Base Sepolia     | 84532    | ETH             | ✅     |

### Supported Tokens

| Token | Name       | Decimals | Networks       |
| ----- | ---------- | -------- | -------------- |
| ETH   | Ethereum   | 18       | All EVM chains |
| USDC  | USD Coin   | 6        | All supported  |
| USDT  | Tether USD | 6        | All supported  |

## React UI Components (Widget Library) 🚀

The SDK ships with a React widget suite that lets you embed complete cross-chain flows in **three simple steps**.

### 1️⃣ Wrap your app with `NexusProvider`

```tsx
import { NexusProvider } from '@avail-project/nexus';

export default function Root() {
  return (
    <NexusProvider
      config={{
        network: 'testnet', // "mainnet" (default) or "testnet"
      }}
    >
      <App />
    </NexusProvider>
  );
}
```

### 2️⃣ Forward the user's wallet provider

```tsx
import { useEffect } from 'react';
import { useAccount } from '@wagmi/react'; // any wallet lib works
import { useNexus } from '@avail-project/nexus';

export function WalletBridge() {
  const { connector, isConnected } = useAccount();
  const { setProvider } = useNexus();

  useEffect(() => {
    if (isConnected && connector?.getProvider) {
      connector.getProvider().then(setProvider);
    }
  }, [isConnected, connector, setProvider]);

  return null;
}
```

### 3️⃣ Drop a widget into your UI

```tsx
import {
  BridgeButton,
  TransferButton,
  BridgeAndExecuteButton,
} from '@avail-project/nexus';

/*  Bridge ----------------------------------------------------------- */
<BridgeButton prefill={{ chainId: 137, token: 'USDC', amount: '100' }}>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? 'Bridging…' : 'Bridge 100 USDC → Polygon'}
    </button>
  )}
</BridgeButton>

/*  Transfer --------------------------------------------------------- */
<TransferButton>
  {({ onClick }) => <YourStyledBtn onClick={onClick}>Send Funds</YourStyledBtn>}
</TransferButton>

/*  Bridge + Execute ------------------------------------------------- */
import aavePoolAbi from './abi/aavePool.json';

const buildParams = (token, amount, chainId, userAddress) => ({
  functionParams: [token, amount, userAddress, 0],
  value: '0',
});

<BridgeAndExecuteButton
  contractAddress="0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf"
  contractAbi={aavePoolAbi}
  functionName="supply"
  buildFunctionParams={buildParams}
  prefill={{ toChainId: 1, token: 'USDC' }}
>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? 'Working…' : 'Bridge & Supply'}
    </button>
  )}
</BridgeAndExecuteButton>
```

---

### Public widget APIs

#### `BridgeButton`

```ts
interface BridgeButtonProps {
  prefill?: Partial<BridgeParams>; // chainId, token, amount
  className?: string;
  children(props: { onClick(): void; isLoading: boolean }): React.ReactNode;
}
```

#### `TransferButton`

```ts
interface TransferButtonProps {
  prefill?: Partial<TransferParams>; // chainId, token, amount, recipient
  className?: string;
  children(props: { onClick(): void; isLoading: boolean }): React.ReactNode;
}
```

#### `BridgeAndExecuteButton`

```ts
type DynamicParamBuilder = (
  token: SUPPORTED_TOKENS,
  amount: string,
  chainId: SUPPORTED_CHAINS_IDS,
  userAddress: `0x${string}`,
) => {
  functionParams: readonly unknown[];
  value?: string; // wei; defaults to "0"
};

interface BridgeAndExecuteButtonProps {
  contractAddress: `0x${string}`; // REQUIRED
  contractAbi: Abi; // REQUIRED
  functionName: string; // REQUIRED
  buildFunctionParams: DynamicParamBuilder; // REQUIRED
  prefill?: { toChainId?: number; token?: SUPPORTED_TOKENS; amount?: string };
  className?: string;
  children(props: { onClick(): void; isLoading: boolean; disabled: boolean }): React.ReactNode;
}
```

`buildFunctionParams` receives the validated UX input (token, amount, destination chainId) plus the **connected wallet address** and must return the encoded `functionParams` (and optional ETH `value`) used in the destination call.  
The library then:

1. Bridges the asset to `toChainId`.
2. Sets ERC-20 allowance if required.
3. Executes `contractAddress.functionName(functionParams, { value })`.

##### Prefill behaviour

| Widget                   | Supported keys                            | Locked in UI |
| ------------------------ | ----------------------------------------- | ------------ |
| `BridgeButton`           | `chainId`, `token`, `amount`              | ✅           |
| `TransferButton`         | `chainId`, `token`, `amount`, `recipient` | ✅           |
| `BridgeAndExecuteButton` | `toChainId`, `token`, `amount`            | ✅           |

Values passed in `prefill` appear as **read-only** fields, enforcing your desired flow.

---

## API Reference

### Initialization

```typescript
import type { NexusNetwork } from '@avail-project/nexus';

// Mainnet (default)
const sdk = new NexusSDK();

// Testnet
const sdk = new NexusSDK({ network: 'testnet' as NexusNetwork });

// Initialize with provider (required)
await sdk.initialize(window.ethereum); // Returns: Promise<void>
```

### Balance Operations

```typescript
import type { UserAsset, TokenBalance } from '@avail-project/nexus';

// Get all balances across chains
const balances: UserAsset[] = await sdk.getUnifiedBalances();

// Get balance for specific token
const usdcBalance: UserAsset | undefined = await sdk.getUnifiedBalance('USDC');
```

### Bridge Operations

```typescript
import type { BridgeParams, BridgeResult, SimulationResult } from '@avail-project/nexus';

// Bridge tokens between chains
const result: BridgeResult = await sdk.bridge({
  token: 'USDC',
  amount: 100,
  chainId: 137,
} as BridgeParams);

// Simulate bridge to preview costs
const simulation: SimulationResult = await sdk.simulateBridge({
  token: 'USDC',
  amount: 100,
  chainId: 137,
});
```

### Transfer Operations

```typescript
import type { TransferParams, TransferResult } from '@avail-project/nexus';

// Transfer to specific recipient
const result: TransferResult = await sdk.transfer({
  token: 'ETH',
  amount: 0.1,
  chainId: 1,
  recipient: '0x...',
} as TransferParams);

// Simulate transfer to preview costs
const simulation: SimulationResult = await sdk.simulateTransfer(transferParams);
```

### Execute Operations

```typescript
import type {
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
} from '@avail-project/nexus';

// Execute contract functions
const result: ExecuteResult = await sdk.execute({
  toChainId: 1,
  contractAddress: '0x...',
  contractAbi: abi,
  functionName: 'deposit',
  functionParams: [amount],
  waitForReceipt: true,
  requiredConfirmations: 3,
  tokenApproval: {
    token: 'USDC',
    amount: '1000000', // Amount in token units
  },
} as ExecuteParams);

// Simulate execute to preview costs and check for approval requirements
const simulation: ExecuteSimulation = await sdk.simulateExecute(executeParams);
if (!simulation.success) {
  console.log('Simulation failed:', simulation.error);
  // Error might indicate missing token approval
}

// Bridge tokens and execute contract function
const bridgeAndExecuteResult: BridgeAndExecuteResult = await sdk.bridgeAndExecute({
  fromChainId: 137, // Polygon
  toChainId: 1, // Ethereum
  token: 'USDC',
  amount: '100000000', // 100 USDC (6 decimals)
  recipient: userAddress,
  execute: {
    contractAddress: '0xAavePoolAddress',
    contractAbi: aavePoolAbi,
    functionName: 'supply',
    functionParams: [usdcTokenAddress, '100000000', userAddress, 0],
    tokenApproval: {
      token: 'USDC',
      amount: '100000000',
    },
  },
  waitForReceipt: true,
} as BridgeAndExecuteParams);

// Comprehensive simulation with detailed step analysis and approval handling
const simulation: BridgeAndExecuteSimulationResult = await sdk.simulateBridgeAndExecute(params);

// The simulation provides detailed step analysis:
console.log('Steps:', simulation.steps);
// [
//   { type: 'bridge', gasUsed: '150000', success: true },
//   { type: 'approval', gasUsed: '45000', success: true },
//   { type: 'execute', gasUsed: '200000', success: true }
// ]

console.log('Total estimated cost:', simulation.totalEstimatedCost);
// {
//   eth: "0.012",
//   breakdown: {
//     bridge: "0.005",
//     approval: "0.002",
//     execute: "0.005"
//   }
// }

console.log('Approval required:', simulation.metadata?.approvalRequired);
console.log('Bridge receive amount:', simulation.metadata?.bridgeReceiveAmount);
```

### Allowance Management

```typescript
import type { AllowanceResponse } from '@avail-project/nexus';

// Check allowances
const allowances: AllowanceResponse[] = await sdk.getAllowance(137, ['USDC', 'USDT']);

// Set allowances
await sdk.setAllowance(137, ['USDC'], 1000000n);

// Revoke allowances
await sdk.revokeAllowance(137, ['USDC']);
```

### Intent Management

```typescript
import type { RequestForFunds } from '@avail-project/nexus';

// Get user's transaction intents
const intents: RequestForFunds[] = await sdk.getMyIntents(1);
```

### Utilities

All utility functions are available under `sdk.utils`:

```typescript
import type { ChainMetadata, TokenMetadata, SUPPORTED_TOKENS } from '@avail-project/nexus';

// Address utilities
const isValid: boolean = sdk.utils.isValidAddress('0x...');
const shortened: string = sdk.utils.truncateAddress('0x...');

// Balance formatting
const formatted: string = sdk.utils.formatBalance('1000000', 6);
const units: bigint = sdk.utils.parseUnits('100.5', 6);
const readable: string = sdk.utils.formatUnits(100500000n, 6);

// Token amount formatting
const formattedAmount: string = sdk.utils.formatTokenAmount('1000000', 'USDC'); // "1.0 USDC"
const testnetFormatted: string = sdk.utils.formatTestnetTokenAmount('1000000', 'USDC'); // "1.0 USDC"

// Chain & token info
const chainMeta: ChainMetadata | undefined = sdk.utils.getChainMetadata(137);
const tokenMeta: TokenMetadata | undefined = sdk.utils.getTokenMetadata('USDC');
const mainnetTokenMeta: TokenMetadata | undefined = sdk.utils.getMainnetTokenMetadata('USDC');
const testnetTokenMeta: TokenMetadata | undefined = sdk.utils.getTestnetTokenMetadata('USDC');

// Chain/token validation
const isSupported: boolean = sdk.utils.isSupportedChain(137);
const isSupportedToken: boolean = sdk.utils.isSupportedToken('USDC');

// Get supported chains
const chains: Array<{ id: number; name: string; logo: string }> = sdk.utils.getSupportedChains();

// Chain ID conversion
const hexChainId: string = sdk.utils.chainIdToHex(137);
const decimalChainId: number = sdk.utils.hexToChainId('0x89');
```

### Event Handling

```typescript
import type { OnIntentHook, OnAllowanceHook, EventListener } from '@avail-project/nexus';

// Intent approval flows
sdk.setOnIntentHook(({ intent, allow, deny, refresh }: Parameters<OnIntentHook>[0]) => {
  // This is a hook for the dev to show user the intent, the sources and associated fees

  // intent: Intent data containing sources and fees for display purpose

  // allow(): accept the current intent and continue the flow

  // deny(): deny the intent and stop the flow

  // refresh(): should be on a timer of 5s to refresh the intent
  // (old intents might fail due to fee changes if not refreshed)
  if (userConfirms) allow();
  else deny();
});

// Allowance approvals
sdk.setOnAllowanceHook(({ allow, deny, sources }: Parameters<OnAllowanceHook>[0]) => {
  // This is a hook for the dev to show user the allowances that need to be setup
  // for the current tx to happen.

  // sources: an array of objects with minAllowance, chainID, token symbol, etc.

  // allow(allowances): continues the transaction flow with `allowances` array
  // allowances.length === sources.length;
  // valid values are "max" | "min" | string | bigint

  // deny(): stops the flow
  allow(['min']); // or ['max'] or custom amounts
});

// Account/chain changes
sdk.onAccountChanged((account) => console.log('Account:', account));
sdk.onChainChanged((chainId) => console.log('Chain:', chainId));
```

#### Bridge & Execute Progress Stream (new in vNEXT)

```typescript
import { NEXUS_EVENTS } from '@avail-project/nexus';
import type { ProgressStep } from '@arcana/ca-sdk';

// 1️⃣  Listen once for all expected steps (array) – call this before bridgeAndExecute()
const unsubscribeExpected = sdk.on(
  NEXUS_EVENTS.BRIDGE_EXECUTE_EXPECTED_STEPS,
  (steps: ProgressStep[]) => {
    // Render your progress bar skeleton here (total steps = steps.length)
    console.log(
      'Expected steps →',
      steps.map((s) => s.typeID),
    );
  },
);

// 2️⃣  Listen for every completed step (single object)
const unsubscribeCompleted = sdk.on(
  NEXUS_EVENTS.BRIDGE_EXECUTE_COMPLETED_STEPS,
  (step: ProgressStep) => {
    // Tick UI when each step finishes or handle errors via step.data.error
    console.log('Completed step →', step.typeID, step.type, step.data);

    if (step.typeID === 'ER') {
      // The operation has failed – display step.data.error
    }
  },
);

// Don't forget to clean up if your component unmounts
return () => {
  unsubscribeExpected();
  unsubscribeCompleted();
};
```

> **Step IDs**
> | ID | Meaning |
> |----|---------------------------------|
> | BR | CA-SDK bridge steps (multiple) |
> | AP | Token approval (virtual) |
> | TS | Execute tx sent (virtual) |
> | RR | Receipt received _(optional)_ |
> | CN | Tx confirmed _(optional)_ |
> | ER | Operation failed (virtual) |

The SDK now emits **exactly two event names** around `bridgeAndExecute()`:

1. `bridge_execute_expected_steps` – _once_ with a full ordered array of `ProgressStep`s.
2. `bridge_execute_completed_steps` – _many_; one per finished step (or error), containing the same `typeID` as in the expected list plus runtime `data` such as `txHash`, `confirmations`, `error`, etc.

This replaces the legacy `BRIDGE_*`, `APPROVAL_*`, `EXECUTE_*`, `OPERATION_*`, and `TRANSFER_*` events.

### Provider Methods

```typescript
import type { EthereumProvider, RequestArguments } from '@avail-project/nexus';

// Get enhanced provider
const provider: EthereumProvider = sdk.getEVMProviderWithCA();

// Make EIP-1193 requests
const result = await sdk.request({
  method: 'eth_accounts',
  params: [],
} as RequestArguments);

// Cleanup
await sdk.deinit();
```

## Usage Examples

### Basic Bridge with Result Handling

```typescript
import { NexusSDK, type BridgeResult } from '@avail-project/nexus';

const sdk = new NexusSDK();
await sdk.initialize(window.ethereum);

try {
  const result: BridgeResult = await sdk.bridge({
    token: 'USDC',
    amount: 100,
    chainId: 137,
  });

  if (result.success) {
    console.log('✅ Bridge successful!');
    if (result.explorerUrl) {
      console.log('View transaction:', result.explorerUrl);
    }
  } else {
    console.error('❌ Bridge failed:', result.error);
  }
} catch (error) {
  console.error('Bridge error:', error);
}
```

### Execute with Receipt Confirmation

```typescript
import type { ExecuteResult } from '@avail-project/nexus';

const result: ExecuteResult = await sdk.execute({
  toChainId: 1,
  contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
  contractAbi: [
    {
      type: 'function',
      name: 'deposit',
      inputs: [
        { name: 'amount', type: 'uint256' },
        { name: 'onBehalfOf', type: 'address' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ],
  functionName: 'deposit',
  functionParams: ['1000000', '0xUserAddress'],
  waitForReceipt: true,
  requiredConfirmations: 3,
});

console.log('Transaction hash:', result.transactionHash);
console.log('Explorer URL:', result.explorerUrl);
console.log('Gas used:', result.gasUsed);
console.log('Confirmations:', result.confirmations);
```

### Bridge and Execute with Error Handling

```typescript
import type { BridgeAndExecuteResult } from '@avail-project/nexus';

try {
  const result: BridgeAndExecuteResult = await sdk.bridgeAndExecute({
    token: 'USDC',
    amount: '1000',
    toChainId: 1,
    execute: {
      contractAddress: '0x...',
      contractAbi: abi,
      functionName: 'deposit',
      functionParams: [amount, userAddress],
    },
    waitForReceipt: true,
  });

  console.log('✅ Bridge and execute completed!');
  if (result.executeTransactionHash) {
    console.log('Execute transaction:', result.executeTransactionHash);
    console.log('View on explorer:', result.executeExplorerUrl);
  }
} catch (error) {
  if (error.message.includes('User denied')) {
    console.log('User cancelled transaction');
  } else if (error.message.includes('Bridge phase failed')) {
    console.error('Bridge failed:', error);
  } else if (error.message.includes('Execute phase failed')) {
    console.error('Execute failed:', error);
  } else {
    console.error('Operation failed:', error);
  }
}
```

### Complete Portfolio Management

```typescript
import type { UserAsset, ChainMetadata } from '@avail-project/nexus';

// Get complete balance overview
const balances: UserAsset[] = await sdk.getUnifiedBalances();

for (const asset of balances) {
  console.log(`\n${asset.symbol}: ${asset.balance}`);
  console.log(`Fiat value: $${asset.balanceInFiat || 0}`);

  if (asset.breakdown) {
    console.log('Chain breakdown:');
    for (const chainBalance of asset.breakdown) {
      const chain: ChainMetadata | undefined = sdk.utils.getChainMetadata(chainBalance.chain.id);
      console.log(`  ${chain?.name}: ${chainBalance.balance}`);
    }
  }
}
```

## Error Handling

```typescript
import type { BridgeResult } from '@avail-project/nexus';

try {
  const result: BridgeResult = await sdk.bridge({ token: 'USDC', amount: 100, chainId: 137 });

  if (!result.success) {
    // Handle bridge failure
    console.error('Bridge failed:', result.error);
  }
} catch (error) {
  if (error.message.includes('User denied')) {
    // User cancelled transaction
  } else if (error.message.includes('Insufficient')) {
    // Insufficient balance
  } else if (error.message.includes('Unsupported')) {
    // Unsupported chain or token
  } else {
    // Other errors
    console.error('Unexpected error:', error);
  }
}
```

## Best Practices

1. **Always simulate first** for gas estimation and validation
2. **Always check for allowances** for tokens
3. **Check return values** - operations return result objects with success/error info
4. **Handle user rejections** gracefully
5. **Use appropriate confirmation levels** based on transaction value
6. **Clean up resources** when component unmounts

```typescript
import type { ExecuteSimulation, ExecuteResult } from '@avail-project/nexus';

// Simulate before executing
const simulation: ExecuteSimulation = await sdk.simulateExecute(params);
if (simulation.success) {
  const result: ExecuteResult = await sdk.execute(params);
}

// Cleanup when done
sdk.removeAllListeners();
await sdk.deinit();
```

## TypeScript Support

The SDK is fully typed with comprehensive TypeScript definitions. Simply import the types you need:

```typescript
import type {
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  SimulationResult,
  UserAsset,
  TokenBalance,
  AllowanceResponse,
  ChainMetadata,
  TokenMetadata,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  EventListener,
  NexusNetwork,
} from '@avail-project/nexus';
```

## Development

```bash
npm run build       # Build package
npm test           # Run tests
npm run lint       # Lint code
```

## Support

- [GitHub Issues](https://github.com/availproject/nexus-sdk/issues)
- [API Documentation](https://docs.availproject.org/nexus-sdk)

## License

MIT
