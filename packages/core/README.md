# @avail-project/nexus/core

A powerful headless TypeScript SDK for cross-chain operations, token bridging, and unified balance management. Perfect for backends, CLIs, and custom UI implementations.

## Installation

```bash
npm install @avail-project/nexus-core
```

## 🚀 Quick Start

```typescript
import { NexusSDK } from '@avail-project/nexus-core';

// Initialize SDK
const sdk = new NexusSDK({ network: 'mainnet' });
await sdk.initialize(provider); // Your wallet provider

// Get unified balances
const balances = await sdk.getUnifiedBalances();
console.log('All balances:', balances);

// Swap tokens (EXACT_IN - specify input amount)

const swapWithExactInInput: ExactInSwapInput = {
  from: [
    {
      chainId: inputData.fromChainID,
      amount: parseUnits(
        fromAmountStr.toString(),
        TOKEN_METADATA[inputData?.fromTokenAddress]?.decimals,
      ),
      tokenAddress: actualFromTokenAddress as `0x${string}`,
    },
  ],
  toChainId: inputData.toChainID,
  toTokenAddress: actualToTokenAddress as `0x${string}`,
};

const swapWithExactInResult = await sdk.swapWithExactIn(swapWithExactInInput, {
  swapIntentHook: async (data: Parameters<SwapIntentHook>[0]) => {},
});

// Swap tokens (EXACT_OUT - only specify destination chain, token and amount)

const swapWithExactOutInput: ExactOutSwapInput = {
  toChainId: inputData.toChainID,
  toTokenAddress: actualToTokenAddress as `0x${string}`,
  toAmount: 0n, // bigint
};

const swapWithExactOutResult = await sdk.swapWithExactOut(swapWithExactOutInput, {
  swapIntentHook: async (data: Parameters<SwapIntentHook>[0]) => {},
});

// Bridge tokens
const bridgeResult = await sdk.bridge({
  token: 'USDC',
  amount: 100,
  chainId: 137, // to Polygon
  sourceChains: [10, 42161], // Only use USDC from optimism and arbitrum as source for bridge
});

// Transfer tokens (automatically optimized)
const transferResult = await sdk.transfer({
  token: 'ETH',
  amount: 0.1,
  chainId: 1, // Uses direct transfer if ETH + gas available on Ethereum
  recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
  sourceChains: [8453], // Only use ETH from base as source for bridge
});

const executeResult = await sdk.execute({
  contractAddress,
  contractAbi: contractAbi,
  functionName: functionName,
  buildFunctionParams: (
    token: SUPPORTED_TOKENS,
    amount: string,
    chainId: SUPPORTED_CHAINS_IDS,
    user: `0x${string}`,
  ) => {
    const decimals = TOKEN_METADATA[token].decimals;
    const amountWei = parseUnits(amount, decimals);
    const tokenAddr = TOKEN_CONTRACT_ADDRESSES[token][chainId];
    return { functionParams: [tokenAddr, amountWei, user, 0] };
  },
  value: ethValue,
  tokenApproval: {
    token: 'USDC',
    amount: '100000000',
  },
});
```

## Core Features

- **Cross-chain bridging** - Seamless token bridging between 16 chains
- **Cross-chain swaps** - Token swapping between chains with EXACT_IN and EXACT_OUT modes
- **Unified balances** - Aggregated portfolio view across all chains
- **Allowance management** - Efficient token approval handling
- **Smart direct transfers** - Send tokens to any address with automatic optimization
- **Smart execution** - Direct smart contract interactions with balance checking
- **Full testnet support** - Complete development environment
- **Transaction simulation** - Preview costs before execution
- **Rich utilities** - Address validation, formatting, and metadata
- **Smart optimizations** - Automatic chain abstraction skipping when funds are available locally

## Smart Optimizations

### Bridge Skip Optimization

When executing bridge-and-execute operations, the SDK checks if sufficient funds already exist on the target chain:

- **Smart balance detection** - Validates token balance + gas requirements on destination
- **Automatic bypass** - Skips bridging when funds are available locally or only bridges the required amount
- **Cost reduction** - Eliminates unnecessary bridge fees and delays
- **Seamless fallback** - Uses chain abstraction when local funds are insufficient

### Direct Transfer Optimization

For transfer operations, the SDK intelligently chooses the most efficient path:

