# Nexus SDK

A powerful TypeScript SDK for cross-chain operations, token bridging, and unified balance management across multiple EVM chains.

## Packages

This monorepo contains two main packages:

### [@avail-project/nexus-core](./packages/core/)

**Headless SDK for cross-chain operations**

- No React dependencies
- Direct chain abstraction integration

```bash
npm install @avail-project/nexus-core
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

**Testnet Chains:**

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
import { NexusSDK } from '@avail-project/nexus-core';

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

## Monorepo & Workspace

- Packages live under `packages/` and are linked via pnpm workspaces.
- Internal shared code stays in `@nexus/commons` (private). It is imported in source during development and bundled into `dist/commons` at build so consumers never install it directly.
- Published package names used everywhere (dev and build):
  - `@avail-project/nexus-core`
  - `@avail-project/nexus-widgets`

### TS path mapping for local DX

- Dev imports use published names while resolving locally:
  - Root `tsconfig.json` maps `@avail-project/nexus-core` → `packages/core/*`
  - Widgets `tsconfig.json` also maps `@avail-project/nexus-core` → `../core/*`
- Keep importing `@nexus/commons` in source; build rewrites it to `./commons` inside the dist.

### Workspace versions and overrides

- Root `package.json` defines pnpm overrides to pin shared versions:
  - `typescript`, `rollup`, `decimal.js`, `viem`
- Update once for all packages:

```bash
pnpm -r up typescript rollup decimal.js viem
```

## Releases & Scripts

- Scripts live in `scripts/`. Both core and widgets have an interactive wizard and CI-friendly flags.
- Commons is always bundled; it is removed from published dependencies.

### Dev (pre-release) policy

- Pre-release numbers progress `0..9` and roll over to the next patch:
  - `0.0.2-beta.0 → 0.0.2-beta.1 … → 0.0.2-beta.9 → 0.0.3-beta.0`
- Widgets depends on the most recently published core prerelease by publish time (not by semver magnitude).

### Flags

- `--yes` or `--ci`: skip interactive prompts (useful in CI)
- `--dry-run` or `-n`: simulate publish (runs `npm pack`, skips git push/tag)

### Core examples

```bash
# Interactive dev prerelease (choose tag like beta/alpha/dev)
./scripts/release-core.sh

# Non-interactive dev prerelease (beta), dry-run
./scripts/release-core.sh dev patch beta --yes --dry-run

# Non-interactive dev prerelease (beta), publish for real
./scripts/release-core.sh dev patch beta --yes

# Production release (patch)
./scripts/release-core.sh prod patch --yes
```

### Widgets examples

```bash
# Interactive dev prerelease (requires a matching core prerelease on npm)
./scripts/release-widgets.sh

# Non-interactive dev prerelease (beta), resolves latest core beta by timestamp, dry-run
./scripts/release-widgets.sh dev patch beta --yes --dry-run

# Production release (patch) – ensure core is published first
./scripts/release-widgets.sh prod patch --yes
```

### Local tarballs (no publish)

```bash
# Build and create .tgz files for local install
./scripts/local-pack.sh

# In another project
pnpm add /absolute/path/to/dist-tarballs/avail-project-nexus-core-*.tgz \
         /absolute/path/to/dist-tarballs/avail-project-nexus-widgets-*.tgz
```

## License

MIT
