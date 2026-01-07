# Swap (Exact In) Example

A **Vite + TypeScript** web application demonstrating exact-input token swapping using Nexus SDK's `swapWithExactIn` method.

## 🎯 Purpose

This example showcases:
- **Exact Input Swaps**: Specify exact input amount, receive maximum output
- **Cross-chain Swaps**: Seamlessly swap tokens across different networks
- **Real-time Pricing**: Live slippage and pricing information
- **DEX Integration**: Access to multiple decentralized exchanges

## 📋 Prerequisites

- **Node.js 18+** and npm
- **EIP-1193 Wallet** (MetaMask, Rabby, Rainbow, Brave, Phantom)
- **Token Funds**: USDT on Arbitrum mainnet (default configuration)
- **Browser Extension**: Wallet extension installed and enabled

> ⚠️ **Mainnet Warning**: Default configuration uses mainnet tokens and will spend real funds. Reduce amounts or switch to testnet for experimentation.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Fund Your Wallet

Obtain tokens for swapping:
- **Mainnet**: Acquire USDT on Arbitrum via DEX or bridge
- **Testnet**: Use testnet faucets for safe experimentation
- **Minimum Amount**: At least equivalent of $10 USD for testing

### 3. Run the Application

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Execute Exact-In Swap

1. **Connect Wallet**: Click "Connect Wallet" and approve in wallet
2. **Review Swap**: Check input amount and expected output
3. **Approve Token**: Approve USDT spending if required
4. **Execute Swap**: Click "Swap" and confirm transactions
5. **Monitor Progress**: Watch real-time swap progress

## 🔧 Technical Implementation

### Architecture

```
src/
├── main.ts              # Application entry point
├── nexus.ts             # SDK initialization and swap logic
├── screens.ts           # UI components and state management
└── index.html           # HTML template
```

### Key Components

#### `nexus.ts` - Swap Logic Implementation
```typescript
// SDK initialization
const sdk = new NexusSDK({ network: 'mainnet' });
await sdk.initialize(provider);

// Exact-in swap parameters
const swapParams = {
  from: [
    {
      chainId: 42161,          // Arbitrum mainnet
      amount: 1000000000n,     // 1000 USDT (6 decimals)
      tokenAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb' // USDT on Arbitrum
    }
  ],
  toChainId: 42161,            // Same chain (on-chain swap)
  toTokenAddress: '0xA0b86a33E6441b8e8C7C7b0b8e8e8e8e8e8e8e' // USDC on Arbitrum
};

// Execute exact-in swap
sdk.swapWithExactIn(swapParams, {
  onEvent: (event) => {
    // Handle swap progress events
  }
});
```

### Swap Process Flow

1. **Route Discovery**: SDK finds optimal swap routes across DEXs
2. **Price Impact Analysis**: Calculates slippage and price impact
3. **Token Approvals**: Handles necessary token approvals
4. **Swap Execution**: Executes swap through selected DEX
5. **Result Tracking**: Monitors swap completion and final balance

## 📊 Understanding Exact-In Swaps

### Exact-In vs Exact-Out

| Feature | Exact-In (`swapWithExactIn`) | Exact-Out (`swapWithExactOut`) |
|---------|-----------------------------|------------------------------|
| **Input** | Fixed | Variable |
| **Output** | Variable (maximum) | Fixed |
| **Use Case** | "I have 100 USDT, swap to max USDC" | "I need exactly 100 USDC, swap from available USDT" |
| **Slippage** | Output may vary due to slippage | Input may vary due to slippage |

### Price Impact & Slippage

```typescript
// Price impact calculation
const priceImpact = (expectedOutput - actualOutput) / expectedOutput * 100;

// Slippage tolerance (default 0.5%)
const slippageTolerance = 0.005; // 0.5%
const minimumOutput = expectedOutput * (1 - slippageTolerance);
```

### Multi-DEX Routing

The SDK automatically considers:
- **1inch**: Aggregated liquidity across multiple DEXs
- **Uniswap V2/V3**: Direct pool swaps
- **Curve**: Stablecoin optimized swaps
- **Balancer**: Weighted pool swaps
- **SushiSwap**: Alternative DEX routing

