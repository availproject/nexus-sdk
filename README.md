# Avail Nexus SDK

A powerful TypeScript SDK for cross-chain operations, token bridging, and unified balance management across multiple EVM chains. It provides a simplified interface for complex cross-chain interactions.

## Installation

### Production Version (Stable)

```bash
npm install avail-nexus-sdk
```

### Development Version (Latest Features)

```bash
npm install avail-nexus-sdk@dev
```

## Quick Start

```typescript
import { NexusSDK, Network } from 'avail-nexus-sdk';

// Initialize SDK with default settings
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

// Bridge USDC to Polygon
await sdk.bridge({
  token: 'USDC',
  amount: 1, // number or string
  chainId: 137, // to Polygon mainnet
});

// Transfer tokens
await sdk.transfer({
  token: 'ETH',
  amount: 1, // 1 ETH in number or string
  chainId: 1,
  recipient: '0x...',
});
```

## Features

- 🔄 **Cross-chain token bridging** - Bridge tokens seamlessly between supported chains
- 💰 **Unified balance management** - Get aggregated balances across all chains
- 🔐 **Token allowance management** - Manage token approvals efficiently
- 🌉 **Direct token transfers** - Transfer tokens to specific recipients
- 🔌 **Event hooks** - React to transaction status and approval flows
- ⚡ **Multi-chain support** - Works with 8 mainnet and 8 testnet chains
- 🧪 **Complete testnet support** - Full development and testing capabilities
- 🛠️ **Comprehensive utilities** - Balance formatting, address validation, and more
- 📊 **Enhanced metadata** - Rich chain and token information
- 🎯 **Transaction simulation** - Preview costs and fees before execution

## Supported Networks

### Mainnet Chains

| Network   | Chain ID | Native Currency | Status |
| --------- | -------- | --------------- | ------ |
| Ethereum  | 1        | ETH             | ✅     |
| Optimism  | 10       | ETH             | ✅     |
| Polygon   | 137      | MATIC           | ✅     |
| Arbitrum  | 42161    | ETH             | ✅     |
| Avalanche | 43114    | AVAX            | ✅     |
| Base      | 8453     | ETH             | ✅     |
| Linea     | 59144    | ETH             | ✅     |
| Scroll    | 534351   | ETH             | ✅     |

### Testnet Chains

| Network          | Chain ID | Native Currency | Status |
| ---------------- | -------- | --------------- | ------ |
| Ethereum Sepolia | 11155111 | ETH             | ✅     |
| Optimism Sepolia | 11155420 | ETH             | ✅     |
| Polygon Amoy     | 80002    | MATIC           | ✅     |
| Arbitrum Sepolia | 421614   | ETH             | ✅     |
| Avalanche Fuji   | 43113    | AVAX            | ✅     |
| Base Sepolia     | 84532    | ETH             | ✅     |
| Linea Sepolia    | 59141    | ETH             | ✅     |
| Scroll Sepolia   | 534352   | ETH             | ✅     |

### Supported Tokens

| Token | Name       | Decimals | Networks       |
| ----- | ---------- | -------- | -------------- |
| ETH   | Ethereum   | 18       | All EVM chains |
| USDC  | USD Coin   | 6        | All supported  |
| USDT  | Tether USD | 6        | All supported  |

## Core API Reference

### Initialization

```typescript
import { NexusSDK, Network } from 'avail-nexus-sdk';

// Basic initialization (defaults to mainnet)
const sdk = new NexusSDK();

// With specific network configuration
const sdk = new NexusSDK({
  network: 'testnet', // Use testnet environment
});

// Initialize with Web3 provider (required before use)
await sdk.initialize(window.ethereum);
```

### Balance Management

#### Get Unified Balances

```typescript
// Get all token balances across all chains
const balances = await sdk.getUnifiedBalances();
console.log('Total portfolio:', balances);

// Get balance for specific token
const usdcBalance = await sdk.getUnifiedBalance('USDC');
console.log('Total USDC:', usdcBalance);

// Get formatted balance for specific token on specific chain
const polygonUSDC = await sdk.getFormattedTokenBalance('USDC', 137);
console.log('Polygon USDC:', polygonUSDC?.formattedBalance);
```

### Cross-Chain Operations

#### Bridge Tokens

```typescript
// Simple bridge operation
await sdk.bridge({
  token: 'USDC',
  amount: 100, // 100 USDC
  chainId: 137, // to Polygon
});

// Bridge with custom gas limit
await sdk.bridge({
  token: 'ETH',
  amount: '0.5', // 0.5 ETH as string
  chainId: 42161, // to Arbitrum
  gas: 100000n, // custom gas limit
});

// Bridge from string amounts
await sdk.bridge({
  token: 'USDT',
  amount: '1000.50', // precise amount as string
  chainId: 10, // to Optimism
});
```