- **Local balance checking** - Validates token + gas availability on target chain
- **Direct EVM transfers** - Uses native blockchain calls when possible (faster, cheaper)
- **Chain abstraction fallback** - Automatically uses CA when direct transfer isn't possible
- **Universal compatibility** - Works with both native tokens (ETH, MATIC) and ERC20 (USDC, USDT)

## Initialization

```typescript
import type { NexusNetwork } from '@avail-project/nexus-core';

// Mainnet (default)
const sdk = new NexusSDK();

// Testnet
const sdk = new NexusSDK({ network: 'testnet' as NexusNetwork });

// Initialize with provider (required)
await sdk.initialize(window.ethereum); // Returns: Promise<void>
```

## 📡 Event Handling

```typescript
import type { OnIntentHook, OnAllowanceHook, EventListener } from '@avail-project/nexus-core';

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

### Progress Events for All Operations

```typescript
import { NEXUS_EVENTS, ProgressStep } from '@avail-project/nexus-core';

// Bridge & Execute Progress
const unsubscribeBridgeExecuteExpected = sdk.nexusEvents.on(
  NEXUS_EVENTS.BRIDGE_EXECUTE_EXPECTED_STEPS,
  (steps: ProgressStep[]) => {
    console.log(
      'Bridge & Execute steps →',
      steps.map((s) => s.typeID),
    );
  },
);

const unsubscribeBridgeExecuteCompleted = sdk.nexusEvents.on(
  NEXUS_EVENTS.BRIDGE_EXECUTE_COMPLETED_STEPS,
  (step: ProgressStep) => {
    console.log('Bridge & Execute completed →', step.typeID, step.data);

    if (step.typeID === 'IS' && step.data.explorerURL) {
      console.log('View transaction:', step.data.explorerURL);
    }
  },
);

// Transfer & Bridge Progress (optimized operations)
const unsubscribeTransferExpected = sdk.nexusEvents.on(
  NEXUS_EVENTS.EXPECTED_STEPS,
  (steps: ProgressStep[]) => {
    console.log(
      'Transfer/Bridge steps →',
      steps.map((s) => s.typeID),
    );
    // For direct transfers: ['CS', 'TS', 'IS'] (3 steps, ~5-15s)
  },
);

const unsubscribeTransferCompleted = sdk.nexusEvents.on(
  NEXUS_EVENTS.STEP_COMPLETE,
  (step: ProgressStep) => {
    console.log('Transfer/Bridge completed →', step.typeID, step.data);

    if (step.typeID === 'IS' && step.data.explorerURL) {
      // Transaction submitted with hash - works for both direct and CA
      console.log('Transaction hash:', step.data.transactionHash);
      console.log('Explorer URL:', step.data.explorerURL);
    }
  },
);

// Cleanup
return () => {
  unsubscribeBridgeExecuteExpected();
  unsubscribeBridgeExecuteCompleted();
  unsubscribeTransferExpected();
  unsubscribeTransferCompleted();
};
```

The SDK emits **consistent event patterns** for all operations:

**Bridge & Execute Operations:**

1. `bridge_execute_expected_steps` – _once_ with full ordered array of `ProgressStep`s
2. `bridge_execute_completed_steps` – _many_; one per finished step with runtime data

**Transfer & Bridge Operations:**

1. `expected_steps` – _once_ with full ordered array of `ProgressStep`s
2. `step_complete` – _many_; one per finished step with runtime data

All events include the same `typeID` structure and runtime `data` such as `transactionHash`, `explorerURL`, `confirmations`, `error`, etc. This provides consistent progress tracking whether using optimized direct operations or chain abstraction.

## Balance Operations

```typescript
import type { UserAsset, TokenBalance } from '@avail-project/nexus-core';

// Get all balances across chains
const balances: UserAsset[] = await sdk.getUnifiedBalances();

// Get balance for specific token
const usdcBalance: UserAsset | undefined = await sdk.getUnifiedBalance('USDC');
```

## Bridge Operations

```typescript
import type { BridgeParams, BridgeResult, SimulationResult } from '@avail-project/nexus-core';

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

## Transfer Operations

