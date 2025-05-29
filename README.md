# Avail Nexus SDK

Nexus SDK for cross-chain bridging and swaps

## Installation

### Production Version (Stable)

```bash
npm install avail-nexus-sdk
```

### Development Version (Latest Features)

```bash
npm install avail-nexus-sdk@dev
```

## Development Workflow

This SDK maintains two distribution channels:

### Production SDK (`latest` tag)

- **Branch**: `main`
- **Installation**: `npm install avail-nexus-sdk`
- **Purpose**: Stable, thoroughly tested releases
- **Release Process**: Manual releases from main branch

### Development SDK (`dev` tag)

- **Branch**: `develop` or feature branches
- **Installation**: `npm install avail-nexus-sdk@dev`
- **Purpose**: Latest features and fixes for testing
- **Release Process**: Automated releases from development branches

## Scripts

### Building

```bash
npm run build          # Standard build
npm run build:prod     # Production build (optimized)
npm run build:dev      # Development build (with source maps)
```

### Releasing

```bash
# Development release
npm run release:dev
# or
./scripts/release.sh dev

# Production release
npm run release:prod
# or
./scripts/release.sh prod
```

### Version Management

```bash
npm run version:dev    # Bump development version
npm run version:prod   # Bump production version
```

## Usage

```typescript
import { formatBalance, getChainMetadata, getFullVersion, IS_DEVELOPMENT } from 'avail-nexus-sdk';

// Use SDK functions
const balance = formatBalance('1000000000000000000', 18);
console.log('Formatted balance:', balance);
```

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Build: `npm run build`
5. Lint: `npm run lint`

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Test thoroughly
4. Create a development release: `./scripts/release.sh dev`
5. Create a pull request to `main`
6. After merge, create a production release: `./scripts/release.sh prod`

## Features

- 🔄 Cross-chain token bridging
- 💰 Unified balance across chains
- 🔐 Token allowance management
- 🌉 Token transfers across chains
- 🔌 Event hooks for transaction status
- ⚡ Support for multiple EVM chains (mainnet & testnet)
- 🧪 Complete testnet support with dedicated metadata
- 🛠️ Comprehensive utility functions
- 📊 Enhanced metadata for chains and tokens
- 🎯 Advanced balance formatting and parsing
- ✅ Address validation and formatting

## Quick Start

```typescript
import { NexusSDK, Network } from '@avail/nexus-sdk';

// Initialize SDK with default settings
const sdk = new NexusSDK();
await sdk.initialize(provider); // Your Web3 provider

// Or initialize with specific network environment
const nexusSdk = new NexusSDK({
  network: Network.CERISE, // Dev with mainnet tokens
});
await nexusSdk.initialize(provider);

// Get unified balances
const balances = await sdk.getUnifiedBalances();

// Bridge tokens
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

## Supported Networks

### Mainnet Chains

| Network   | Chain ID | Native Currency | Block Time | Status |
| --------- | -------- | --------------- | ---------- | ------ |
| Ethereum  | 1        | ETH             | 12s        | ✅     |
| Optimism  | 10       | ETH             | 2s         | ✅     |
| Polygon   | 137      | MATIC           | 2s         | ✅     |
| Arbitrum  | 42161    | ETH             | 1s         | ✅     |
| Avalanche | 43114    | AVAX            | 2s         | ✅     |
| Base      | 8453     | ETH             | 2s         | ✅     |
| Linea     | 59144    | ETH             | 12s        | ✅     |
| Scroll    | 534351   | ETH             | 3s         | ✅     |

### Testnet Chains 🧪

| Network          | Chain ID | Native Currency | Block Time | Status |
| ---------------- | -------- | --------------- | ---------- | ------ |
| Ethereum Sepolia | 11155111 | ETH             | 12s        | ✅     |
| Optimism Sepolia | 11155420 | ETH             | 2s         | ✅     |
| Polygon Amoy     | 80002    | MATIC           | 2s         | ✅     |
| Arbitrum Sepolia | 421614   | ETH             | 1s         | ✅     |
| Avalanche Fuji   | 43113    | AVAX            | 2s         | ✅     |
| Base Sepolia     | 84532    | ETH             | 2s         | ✅     |
| Linea Sepolia    | 59141    | ETH             | 12s        | ✅     |
| Scroll Sepolia   | 534352   | ETH             | 3s         | ✅     |

## Supported Tokens

### Mainnet Tokens

| Token | Name       | Decimals | Type   |
| ----- | ---------- | -------- | ------ |
| ETH   | Ethereum   | 18       | Native |
| USDC  | USD Coin   | 6        | ERC-20 |
| USDT  | Tether USD | 6        | ERC-20 |

### Testnet Tokens 🧪

| Token | Name          | Decimals | Type   | Note        |
| ----- | ------------- | -------- | ------ | ----------- |
| ETH   | Test Ethereum | 18       | Native | Faucet ETH  |
| USDC  | Test USD Coin | 6        | ERC-20 | Test tokens |
| USDT  | Test Tether   | 6        | ERC-20 | Test tokens |

## API Reference

### Initialization

#### `initialize(provider: EthereumProvider): Promise<void>`

Initializes the SDK with a Web3/EVM provider. Must be called before any other method.

```typescript
// Basic initialization
await sdk.initialize(window.ethereum);