#### Transfer Tokens

```typescript
// Transfer to specific recipient
await sdk.transfer({
  token: 'ETH',
  amount: 1,
  chainId: 1, // on Ethereum
  recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
});

// Transfer USDC on Polygon
await sdk.transfer({
  token: 'USDC',
  amount: '250.75',
  chainId: 137,
  recipient: '0xRecipientAddress',
});
```

#### Transaction Simulation

```typescript
// Simulate bridge to preview costs
const bridgeSimulation = await sdk.simulateBridge({
  token: 'USDC',
  amount: 100,
  chainId: 137,
});
console.log('Bridge simulation:', bridgeSimulation);

// Simulate transfer to preview costs
const transferSimulation = await sdk.simulateTransfer({
  token: 'ETH',
  amount: '0.1',
  chainId: 42161,
  recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
});
console.log('Transfer simulation:', transferSimulation);
```

### Allowance Management

```typescript
// Check allowances for specific tokens on specific chain
const allowances = await sdk.getAllowance(137, ['USDC', 'USDT']);
console.log('Polygon allowances:', allowances);

// Check all allowances on a chain
const chainAllowances = await sdk.getAllowance(1);

// Check allowances for specific tokens across all chains
const tokenAllowances = await sdk.getAllowance(undefined, ['USDC']);

// Set allowance for tokens
await sdk.setAllowance(137, ['USDC'], 1000000n); // 1M USDC units

// Revoke allowances
await sdk.revokeAllowance(137, ['USDC', 'USDT']);
```

### Event Handling

#### Intent Hooks

```typescript
// Handle bridge/transfer approval flows
sdk.setOnIntentHook(({ intent, allow, deny, refresh }) => {
  console.log('Transaction intent:', intent);

  // Show user the transaction details
  // Then allow or deny based on user input
  if (userApproves) {
    allow();
  } else {
    deny();
  }
});
```

#### Allowance Hooks

```typescript
// Handle token allowance approvals
sdk.setOnAllowanceHook(({ sources, allow, deny }) => {
  console.log('Allowance required for:', sources);

  // Show user allowance requirements
  // Set minimum allowances for the transaction
  allow(['min']);

  // Or set maximum allowances
  // allow(['max']);

  // Or set custom amounts
  // allow(['1000000', '2000000']); // Custom amounts as strings
});
```

#### Account and Chain Events

```typescript
// Listen for account changes
sdk.onAccountChanged((newAccount) => {
  console.log('Account changed to:', newAccount);
  // Update UI or reload balances
});

// Listen for chain changes
sdk.onChainChanged((newChainId) => {
  console.log('Chain changed to:', newChainId);
  // Update UI for new chain
});

// Remove all listeners when component unmounts
sdk.removeAllListeners();
```

### Intent Management

```typescript
// Get user's transaction intents with pagination
const page1Intents = await sdk.getMyIntents(1);
const page2Intents = await sdk.getMyIntents(2);
console.log('My intents:', page1Intents);
```

## Utility Functions

### Token and Chain Information

```typescript
// Check if chain is supported
const isSupported = sdk.isSupportedChain(137); // true for Polygon

// Check if token is supported
const tokenSupported = sdk.isSupportedToken('USDC'); // true

// Get supported chains list
const chains = sdk.getSupportedChains();
console.log('Supported chains:', chains);

// Get detailed chain metadata
const polygonMetadata = sdk.getChainMetadata(137);
console.log('Polygon info:', polygonMetadata);

// Get all chains with metadata
const allChains = sdk.getSupportedChainsWithMetadata();

// Get token metadata
const usdcInfo = sdk.getTokenMetadata('USDC');
const testnetUsdcInfo = sdk.getTestnetTokenMetadata('USDC');
```

### Balance and Number Formatting

```typescript
// Format balance with proper decimals
const formatted = sdk.formatBalance('1500000', 6, 2); // '1.50' (USDC)
const ethFormatted = sdk.formatBalance('1500000000000000000', 18); // '1.5' (ETH)

// Parse human-readable amounts to smallest units
const usdcUnits = sdk.parseUnits('100.50', 6); // 100500000n
const ethUnits = sdk.parseUnits('1.5', 18); // 1500000000000000000n

// Format smallest units to human-readable
const usdcAmount = sdk.formatUnits(100500000n, 6); // '100.5'
const ethAmount = sdk.formatUnits(1500000000000000000n, 18); // '1.5'
```

### Address Utilities

```typescript
// Validate Ethereum addresses
const isValid = sdk.isValidAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // true
const isInvalid = sdk.isValidAddress('invalid-address'); // false

// Truncate addresses for display
const address = '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45';
const short = sdk.truncateAddress(address); // '0x742d...4Db45'
const custom = sdk.truncateAddress(address, 8, 6); // '0x742d35...4b4Db45'
```

