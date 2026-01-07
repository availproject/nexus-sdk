# Nexus SDK Examples

This directory contains practical examples demonstrating how to use the **Nexus SDK** for cross-chain operations, token bridging, swapping, and unified balance management.

## 📁 Directory Structure

```
examples/
├── node/                    # Node.js + TypeScript examples
│   ├── balances/           # Balance checker across networks
│   └── basic-execution/    # CLI runner for all operations
└── web/                    # Browser-based examples
    ├── bridge/             # Simple token bridging
    ├── bridge-and-transfer/ # Bridge + on-chain transfer
    ├── swap-with-exact-in/ # Exact input swaps
    ├── swap-with-exact-out/ # Exact output swaps
    └── wasm/               # Rust + WebAssembly integration
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** and npm
- **EIP-1193 wallet** (MetaMask, Rabby, Rainbow, etc.) for web examples
- **Testnet funds** for safe experimentation

### Choose Your Platform

#### 🖥️ Node.js Examples
Perfect for backend services, CLI tools, and automation:

```bash
cd examples/node/balances      # Check balances across networks
cd examples/node/basic-execution # Run any operation via CLI
```

#### 🌐 Web Examples  
Ideal for frontend integration and user interfaces:

```bash
cd examples/web/bridge              # Simple bridging demo
cd examples/web/bridge-and-transfer # Bridge + transfer demo
cd examples/web/swap-with-exact-in  # Exact input swap demo
cd examples/web/swap-with-exact-out # Exact output swap demo
cd examples/web/wasm                # Rust + WASM integration
```

## 📋 Example Overview

### Node.js Examples

| Example | Description | Use Case |
|---------|-------------|----------|
| **[balances](./node/balances/)** | Check bridge balances across multiple networks | Balance monitoring, portfolio tracking |
| **[basic-execution](./node/basic-execution/)** | CLI runner for all SDK operations | Automation, testing, batch operations |

### Web Examples

| Example | Description | Use Case |
|---------|-------------|----------|
| **[bridge](./web/bridge/)** | Simple token bridging UI | Basic cross-chain transfers |
| **[bridge-and-transfer](./web/bridge-and-transfer/)** | Bridge + on-chain transfer | Complex cross-chain operations |
| **[swap-with-exact-in](./web/swap-with-exact-in/)** | Exact input token swapping | Fixed-amount swaps |
| **[swap-with-exact-out](./web/swap-with-exact-out/)** | Exact output token swapping | Fixed-destination swaps |
| **[wasm](./web/wasm/)** | Rust UI + TypeScript SDK | Custom UI frameworks, WASM integration |

## 🔧 Common Setup Steps

### 1. Install Dependencies

```bash
# For any example
cd examples/[category]/[example]
npm install
```

### 2. Configure Network

Most examples default to **testnet** for safe experimentation:

```typescript
// Testnet (default)
const sdk = new NexusSDK({ network: 'testnet' });

// Mainnet (use with real funds only)
const sdk = new NexusSDK({ network: 'mainnet' });
```

### 3. Run the Example

```bash
# Node.js examples
npm start

# Web examples  
npm run dev
```

## 🛡️ Security Best Practices

- **Never commit private keys** or sensitive configuration
- **Use testnet funds** for initial experimentation
- **Start with small amounts** when testing mainnet operations
- **Keep wallet software updated** and use hardware wallets when possible

## 📚 Learn More

- **[Main SDK Documentation](../../README.md)** - Complete API reference
- **[Supported Networks](../../README.md#-supported-networks)** - Available chains and tokens
- **[GitHub Repository](https://github.com/availproject/nexus-sdk)** - Source code and issues

## 🤝 Contributing

Found a bug or want to improve an example? 

1. **Open an issue** describing the problem or suggestion
2. **Submit a pull request** with your improvements
3. **Follow existing patterns** and maintain consistency

## 🆘 Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| **RPC errors** | Check chain configurations and RPC endpoint availability |
| **Insufficient funds** | Ensure wallet has enough tokens for gas and operations |
| **Wallet not connected** | Verify wallet extension is installed and unlocked |
| **Network mismatch** | Confirm SDK network matches your wallet's network |

### Get Help

- **Check individual example READMEs** for specific troubleshooting
- **Review the main SDK documentation** for detailed API information
- **Open a GitHub issue** for bugs or feature requests

---

**⚠️ Important:** Always test with small amounts on testnet before using mainnet. The examples are for educational purposes and may need additional security hardening for production use.