// With network configuration
const sdk = new NexusSDK({
  network: Network.CERISE, // Choose based on your needs
});
await sdk.initialize(window.ethereum);
```

#### `deinit(): Promise<void>`

Deinitializes the SDK and cleans up resources.

```typescript
await sdk.deinit();
```

---

### Network Configuration 🔧

The SDK can be configured to work with different network environments based on your development needs.

#### **Available Network Environments**

```typescript
import { Network } from '@avail/nexus-sdk';

// Available environments:
Network.FOLLY; // Dev with testnet tokens
Network.CERISE; // Dev with mainnet tokens
Network.CORAL; // Testnet with mainnet tokens
```

#### **Configuration Examples**

```typescript
import { NexusSDK, Network } from '@avail/nexus-sdk';

// For development with mainnet tokens (recommended for most dev work)
const mainnetDevSdk = new NexusSDK({
  network: Network.CERISE,
});

// For development with testnet tokens (for testing with test funds)
const testnetDevSdk = new NexusSDK({
  network: Network.FOLLY,
});

// For testnet with mainnet tokens (advanced use case)
const testnetMainnetSdk = new NexusSDK({
  network: Network.CORAL,
});

// For production
const prodSdk = new NexusSDK();

await mainnetDevSdk.initialize(provider);
```

#### **Environment Selection Guide**

| Environment | Use Case    | Tokens  | Chains  | Best For                                        |
| ----------- | ----------- | ------- | ------- | ----------------------------------------------- |
| `FOLLY`     | Development | Testnet | Testnet | Early development, testing with free tokens     |
| `CERISE`    | Development | Mainnet | Mainnet | Development with real token prices/metadata     |
| `CORAL`     | Testing     | Mainnet | Testnet | Testing mainnet logic on testnet infrastructure |

#### **Default Behavior**

```typescript
// Without specifying network, SDK uses default configuration
const sdk = new NexusSDK(); // Uses default environment

// Same as explicitly setting CERISE (most common for development)
const sdk = new NexusSDK({
  network: Network.CERISE,
});
```

---

### Unified Balance

#### `getUnifiedBalances(): Promise<UnifiedBalanceResponse[]>`

Retrieves unified balances for all supported tokens across all chains.

```typescript
const balances = await sdk.getUnifiedBalances();
```

#### `getUnifiedBalance(symbol: string): Promise<UnifiedBalanceResponse | undefined>`

Retrieves the unified balance for a specific token symbol (e.g., 'USDC').

```typescript
const usdcBalance = await sdk.getUnifiedBalance('USDC');
```

#### `getFormattedTokenBalance(symbol: string, chainId?: number): Promise<TokenBalance | undefined>` 🆕

Get token balance for a specific token, optionally on a specific chain.

```typescript
// Get USDC balance on Polygon
const polygonUSDC = await sdk.getFormattedTokenBalance('USDC', 137);