### Chain ID Conversion

```typescript
// Convert chain ID to hex format (for wallet switching)
const hexChainId = sdk.chainIdToHex(137); // '0x89'

// Convert hex back to decimal
const decimalChainId = sdk.hexToChainId('0x89'); // 137
```

## Advanced Usage Examples

### Complete Bridge Flow with Error Handling

```typescript
import { NexusSDK, Network } from 'avail-nexus-sdk';

async function bridgeTokensWithHandling() {
  const sdk = new NexusSDK();

  try {
    // Initialize SDK
    await sdk.initialize(window.ethereum);

    // Set up event handlers
    sdk.setOnIntentHook(({ intent, allow, deny }) => {
      console.log('Bridge intent:', intent);
      // Show user confirmation dialog
      if (confirm(`Bridge ${intent.amount} ${intent.token} to chain ${intent.chainId}?`)) {
        allow();
      } else {
        deny();
      }
    });

    sdk.setOnAllowanceHook(({ sources, allow }) => {
      console.log('Setting allowances for:', sources);
      allow(['min']); // Use minimum required allowances
    });

    // Check if we have sufficient balance
    const usdcBalance = await sdk.getUnifiedBalance('USDC');
    if (!usdcBalance || parseFloat(usdcBalance.balance) < 100) {
      throw new Error('Insufficient USDC balance');
    }

    // Simulate bridge to check costs
    const simulation = await sdk.simulateBridge({
      token: 'USDC',
      amount: 100,
      chainId: 137,
    });

    console.log('Bridge costs:', simulation);

    // Execute bridge
    const result = await sdk.bridge({
      token: 'USDC',
      amount: 100,
      chainId: 137,
    });

    console.log('Bridge successful:', result);
  } catch (error) {
    console.error('Bridge failed:', error);
  }
}
```

### Portfolio Management

```typescript
async function managePortfolio() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  // Get complete portfolio overview
  const allBalances = await sdk.getUnifiedBalances();

  // Calculate total portfolio value (you'll need price data)
  let totalValue = 0;
  for (const asset of allBalances) {
    console.log(`${asset.symbol}: ${asset.balance} across ${asset.chains?.length || 0} chains`);
    // totalValue += asset.balance * priceData[asset.symbol];
  }

  // Get detailed breakdown by chain
  for (const chainId of [1, 137, 42161, 10]) {
    const chainMeta = sdk.getChainMetadata(chainId);
    console.log(`\n${chainMeta?.name} balances:`);

    for (const token of ['ETH', 'USDC', 'USDT']) {
      const balance = await sdk.getFormattedTokenBalance(token, chainId);
      if (balance && parseFloat(balance.balance) > 0) {
        console.log(`  ${token}: ${balance.formattedBalance}`);
      }
    }
  }
}
```

### Multi-Chain Allowance Management

```typescript
async function manageAllowances() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  const targetChains = [1, 137, 42161, 10]; // Ethereum, Polygon, Arbitrum, Optimism
  const tokens = ['USDC', 'USDT'];

  // Check allowances across all target chains
  for (const chainId of targetChains) {
    const allowances = await sdk.getAllowance(chainId, tokens);
    const chainName = sdk.getChainMetadata(chainId)?.name;

    console.log(`\n${chainName} allowances:`);
    for (const allowance of allowances) {
      console.log(`  ${allowance.token}: ${allowance.allowance.toString()}`);

      // Set allowance if it's too low
      if (allowance.allowance < 1000000n) {
        console.log(`Setting allowance for ${allowance.token} on ${chainName}`);
        await sdk.setAllowance(chainId, [allowance.token], 1000000000n);
      }
    }
  }
}
```

## Provider Integration

### With MetaMask

```typescript
import { NexusSDK } from 'avail-nexus-sdk';

async function initializeWithMetaMask() {
  if (!window.ethereum) {
    throw new Error('MetaMask not installed');
  }

  // Request account access
  await window.ethereum.request({ method: 'eth_requestAccounts' });

  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  return sdk;
}
```

### With WalletConnect

```typescript
import { WalletConnectProvider } from '@walletconnect/ethereum-provider';
import { NexusSDK } from 'avail-nexus-sdk';

async function initializeWithWalletConnect() {
  const provider = await WalletConnectProvider.init({
    projectId: 'your-project-id',
    chains: [1, 137, 42161], // Supported chains
    showQrModal: true,
  });

  await provider.connect();

  const sdk = new NexusSDK();
  await sdk.initialize(provider);

  return sdk;
}
```

## Error Handling Best Practices