```typescript
import type { TransferParams, TransferResult } from '@avail-project/nexus-core';

// Smart transfer with automatic optimization
const result: TransferResult = await sdk.transfer({
  token: 'USDC',
  amount: 100,
  chainId: 42161, // Arbitrum
  recipient: '0x...',
} as TransferParams);

// The SDK automatically:
// 1. Checks if you have USDC + ETH for gas on Arbitrum
// 2. Uses direct EVM transfer if available (faster, cheaper)
// 3. Falls back to chain abstraction if local funds insufficient

// Simulate transfer to preview costs and optimization path
const simulation: SimulationResult = await sdk.simulateTransfer({
  token: 'USDC',
  amount: 100,
  chainId: 42161,
  recipient: '0x...',
});

// Check if direct transfer will be used
console.log('Fees:', simulation.intent.fees);
// For direct transfers: gasSupplied shows actual native token cost
// For CA transfers: includes additional CA routing fees
```

## Execute Operations

```typescript
import type {
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
} from '@avail-project/nexus-core';

// Execute contract functions with dynamic parameter builder - Compound V3 Supply
const result: ExecuteResult = await sdk.execute({
  toChainId: 1,
  contractAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', // Compound V3 USDC Market
  contractAbi: [
    {
      inputs: [
        { internalType: 'address', name: 'asset', type: 'address' },
        { internalType: 'uint256', name: 'amount', type: 'uint256' },
      ],
      name: 'supply',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ],
  functionName: 'supply',
  buildFunctionParams: (
    token: SUPPORTED_TOKENS,
    amount: string,
    chainId: SUPPORTED_CHAINS_IDS,
    userAddress: `0x${string}`,
  ) => {
    const decimals = TOKEN_METADATA[token].decimals;
    const amountWei = parseUnits(amount, decimals);
    const tokenAddress = TOKEN_CONTRACT_ADDRESSES[token][chainId];
    return {
      functionParams: [tokenAddress, amountWei],
    };
  },
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

// Bridge tokens and execute contract function - Yearn Vault Deposit
const bridgeAndExecuteResult: BridgeAndExecuteResult = await sdk.bridgeAndExecute({
  token: 'USDC',
  amount: '100000000', // 100 USDC (6 decimals)
  toChainId: 1, // Ethereum
  sourceChains: [8453], // Only use `Base` as source for bridge
  execute: {
    contractAddress: '0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE', // Yearn USDC Vault
    contractAbi: [
      {
        inputs: [
          { internalType: 'uint256', name: 'assets', type: 'uint256' },
          { internalType: 'address', name: 'receiver', type: 'address' },
        ],
        name: 'deposit',
        outputs: [{ internalType: 'uint256', name: 'shares', type: 'uint256' }],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
    functionName: 'deposit',
    buildFunctionParams: (
      token: SUPPORTED_TOKENS,
      amount: string,
      chainId: SUPPORTED_CHAINS_IDS,
      userAddress: `0x${string}`,
    ) => {
      const decimals = TOKEN_METADATA[token].decimals;
      const amountWei = parseUnits(amount, decimals);
      return {
        functionParams: [amountWei, userAddress],
      };
    },
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

console.log('Total estimated cost:', simulation.totalEstimatedCost);

console.log('Approval required:', simulation.metadata?.approvalRequired);
console.log('Bridge receive amount:', simulation.metadata?.bridgeReceiveAmount);
```

## Swap Operations

```typescript
import type { ExactInSwapInput, SwapIntentHook, ExactOutSwapInput  SwapResult } from '@avail-project/nexus-core';


// Swap tokens (EXACT_IN - specify input amount)

const swapWithExactInInput: ExactInSwapInput = {
  from: [
    {
      chainId: inputData.fromChainID,
      amount: parseUnits(
        fromAmountStr.toString(),
        TOKEN_METADATA[inputData?.fromTokenAddress]?.decimals,
      ),
      tokenAddress: actualFromTokenAddress as `0x${string}`,
    },
  ],
  toChainId: inputData.toChainID,
  toTokenAddress: actualToTokenAddress as `0x${string}`,
};

const swapWithExactInResult = await sdk.swapWithExactIn(swapWithExactInInput, {swapIntentHook : async (data: Parameters<SwapIntentHook>[0]) => {
  // use this to capture the intent allow, reject and refresh functions
  const {intent, allow, reject, refresh} = data;
  // Use it to handle user interaction or display transaction details

  // setSwapIntent(intent);
  // setAllowCallback(allow);
  // setRejectCallback(reject);
  // setRefreshCallback(refresh);

  // or directly approve or reject the intent
  // calling allow processes the txn
  allow()
}});

// Swap tokens (EXACT_OUT - only specify destination chain, token and amount)

const swapWithExactOutInput: ExactOutSwapInput = {
  toChainId: inputData.toChainID,
  toTokenAddress: actualToTokenAddress as `0x${string}`,
  toAmount: 0n // bigint
};

const swapWithExactOutResult = await sdk.swapWithExactOut(swapWithExactOutInput, {swapIntentHook : async (data: Parameters<SwapIntentHook>[0]) => {
  // use this to capture the intent allow, reject and refresh functions
  const {intent, allow, reject, refresh} = data;
  // Use it to handle user interaction or display transaction details

  // setSwapIntent(intent);
  // setAllowCallback(allow);
  // setRejectCallback(reject);
  // setRefreshCallback(refresh);

  // or directly approve or reject the intent
  // calling allow processes the txn
  allow()
}});


// Handle swap results
if (swapWithExactInResult.success) {
  console.log('✅ Swap successful!');
  console.log('Source transaction:', exactInSwap.result.sourceSwaps);
  console.log('Destination transaction:', exactInSwap.result.destinationSwap);
  console.log('Explorer URL:', exactInSwap.result.explorerURL);
} else {
  console.error('❌ Swap failed:', exactInSwap.error);
}
```

