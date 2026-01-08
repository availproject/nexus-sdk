# Swap (Exact Out) Example

A **Vite + TypeScript** web application demonstrating exact-output token swapping using Nexus SDK's `swapWithExactOut` method.

## 🎯 Purpose

This example showcases:
- **Exact Output Swaps**: Specify exact amount to receive, pay minimum required input
- **Target-Based Trading**: Perfect for precise portfolio rebalancing and payment needs
- **Cross-chain Swaps**: Seamlessly obtain exact amounts across different networks
- **Cost Optimization**: Automatically finds most cost-effective input amount

## 📋 Prerequisites

- **Node.js 18+** and npm
- **EIP-1193 Wallet** (MetaMask, Rabby, Rainbow, Brave, Phantom)
- **Token Funds**: Various tokens on Arbitrum mainnet (default configuration)
- **Browser Extension**: Wallet extension installed and enabled

> ⚠️ **Mainnet Warning**: Default configuration uses mainnet tokens and will spend real funds. Reduce amounts or switch to testnet for safe experimentation.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Fund Your Wallet

Obtain tokens for swapping:
- **Multiple Options**: ETH, USDC, USDT on Arbitrum mainnet
- **Sufficient Balance**: Need enough tokens to cover the exact output plus gas
- **Testnet Alternative**: Use testnet faucets for risk-free testing

### 3. Run Application

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Execute Exact-Out Swap

1. **Connect Wallet**: Click "Connect Wallet" and approve in wallet
2. **Set Target**: Enter exact amount you want to receive
3. **Review Quote**: Check required input amount and cost
4. **Approve Tokens**: Approve token spending if required
5. **Execute Swap**: Click "Swap" and confirm transactions
6. **Monitor Progress**: Watch real-time swap completion

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

#### `nexus.ts` - Exact-Out Swap Logic
```typescript
// SDK initialization
const sdk = new NexusSDK({ network: 'mainnet' });
await sdk.initialize(provider);

// Exact-out swap parameters
const swapParams = {
  toChainId: 42161,                    // Arbitrum mainnet
  toTokenAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb', // USDT target
  toAmount: 1000000000n                 // Exactly 1000 USDT (6 decimals)
};

// Execute exact-out swap
sdk.swapWithExactOut(swapParams, {
  onEvent: (event) => {
    // Handle swap progress events
  }
});
```

### Swap Process Flow

1. **Target Analysis**: SDK determines optimal source tokens for exact output
2. **Route Calculation**: Finds best paths across multiple DEXs
3. **Input Estimation**: Calculates minimum input required for exact output
4. **Token Selection**: Chooses most cost-effective source tokens
5. **Swap Execution**: Executes swap through optimal DEX route
6. **Verification**: Confirms exact output amount received

## 📊 Understanding Exact-Out Swaps

### Exact-Out vs Exact-In Comparison

| Feature | Exact-Out (`swapWithExactOut`) | Exact-In (`swapWithExactIn`) |
|---------|-----------------------------|------------------------------|
| **Output** | Fixed (guaranteed) | Variable (subject to slippage) |
| **Input** | Variable (minimum required) | Fixed (user-specified) |
| **Use Case** | "I need exactly 1000 USDT for payment" | "I have 500 USDC to swap for max" |
| **Best For** | Target payments, portfolio targets | General trading, spending available funds |

### Input Token Selection

The SDK automatically considers all available tokens:
- **ETH**: Native gas token
- **USDC**: Stablecoin with high liquidity
- **USDT**: Tether stablecoin
- **WBTC**: Wrapped Bitcoin
- **Other Tokens**: Based on wallet balances and DEX availability

### Cost Optimization Algorithm

```typescript
// SDK's optimization process
const optimizeForExactOut = async (toAmount, toToken) => {
  const allAvailableTokens = await getWalletBalances();
  const possibleRoutes = [];
  
  for (const token of allAvailableTokens) {
    const route = await calculateRoute(token, toToken, toAmount);
    possibleRoutes.push(route);
  }
  
  return selectOptimalRoute(possibleRoutes); // Minimizes input cost
};
```

## 🎨 UI Features

### Target-Oriented Interface

- **Target Amount**: Fixed amount you want to receive
- **Input Estimation**: Shows minimum required from each token
- **Cost Comparison**: Displays different token input costs
- **Optimal Selection**: Highlights most cost-effective input token

### Progress Tracking

