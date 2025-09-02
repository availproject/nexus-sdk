# Nexus SDK

A powerful TypeScript SDK for cross-chain operations, token bridging, and unified balance management across multiple EVM chains.

## Packages

This monorepo contains two main packages:

### [@avail-project/nexus](./packages/core/)

**Headless SDK for cross-chain operations**

- No React dependencies
- Direct chain abstraction integration

```bash
npm install @avail-project/nexus
```

[📖 Core Documentation](./packages/core/README.md)

### [@avail-project/nexus-widgets](./packages/widgets/)

**React components for cross-chain transactions**

- Ready-to-use React widgets
- Drop-in bridge, transfer, bridge-and-execute and execute components

```bash
npm install @avail-project/nexus-widgets
```

[Widgets Documentation](./packages/widgets/README.md)

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

## Supported Tokens

| Token | Networks       |
| ----- | -------------- |
| ETH   | All EVM chains |
| USDC  | All supported  |
| USDT  | All supported  |

## 🚀 Quick Examples

### Headless SDK

```typescript
import { NexusSDK } from '@avail-project/nexus';

const sdk = new NexusSDK({ network: 'mainnet' });
await sdk.initialize(provider);

// Bridge tokens
const result = await sdk.bridge({
  token: 'USDC',
  amount: 100,
  chainId: 137,
});
```

### React Widgets

```typescript
import { NexusProvider, BridgeButton } from '@avail-project/nexus-widgets';

function App() {
  return (
    <NexusProvider config={{ network: 'mainnet' }}>
      <BridgeButton prefill={{ token: 'USDC', amount: '100', chainId: 137 }}>
        {({ onClick, isLoading }) => (
          <button onClick={onClick} disabled={isLoading}>
            Bridge USDC
          </button>
        )}
      </BridgeButton>
    </NexusProvider>
  );
}
```

## Documentation

- [Core SDK Documentation](./packages/core/README.md) - Headless SDK API reference
- [Widgets Documentation](./packages/widgets/README.md) - React components guide
- [API Documentation](https://docs.availproject.org/api-reference/avail-nexus-sdk)

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

MIT
