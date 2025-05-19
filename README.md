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

| Network   | Chain ID |
| --------- | -------- |
| Ethereum  | 1        |
| Optimism  | 10       |
| Polygon   | 137      |
| Fuel      | 122      |
| Arbitrum  | 42161    |
| Avalanche | 43114    |
| Base      | 8453     |
| Linea     | 59144    |
| Scroll    | 534351   |

## Supported Tokens

- ETH
- USDC
- USDT

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

#### `setAllowance(chainId: number, token: string, amount: string): Promise<void>`

Sets the allowance for a token on a specific chain.

```typescript
await sdk.setAllowance(42161, 'USDC', '100000000000'); // Set allowance for USDC on Arbitrum
```

#### `revokeAllowance(chainId: number, token: string): Promise<void>`

Revokes the allowance for a token on a specific chain.

```typescript
await sdk.revokeAllowance(42161, 'USDC');
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

Returns a list of supported chains.

```typescript
const chains = sdk.getSupportedChains();
```

#### `getSupportedTokens(): typeof SUPPORTED_TOKENS`

Returns a list of supported tokens.

```typescript
const tokens = sdk.getSupportedTokens();
```

#### `request(args: RequestArguments): Promise<unknown>`

Makes a generic EIP-1193 request to the provider (advanced usage).

```typescript
const result = await sdk.request({
  method: 'eth_sendTransaction',
  params: [
    /* ... */
  ],
});
```

#### `preprocess(args: PreSendTxParams, options?: PreProcessOptions): Promise<void>`

Preprocesses a transaction (e.g., for gas estimation or validation) before sending.

```typescript
await sdk.preprocess(
  {
    // transaction params
  },
  { bridge: true, extraGas: 100000n },
);
```

---

## Type Definitions

### BridgeParams

```typescript
{
  token: 'ETH' | 'USDC' | 'USDT';
  amount: number;
  chainId: number;
}
```

### TransferParams

```typescript
{
  token: 'ETH' | 'USDC' | 'USDT';
  amount: number;
  chainId: number;
  recipient: `0x${string}`;
}
```

### AllowanceParams

```typescript
{
  chainId: number;
  tokens: string[];
}
```

### UnifiedBalanceResponse

```typescript
{
  symbol: string;
  balance: string;
  balanceInFiat: number;
  decimals: number;
  icon?: string;
  breakdown: {
    chain: {
      id: number;
      name: string;
      logo: string;
    };
    network: 'evm';
    contractAddress: `0x${string}`;
    isNative?: boolean;
    balance: string;
    balanceInFiat: number;
  }[];
}
```

---

## Error Handling

The SDK throws descriptive errors for various scenarios:

- Invalid provider
- Unsupported chains or tokens
- Failed transactions
- Insufficient allowances
- Network errors

## Best Practices

1. Always initialize the SDK with a valid provider before making any calls
2. Check token allowances before bridging or transferring
3. Subscribe to relevant events for tracking transaction status
4. Handle errors appropriately in your application
5. Clean up event listeners when they're no longer needed

## License

MIT
