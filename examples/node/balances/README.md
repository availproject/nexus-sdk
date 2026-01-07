# Nexus SDK Balance Checker

A Node.js + TypeScript example that demonstrates how to check unified bridge balances across multiple networks using the Nexus SDK.

## 🎯 Purpose

This example shows how to:
- Initialize the Nexus SDK with custom wallet providers
- Query bridge balances across different networks
- Display balance breakdowns by chain and token
- Handle multiple wallets and networks in a single run

## 📋 Requirements

- **Node.js 20+**
- **npm** (or compatible package manager)
- **RPC endpoints** for chains you want to query

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm ci
```

### 2. Configure

Edit `configuration.json`:

```json
{
  "networks": ["testnet"],
  "chains": [
    [1, "https://eth.merkle.io"],
    [84532, "https://sepolia.base.org"],
    [137, "https://polygon-rpc.com"]
  ],
  "privateKeys": ["your-testnet-private-key-here"]
}
```

**Configuration Options:**

- `networks`: Array of networks to query (`"testnet"` or `"mainnet"`)
- `chains`: EVM chain ID and RPC URL pairs for wallet provider
- `privateKeys`: EVM private keys for wallets to check balances

### 3. Run

```bash
npm start
```

**Optional:** Use custom config file path:

```bash
CONFIGURATION=./custom.json npm start
```

## 📊 Output Example

```
Private Key: 0x123... Address: 0xabc...
	Network: testnet Symbol: USDC Balance: 1500000
		Ethereum 1000000
		Base Sepolia 500000
	Network: testnet Symbol: ETH Balance: 2000000000000000
		Ethereum 2000000000000000
```

## 🔧 How It Works

1. **Wallet Setup**: Creates an ethers wallet with custom provider for each private key
2. **SDK Initialization**: Initializes NexusSDK for each network configuration
3. **Balance Query**: Calls `sdk.getBalancesForBridge()` to fetch unified balances
4. **Filtering**: Displays only non-zero balances with chain breakdowns
5. **Output**: Formats and prints results in a readable format

## 🛡️ Security Notes

- **⚠️ Never commit real private keys** to version control
- **🧪 Use testnet keys** for initial experimentation
- **🔒 Keep configuration files** in `.gitignore` for production
- **🔐 Consider using environment variables** for sensitive data

## 🐛 Troubleshooting

### Common Issues

| Error | Solution |
|-------|----------|
| `RPC timeout` | Check RPC URL reliability and add fallback endpoints |
| `Invalid chain ID` | Verify chain IDs match supported networks |
| `Insufficient funds` | Expected - shows 0 balance for empty wallets |

### Debug Tips

```bash
# Enable verbose logging
DEBUG=* npm start

# Test with single network first
echo '{"networks":["testnet"],"chains":[[1,"https://eth.merkle.io"]],"privateKeys":["0x..."]}' > test.json
CONFIGURATION=./test.json npm start
```

## 📚 Related Examples

- **[Basic Execution](../basic-execution/)** - Full CLI runner for all operations
- **[Web Bridge](../../web/bridge/)** - Browser-based bridging interface
- **[Main SDK Documentation](../../../README.md)** - Complete API reference

## 🔄 Extending the Example

### Add Custom Chains

```json
{
  "chains": [
    [1, "https://eth.merkle.io"],
    [42161, "https://arb1.arbitrum.io/rpc"],
    [10, "https://mainnet.optimism.io"]
  ]
}
```

### Filter by Token

```typescript
// In main.ts - filter for specific tokens
const filteredBalances = balances.filter(b => 
  ['USDC', 'USDT', 'ETH'].includes(b.symbol)
);
```

### Export to CSV

```typescript
// Add CSV export functionality
import fs from 'fs';

const csvData = balances.map(b => 
  `${b.symbol},${b.balance},${b.breakdown.map(d => `${d.chain.name}:${d.balance}`).join(';')}`
).join('\n');

fs.writeFileSync('balances.csv', csvData);
```

---

**💡 Tip:** This example is perfect for monitoring wallet balances across multiple chains or as a starting point for portfolio tracking applications.