```typescript
import { NexusSDK } from 'avail-nexus-sdk';

async function robustBridgeOperation() {
  const sdk = new NexusSDK();

  try {
    await sdk.initialize(window.ethereum);

    // Validate inputs
    if (!sdk.isSupportedToken('USDC')) {
      throw new Error('Token not supported');
    }

    if (!sdk.isSupportedChain(137)) {
      throw new Error('Chain not supported');
    }

    // Check balance before operation
    const balance = await sdk.getUnifiedBalance('USDC');
    const requiredAmount = 100;

    if (!balance || parseFloat(balance.balance) < requiredAmount) {
      throw new Error(
        `Insufficient balance. Required: ${requiredAmount}, Available: ${balance?.balance || 0}`,
      );
    }

    // Simulate first to check for issues
    const simulation = await sdk.simulateBridge({
      token: 'USDC',
      amount: requiredAmount,
      chainId: 137,
    });

    console.log('Simulation successful, proceeding with bridge');

    // Execute the actual bridge
    const result = await sdk.bridge({
      token: 'USDC',
      amount: requiredAmount,
      chainId: 137,
    });

    return result;
  } catch (error) {
    if (error.message.includes('User denied')) {
      console.log('User cancelled the transaction');
    } else if (error.message.includes('Insufficient')) {
      console.error('Balance error:', error.message);
    } else if (error.message.includes('Network')) {
      console.error('Network error:', error.message);
    } else {
      console.error('Unknown error:', error);
    }

    throw error;
  }
}
```

## Smart Contract Deposit Operations

The Nexus SDK provides powerful functionality for depositing funds into smart contracts after bridging tokens to the target chain. This enables seamless integration with DeFi protocols, staking contracts, and other dApps.

### Core Deposit Functions

#### `deposit(params)` - Direct Contract Deposit

Execute a smart contract function call with enhanced transaction tracking and receipt confirmation.

**Parameters:**

```typescript
interface DepositParams {
  toChainId: number; // Target chain ID
  contractAddress: string; // Contract address to interact with
  contractAbi: Abi; // Contract ABI (viem format)
  functionName: string; // Function to call
  functionParams: readonly unknown[]; // Function parameters
  value?: string; // ETH value to send (hex string)
  gasLimit?: string; // Custom gas limit (hex string)
  maxGasPrice?: string; // Maximum gas price (hex string)
  enableTransactionPolling?: boolean; // Legacy polling (default: false)
  transactionTimeout?: number; // Legacy timeout (default: 30000ms)

  // Enhanced Receipt Confirmation
  waitForReceipt?: boolean; // Wait for transaction receipt (default: false)
  receiptTimeout?: number; // Receipt timeout (default: 300000ms)
  requiredConfirmations?: number; // Block confirmations required (default: 1)
}
```

**Returns:**

```typescript
interface DepositResult {
  transactionHash: string; // Transaction hash
  explorerUrl: string; // Block explorer URL
  chainId: number; // Chain ID where deposit occurred

  // Receipt Information (when waitForReceipt: true)
  receipt?: TransactionReceipt; // Full transaction receipt
  confirmations?: number; // Number of confirmations
  gasUsed?: string; // Actual gas used
  effectiveGasPrice?: string; // Effective gas price paid
}
```

#### `simulateDeposit(params)` - Preview Deposit Costs

Simulate a deposit operation to estimate gas costs and validate parameters without executing the transaction.

**Parameters:** Same as `deposit()` but only requires core contract parameters

**Returns:**

```typescript
interface DepositSimulation {
  gasLimit: string; // Estimated gas limit
  gasPrice: string; // Current gas price
  estimatedCost: string; // Total cost in wei
  estimatedCostEth: string; // Total cost in ETH
  success: boolean; // Simulation success
  error?: string; // Error message if failed
}
```

#### `bridgeAndDeposit(params)` - Combined Bridge + Deposit

Bridge tokens to a target chain and then deposit them into a smart contract in a single operation.

**Parameters:**

```typescript
interface BridgeAndDepositParams {
  toChainId: SUPPORTED_CHAINS_IDS; // Target chain ID
  token: SUPPORTED_TOKENS; // Token to bridge
  amount: string; // Amount to bridge
  recipient?: `0x${string}`; // Bridge recipient (optional)

  // Optional deposit configuration
  deposit?: Omit<DepositParams, 'toChainId'>; // Deposit params (excluding toChainId)

  // Transaction options
  enableTransactionPolling?: boolean; // Legacy polling
  transactionTimeout?: number; // Legacy timeout

  // Global receipt confirmation options
  waitForReceipt?: boolean; // Wait for deposit receipt
  receiptTimeout?: number; // Receipt timeout
  requiredConfirmations?: number; // Required confirmations
}
```

**Returns:**

