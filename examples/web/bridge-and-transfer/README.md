# Bridge + Transfer Example

A **Vite + TypeScript** web application demonstrating combined cross-chain bridging and on-chain transfer operations using the Nexus SDK.

## 🎯 Purpose

This example showcases advanced cross-chain operations:
- **Bridge + Transfer**: Bridge tokens and immediately transfer to recipient
- **Complex Workflows**: Multi-step cross-chain operations in single transaction
- **Real-time Tracking**: Live progress updates for both bridge and transfer steps
- **Error Handling**: Comprehensive error management for complex operations

## 📋 Prerequisites

- **Node.js 18+** and npm
- **EIP-1193 Wallet** (MetaMask, Rabby, Rainbow, Brave, Phantom)
- **Testnet Funds**: Arbitrum Sepolia USDC for experimentation
- **Browser Extension**: Wallet extension installed and enabled

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Fund Your Wallet

Obtain testnet USDC on any supported chain:
- **Source Options**: Ethereum Sepolia, Optimism Sepolia, Base Sepolia
- **Faucet**: Visit appropriate testnet faucets
- **Bridge**: Use official testnet bridges if needed
- **Amount**: At least 1.5 USDC (1,500,000 units, includes bridge + transfer gas)

### 3. Run the Application

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Execute Bridge + Transfer

1. **Connect Wallet**: Click "Connect Wallet" and approve
2. **Review Parameters**: Check amount, destination, and recipient
3. **Execute Operation**: Click "Bridge + Transfer" 
4. **Monitor Progress**: Watch both bridge and transfer steps complete

## 🔧 Technical Implementation

### Architecture

```
src/
├── main.ts              # Application entry point
├── nexus.ts             # SDK and bridge+transfer logic
├── screens.ts           # UI components and state management
└── index.html           # HTML template
```

### Key Components

#### `nexus.ts` - Combined Operation Logic
```typescript
// SDK initialization
const sdk = new NexusSDK({ network: 'testnet' });
await sdk.initialize(provider);

// Bridge + Transfer parameters
const transferParams = {
  token: 'USDC',
  amount: 1500000n,        // 1.5 USDC
  toChainId: 421614,       // Arbitrum Sepolia
  recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45', // Recipient address
  sourceChains: [11155111] // Optional: specify source chains
};

// Execute combined operation
sdk.bridgeAndTransfer(transferParams, {
  onEvent: (event) => {
    // Handle bridge and transfer progress
  }
});
```

### Operation Flow

1. **Source Chain Analysis**: SDK determines optimal source for tokens
2. **Bridge Execution**: Tokens are bridged to destination chain
3. **Transfer Execution**: Tokens are transferred to recipient on destination
4. **Gas Optimization**: SDK handles gas estimation and provision
5. **Progress Tracking**: Real-time updates for each step

## 🔄 Bridge + Transfer vs Separate Operations

### Advantages of Combined Operation

| Feature | Separate Operations | Bridge + Transfer |
|---------|-------------------|-------------------|
| **Gas Efficiency** | Higher (2 transactions) | Lower (1 atomic operation) |
| **Execution Speed** | Slower (sequential) | Faster (atomic) |
| **Failure Handling** | Complex (partial states) | Simple (all-or-nothing) |
| **User Experience** | Multiple confirmations | Single confirmation |

### When to Use Each

**Use Bridge + Transfer when:**
- Transferring to different recipient than sender
- Wanting atomic execution (all or nothing)
- Minimizing transaction costs is important
- Need guaranteed execution order

**Use Separate Operations when:**
- Transferring to same address (sender)
- Need flexibility between operations
- Want to verify bridge before transfer
| Building complex DeFi workflows |

## 🎨 UI Features

### Progress Tracking

The UI displays detailed progress for both phases:

#### Bridge Phase
- **Source Detection**: Identifying optimal source chain
- **Bridge Initiation**: Starting bridge transaction
- **Bridge Completion**: Tokens arrive on destination chain

#### Transfer Phase  
- **Transfer Preparation**: Setting up transfer transaction
- **Transfer Execution**: Transferring to recipient
- **Final Confirmation**: Operation complete

### Status Indicators

| Status | Bridge Phase | Transfer Phase | UI Display |
|--------|-------------|---------------|------------|
| **Pending** | ⏳ Waiting | ⏸️ Not Started | Yellow indicator |
| **In Progress** | 🔄 Active | ⏳ Waiting | Blue spinner |
| **Completed** | ✅ Done | 🔄 Active | Green checkmark |
| **Failed** | ❌ Error | ⏸️ Cancelled | Red error icon |

## 🔧 Customization

### Modify Transfer Parameters

Edit `src/nexus.ts`:

```typescript
export const transferParams = {
  token: 'USDC',                    // Token to bridge and transfer
  amount: 1500000n,                 // Amount in smallest units
  toChainId: 421614,                // Destination chain
  recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45', // Recipient
  sourceChains: [11155111, 84532],  // Optional: preferred source chains
};
```

### Recipient Configuration

#### Fixed Recipient
```typescript
recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45'
```

#### Dynamic Recipient (User Input)
```typescript
// Add to UI for recipient input
const [recipient, setRecipient] = useState('');

// In transfer execution
recipient: recipient || userAddress
```

#### Contract Recipient
```typescript
recipient: '0xA0b86a33E6441b8e8C7C7b0b8e8e8e8e8e8e8e8e' // Contract address
```

### Source Chain Optimization

