# Nexus SDK

A TypeScript SDK for seamless cross-chain token operations and unified balance management.

## Installation

```bash
npm install @avail/nexus-sdk
```

## Features

- 🔄 Cross-chain token bridging
- 💰 Unified balance across chains
- 🔐 Token allowance management
- 🌉 Token transfers across chains
- 🔌 Event hooks for transaction status
- ⚡ Support for multiple EVM chains
- 🛠️ Comprehensive utility functions
- 📊 Enhanced metadata for chains and tokens
- 🎯 Advanced balance formatting and parsing
- ✅ Address validation and formatting

## Quick Start

```typescript
import { NexusSDK } from '@avail/nexus-sdk';

// Initialize SDK
const sdk = new NexusSDK();
await sdk.initialize(provider); // Your Web3 provider

// Get unified balances
const balances = await sdk.getUnifiedBalances();

// Bridge tokens
await sdk.bridge({
  token: 'USDC',
  amount: 1, // number or string
  chainId: 137, // to Polygon
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

| Network   | Chain ID | Native Currency | Block Time |
| --------- | -------- | --------------- | ---------- |
| Ethereum  | 1        | ETH             | 12s        |
| Optimism  | 10       | ETH             | 2s         |
| Polygon   | 137      | MATIC           | 2s         |
| Fuel      | 122      | ETH             | -          |
| Arbitrum  | 42161    | ETH             | 1s         |
| Avalanche | 43114    | AVAX            | 2s         |
| Base      | 8453     | ETH             | 2s         |
| Linea     | 59144    | ETH             | 12s        |
| Scroll    | 534351   | ETH             | 3s         |

## Supported Tokens

| Token | Name       | Decimals | Type   |
| ----- | ---------- | -------- | ------ |
| ETH   | Ethereum   | 18       | Native |
| USDC  | USD Coin   | 6        | ERC-20 |
| USDT  | Tether USD | 6        | ERC-20 |

## API Reference

### Initialization

#### `initialize(provider: EthereumProvider): Promise<void>`

Initializes the SDK with a Web3/EVM provider. Must be called before any other method.

```typescript
await sdk.initialize(window.ethereum);
```

#### `deinit(): Promise<void>`

Deinitializes the SDK and cleans up resources.

```typescript
await sdk.deinit();
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

#### `getTokenBalance(symbol: string, chainId?: number): Promise<TokenBalance | undefined>` 🆕

Get token balance for a specific token, optionally on a specific chain.

```typescript
// Get USDC balance on Polygon
const polygonUSDC = await sdk.getTokenBalance('USDC', 137);

// Get total USDC balance across all chains
const totalUSDC = await sdk.getTokenBalance('USDC');
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

#### `getAllowance(params: AllowanceParams): Promise<AllowanceResponse[]>`

Gets the allowance for specified tokens on a given chain.

```typescript
const allowances = await sdk.getAllowance({
  chainId: 137,
  tokens: ['USDC', 'USDT'],
});
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

#### `getSupportedTokens(): TokenMetadata[]`

Get comprehensive metadata for all supported tokens.

```typescript
const tokens = sdk.getSupportedTokens();
// Returns: [{ symbol: 'ETH', name: 'Ethereum', decimals: 18, icon: '...', coingeckoId: 'ethereum', isNative: true }, ...]
```

#### `getChainMetadata(chainId: number): ChainMetadata | undefined`

Get detailed metadata for a specific chain.

```typescript
const ethMetadata = sdk.getChainMetadata(1);
// Returns: { id: 1, name: 'Ethereum Mainnet', shortName: 'eth', logo: '...', nativeCurrency: {...}, rpcUrls: [...], ... }
```

#### `getSupportedChainsWithMetadata(): ChainMetadata[]`

Get enhanced metadata for all supported chains.

```typescript
const chains = sdk.getSupportedChainsWithMetadata();
```

#### `getSupportedTokenSymbols(): string[]`

Get array of supported token symbols.

```typescript
const symbols = sdk.getSupportedTokenSymbols(); // ['ETH', 'USDC', 'USDT']
```

```typescript
const chainIds = sdk.getSupportedChainIds(); // [1, 10, 137, 42161, ...]
```

#### `getSupportedChainIds(): number[]`

Get array of supported chain IDs.

```typescript
const chainIds = sdk.getSupportedChainIds(); // [1, 10, 137, 42161, ...]
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
import { SUPPORTED_CHAINS, TOKEN_METADATA, CHAIN_METADATA, NEXUS_EVENTS } from '@avail/nexus-sdk';

// Chain IDs
console.log(SUPPORTED_CHAINS.ETHEREUM); // 1
console.log(SUPPORTED_CHAINS.POLYGON); // 137

// Token metadata
console.log(TOKEN_METADATA.USDC); // { symbol: 'USDC', name: 'USD Coin', decimals: 6, ... }

// Chain metadata
console.log(CHAIN_METADATA[1]); // { id: 1, name: 'Ethereum Mainnet', ... }

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
const usdcBalance = await sdk.getTokenBalance('USDC');
console.log(`Total USDC: ${usdcBalance?.formattedBalance}`);

// Get token balance on specific chain
const polygonUSDC = await sdk.getTokenBalance('USDC', 137);
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