```typescript
interface BridgeAndDepositResult {
  depositTransactionHash?: string; // Deposit transaction hash
  depositExplorerUrl?: string; // Deposit explorer URL
  toChainId: number; // Target chain ID
}
```

#### `simulateBridgeAndDeposit(params)` - Preview Combined Operation

Simulate both bridge and deposit operations to get comprehensive cost estimates.

**Returns:**

```typescript
{
  bridgeSimulation: SimulationResult | null;    // Bridge simulation result
  depositSimulation?: DepositSimulation;        // Deposit simulation result
  success: boolean;                             // Overall success
  error?: string;                               // Error message if failed
}
```

## Deposit Usage Examples

### Basic Smart Contract Deposit

```typescript
async function basicDeposit() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  const result = await sdk.deposit({
    toChainId: 1, // Ethereum mainnet
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
    functionParams: ['1000000000', '0xUserAddress'], // 1000 USDC, user address
  });

  console.log('Deposit successful:', result.transactionHash);
  console.log('View on explorer:', result.explorerUrl);
}
```

### Deposit with Enhanced Receipt Confirmation

```typescript
async function depositWithReceiptConfirmation() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  // Set up enhanced event listeners
  sdk.on('transaction:sent', (data) => {
    console.log(`📤 Transaction sent: ${data.hash}`);
  });

  sdk.on('receipt:received', (data) => {
    console.log(`📄 Receipt received for ${data.hash}`);
    console.log(`⛽ Gas used: ${data.receipt.gasUsed}`);
    console.log(`💰 Effective gas price: ${data.receipt.effectiveGasPrice}`);
  });

  sdk.on('transaction:confirmed', (data) => {
    console.log(`✅ Transaction confirmed with ${data.confirmations} confirmations`);
  });

  try {
    const result = await sdk.deposit({
      toChainId: 1, // Ethereum mainnet
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
          stateMutability: 'payable',
        },
      ],
      functionName: 'deposit',
      functionParams: ['1000000000', '0xUserAddress'],
      value: '0x1bc16d674ec80000', // 2 ETH
      // Enhanced transaction confirmation options
      waitForReceipt: true,
      receiptTimeout: 600000, // 10 minutes
      requiredConfirmations: 3,
    });

    console.log('✅ Deposit completed successfully!');
    console.log(`Transaction: ${result.transactionHash}`);
    console.log(`Confirmations: ${result.confirmations}`);
    console.log(`Gas used: ${result.gasUsed}`);

    if (result.receipt) {
      console.log('📄 Full receipt:', result.receipt);
    }

    return result;
  } catch (error) {
    console.error('❌ Deposit failed:', error);
    throw error;
  }
}
```

### Simulate Deposit Before Execution

```typescript
async function simulateAndDeposit() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  // First simulate to check costs and validate
  const simulation = await sdk.simulateDeposit({
    toChainId: 1,
    contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
    contractAbi: [
      {
        type: 'function',
        name: 'stake',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'stake',
    functionParams: ['5000000000'], // 5000 USDC
  });

  if (!simulation.success) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  console.log('💰 Estimated gas cost:', simulation.estimatedCostEth, 'ETH');
  console.log('⛽ Gas limit needed:', simulation.gasLimit);

  // Ask user for confirmation
  const confirmed = confirm(
    `This will cost approximately ${simulation.estimatedCostEth} ETH in gas. Continue?`,
  );

  if (!confirmed) {
    console.log('User cancelled transaction');
    return;
  }

  // Execute the deposit
  const result = await sdk.deposit({
    toChainId: 1,
    contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
    contractAbi: [
      {
        type: 'function',
        name: 'stake',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'stake',
    functionParams: ['5000000000'],
    gasLimit: simulation.gasLimit, // Use simulated gas limit
    waitForReceipt: true,
  });

  console.log('🎉 Staking completed!', result.transactionHash);
}
```

### Bridge and Deposit to DeFi Protocol

```typescript
async function bridgeAndDepositToDeFi() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  // Aave lending pool deposit example
  const aaveV3PoolAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
  const aaveV3PoolAbi = [
    {
      type: 'function',
      name: 'supply',
      inputs: [
        { name: 'asset', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'onBehalfOf', type: 'address' },
        { name: 'referralCode', type: 'uint16' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ];

  try {
    const result = await sdk.bridgeAndDeposit({
      token: 'USDC',
      amount: '1000', // Bridge 1000 USDC
      toChainId: 1, // to Ethereum mainnet
      deposit: {
        contractAddress: aaveV3PoolAddress,
        contractAbi: aaveV3PoolAbi,
        functionName: 'supply',
        functionParams: [
          '0xA0b86a33E6411e3Ab02b73D2F75bDaCfDCeA51c8', // USDC address on mainnet
          '1000000000', // 1000 USDC (6 decimals)
          '0xUserAddress', // Supply on behalf of user
          0, // No referral code
        ],
      },
      waitForReceipt: true,
      requiredConfirmations: 2,
    });

    console.log('✅ Bridge and deposit to Aave completed!');
    console.log('Deposit transaction:', result.depositTransactionHash);
    console.log('View on explorer:', result.depositExplorerUrl);

    return result;
  } catch (error) {
    console.error('❌ Bridge and deposit failed:', error);
    throw error;
  }
}
```