## 🎨 UI Features

### Swap Interface

- **Input Field**: Exact amount to swap (fixed)
- **Output Display**: Estimated amount to receive (variable)
- **Price Impact**: Visual indicator of market impact
- **Slippage Warning**: Alerts for high slippage scenarios
- **Route Information**: Shows DEX and hop count

### Progress Tracking

| Step | Description | UI Indicator |
|-------|-------------|--------------|
| **Route Discovery** | Finding optimal swap path | 🔍 Searching |
| **Approval Required** | Token approval needed | ✍️ Approve |
| **Swap Executing** | Swap transaction in progress | 🔄 Swapping |
| **Transaction Complete** | Swap finished successfully | ✅ Complete |
| **Failed** | Swap failed or reverted | ❌ Failed |

## 🔧 Customization

### Modify Swap Parameters

Edit `src/nexus.ts`:

```typescript
export const swapParams = {
  from: [
    {
      chainId: 42161,              // Source chain
      amount: 1000000000n,         // Input amount (6 decimals for USDT)
      tokenAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb' // USDT contract
    }
  ],
  toChainId: 42161,                // Destination chain  
  toTokenAddress: '0xA0b86a33E6441b8e8C7C7b0b8e8e8e8e8e8e' // USDC contract
};
```

### Common Token Addresses

| Token | Symbol | Decimals | Arbitrum Mainnet | Arbitrum Sepolia |
|-------|--------|----------|-----------------|-----------------|
| USD Coin | USDC | 6 | `0x75faf114e29164470b99d6e18c65f18b8e3f5544` |
| Tether USD | USDT | 6 | `0x6Ee6F34B03E05C85C03C754c8c50D2591a894f5` |
| Ethereum | ETH | 18 | Native | Native |
| Wrapped BTC | WBTC | 8 | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` |

### Cross-Chain Swaps

```typescript
// Arbitrum to Ethereum
const crossChainParams = {
  from: [{ chainId: 42161, amount: 1000000000n, tokenAddress: '0x...' }],
  toChainId: 1,                    // Ethereum mainnet
  toTokenAddress: '0xA0b86a33E6441b8e8C7C7b0b8e8e8e8e8e8e' // USDC on Ethereum
};

// Ethereum to Polygon
const ethToPolygonParams = {
  from: [{ chainId: 1, amount: 1000000000n, tokenAddress: '0x...' }],
  toChainId: 137,                   // Polygon mainnet
  toTokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' // USDC on Polygon
};
```

### Testnet Configuration

```typescript
// Switch to testnet for safe testing
const sdk = new NexusSDK({ network: 'testnet' });

const testnetParams = {
  from: [
    {
      chainId: 421614,              // Arbitrum Sepolia
      amount: 1000000n,             // 1 USDT
      tokenAddress: '0x6Ee6F34B03E05C85C03C754c8c50D2591a894f5' // USDT Sepolia
    }
  ],
  toChainId: 421614,               
  toTokenAddress: '0x75faf114e29164470b99d6e18c65f18b8e3f5544' // USDC Sepolia
};
```

**Current Code Configuration**: The example defaults to mainnet with 1 USDT. For safe testing, either:
1. Use the testnet configuration above
2. Or modify the existing mainnet params to use smaller amounts

## 🛡️ Security Considerations

### Front-Running Protection

```typescript
// Maximum slippage protection
const MAX_SLIPPAGE = 0.01; // 1% maximum

if (calculatedSlippage > MAX_SLIPPAGE) {
  throw new Error('Slippage too high, transaction may be front-run');
}
```

### Smart Contract Verification

Always verify token contract addresses:
```typescript
// Official USDT on Arbitrum
const ARBITRUM_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb';

// Verify address matches official contract
if (tokenAddress !== ARBITRUM_USDT) {
  console.warn('Warning: Unofficial token contract detected');
}
```

### Amount Validation

```typescript
// Minimum and maximum swap limits
const MIN_SWAP_AMOUNT = {
  USDT: 1000000n,    // 1 USDT minimum
  USDC: 1000000n     // 1 USDC minimum
};

