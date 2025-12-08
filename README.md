# @avail-project/nexus/core

A **headless TypeScript SDK** for **cross-chain operations**, **token bridging**, **swapping**, and **unified balance management** — built for backends, CLIs, and custom UI integrations.

> ⚡ Powering next-generation cross-chain apps with a single interface.

---

## 📦 Installation

```bash
npm install @avail-project/nexus-core
```

---

## 🚀 Quick Start

```typescript
import { NexusSDK, NEXUS_EVENTS } from '@avail-project/nexus-core';

// Initialize SDK
const sdk = new NexusSDK({ network: 'mainnet' });
await sdk.initialize(provider); // Your EVM-compatible wallet provider

// (Optional) Add TRON support
const tronLinkAdapter = new TronLinkAdapter();
sdk.addTron(tronLinkAdapter);

// ---------------------------
// 1️⃣ Get unified balances
// ---------------------------
const balances = await sdk.getUnifiedBalances(false); // false = CA balances only
console.log('Balances:', balances);

// ---------------------------
// 2️⃣ Bridge tokens
// ---------------------------
const bridgeResult = await sdk.bridge(
  {
    token: 'USDC',
    amount: 1_500_000n,
    recipient: '0x...' // Optional
    toChainId: 137, // Polygon
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Bridge steps:', event.args);
      if (event.name === NEXUS_EVENTS.STEP_COMPLETE) console.log('Step completed:', event.args);
    },
  },
);

// ---------------------------
// 3️⃣ Transfer tokens
// ---------------------------
const transferResult = await sdk.bridgeAndTransfer(
  {
    token: 'ETH',
    amount: 1_500_000n,
    toChainId: 1, // Ethereum
    recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Transfer steps:', event.args);
      if (event.name === NEXUS_EVENTS.STEP_COMPLETE) console.log('Step completed:', event.args);
    },
  },
);

// ---------------------------
// 4️⃣ Execute a contract
// ---------------------------
const executeResult = await sdk.execute(
  {
    to: '0x...',
    value: 0n,
    data: '0x...',
    toChainId: 1,
    tokenApproval: { token: 'USDC', amount: 10000n, spender: "0x..."  },
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Execute steps:', event.args);
      if (event.name === NEXUS_EVENTS.STEP_COMPLETE) console.log('Step completed:', event.args);
    },
  },
);

// ---------------------------
// 5️⃣ Bridge and Execute
// ---------------------------
const bridgeAndExecuteResult = await sdk.bridgeAndExecute(
  {
    token: 'USDC',
    amount: 100_000_000n,
    toChainId: 1,
    sourceChains: [8453],
    execute: {
      to: '0x...',
      data: '0x...',
      tokenApproval: { token: 'USDC', amount: 100_000_000n, spender: "0x..." },
    },
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Bridge+Execute steps:', event.args);
      if (event.name === NEXUS_EVENTS.STEP_COMPLETE) console.log('Step completed:', event.args);
    },
  },
);

// ---------------------------
// 6️⃣ Swap tokens
// ---------------------------
const swapResult = await sdk.swapWithExactIn(
  {
    from: [
      { chainId: 10, amount: 1_000_000n, tokenAddress: '0x...' },
    ],
    toChainId: 8453,
    toTokenAddress: '0x...',
  },
  {
    onEvent: (event) => console.log('Swap event:', event),
  },
);

```

---

## ✨ Core Features

- **Cross-chain bridging** — Move tokens seamlessly across 16+ chains.
- **Cross-chain swaps** — Execute EXACT_IN and EXACT_OUT swaps between any supported networks.
- **Unified balances** — Aggregate user assets and balances across all connected chains.
- **Optimized transfers** — Automatically choose the most efficient transfer route.
- **Contract execution** — Call smart contracts with automatic bridging and funding logic.
- **Transaction simulation** — Estimate gas, fees, and required approvals before sending.
- **Complete testnet coverage** — Full multi-chain test environment.
- **Comprehensive utilities** — Address, token, and chain helpers built in.

---

## 🧠 Smart Optimizations

### 🔁 Bridge Skip Optimization

During **bridge-and-execute** operations, the SDK checks whether sufficient funds already exist on the destination chain:

- **Balance detection** — Verifies token and gas availability.
- **Integrated gas supply** — Provides gas alongside bridged tokens.
- **Adaptive bridging** — Skips unnecessary bridging or transfers only the shortfall.
- **Seamless fallback** — Uses chain abstraction if local funds are insufficient.

### ⚡ Direct Transfer Optimization

For transfers, the SDK automatically chooses the most efficient execution path:

- **Local balance checking** — Confirms token and gas availability on the target chain.
- **Direct EVM transfers** — Uses native transfers where possible (faster, cheaper).
- **Chain abstraction fallback** — Uses CA routing only when required.
- **Universal compatibility** — Works with both native tokens (ETH, MATIC) and ERC-20s (USDC, USDT).