### Bridge and Deposit with Advanced Options

```typescript
async function bridgeAndDepositWithAdvancedOptions() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  try {
    // First simulate to check costs
    const simulation = await sdk.simulateBridgeAndDeposit({
      token: 'USDC',
      amount: '5000',
      toChainId: 1, // Ethereum mainnet
      deposit: {
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
        functionParams: ['5000000000', '0xUserAddress'],
      },
    });

    console.log('Bridge simulation:', simulation.bridgeSimulation);
    console.log('Deposit simulation:', simulation.depositSimulation);

    if (!simulation.success) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    // Execute with advanced options
    const result = await sdk.bridgeAndDeposit({
      token: 'USDC',
      amount: '5000',
      toChainId: 1,
      deposit: {
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
        functionParams: ['5000000000', '0xUserAddress'],
        // Individual deposit options
        gasLimit: '0x30d40', // 200k gas
        maxGasPrice: '0x174876e800', // 100 gwei max
      },
      // Global transaction options
      waitForReceipt: true,
      receiptTimeout: 900000, // 15 minutes
      requiredConfirmations: 5, // Extra safety for high-value tx
    });

    console.log('🎉 Bridge and deposit completed!');
    console.log(`Deposit transaction: ${result.depositTransactionHash}`);
    console.log(`Explorer: ${result.depositExplorerUrl}`);

    return result;
  } catch (error) {
    console.error('❌ Bridge and deposit failed:', error);
    throw error;
  }
}
```

### Multiple DeFi Protocol Deposits

```typescript
async function multiProtocolDeposit() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  const protocols = [
    {
      name: 'Aave V3',
      contractAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      functionName: 'supply',
      amount: '2000',
      abi: [
        {
          type: 'function',
          name: 'supply',
          inputs: [
            { name: 'asset', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'onBehalfOf', type: 'address' },
            { name: 'referralCode', type: 'uint16' },
          ],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ],
      params: [
        '0xA0b86a33E6411e3Ab02b73D2F75bDaCfDCeA51c8', // USDC
        '2000000000', // 2000 USDC
        '0xUserAddress',
        0,
      ],
    },
    {
      name: 'Compound V3',
      contractAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      functionName: 'supply',
      amount: '1500',
      abi: [
        {
          type: 'function',
          name: 'supply',
          inputs: [
            { name: 'asset', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ],
      params: ['0xA0b86a33E6411e3Ab02b73D2F75bDaCfDCeA51c8', '1500000000'],
    },
  ];

  const results = [];

  for (const protocol of protocols) {
    console.log(`🏦 Processing ${protocol.name}...`);

    try {
      // Simulate first
      const simulation = await sdk.simulateBridgeAndDeposit({
        token: 'USDC',
        amount: protocol.amount,
        toChainId: 1,
        deposit: {
          contractAddress: protocol.contractAddress,
          contractAbi: protocol.abi,
          functionName: protocol.functionName,
          functionParams: protocol.params,
        },
      });

      if (!simulation.success) {
        console.error(`❌ ${protocol.name} simulation failed:`, simulation.error);
        continue;
      }

      console.log(
        `💰 ${protocol.name} estimated cost: ${simulation.depositSimulation?.estimatedCostEth} ETH`,
      );

      // Execute deposit
      const result = await sdk.bridgeAndDeposit({
        token: 'USDC',
        amount: protocol.amount,
        toChainId: 1,
        deposit: {
          contractAddress: protocol.contractAddress,
          contractAbi: protocol.abi,
          functionName: protocol.functionName,
          functionParams: protocol.params,
        },
        waitForReceipt: true,
        requiredConfirmations: 2,
      });

      console.log(`✅ ${protocol.name} deposit completed:`, result.depositTransactionHash);
      results.push({ protocol: protocol.name, result });
    } catch (error) {
      console.error(`❌ ${protocol.name} deposit failed:`, error);
    }
  }

  return results;
}
```

### Transaction Confirmation Strategies

