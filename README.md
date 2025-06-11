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
  amount: 0.5,
  chainId: 42161,
  recipient: '0xRecipientAddress',
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