```typescript
// Prefer specific source chains
sourceChains: [1, 10] // Ethereum and Optimism only

// Let SDK choose optimal source
sourceChains: undefined // SDK selects best option

// Exclude certain chains
sourceChains: [137, 42161] // Only Polygon and Arbitrum
```

## 🛡️ Security Considerations

### Recipient Verification

Always verify recipient addresses:

```typescript
// Address validation
function isValidRecipient(address: string): boolean {
  return ethers.isAddress(address) && 
         address !== '0x0000000000000000000000000000000000000000';
}

// In UI - show recipient confirmation
const recipientConfirmation = `Transfer to: ${truncateAddress(recipient)}`;
```

### Amount Safety

```typescript
// Maximum amount limits
const MAX_AMOUNT = {
  USDC: 1000000000n,  // 1000 USDC
  USDT: 1000000000n,  // 1000 USDT  
  ETH: 1000000000000000000n // 1 ETH
};

// Amount validation
if (amount > MAX_AMOUNT[token]) {
  throw new Error('Amount exceeds safety limit');
}
```

### Transaction Simulation

```typescript
// Pre-execution simulation
const simulation = await sdk.simulateBridgeAndTransfer(transferParams);
console.log('Estimated gas:', simulation.gasEstimate);
console.log('Total cost:', simulation.totalCost);
```

## 🐛 Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **Transfer fails** | Invalid recipient address | Verify address format and checksum |
| **Insufficient gas** | Low gas on destination chain | SDK auto-provides gas, but check source balance |
| **Bridge timeout** | Network congestion | Retry with higher gas settings |
| **Wrong network** | Wallet on incorrect chain | Switch wallet to appropriate source network |

### Debug Information

Enable detailed logging:

```typescript
// In nexus.ts
const sdk = new NexusSDK({ 
  network: 'testnet',
  debug: true 
});

// Log all events
sdk.bridgeAndTransfer(transferParams, {
  onEvent: (event) => {
    console.log('Event:', event.name, event.args);
  }
});
```

### Error Recovery

```typescript
// Retry logic for failed operations
const executeWithRetry = async (params, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sdk.bridgeAndTransfer(params);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
    }
  }
};
```

## 📚 Advanced Use Cases

### Batch Transfers

```typescript
// Transfer to multiple recipients
const recipients = [
  '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
  '0x1234567890123456789012345678901234567890',
  '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
];

for (const recipient of recipients) {
  await sdk.bridgeAndTransfer({
    ...transferParams,
    recipient,
    amount: transferParams.amount / recipients.length
  });
}
```

### Time-locked Transfers

```typescript
// Transfer to time-locked contract
const timeLockParams = {
  ...transferParams,
  recipient: '0xTimeLockContractAddress',
  // Additional data for time-lock contract
  data: '0x' + encodeTimeLock(24 * 60 * 60) // 24 hours
};
```

### Conditional Transfers

```typescript
// Transfer with condition (e.g., price threshold)
const conditionalParams = {
  ...transferParams,
  recipient: '0xConditionalTransferContract',
  data: encodeCondition({
    token: 'USDC',
    threshold: 1000000n, // $1 USD
    oracle: '0xChainlinkPriceFeed'
  })
};
```

## 📖 Related Examples

- **[Simple Bridge](../bridge/)** - Basic token bridging
- **[Bridge + Execute](../bridge-and-execute/)** - Bridge with contract execution
- **[Swap Examples](../swap-with-exact-in/)** - Token swapping operations
- **[Node.js Examples](../../node/)** - Backend implementations

## 🔄 Integration Patterns

### React Hook

```typescript
// Custom hook for bridge + transfer
export function useBridgeAndTransfer() {
  const [sdk, setSdk] = useState(null);
  const [progress, setProgress] = useState([]);
  
  const executeTransfer = async (params) => {
    return await sdk.bridgeAndTransfer(params, {
      onEvent: (event) => setProgress(prev => [...prev, event])
    });
  };
  
  return { sdk, executeTransfer, progress };
}
```

### Service Class

```typescript
// Service for bridge + transfer operations
class BridgeTransferService {
  constructor(sdk) {
    this.sdk = sdk;
  }
  
  async transferToRecipient(params) {
    const validatedParams = this.validateParams(params);
    return await this.sdk.bridgeAndTransfer(validatedParams);
  }
  
  validateParams(params) {
    // Parameter validation logic
    return params;
  }
}
```

## 🐛 Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **Transfer fails** | Invalid recipient address | Verify address format and checksum |
| **Bridge timeout** | Network congestion | Retry with higher gas settings |
| **Insufficient funds** | Low balance on source chains | Fund wallet with testnet tokens |
| **Gas estimation fails** | Complex multi-step operation | Reduce amount or simplify transaction |

### Debug Information

```typescript
// Enable detailed logging in nexus.ts
const sdk = new NexusSDK({ 
  network: 'testnet',
  debug: true 
});

// Log all events
sdk.bridgeAndTransfer(transferParams, {
  onEvent: (event) => {
    console.log('Event:', event.name, event.args);
  }
});
```

### Error Recovery

```typescript
// Retry logic for failed transfers
const executeWithRetry = async (params, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sdk.bridgeAndTransfer(params);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
    }
  }
};
```

---

**💡 Pro Tip**: Bridge + Transfer is ideal for payment systems, cross-chain airdrops, and any scenario where you need to move tokens to a different address than the sender. The atomic nature ensures either the entire operation succeeds or fails, preventing partial states.