// Get total USDC balance across all chains
const totalUSDC = await sdk.getFormattedTokenBalance('USDC');
```

---

### Bridging & Transfers

#### `bridge(params: BridgeParams): Promise<unknown>`

Bridges tokens between chains using Nexus's intent system.

```typescript
await sdk.bridge({
  token: 'USDC',
  amount: 10,
  chainId: 137, // Destination chain ID
  gas: 100000, // optional gas limit
});
```

#### `transfer(params: TransferParams): Promise<unknown>`

Transfers tokens to a recipient on a specified chain.

```typescript
await sdk.transfer({
  token: 'ETH',
  amount: 1,
  chainId: 1, // Destination chain ID
  recipient: '0xRecipientAddress',
});
```

---

### Allowance Management

#### `getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]>`

Gets the allowance for specified tokens on a given chain.

```typescript
// Get allowances for specific tokens on specific chain
const allowances = await sdk.getAllowance(137, ['USDC', 'USDT']);

// Get all allowances for specific chain
const chainAllowances = await sdk.getAllowance(137);

// Get allowances for specific tokens across all chains
const tokenAllowances = await sdk.getAllowance(undefined, ['USDC']);

// Get all allowances across all chains
const allAllowances = await sdk.getAllowance();
```

#### `setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void>`

Sets the allowance for tokens on a specific chain.

```typescript
await sdk.setAllowance(42161, ['USDC'], BigInt('100000000000')); // Set allowance for USDC on Arbitrum
```

#### `revokeAllowance(chainId: number, tokens: string[]): Promise<void>`

Revokes the allowance for tokens on a specific chain.

```typescript
await sdk.revokeAllowance(42161, ['USDC']);
```

---

### Metadata & Information 🆕

#### `getTokenMetadata(symbol: string): TokenMetadata`

Get comprehensive metadata for a specific supported token (defaults to mainnet).

```typescript
const ethMetadata = sdk.getTokenMetadata('ETH');
// Returns: { symbol: 'ETH', name: 'Ethereum', decimals: 18, icon: '...', coingeckoId: 'ethereum', isNative: true }
```

#### `getMainnetTokenMetadata(symbol: string): TokenMetadata` 🧪

Get comprehensive metadata for a specific mainnet token.

```typescript
const usdcMetadata = sdk.getMainnetTokenMetadata('USDC');
// Returns: { symbol: 'USDC', name: 'USD Coin', decimals: 6, icon: '...', coingeckoId: 'usd-coin' }
```

#### `getTestnetTokenMetadata(symbol: string): TokenMetadata` 🧪

Get comprehensive metadata for a specific testnet token.

```typescript
const testUsdcMetadata = sdk.getTestnetTokenMetadata('USDC');
// Returns: { symbol: 'USDC', name: 'Test USD Coin', decimals: 6, icon: '...', coingeckoId: 'usd-coin' }