const MAX_SWAP_AMOUNT = {
  USDT: 100000000000n, // 100,000 USDT maximum
  USDC: 100000000000n  // 100,000 USDC maximum
};
```

## 🐛 Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **Insufficient liquidity** | Low pool liquidity for swap | Try smaller amount or different token pair |
| **High slippage** | Large trade relative to pool | Reduce amount or wait for better timing |
| **Approval failed** | Token approval transaction failed | Check gas settings, retry approval |
| **Swap reverted** | Price moved significantly | Increase slippage tolerance or retry |

### Error Analysis

```typescript
// Enhanced error handling
sdk.swapWithExactIn(swapParams, {
  onEvent: (event) => {
    switch (event.name) {
      case 'SWAP_STEP_COMPLETE':
        if (event.args.error) {
          console.error('Swap step failed:', event.args.error);
          // Show user-friendly error message
          showErrorToUser(formatSwapError(event.args.error));
        }
        break;
      case 'INSUFFICIENT_LIQUIDITY':
        // Suggest alternative amounts or tokens
        suggestAlternatives();
        break;
    }
  }
});
```

### Performance Optimization

```typescript
// Debounce swap requests for better UX
const debouncedSwap = debounce(async (amount) => {
  if (amount >= MIN_SWAP_AMOUNT) {
    const quote = await sdk.simulateSwapWithExactIn({
      ...swapParams,
      from: [{ ...swapParams.from[0], amount }]
    });
    updateUIWithQuote(quote);
  }
}, 500);

// Add to input field onChange
inputElement.addEventListener('input', (e) => {
  debouncedSwap(parseAmount(e.target.value));
});
```

## 📚 Advanced Features

### Multi-Token Swaps

```typescript
// Swap multiple tokens in sequence
const tokenPairs = [
  { from: 'USDT', to: 'USDC' },
  { from: 'USDC', to: 'ETH' },
  { from: 'ETH', to: 'WBTC' }
];

for (const pair of tokenPairs) {
  await sdk.swapWithExactIn(getSwapParams(pair));
}
```

### Price Comparison

```typescript
// Compare with other DEXs for best rate
const nexusQuote = await sdk.simulateSwapWithExactIn(swapParams);
const oneInchQuote = await oneInchAPI.getQuote(swapParams);
const uniswapQuote = await uniswapAPI.getQuote(swapParams);

const bestRate = Math.max(
  nexusQuote.outputAmount,
  oneInchQuote.outputAmount,
  uniswapQuote.outputAmount
);
```

### Automated Swaps

```typescript
// Automated dollar-cost averaging
const automatedSwap = {
  amount: '100000000', // 100 USDT daily
  interval: 24 * 60 * 60 * 1000, // Daily
  targetToken: 'USDC'
};

setInterval(async () => {
  await sdk.swapWithExactIn({
    from: [{ chainId: 42161, amount: automatedSwap.amount, tokenAddress: USDT_ADDRESS }],
    toChainId: 42161,
    toTokenAddress: USDC_ADDRESS
  });
}, automatedSwap.interval);
```

## 🐛 Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **Swap fails** | Insufficient liquidity or price impact too high | Try smaller amount or different token pair |
| **Approval fails** | Token approval transaction failed | Check gas settings, retry approval |
| **Wrong network** | Wallet on incorrect chain | Switch wallet to appropriate network |
| **Route not found** | No available swap path | Try different input/output tokens |

### Error Recovery

```typescript
// Enhanced error handling with retry
const executeWithRetry = async (params, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sdk.swapWithExactIn(params);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
    }
  }
};
```

## 📖 Related Examples

- **[Exact Out Swap](../swap-with-exact-out/)** - Fixed output, variable input swaps
- **[Bridge Examples](../bridge/)** - Cross-chain token transfers
- **[Bridge + Transfer](../bridge-and-transfer/)** - Combined operations
- **[Node.js Examples](../../node/)** - Backend implementations

---

**💡 Pro Tip**: Exact-in swaps are ideal when you have a specific amount to spend and want to maximize what you receive. Always check slippage and compare rates before executing large swaps.