### Discovering Available Swap Options

```typescript
import type { SupportedChainsResult } from '@avail-project/nexus-core';
import { DESTINATION_SWAP_TOKENS } from '@avail-project/nexus-core';

// Get supported source chains and tokens for swaps
const supportedOptions: SupportedChainsResult = sdk.utils.getSwapSupportedChainsAndTokens();
console.log('Supported source chains and tokens:', supportedOptions);

// Example: Build a source token selector
supportedOptions.forEach((chain) => {
  console.log(`Chain: ${chain.name} (${chain.id})`);
  chain.tokens.forEach((token) => {
    console.log(`  - ${token.symbol}: ${token.tokenAddress}`);
  });
});

// Get suggested destination tokens (optional - destination can be any token or chain)
const optimismDestinations = DESTINATION_SWAP_TOKENS.get(10); // Optimism
const arbitrumDestinations = DESTINATION_SWAP_TOKENS.get(42161); // Arbitrum
const baseDestinations = DESTINATION_SWAP_TOKENS.get(8453); // Base

console.log('Popular Optimism destinations:', optimismDestinations);
console.log('Popular Arbitrum destinations:', arbitrumDestinations);
console.log('Popular Base destinations:', baseDestinations);

// Example: Build destination token options for UI
const buildDestinationOptions = (chainId: number) => {
  const popularTokens = DESTINATION_SWAP_TOKENS.get(chainId) || [];
  return popularTokens.map((token) => ({
    label: `${token.symbol} - ${token.name}`,
    value: token.tokenAddress,
    icon: token.logo,
    decimals: token.decimals,
  }));
};
```

**Note:**

- **Source chains/tokens** are restricted to what `getSwapSupportedChainsAndTokens()` returns
- **Destination chains/tokens** can be any supported chain and token address
- `DESTINATION_SWAP_TOKENS` provides popular destination options but is not exhaustive

### Swap Types

**EXACT_IN Swaps:**

- You specify exactly how much you want to spend (`fromAmount`)
- Output amount varies based on market conditions and fees
- Use case: "I want to swap all my 100 USDC"

**EXACT_OUT Swaps:**

- You specify exactly how much you want to receive (`toAmount`)
- Input amount varies based on market conditions and fees
- Use case: "I need exactly 1 ETH for a specific purpose"

### Swap Progress Events

```typescript
import { NEXUS_EVENTS } from '@avail-project/nexus-core';

// Listen for swap progress updates
const unsubscribeSwapSteps = sdk.nexusEvents.on(NEXUS_EVENTS.SWAP_STEPS, (step) => {
  console.log('Swap step:', step.type);

  if (step.type === 'SOURCE_SWAP_HASH' && step.explorerURL) {
    console.log('Source transaction:', step.explorerURL);
  }

  if (step.type === 'DESTINATION_SWAP_HASH' && step.explorerURL) {
    console.log('Destination transaction:', step.explorerURL);
  }

  if (step.type === 'SWAP_COMPLETE' && step.completed) {
    console.log('✅ Swap completed successfully!');
  }
});

// Cleanup
unsubscribeSwapSteps();
```

## Allowance Management