```typescript
async function depositWithCustomConfirmationStrategy() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  // Strategy 1: High-value transaction with maximum confirmations
  const highValueDeposit = async () => {
    return sdk.deposit({
      toChainId: 1,
      contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
      contractAbi: [
        /*...*/
      ],
      functionName: 'deposit',
      functionParams: ['10000000000'], // Large amount
      waitForReceipt: true,
      requiredConfirmations: 10, // Extra confirmations for large transactions
      receiptTimeout: 1800000, // 30 minutes for high-value tx
    });
  };

  // Strategy 2: Time-sensitive transaction with fast confirmation
  const timeSensitiveDeposit = async () => {
    return sdk.deposit({
      toChainId: 137, // Polygon for faster confirmation
      contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
      contractAbi: [
        /*...*/
      ],
      functionName: 'deposit',
      functionParams: ['1000000'],
      waitForReceipt: true,
      requiredConfirmations: 1, // Fast confirmation
      receiptTimeout: 120000, // 2 minutes max wait
    });
  };

  // Strategy 3: Standard transaction with balanced settings
  const standardDeposit = async () => {
    return sdk.deposit({
      toChainId: 42161, // Arbitrum
      contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
      contractAbi: [
        /*...*/
      ],
      functionName: 'deposit',
      functionParams: ['500000'],
      waitForReceipt: true,
      requiredConfirmations: 3, // Standard safety
      receiptTimeout: 300000, // 5 minutes
    });
  };

  // Execute based on transaction characteristics
  const transactionValue = 5000; // USD
  const isTimeSensitive = false;

  let result;
  if (transactionValue > 10000) {
    result = await highValueDeposit();
  } else if (isTimeSensitive) {
    result = await timeSensitiveDeposit();
  } else {
    result = await standardDeposit();
  }

  console.log('Deposit result:', result);
  return result;
}
```

### Error Handling and Retry Logic