const testMaticMetadata = sdk.getTestnetTokenMetadata('MATIC');
// Returns: { symbol: 'MATIC', name: 'Test Polygon', decimals: 18, icon: '...', coingeckoId: 'matic-network', isNative: true }
```

#### `getChainMetadata(chainId: number): ChainMetadata | undefined`

Get detailed metadata for a specific chain.

```typescript
const ethMetadata = sdk.getChainMetadata(1);
// Returns: { id: 1, name: 'Ethereum', shortName: 'eth', logo: '...', nativeCurrency: {...}, rpcUrls: [...], ... }
```

#### `getSupportedChainsWithMetadata(): ChainMetadata[]`

Get enhanced metadata for all supported chains.

```typescript
const chains = sdk.getSupportedChainsWithMetadata();
```

---

### Utility Functions 🆕

#### `formatBalance(balance: string, decimals: number, precision?: number): string`

Format a balance string to human-readable format.

```typescript
const formatted = sdk.formatBalance('1000000000000000000', 18, 4); // '1'
const formatted2 = sdk.formatBalance('1500000', 6, 2); // '1.5'
```

#### `parseUnits(value: string, decimals: number): bigint`

Parse human-readable value to smallest unit.

```typescript
const wei = sdk.parseUnits('1.5', 18); // 1500000000000000000n
const usdc = sdk.parseUnits('100', 6); // 100000000n
```

#### `formatUnits(value: bigint, decimals: number): string`

Format smallest unit to human-readable string.

```typescript
const formatted = sdk.formatUnits(1500000000000000000n, 18); // '1.5'
```

#### `isValidAddress(address: string): boolean`

Validate if a string is a valid Ethereum address.

```typescript
const isValid = sdk.isValidAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // true
const isInvalid = sdk.isValidAddress('invalid'); // false
```

#### `truncateAddress(address: string, startLength?: number, endLength?: number): string`

Truncate an address for display purposes.

```typescript
const short = sdk.truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'); // '0x742d...4Db45'
const custom = sdk.truncateAddress('0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45', 8, 6); // '0x742d35...4b4Db45'
```

#### `chainIdToHex(chainId: number): string` / `hexToChainId(hex: string): number`

Convert between chain ID formats.

```typescript
const hex = sdk.chainIdToHex(137); // '0x89'
const decimal = sdk.hexToChainId('0x89'); // 137
```

---

### Event Hooks & Listeners

#### `setOnIntentHook(callback: OnIntentHook): void`

Sets a callback to handle intent approval flows (e.g., user confirmation for bridging/transfer intent).

```typescript
sdk.setOnIntentHook(({ intent, allow, deny, refresh }) => {
  // Show intent details to user
  // Call allow(), deny(), or refresh() as needed
});
```

#### `setOnAllowanceHook(callback: OnAllowanceHook): void`

Sets a callback to handle allowance approval flows (e.g., user confirmation for setting allowances).

```typescript
sdk.setOnAllowanceHook(async ({ allow, deny, sources }) => {
  // Show allowance requirements to user
  // Call allow([...]), or deny() as needed
});
```

#### `onAccountChanged(callback: (account: string) => void): void`

Subscribes to account change events from the provider.

```typescript
sdk.onAccountChanged((account) => {
  // Handle account change
});
```

#### `onChainChanged(callback: (chainId: number) => void): void`

Subscribes to chain/network change events from the provider.

```typescript
sdk.onChainChanged((chainId) => {
  // Handle chain change
});
```

#### `on(eventName: string, listener: (...args: any[]) => void): void`

Subscribes to any event emitted by the underlying CA SDK.

```typescript
sdk.on('expected_steps', (data) => {
  // Handle custom event
});
```

#### `removeListener(eventName: string, listener: (...args: any[]) => void): void`

Removes a specific event listener.

```typescript
sdk.removeListener('expected_steps', myListener);
```

#### `removeAllListeners(): void`

Removes all event listeners from the SDK.

```typescript
sdk.removeAllListeners();
```

#### `removeAllCaEventListeners(eventName?: string): void`

Removes all listeners for a specific CA event, or all if no event is specified.

```typescript
sdk.removeAllCaEventListeners('expected_steps');
```

---

### Utility & Advanced Methods

#### `isSupportedChain(chainId: number): boolean`

Checks if a chain is supported by the SDK.

```typescript
if (sdk.isSupportedChain(137)) {
  // Supported
}
```

#### `isSupportedToken(token: string): boolean`

Checks if a token is supported by the SDK.

```typescript
if (sdk.isSupportedToken('USDC')) {
  // Supported
}
```

#### `getSupportedChains(): Array<{ id: number; name: string; logo: string }>`

Returns a list of supported chains from the CA SDK.

```typescript
const chains = sdk.getSupportedChains();
```

#### `request(args: RequestArguments): Promise<unknown>`

Make a generic EIP-1193 request to the provider.

```typescript
const result = await sdk.request({
  method: 'eth_getBalance',
  params: ['0x...', 'latest'],
});
```

#### `preprocess(args: PreSendTxParams, options?: PreProcessOptions): Promise<void>`

Preprocess a transaction for validation or gas estimation.

```typescript
await sdk.preprocess({
  to: '0x...',
  value: '0x1',
});
```

---

## Constants & Types

### Available Constants

```typescript
import {
  SUPPORTED_CHAINS,
  TOKEN_METADATA,
  TESTNET_TOKEN_METADATA,
  CHAIN_METADATA,
  NEXUS_EVENTS,
  MAINNET_CHAINS,
  TESTNET_CHAINS,
  isMainnetChain,
  isTestnetChain,
  Network,
} from '@avail/nexus-sdk';

