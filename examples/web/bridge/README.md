# Bridge Example

A minimal **Vite + TypeScript** web application demonstrating cross-chain token bridging using the Nexus SDK.

## 🎯 Purpose

This example showcases:
- **Browser Integration**: Connect EIP-1193 wallets with Nexus SDK
- **Real-time UI**: Live bridge progress updates with event streaming
- **Cross-chain Operations**: Seamless token bridging between networks
- **Error Handling**: Comprehensive error display and user feedback

## 📋 Prerequisites

- **Node.js 18+** and npm
- **EIP-1193 Wallet** (MetaMask, Rabby, Rainbow, Brave, Phantom)
- **Testnet Funds**: Arbitrum Sepolia USDC for safe experimentation
- **Browser Extension**: Wallet extension must be installed and enabled

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Fund Your Wallet

Obtain testnet USDC on Arbitrum Sepolia:
- **Faucet**: Visit [Arbitrum Sepolia Faucet](https://sepolia-faucet.arbitrum.io/)
- **Bridge**: Bridge from Ethereum Sepolia using official bridge
- **Amount**: At least 1 USDC (1,000,000 units) for testing (includes gas fees)

### 3. Run the Application

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Connect Wallet & Bridge

1. **Connect Wallet**: Click "Connect Wallet" and approve in your wallet
2. **Review Parameters**: Check bridge amount and destination
3. **Execute Bridge**: Click "Bridge" and approve transactions
4. **Monitor Progress**: Watch real-time updates in the UI

## 🔧 Technical Implementation

### Architecture

```
src/
├── main.ts          # Application entry point
├── nexus.ts         # SDK initialization and bridge logic
├── screens.ts       # UI components and state management
└── index.html       # HTML template
```

### Key Components

#### `nexus.ts` - SDK Integration
```typescript
// SDK initialization
const sdk = new NexusSDK({ network: 'testnet' });
await sdk.initialize(provider);

// Bridge parameters
const bridgeParams = {
  token: 'USDC',
  amount: 1000000n,  // 1 USDC (6 decimals)
  toChainId: 421614, // Arbitrum Sepolia
  recipient: '0x...' // Optional custom recipient
};

// Event handling
sdk.bridge(bridgeParams, {
  onEvent: (event) => {
    // Update UI with bridge progress
  }
});
```

#### `screens.ts` - UI Management
- **Loading Screen**: Wallet connection and SDK initialization
- **Main Screen**: Bridge parameters and execution
- **Error Screen**: Error display and retry options
- **Progress Updates**: Real-time bridge status

### Event Flow

1. **Wallet Detection** → Check for EIP-1193 provider
2. **SDK Initialization** → Connect wallet to Nexus SDK
3. **Balance Fetching** → Display available balances
4. **Bridge Execution** → User initiates bridge operation
5. **Progress Streaming** → Real-time updates via NEXUS_EVENTS
6. **Completion** → Success/error display with transaction details

## 🎨 UI Features

### Connection States

| State | Description | UI Element |
|-------|-------------|------------|
| **Loading** | Initializing SDK and connecting wallet | Spinner + status text |
| **Connected** | Wallet ready, showing balances | Bridge form |
| **Bridging** | Transaction in progress | Progress bar + step details |
| **Success** | Bridge completed successfully | Transaction links |
| **Error** | Bridge failed or rejected | Error message + retry |

### Progress Indicators

- **Step List**: Complete bridge workflow overview
- **Current Step**: Active operation highlighting
- **Transaction Hashes**: Direct blockchain explorer links
- **Gas Information**: Real-time gas cost estimates

## 🔧 Customization

### Modify Bridge Parameters

Edit `src/nexus.ts`:

```typescript
export const bridgeParams = {
  token: 'USDC',           // Token symbol
  amount: 1000000n,        // Amount in smallest units (6 decimals for USDC)
  toChainId: 421614,       // Destination chain (Arbitrum Sepolia)
  recipient: userAddress,  // Optional: custom recipient address
};
```

### Supported Tokens

| Token | Symbol | Decimals | Testnet Availability |
|-------|--------|----------|---------------------|
| USD Coin | USDC | 6 | ✅ Arbitrum Sepolia |
| Tether USD | USDT | 6 | ✅ Arbitrum Sepolia |
| Ethereum | ETH | 18 | ✅ Arbitrum Sepolia |

### Network Configuration

```typescript
// Switch to mainnet (use with real funds)
const sdk = new NexusSDK({ network: 'mainnet' });

// Custom network configuration
const sdk = new NexusSDK({
  network: {
    VSC_BASE_URL: 'https://api.availproject.org',
    VSC_WS_URL: 'wss://api.availproject.org/ws',
    // ... other network config
  }
});
```

### UI Styling

The example uses minimal inline styles. To customize:

```css
/* Add to index.html or separate CSS file */
.bridge-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
}

.transaction-link {
  color: #0066cc;
  text-decoration: none;
}
```

## 🛡️ Security Considerations

### Best Practices

- **HTTPS Required**: Always serve over HTTPS in production
- **Wallet Security**: Use reputable wallet providers
- **Amount Validation**: Double-check amounts before approval
- **Network Verification**: Confirm correct network in wallet

### Common Risks

| Risk | Mitigation |
|------|------------|
| **Phishing** | Verify URL and wallet connection domain |
| **Front-running** | Use appropriate slippage tolerance |
| **Gas Manipulation** | Monitor gas prices during high network activity |
| **Contract Risks** | Use official bridge contracts and verified addresses |

## 🐛 Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| **Wallet not detected** | Install/enable wallet extension, refresh page |
| **Wrong network** | Switch wallet to Arbitrum Sepolia testnet |
| **Insufficient funds** | Obtain testnet USDC from faucet |
| **Transaction failed** | Check gas settings, retry with higher gas |
| **RPC errors** | Wait for network congestion to clear |

### Debug Mode

Enable console logging for detailed debugging:

```typescript
// In nexus.ts
const sdk = new NexusSDK({ 
  network: 'testnet',
  debug: true  // Enable verbose logging
});
```

### Browser Compatibility

| Browser | Status | Notes |
|---------|--------|-------|
| Chrome | ✅ Full Support | Recommended |
| Firefox | ✅ Full Support | Good alternative |
| Safari | ✅ Limited Support | Some wallet extensions may have issues |
| Edge | ✅ Full Support | Chromium-based |

## 📚 Integration Examples

### React Integration

```typescript
// React component example
import { useState, useEffect } from 'react';
import { NexusSDK } from '@avail-project/nexus-core';

function BridgeComponent() {
  const [sdk, setSdk] = useState(null);
  const [progress, setProgress] = useState([]);

  useEffect(() => {
    if (window.ethereum) {
      const nexusSDK = new NexusSDK({ network: 'testnet' });
      nexusSDK.initialize(window.ethereum).then(() => {
        setSdk(nexusSDK);
      });
    }
  }, []);

  const handleBridge = async () => {
    await sdk.bridge(bridgeParams, {
      onEvent: (event) => setProgress(prev => [...prev, event])
    });
  };

  return (
    <div>
      {/* Bridge UI */}
    </div>
  );
}
```

### Next.js Integration

```typescript
// pages/bridge.tsx
import { GetServerSideProps } from 'next';

export default function BridgePage() {
  // Client-side bridge implementation
  return <div>{/* Bridge component */}</div>;
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    props: {}, // No server-side props needed
  };
};
```

## 📖 Related Examples

- **[Bridge + Transfer](../bridge-and-transfer/)** - Bridge with on-chain transfer
- **[Swap Examples](../swap-with-exact-in/)** - Token swapping demonstrations
- **[WASM Integration](../wasm/)** - Rust + WebAssembly implementation
- **[Node.js Examples](../../node/)** - Backend and CLI implementations

## 🔄 Advanced Features

### Multi-token Bridging

```typescript
// Bridge multiple tokens in sequence
const tokens = ['USDC', 'USDT', 'ETH'];
for (const token of tokens) {
  await sdk.bridge({
    token,
    amount: getTokenAmount(token),
    toChainId: 421614
  });
}
```

### Custom Event Handling

```typescript
sdk.bridge(bridgeParams, {
  onEvent: (event) => {
    switch (event.name) {
      case NEXUS_EVENTS.STEPS_LIST:
        console.log('Bridge steps:', event.args);
        break;
      case NEXUS_EVENTS.STEP_COMPLETE:
        console.log('Step completed:', event.args);
        // Update UI progress
        break;
      case NEXUS_EVENTS.ERROR:
        console.error('Bridge error:', event.args);
        // Show error to user
        break;
    }
  }
});
```

---

**💡 Pro Tip**: This example serves as an excellent starting point for building production-ready bridge interfaces. The event-driven architecture ensures smooth user experiences even during complex cross-chain operations.