---

## 🏗️ Initialization

```typescript
import { NexusSDK, type NexusNetwork } from '@avail-project/nexus-core';

// Mainnet
const sdk = new NexusSDK({ network: 'mainnet' });

// Testnet
const sdkTest = new NexusSDK({ network: 'testnet' });

// Initialize with wallet provider
await sdk.initialize(window.ethereum);
```

---

## 📡 Event Handling

**All main SDK functions support the `onEvent` hook**:

- `bridge`
- `bridgeAndTransfer`
- `execute`
- `bridgeAndExecute`
- `swapWithExactIn` / `swapWithExactOut`

Example usage for **progress steps**:

```typescript
sdk.bridge({...}, {
  onEvent: (event) => {
    if(event.name === NEXUS_EVENTS.STEPS_LIST) {
      // Store list of steps
    } else if(event.name === NEXUS_EVENTS.STEP_COMPLETE) {
      // Mark step as done
    }
  }
});
```

Additional hooks for user interactions:

```typescript
sdk.setOnIntentHook(({ intent, allow, deny, refresh }) => {
  if (userApproves) allow();
  else deny();
});

sdk.setOnSwapIntentHook(({ intent, allow, deny, refresh }) => {
  if (userApproves) allow();
  else deny();
});

sdk.setOnAllowanceHook(({ sources, allow, deny }) => {
  allow(['min']); // 'max' or custom bigint[] supported
});
```

### Consistent Event Pattern

| Operation Type   | Event Name           | Description                             |
| ---------------- | -------------------- | --------------------------------------- |
| Bridge / Execute | `STEPS_LIST`         | Full ordered list of steps emitted once |
|                  | `STEP_COMPLETE`      | Fired per completed step with data      |
| Swap             | `SWAP_STEP_COMPLETE` | Fired per completed step with data      |

All events include `typeID`, `transactionHash`, `explorerURL`, and `error` (if any).

---

## 💰 Balance Operations

```typescript
const unifiedBridgeBalances = await sdk.getBalancesForBridge(); // Returns balances that can be used in bridge operations
---
const swapBalances = await sdk.getBalancesForSwap(); // Returns balances that can be used in swap operations
```

---

## 🌉 Bridge Operations

```typescript
const result = await sdk.bridge({
  token: 'USDC',
  amount: 83_500_000n,
  toChainId: 137,
  recipient: '0x....',
});

const simulation = await sdk.simulateBridge({
  token: 'USDC',
  amount: 83_500_000n,
  toChainId: 137,
  recipient: '0x....',
});
```

---

## 🔁 Transfer Operations

```typescript
const result = await sdk.bridgeAndTransfer({
  token: 'USDC',
  amount: 1_530_000n,
  toChainId: 42161,
  recipient: '0x...',
});
const simulation = await sdk.simulateBridgeAndTransfer({
  token: 'USDC',
  amount: 1_530_000n, // = 1.53 USDC
  toChainId: 42161,
  recipient: '0x...',
});
```

---

## ⚙️ Execute & Bridge + Execute

```typescript
// Direct contract execution
const result = await sdk.execute({
  toChainId: 1,
  to: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
  data: '0x...',
  tokenApproval: { token: 'USDC', amount: 1000000n, spender: '0x...' },
});

// Bridge and execute
const result2 = await sdk.bridgeAndExecute({
  token: 'USDC',
  amount: 100_000_000n,
  toChainId: 1,
  sourceChains: [8453],
  execute: {
    to: '0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE',
    data: '0x...',
    tokenApproval: { token: 'USDC', amount: 100_000_000n, spender: '0x...' },
  },
});
```

---

## 🔄 Swap Operations

```typescript
const swapResult = await sdk.swapWithExactIn(
  {
    from: [{ chainId: 10, amount: 1_000_000n, tokenAddress: '0x...' }],
    toChainId: 8453,
    toTokenAddress: '0x...',
  },
  { onEvent: (event) => console.log(event) },
);
```

### Swap Types

| Type          | Description                                       | Example                     |
| ------------- | ------------------------------------------------- | --------------------------- |
| **EXACT_IN**  | Specify the amount you’re spending; output varies | “Swap 100 USDC for max ETH” |
| **EXACT_OUT** | Specify the amount you’ll receive; input varies   | “Get exactly 1 ETH”         |

---

## 🧩 Intent Management

```typescript
const intents = await sdk.getMyIntents(1);
console.log('Active intents:', intents);
```

---

## 🛠️ Utilities