// Mainnet Chain IDs
console.log(SUPPORTED_CHAINS.ETHEREUM); // 1
console.log(SUPPORTED_CHAINS.POLYGON); // 137

// Testnet Chain IDs 🧪 NEW
console.log(SUPPORTED_CHAINS.ETHEREUM_SEPOLIA); // 11155111
console.log(SUPPORTED_CHAINS.POLYGON_AMOY); // 80002

// Mainnet token metadata
console.log(TOKEN_METADATA.USDC); // { symbol: 'USDC', name: 'USD Coin', decimals: 6, ... }

// Testnet token metadata 🧪 NEW
console.log(TESTNET_TOKEN_METADATA.USDC); // { symbol: 'USDC', name: 'Test USD Coin', decimals: 6, ... }

// Chain metadata (works for both mainnet and testnet)
console.log(CHAIN_METADATA[1]); // { id: 1, name: 'Ethereum', ... }
console.log(CHAIN_METADATA[11155111]); // { id: 11155111, name: 'Ethereum Sepolia', ... }

// Helper arrays 🧪 NEW
console.log(MAINNET_CHAINS); // [1, 10, 137, 42161, 43114, 8453, 59144, 534351]
console.log(TESTNET_CHAINS); // [11155111, 11155420, 80002, 421614, 43113, 84532, 59141, 534352]

// Helper functions 🧪 NEW
console.log(isMainnetChain(1)); // true
console.log(isTestnetChain(11155111)); // true
console.log(isMainnetChain(11155111)); // false

// Network environments 🧪 NEW
console.log(Network.FOLLY); // 0 - Dev with testnet tokens
console.log(Network.CERISE); // 1 - Dev with mainnet tokens
console.log(Network.CORAL); // 2 - Testnet with mainnet tokens

// Event names
console.log(NEXUS_EVENTS.EXPECTED_STEPS); // 'expected_steps'
```

### Available Utility Functions

```typescript
import {
  formatBalance,
  parseUnits,
  formatUnits,
  isValidAddress,
  truncateAddress,
  chainIdToHex,
  hexToChainId,
  getTokenMetadata, // Defaults to mainnet
  getMainnetTokenMetadata,
  getTestnetTokenMetadata,
  getChainMetadata,
  formatTokenAmount,
  formatTestnetTokenAmount,
  isMainnetChain,
  isTestnetChain,
} from '@avail/nexus-sdk';
```

---

## Error Handling

The SDK throws descriptive errors for various scenarios:

```typescript
try {
  await sdk.bridge({
    token: 'INVALID_TOKEN',
    amount: 10,
    chainId: 137,
  });
} catch (error) {
  console.error(error.message); // "Unsupported token"
}
```

Common error scenarios:

- `"CA SDK not initialized. Call initialize() first."` - SDK not initialized
- `"Unsupported chain"` - Chain ID not supported
- `"Unsupported token"` - Token symbol not supported
- `"Provider is required"` - No provider passed to initialize
- `"Failed to initialize CA SDK"` - Provider initialization failed

---

## TypeScript Support

The SDK is fully typed with comprehensive TypeScript definitions:

```typescript
import type {
  TokenMetadata,
  ChainMetadata,
  TokenBalance,
  BridgeParams,
  TransferParams,
} from '@avail/nexus-sdk';
```

---

## Testnet Usage 🧪

The SDK now provides comprehensive testnet support with dedicated metadata and helper functions.

### Working with Testnets

```typescript
import { NexusSDK, SUPPORTED_CHAINS, isTestnetChain, isMainnetChain } from '@avail/nexus-sdk';

const sdk = new NexusSDK();
await sdk.initialize(provider);

// Check if current chain is testnet
const currentChainId = 11155111; // Ethereum Sepolia
console.log(isTestnetChain(currentChainId)); // true
console.log(isMainnetChain(currentChainId)); // false

// Get testnet token metadata
const testUSDC = sdk.getTestnetTokenMetadata('USDC');
console.log(testUSDC.name); // "Test USD Coin"

// Bridge on testnet (same API as mainnet)
await sdk.bridge({
  token: 'USDC',
  amount: 10,
  chainId: SUPPORTED_CHAINS.POLYGON_AMOY, // Polygon testnet
});

