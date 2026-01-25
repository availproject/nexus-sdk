# 🌉 Nexus SDK Bridge UI - User Guide

A complete bridge interface using the Nexus SDK with V2 middleware integration.

## Features

✅ **Wallet Connection** - Connect MetaMask with one click
✅ **Unified Balances** - View balances across all chains
✅ **Simple Bridge UI** - Easy token bridging between chains
✅ **Real-time Progress** - Live updates during bridge execution
✅ **V2 Middleware** - Uses middleware APIs automatically
✅ **Event Tracking** - See each step as it completes

---

## Quick Start

### 1. Prerequisites

Ensure these services are running:

```bash
# Middleware (required)
curl http://localhost:3000/

# Statekeeper (required)
curl http://localhost:9080/health

# MetaMask browser extension (required)
```

### 2. Start the App

```bash
cd test-app
pnpm dev
```

Open: **http://localhost:5173**

### 3. Use the Bridge

1. Click **🌉 Bridge** tab
2. Click **Connect Wallet** button
3. Approve MetaMask connection
4. View your balances across chains
5. Select token, amount, and chains
6. Click **Bridge** button
7. Approve transactions in MetaMask
8. Watch real-time progress

---

## How It Works

### SDK Configuration

The app uses V2 middleware configuration:

```typescript
const V2_CONFIG = {
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true, // ← Enables V2!
};

const sdk = new NexusSDK({ network: V2_CONFIG });
```

### Balance Fetching

```typescript
// Get unified balances across all chains
const balances = await sdk.getBalancesForBridge();

// Returns:
[
  {
    symbol: 'USDC',
    chains: [
      { chainId: 42161, chainName: 'Arbitrum', balance: '1000.50' },
      { chainId: 8453, chainName: 'Base', balance: '500.25' },
    ]
  }
]
```

### Bridging

```typescript
// Bridge tokens
const result = await sdk.bridge(
  {
    token: 'USDC',
    amount: '100',
    toChainId: 8453, // Base
    sourceChains: [42161], // Arbitrum
  },
  {
    onEvent: (event) => {
      if (event.name === NEXUS_EVENTS.STEPS_LIST) {
        // All bridge steps
        console.log('Steps:', event.args);
      }
      if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
        // Individual step completed
        console.log('Completed:', event.args);
      }
    },
  },
);

// Returns:
{
  explorerUrl: 'http://localhost:3000/explorer/rff/0x...'
}
```

---

## UI Components

### 🌉 Bridge Tab

**Main Features**:
- Wallet connection
- Balance display (grouped by token)
- Bridge form with chain selection
- Real-time progress tracking
- Transaction explorer link

**Form Fields**:
1. **Token** - Select token to bridge (USDC, USDT, etc.)
2. **Amount** - Enter amount to bridge
3. **From Chain** - Source chain (shows available balances)
4. **To Chain** - Destination chain
5. **Bridge Button** - Execute the bridge

### 🧪 Tests Tab

Automated tests for:
- Middleware health check
- Balance fetching
- Statekeeper connectivity

### ⚙️ Config Tab

View configuration:
- Middleware URL
- Statekeeper URL
- V2 middleware status
- Supported chains

---

## Bridge Flow

```
1. Connect Wallet
   ↓
2. Load Balances (via middleware)
   GET /api/v1/balance/evm/{address}
   ↓
3. Select Token & Chains
   ↓
4. Click Bridge
   ↓
5. SDK Events:
   - STEPS_LIST → Show all steps
   - STEP_COMPLETE → Mark step done
   ↓
6. Bridge Steps Execute:
   ├─ Intent Accepted
   ├─ Allowance Approval (if needed)
   ├─ Intent Hash Signed
   ├─ Intent Submitted (via middleware)
   ├─ Collection Complete
   └─ Intent Fulfilled
   ↓
7. Show Explorer Link
   ↓
8. Reload Balances
```

---

## Supported Chains

| Chain | Chain ID | Tokens |
|-------|----------|--------|
| Ethereum | 1 | USDC, USDT |
| Polygon | 137 | USDC |
| Base | 8453 | USDC |
| Arbitrum | 42161 | USDC |
| Optimism | 10 | USDC |

---

## Bridge Events

The SDK emits events during bridging:

### `NEXUS_EVENTS.STEPS_LIST`

Fired once at the start with all steps:

```typescript
{
  name: 'STEPS_LIST',
  args: [
    { typeID: 'intent-accepted', title: 'Intent Accepted', ... },
    { typeID: 'allowance-approval', title: 'Approve Allowance', ... },
    { typeID: 'intent-signed', title: 'Sign Intent Hash', ... },
    { typeID: 'intent-submitted', title: 'Submit Intent', ... },
    { typeID: 'intent-fulfilled', title: 'Bridge Complete', ... },
  ]
}
```

### `NEXUS_EVENTS.STEP_COMPLETE`

Fired for each completed step:

```typescript
{
  name: 'STEP_COMPLETE',
  args: {
    typeID: 'intent-accepted',
    title: 'Intent Accepted',
    ...
  }
}
```

---

## MetaMask Interactions

During a bridge, MetaMask will prompt you to:

1. **Connect** - Grant access to your wallet
2. **Sign Message** - Approve intent hash
3. **Approve Token** - Permit token spending (if needed)
4. **Confirm Transaction** - Execute deposit (for native tokens)

**Important**: Always review transaction details before approving!

---

## Troubleshooting

### "MetaMask not found"

**Solution**: Install [MetaMask](https://metamask.io/) browser extension

### "No accounts found"

**Solution**: Unlock MetaMask and ensure accounts are available

### "Failed to load balances"

**Check**:
1. Middleware is running: `curl http://localhost:3000/`
2. Wallet is connected properly
3. Browser console for errors (F12)

### "Bridge operation failed"

**Check**:
1. Statekeeper is running: `curl http://localhost:9080/health`
2. You have sufficient balance on source chain
3. MetaMask transactions were approved
4. Browser console for detailed error

### Balance shows "0" but I have funds

**Solutions**:
1. Click the refresh button (🔄)
2. Disconnect and reconnect wallet
3. Check middleware logs for errors
4. Verify token is supported on that chain

---

## Development

### Project Structure

```
src/
├── components/
│   ├── BridgeUI.tsx          # Main bridge component
│   ├── BridgeUI.css          # Bridge styles
│   ├── V2MiddlewareTest.tsx  # Test component
│   └── V2MiddlewareTest.css  # Test styles
├── types/
│   └── window.d.ts           # TypeScript window types
├── App.tsx                    # App shell
├── App.css                    # App styles
└── main.tsx                   # Entry point
```

### Adding New Features

**Add a new token**:
1. SDK should auto-detect supported tokens
2. Balances will show all available tokens
3. No UI changes needed

**Add a new chain**:
1. Add to `CHAIN_NAMES` in `BridgeUI.tsx`
2. Add to destination chain dropdown
3. SDK handles the rest

**Customize bridge parameters**:
Edit the `sdk.bridge()` call in `handleBridge()` function.

---

## API Reference

### SDK Methods Used

```typescript
// Initialize SDK
const sdk = new NexusSDK({ network: config });
await sdk.initialize(provider);

// Get balances
const balances = await sdk.getBalancesForBridge();

// Bridge tokens
const result = await sdk.bridge(params, options);
```

### Configuration

```typescript
interface NetworkConfig {
  MIDDLEWARE_URL: string;
  STATEKEEPER_URL: string;
  useV2Middleware: boolean;
  // ... other fields
}
```

---

## Security Notes

⚠️ **Important Security Considerations**:

1. **Never share private keys** - SDK uses MetaMask, never enters private keys
2. **Verify transactions** - Always review MetaMask prompts before approving
3. **Test with small amounts** - Start with small amounts when testing
4. **Check explorer links** - Verify transactions completed successfully
5. **Local testing only** - This setup is for local development only

---

## Next Steps

1. **Test the bridge** - Try bridging a small amount
2. **Monitor progress** - Watch the step-by-step execution
3. **Check explorer** - View transaction on explorer
4. **Verify balances** - Refresh to see updated balances

---

## Support

**Documentation**:
- SDK Docs: `../docs/`
- V2 Integration: `../V2_INTEGRATION_COMPLETE.md`
- Test App README: `README.md`

**Debugging**:
- Browser Console: F12 → Console tab
- Middleware Logs: Check middleware terminal
- Statekeeper Logs: Check statekeeper terminal

**Issues**:
1. Check all services are running
2. Check browser console for errors
3. Review transaction in MetaMask
4. Check middleware/statekeeper logs

---

**🎉 You're ready to bridge! Connect your wallet and start testing.**
