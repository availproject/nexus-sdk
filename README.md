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
  amount: '1000000', // 1 USDC (6 decimals)
  chainId: 137, // to Polygon
});

// Transfer tokens
await sdk.transfer({
  token: 'ETH',
  amount: '1000000000000000000', // 1 ETH
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

### Core Methods

#### Initialize

```typescript
initialize(provider: EthereumProvider): Promise<void>
```

Initialize the SDK with a Web3 provider.

#### Get Balances

```typescript
getUnifiedBalances(): Promise<UnifiedBalanceResponse[]>
getUnifiedBalance(symbol: string): Promise<UnifiedBalanceResponse | undefined>
```

Retrieve unified balances across all supported chains.

#### Bridge and Transfer

```typescript
bridge(params: BridgeParams): Promise<TransactionResponse>
transfer(params: TransferParams): Promise<TransactionResponse>
```

Bridge tokens between chains or transfer to another address.

### Allowance Management

```typescript
getAllowance(params: AllowanceParams): Promise<AllowanceResponse[]>
setAllowance(chainId: number, token: string, amount: string): Promise<void>
revokeAllowance(chainId: number, token: string): Promise<void>
```

### Event Hooks

```typescript
setOnIntentHook(callback: OnIntentHook): void
setOnAllowanceHook(callback: OnAllowanceHook): void
onAccountChanged(callback: (account: string) => void): void
onChainChanged(callback: (chainId: number) => void): void
removeAllListeners(): void
```

## Type Definitions

### BridgeParams

```typescript
{
  token: 'ETH' | 'USDC' | 'USDT';
  amount: string;
  chainId: number;
}
```

### TransferParams

```typescript
{
  token: 'ETH' | 'USDC' | 'USDT';
  amount: string;
  chainId: number;
  recipient: `0x${string}`;
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