// Transfer on testnet
await sdk.transfer({
  token: 'ETH',
  amount: 0.1,
  chainId: SUPPORTED_CHAINS.ETHEREUM_SEPOLIA,
  recipient: '0x...',
});
```

### Testnet Chain Examples

```typescript
// All supported testnet chains
const testnetChains = [
  SUPPORTED_CHAINS.ETHEREUM_SEPOLIA, // 11155111
  SUPPORTED_CHAINS.BASE_SEPOLIA, // 84532
  SUPPORTED_CHAINS.ARBITRUM_SEPOLIA, // 421614
  SUPPORTED_CHAINS.OPTIMISM_SEPOLIA, // 11155420
  SUPPORTED_CHAINS.POLYGON_AMOY, // 80002
  SUPPORTED_CHAINS.AVALANCHE_FUJI, // 43113
  SUPPORTED_CHAINS.LINEA_SEPOLIA, // 59141
  SUPPORTED_CHAINS.SCROLL_SEPOLIA, // 534352
];

// Get metadata for any testnet chain
const sepoliaMetadata = sdk.getChainMetadata(SUPPORTED_CHAINS.ETHEREUM_SEPOLIA);
console.log(sepoliaMetadata.name); // "Ethereum Sepolia"
console.log(sepoliaMetadata.rpcUrls[0]); // "https://rpc.sepolia.org"
```

### Testnet vs Mainnet Token Formatting

```typescript
// Format mainnet tokens
const mainnetFormatted = sdk.formatTokenAmount('1000000', 'USDC'); // Uses mainnet decimals
console.log(mainnetFormatted); // "1 USDC"

// Format testnet tokens
const testnetFormatted = sdk.formatTestnetTokenAmount('1000000', 'USDC'); // Uses testnet decimals
console.log(testnetFormatted); // "1 USDC" (same result, but uses testnet metadata)

// Compare metadata
const mainnetUSDC = sdk.getMainnetTokenMetadata('USDC');
const testnetUSDC = sdk.getTestnetTokenMetadata('USDC');
console.log(mainnetUSDC.name); // "USD Coin"
console.log(testnetUSDC.name); // "Test USD Coin"
```

---

## Examples

### Complete Bridge Example

```typescript
import { NexusSDK, SUPPORTED_CHAINS } from '@avail/nexus-sdk';

const sdk = new NexusSDK();

// Initialize
await sdk.initialize(window.ethereum);

// Set up hooks
sdk.setOnIntentHook(({ intent, allow, deny }) => {
  // Show user the intent details and fees
  console.log('Intent:', intent);
  allow(); // User approves
});

sdk.setOnAllowanceHook(async ({ sources, allow, deny }) => {
  // Show user allowance requirements
  console.log('Allowances needed:', sources);
  allow(['min']); // Set min,max or custom allowances
});

// Bridge USDC from Ethereum to Polygon
await sdk.bridge({
  token: 'USDC',
  amount: 100,
  chainId: SUPPORTED_CHAINS.POLYGON,
});
```

### Balance Management Example

```typescript
// Get all balances
const allBalances = await sdk.getUnifiedBalances();

// Get specific token balance
const usdcBalance = await sdk.getFormattedTokenBalance('USDC');
console.log(`Total USDC: ${usdcBalance?.formattedBalance}`);

// Get token balance on specific chain
const polygonUSDC = await sdk.getFormattedTokenBalance('USDC', 137);
console.log(`Polygon USDC: ${polygonUSDC?.formattedBalance}`);

// Format balances manually
const formatted = sdk.formatBalance('1500000', 6, 2); // '1.5'
```

### Utility Functions Example

```typescript
// Address validation and formatting
const address = '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45';
if (sdk.isValidAddress(address)) {
  const short = sdk.truncateAddress(address); // '0x742d...4Db45'
}

// Unit conversion
const wei = sdk.parseUnits('1.5', 18); // 1500000000000000000n
const eth = sdk.formatUnits(wei, 18); // '1.5'

// Chain utilities
const hex = sdk.chainIdToHex(137); // '0x89'
const decimal = sdk.hexToChainId('0x89'); // 137
```

---

## License

MIT