| Step | Description | UI Indicator |
|-------|-------------|--------------|
| **Route Analysis** | Finding optimal input tokens | 🔍 Analyzing |
| **Input Estimation** | Calculating required amounts | 🧮 Computing |
| **Token Selection** | Choosing best input token | 🎯 Optimizing |
| **Swap Executing** | Performing swap transaction | 🔄 Swapping |
| **Verification** | Confirming exact output received | ✅ Complete |

### Multi-Token Cost Display

```
Target: 1,000 USDT

Required Input Options:
• 502.5 ETH   ($1,001.20) ⭐ Recommended
• 1,001.3 USDC ($1,001.30) 
• 1,000.8 USDT ($1,000.80)
• 0.025 WBTC   ($1,002.50)

Estimated Gas: $2.50 (included above)
Total Cost: Most efficient option shown
```

## 🔧 Customization

### Modify Swap Parameters

Edit `src/nexus.ts`:

```typescript
export const swapParams = {
  toChainId: 42161,                        // Destination chain
  toTokenAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb', // Target token contract
  toAmount: 1000000000n,                           // Exact target amount (6 decimals)
};
```

### Common Target Token Addresses

| Token | Symbol | Decimals | Arbitrum Mainnet | Arbitrum Sepolia |
|-------|--------|----------|-----------------|-----------------|
| USD Coin | USDC | 6 | `0x75faf114e29164470b99d6e18c65f18b8e3f5544` |
| Tether USD | USDT | 6 | `0x6Ee6F34B03E05C85C03C754c8c50D2591a894f5` |
| Ethereum | ETH | 18 | Native | Native |
| Wrapped BTC | WBTC | 8 | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` |

### Cross-Chain Exact-Out Swaps

```typescript
// Arbitrum to Ethereum exact-out
const crossChainParams = {
  toChainId: 1,                        // Ethereum mainnet
  toTokenAddress: '0xA0b86a33E6441b8e8C7C7b0b8e8e8e8e8e', // USDC on Ethereum
  toAmount: 1000000n                       // Exactly 1 USDC
};

// Polygon to Arbitrum exact-out
const polygonToArbitrumParams = {
  toChainId: 42161,                     // Arbitrum
  toTokenAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb', // USDT on Arbitrum
  toAmount: 1000000n                     // Exactly 1 USDT
};
```

### Testnet Configuration

```typescript
// Switch to testnet for safe testing
const sdk = new NexusSDK({ network: 'testnet' });

const testnetParams = {
  toChainId: 421614,                     // Arbitrum Sepolia
  toTokenAddress: '0x6Ee6F34B03E05C85C03C754c8c50D2591a894f5', // USDT Sepolia
  toAmount: 1000000n                 // Exactly 1 USDT testnet
};
```

**Current Code Configuration**: The example defaults to mainnet with 1 USDT. For safe testing, either:
1. Use the testnet configuration above
2. Or modify the existing mainnet params to use smaller amounts

## 🛡️ Security Considerations

### Input Token Verification

```typescript
// Verify input token contracts are legitimate
const WHITELISTED_TOKENS = {
  '0xA0b86a33E6441b8e8C7C7b0b8e8e8e8e8e': 'USDC',
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb': 'USDT',
  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': 'WBTC'
};

if (!WHITELISTED_TOKENS[inputTokenAddress]) {
  console.warn('Warning: Input token not in whitelist');
}
```

### Output Verification

```typescript
// Confirm exact output amount received
const validateExactOutput = (expectedAmount, actualAmount) => {
  const tolerance = 100n; // Small tolerance for rounding
  return actualAmount >= expectedAmount - tolerance;
};
```

### Maximum Amount Protection

```typescript
// Prevent excessive swaps
const MAX_TARGET_AMOUNTS = {
  USDT: 10000000000n,    // 10,000 USDT maximum
  USDC: 10000000000n,     // 10,000 USDC maximum
  ETH: 1000000000000000000n // 1,000 ETH maximum
};

if (swapParams.toAmount > MAX_TARGET_AMOUNTS[targetToken]) {
  throw new Error('Target amount exceeds safety limit');
}
```

## 🐛 Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **Insufficient input liquidity** | Not enough tokens for target output | Increase target network or try different target token |
| **High input cost** | Low liquidity for target token | Use smaller target amount or choose different timing |
| **Slippage exceeded** | Market moved during swap | Retry with slightly higher target or wait |
| **Route calculation failed** | No valid swap paths available | Try different input tokens or target amounts |

### Error Recovery

```typescript
// Enhanced error handling with fallback
const executeWithFallback = async (primaryParams) => {
  try {
    return await sdk.swapWithExactOut(primaryParams);
  } catch (error) {
    console.error('Primary swap failed:', error);
    
    // Fallback: try with smaller amount
    const fallbackParams = {
      ...primaryParams,
      toAmount: primaryParams.toAmount * 0.95n // 5% less
    };
    
    return await sdk.swapWithExactOut(fallbackParams);
  }
};
```

### Performance Optimization

```typescript
// Cache route calculations for better UX
const routeCache = new Map();