```typescript
import { CHAIN_METADATA, formatTokenBalance, truncateAddress } from '@avail-project/nexus-core';

const isValid = sdk.utils.isValidAddress('0x...');
const chainMeta = CHAIN_METADATA[137];
const formatted = sdk.utils.formatTokenBalance('0.000294700412452583', {
  symbol: 'ETH',
  decimals: 18,
}); // "~0.0₄2552 ETH"

// Direct imports (no sdk instance required) for stateless helpers:
const directFormatted = formatTokenBalance(12.345678, { symbol: 'USDC' });
const short = truncateAddress('0x1234567890123456789012345678901234567890');
```

---

## 🧾 Error Handling

```typescript
try {
  await sdk.bridge({ token: 'USDC', amount: 1_530_000n, toChainId: 137 });
} catch (err) {
  if (err instanceof NexusError) {
    console.error(`[${err.code}] ${err.message}`);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

---

## 🧠 TypeScript Support

```typescript
import type {
  BridgeParams,
  ExecuteParams,
  TransferParams,
  SwapResult,
  NexusNetwork,
  TokenMetadata,
} from '@avail-project/nexus-core';
```

---

## 📊 Analytics

The Nexus SDK includes **built-in analytics** powered by PostHog to help improve the SDK and understand usage patterns. Analytics are **enabled by default** but can be easily customized or disabled.

### Default Behavior

By default, the SDK sends anonymous telemetry data to Avail's PostHog instance:

- SDK initialization events
- Operation performance metrics
- Session duration and success rates
- Error tracking (without sensitive data)

**No wallet addresses or transaction amounts** are collected unless you explicitly configure custom analytics.

### Disabling Analytics

```typescript
const sdk = new NexusSDK({
  network: 'mainnet',
  analytics: { enabled: false },
});
```

### Privacy Controls

```typescript
const sdk = new NexusSDK({
  network: 'mainnet',
  analytics: {
    enabled: true,
    privacy: {
      anonymizeWallets: true, // Hash wallet addresses
      anonymizeAmounts: true, // Exclude transaction amounts
    },
  },
});
```

### Custom Analytics (BYO PostHog)

You can use your own PostHog instance for custom analytics:

```typescript
const sdk = new NexusSDK({
  network: 'mainnet',
  analytics: {
    enabled: true,
    posthogApiKey: 'your-posthog-key',
    posthogApiHost: 'https://your-posthog-instance.com',
    appMetadata: {
      appName: 'My DApp',
      appVersion: '1.0.0',
      appUrl: 'https://mydapp.com',
    },
  },
});
```

### Accessing Analytics Programmatically

```typescript
// Track custom events
sdk.analytics.track('custom_event', { foo: 'bar' });

// Identify users
sdk.analytics.identify('user-id', { plan: 'premium' });

// Check if analytics is enabled
if (sdk.analytics.isEnabled()) {
  console.log('Analytics active');
}

// Disable analytics at runtime
sdk.analytics.disable();

// Re-enable analytics
sdk.analytics.enable();
```

### Bundle Size Impact

Adding PostHog analytics increases the bundle size by approximately **~50KB gzipped**. The analytics code is tree-shakeable, so if you don't use it, it won't significantly impact your bundle.

---

## 🌐 Supported Networks

### Mainnets

| Network   | Chain ID  | Native | Status |
| --------- | --------- | ------ | ------ |
| Ethereum  | 1         | ETH    | ✅     |
| Optimism  | 10        | ETH    | ✅     |
| Polygon   | 137       | MATIC  | ✅     |
| Arbitrum  | 42161     | ETH    | ✅     |
| Avalanche | 43114     | AVAX   | ✅     |
| Base      | 8453      | ETH    | ✅     |
| Scroll    | 534352    | ETH    | ✅     |
| Sophon    | 50104     | SOPH   | ✅     |
| Kaia      | 8217      | KAIA   | ✅     |
| BNB       | 56        | BNB    | ✅     |
| HyperEVM  | 999       | HYPE   | ✅     |
| TRON      | 728126428 | TRX    | ✅     |

### Testnets

| Network          | Chain ID | Native | Status |
| ---------------- | -------- | ------ | ------ |
| Optimism Sepolia | 11155420 | ETH    | ✅     |
| Polygon Amoy     | 80002    | MATIC  | ✅     |
| Arbitrum Sepolia | 421614   | ETH    | ✅     |
| Base Sepolia     | 84532    | ETH    | ✅     |
| Sepolia          | 11155111 | ETH    | ✅     |
| Monad Testnet    | 10143    | MON    | ✅     |

---

## 💎 Supported Tokens

| Token | Name       | Decimals | Availability   |
| ----- | ---------- | -------- | -------------- |
| ETH   | Ethereum   | 18       | All EVM chains |
| USDC  | USD Coin   | 6        | All supported  |
| USDT  | Tether USD | 6        | All supported  |

---

## 🔗 Resources

- **GitHub:** [availproject/nexus-sdk](https://github.com/availproject/nexus-sdk)
- **Docs:** [docs.availproject.org](https://docs.availproject.org/nexus/avail-nexus-sdk)