```typescript
import type { AllowanceResponse } from '@avail-project/nexus-core';

// Check allowances
const allowances: AllowanceResponse[] = await sdk.getAllowance(137, ['USDC', 'USDT']);

// Set allowances
await sdk.setAllowance(137, ['USDC'], 1000000n);

// Revoke allowances
await sdk.revokeAllowance(137, ['USDC']);
```

## Intent Management

```typescript
import type { RequestForFunds } from '@avail-project/nexus-core';

// Get user's transaction intents
const intents: RequestForFunds[] = await sdk.getMyIntents(1);
```

## Utilities

All utility functions are available under `sdk.utils`:

```typescript
import type { ChainMetadata, TokenMetadata, SUPPORTED_TOKENS } from '@avail-project/nexus-core';

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

// Swap discovery utilities
const swapOptions: SupportedChainsResult = sdk.utils.getSwapSupportedChainsAndTokens();

// Chain ID conversion
const hexChainId: string = sdk.utils.chainIdToHex(137);
const decimalChainId: number = sdk.utils.hexToChainId('0x89');
```

## Provider Methods

```typescript
import type { EthereumProvider, RequestArguments } from '@avail-project/nexus-core';

// Get chain abstracted provider
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
import { NexusSDK, type BridgeResult } from '@avail-project/nexus-core';

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
import type { ExecuteResult } from '@avail-project/nexus-core';

// MakerDAO DSR (Dai Savings Rate) Deposit
const result: ExecuteResult = await sdk.execute({
  toChainId: 1,
  contractAddress: '0x373238337Bfe1146fb49989fc222523f83081dDb', // DSR Manager
  contractAbi: [
    {
      inputs: [
        { internalType: 'address', name: 'usr', type: 'address' },
        { internalType: 'uint256', name: 'wad', type: 'uint256' },
      ],
      name: 'join',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ],
  functionName: 'join',
  buildFunctionParams: (
    token: SUPPORTED_TOKENS,
    amount: string,
    chainId: SUPPORTED_CHAINS_IDS,
    userAddress: `0x${string}`,
  ) => {
    const decimals = TOKEN_METADATA[token].decimals;
    const amountWei = parseUnits(amount, decimals);
    return {
      functionParams: [userAddress, amountWei],
    };
  },
  waitForReceipt: true,
  requiredConfirmations: 3,
  tokenApproval: {
    token: 'USDC', // Will be converted to DAI in the bridge
    amount: '1000000',
  },
});

console.log('Transaction hash:', result.transactionHash);
console.log('Explorer URL:', result.explorerUrl);
console.log('Gas used:', result.gasUsed);
console.log('Confirmations:', result.confirmations);
```

### Complete Portfolio Management

```typescript
import type { UserAsset, ChainMetadata } from '@avail-project/nexus-core';

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
import type { BridgeResult } from '@avail-project/nexus-core';

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

```typescript
import type { ExecuteSimulation, ExecuteResult } from '@avail-project/nexus-core';

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

The SDK is fully typed with comprehensive TypeScript definitions. Import the types you need:

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
  SwapInput,
  SwapResult,
  SwapBalances,
  SupportedChainsResult,
  DESTINATION_SWAP_TOKENS,
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
} from '@avail-project/nexus-core';
```

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
| Sophon    | 50104    | SOPH            | ✅     |
| Kaia      | 8217     | KAIA            | ✅     |
| BNB       | 56       | BNB             | ✅     |
| HyperEVM  | 999      | HYPE            | ✅     |

### Testnet Chains

| Network          | Chain ID | Native Currency | Status |
| ---------------- | -------- | --------------- | ------ |
| Optimism Sepolia | 11155420 | ETH             | ✅     |
| Polygon Amoy     | 80002    | MATIC           | ✅     |
| Arbitrum Sepolia | 421614   | ETH             | ✅     |
| Base Sepolia     | 84532    | ETH             | ✅     |
| Sepolia          | 11155111 | ETH             | ✅     |
| Monad Testnet    | 10143    | MON             | ✅     |

### Supported Tokens

| Token | Name       | Decimals | Networks       |
| ----- | ---------- | -------- | -------------- |
| ETH   | Ethereum   | 18       | All EVM chains |
| USDC  | USD Coin   | 6        | All supported  |
| USDT  | Tether USD | 6        | All supported  |

## 🔗 Links

- [GitHub Repository](https://github.com/availproject/nexus-sdk)
- [API Documentation](https://docs.availproject.org/api-reference/avail-nexus-sdk)