const getCachedRoute = async (params) => {
  const cacheKey = `${params.toChainId}-${params.toTokenAddress}-${params.toAmount}`;
  
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }
  
  const route = await sdk.simulateSwapWithExactOut(params);
  routeCache.set(cacheKey, route);
  
  // Cache for 30 seconds
  setTimeout(() => routeCache.delete(cacheKey), 30000);
  
  return route;
};
```

## 📚 Advanced Features

### Target-Based Rebalancing

```typescript
// Portfolio rebalancing using exact-out
const targetAllocation = {
  ETH: 0.4,    // 40% ETH
  USDC: 0.3,   // 30% USDC  
  USDT: 0.2,   // 20% USDT
  WBTC: 0.1     // 10% WBTC
};

const rebalancePortfolio = async (totalValue) => {
  for (const [token, targetRatio] of Object.entries(targetAllocation)) {
    const targetAmount = totalValue * targetRatio;
    await sdk.swapWithExactOut({
      toChainId: 42161,
      toTokenAddress: TOKEN_ADDRESSES[token],
      toAmount: convertToTokenUnits(targetAmount, token)
    });
  }
};
```

### Dollar-Cost Averaging (DCA)

```typescript
// Regular exact-out swaps for accumulation
const dcaStrategy = {
  targetAmount: 100000000n,  // 100 USDT per swap
  frequency: 7 * 24 * 60 * 60 * 1000, // Weekly
  duration: 52 // 52 weeks (1 year)
};

const executeDCA = async () => {
  for (let week = 0; week < dcaStrategy.duration; week++) {
    try {
      await sdk.swapWithExactOut({
        toChainId: 42161,
        toTokenAddress: USDT_ADDRESS,
        toAmount: dcaStrategy.targetAmount
      });
      
      console.log(`Week ${week + 1}: DCA swap completed`);
    } catch (error) {
      console.error(`Week ${week + 1}: DCA failed:`, error);
    }
    
    // Wait for next interval
    await new Promise(resolve => setTimeout(resolve, dcaStrategy.frequency));
  }
};
```

### Payment Processing

```typescript
// Exact-out for invoice payments
const processPayment = async (invoice) => {
  const paymentParams = {
    toChainId: invoice.currencyChain,
    toTokenAddress: invoice.tokenAddress,
    toAmount: invoice.amount // Exact amount needed for payment
  };
  
  try {
    const result = await sdk.swapWithExactOut(paymentParams);
    
    // Verify payment was successful
    if (validateExactOutput(invoice.amount, result.outputAmount)) {
      await markInvoicePaid(invoice.id, result.transactionHash);
      sendConfirmation(invoice.recipient, result);
    }
  } catch (error) {
    await markInvoiceFailed(invoice.id, error);
    notifyPaymentFailure(invoice, error);
  }
};
```

## 🐛 Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **Target amount unavailable** | Insufficient liquidity for exact output | Reduce target amount or try different token |
| **High input cost** | Low liquidity for target token | Use smaller target or different timing |
| **Route calculation failed** | No valid swap paths available | Try different input tokens or targets |
| **Approval insufficient** | Token approval too low for swap | Increase approval amount or use max approval |

### Error Analysis

```typescript
// Analyze failed exact-out swaps
const analyzeSwapFailure = (error, targetAmount) => {
  if (error.message.includes('insufficient liquidity')) {
    console.log('Try reducing target amount:', targetAmount * 0.9n);
  }
  
  if (error.message.includes('route not found')) {
    console.log('Try alternative input tokens or different target token');
  }
};
```

## 📖 Related Examples

- **[Exact In Swap](../swap-with-exact-in/)** - Fixed input, variable output swaps
- **[Bridge Examples](../bridge/)** - Cross-chain token transfers
- **[Bridge + Transfer](../bridge-and-transfer/)** - Combined operations
- **[Node.js Examples](../../node/)** - Backend implementations

---

**💡 Pro Tip**: Exact-out swaps are perfect for payment processing, portfolio rebalancing, and any scenario where you need to receive a specific amount. The SDK automatically optimizes for the most cost-effective input, ensuring you get your target amount at the lowest possible cost.