```typescript
async function robustDepositWithRetry() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Validate contract first
      const simulation = await sdk.simulateDeposit({
        toChainId: 1,
        contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
        contractAbi: [
          {
            type: 'function',
            name: 'deposit',
            inputs: [{ name: 'amount', type: 'uint256' }],
            outputs: [],
            stateMutability: 'nonpayable',
          },
        ],
        functionName: 'deposit',
        functionParams: ['1000000000'],
      });

      if (!simulation.success) {
        throw new Error(`Simulation failed: ${simulation.error}`);
      }

      console.log(`Attempt ${attempt + 1}/${maxRetries}`);
      console.log(`Estimated cost: ${simulation.estimatedCostEth} ETH`);

      const result = await sdk.deposit({
        toChainId: 1,
        contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
        contractAbi: [
          {
            type: 'function',
            name: 'deposit',
            inputs: [{ name: 'amount', type: 'uint256' }],
            outputs: [],
            stateMutability: 'nonpayable',
          },
        ],
        functionName: 'deposit',
        functionParams: ['1000000000'],
        gasLimit: simulation.gasLimit,
        waitForReceipt: true,
        requiredConfirmations: 2,
        receiptTimeout: 600000, // 10 minutes
      });

      console.log('🎉 Deposit successful!');
      return result;
    } catch (error) {
      attempt++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`Attempt ${attempt}/${maxRetries} failed:`, errorMessage);

      if (attempt >= maxRetries) {
        throw new Error(`Deposit failed after ${maxRetries} attempts: ${errorMessage}`);
      }

      // Don't retry user rejections
      if (errorMessage.includes('User denied') || errorMessage.includes('rejected')) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

### Event-Driven Deposit Monitoring

```typescript
async function depositWithEventMonitoring() {
  const sdk = new NexusSDK();
  await sdk.initialize(window.ethereum);

  // Set up comprehensive event monitoring
  const events = [];

  sdk.on('deposit:started', (data) => {
    console.log(`🏦 Deposit started on chain ${data.chainId}`);
    console.log(`Contract: ${data.contractAddress}`);
    events.push({ type: 'deposit_started', timestamp: Date.now(), data });
  });

  sdk.on('transaction:sent', (data) => {
    console.log(`📤 Transaction sent: ${data.hash}`);
    events.push({ type: 'transaction_sent', timestamp: Date.now(), data });
  });

  sdk.on('receipt:received', (data) => {
    console.log(`📄 Receipt received: ${data.hash}`);
    console.log(`⛽ Gas used: ${data.receipt.gasUsed}`);
    console.log(`💰 Gas price: ${data.receipt.effectiveGasPrice}`);
    events.push({ type: 'receipt_received', timestamp: Date.now(), data });
  });

  sdk.on('confirmation:update', (data) => {
    console.log(`🔄 Confirmations: ${data.confirmations}`);
    events.push({ type: 'confirmation_update', timestamp: Date.now(), data });
  });

  sdk.on('transaction:confirmed', (data) => {
    console.log(`✅ Transaction confirmed: ${data.confirmations} confirmations`);
    events.push({ type: 'transaction_confirmed', timestamp: Date.now(), data });
  });

  sdk.on('deposit:completed', (data) => {
    console.log(`🎉 Deposit completed successfully!`);
    console.log(`Transaction: ${data.transactionHash}`);
    console.log(`Explorer: ${data.explorerUrl}`);
    events.push({ type: 'deposit_completed', timestamp: Date.now(), data });
  });

  sdk.on('deposit:failed', (data) => {
    console.error(`❌ Deposit failed: ${data.message}`);
    events.push({ type: 'deposit_failed', timestamp: Date.now(), data });
  });

  try {
    const result = await sdk.deposit({
      toChainId: 1,
      contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
      contractAbi: [
        {
          type: 'function',
          name: 'stake',
          inputs: [{ name: 'amount', type: 'uint256' }],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'stake',
      functionParams: ['1000000000'],
      waitForReceipt: true,
      requiredConfirmations: 3,
    });

    // Log complete event timeline
    console.log('\n📊 Complete Event Timeline:');
    events.forEach((event, index) => {
      const elapsed = index > 0 ? event.timestamp - events[0].timestamp : 0;
      console.log(`${index + 1}. [+${elapsed}ms] ${event.type}`);
    });

    return { result, events };
  } catch (error) {
    console.error('Deposit failed:', error);
    return { error, events };
  } finally {
    // Clean up event listeners
    sdk.removeAllListeners();
  }
}
```

## Best Practices for Deposit Operations

### 1. Always Simulate First

```typescript
// ✅ Good: Simulate before executing
const simulation = await sdk.simulateDeposit(params);
if (simulation.success) {
  const result = await sdk.deposit(params);
}

// ❌ Bad: Execute without simulation
const result = await sdk.deposit(params);
```

### 2. Use Appropriate Confirmation Levels

```typescript
// High-value transactions (>$10,000)
requiredConfirmations: 10,
receiptTimeout: 1800000, // 30 minutes

// Standard transactions ($100-$10,000)
requiredConfirmations: 3,
receiptTimeout: 600000, // 10 minutes

// Small transactions (<$100)
requiredConfirmations: 1,
receiptTimeout: 300000, // 5 minutes
```

### 3. Handle Errors Gracefully

```typescript
try {
  const result = await sdk.deposit(params);
  return result;
} catch (error) {
  if (error.message.includes('User denied')) {
    // Handle user rejection
    console.log('Transaction was cancelled by user');
    return null;
  } else if (error.message.includes('insufficient funds')) {
    // Handle insufficient balance
    console.error('Insufficient balance for transaction');
    throw new Error('Please ensure you have enough balance');
  } else {
    // Handle other errors
    console.error('Deposit failed:', error);
    throw error;
  }
}
```

### 4. Monitor Events for Better UX

```typescript
// Set up progress indicators
sdk.on('transaction:sent', () => updateUI('Transaction sent...'));
sdk.on('receipt:received', () => updateUI('Processing...'));
sdk.on('transaction:confirmed', () => updateUI('Confirmed!'));
```

### 5. Use Gas Optimization

```typescript
// For non-urgent transactions, use lower gas prices
const simulation = await sdk.simulateDeposit(params);
const result = await sdk.deposit({
  ...params,
  gasLimit: simulation.gasLimit,
  maxGasPrice: '0x12a05f200', // 5 gwei maximum
});
```

## Development Workflow

### Building

```bash
npm run build          # Standard build
npm run build:prod     # Production build (optimized)
npm run build:dev      # Development build (with source maps)
```

### Testing

```bash
npm test              # Run tests
npm run lint          # Lint code
npm run typecheck     # Type checking
```

### Releasing

```bash
# Development release
npm run release:dev

# Production release
npm run release:prod
```

## Clean Up

Always clean up resources when your application unmounts:

```typescript
// Remove all event listeners
sdk.removeAllListeners();

// Deinitialize the SDK
await sdk.deinit();
```

## Troubleshooting

### Common Issues

1. **SDK not initialized**: Always call `await sdk.initialize(provider)` before using other methods
2. **Unsupported chain/token**: Check supported chains and tokens using `sdk.isSupportedChain()` and `sdk.isSupportedToken()`
3. **Insufficient allowance**: Use allowance management methods to check and set appropriate allowances
4. **Provider issues**: Ensure your Web3 provider is properly connected and on a supported network

### Debug Mode

Enable debug logs by setting the appropriate network configuration:

```typescript
const sdk = new NexusSDK({
  network: 'testnet', // Use testnet for debugging
  debug: true,
  //...
});
```

## License

MIT - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## Support

For issues and questions:

- GitHub Issues: [Create an issue](https://github.com/availproject/nexus-sdk/issues)
- Documentation: [API Reference](https://docs.availproject.org/nexus-sdk)
