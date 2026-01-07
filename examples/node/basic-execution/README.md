# Nexus SDK CLI Runner

A comprehensive **Node.js + TypeScript** command-line interface for testing and automating all Nexus SDK operations.

## 🎯 Purpose

This powerful CLI runner enables:
- **All SDK Operations**: Bridge, transfer, execute, swap, and combined operations
- **Batch Processing**: Run multiple operations with configurable retry logic
- **Profile Management**: JSON-based configuration for different scenarios
- **Comprehensive Logging**: Detailed operation logs with error tracking
- **Automation Ready**: Perfect for CI/CD, testing, and production workflows

## 📋 Requirements

- **Node.js 20+**
- **npm** (or compatible package manager)
- **RPC endpoints** for chains you plan to use
- **Testnet funds** for safe experimentation

> **🔒 Security Note**: Configuration includes private keys. Use testnet keys and never commit secrets to version control.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm ci
```

### 2. Configure

Create `configuration.json` (see detailed configuration below):

```json
{
  "network": "testnet",
  "chains": [[1, "https://eth.merkle.io"], [84532, "https://sepolia.base.org"]],
  "profiles": [
    {
      "id": "TEST_BRIDGE",
      "privateKey": "your-testnet-private-key",
      "operation": "bridge",
      "token": "USDC",
      "amount": "1000000",
      "toChainId": 84532,
      "count": 1
    }
  ]
}
```

### 3. Run

```bash
# Run profile 0
INDEX=0 npm run start

# Or use helper script
./run.sh 0

# With custom config
CONFIGURATION=./custom.json INDEX=0 npm run start
```

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INDEX` | ✅ | Profile index to run (0-based) |
| `CONFIGURATION` | ❌ | Path to config file (default: `./configuration.json`) |

### Top-Level Schema

```json
{
  "network": "testnet",           // "testnet" | "mainnet" | custom object
  "chains": [                     // EVM chain ID + RPC URL pairs
    [1, "https://eth.merkle.io"],
    [84532, "https://sepolia.base.org"]
  ],
  "profiles": []                  // Array of operation profiles
}
```

### Network Configuration

#### Simple Networks
```json
{
  "network": "testnet"   // or "mainnet"
}
```

#### Advanced Network Object
```json
{
  "network": {
    "COSMOS_REST_URL": "https://…",
    "COSMOS_RPC_URL": "https://…",
    "COSMOS_WS_URL": "wss://…",
    "COSMOS_GRPC_URL": "https://…",
    "VSC_BASE_URL": "https://…",
    "VSC_WS_URL": "wss://…",
    "INTENT_EXPLORER_URL": "https://…",
    "NETWORK_HINT": 2
  }
}
```

### Profile Schema

Each profile combines runner settings with operation parameters:

#### Common Profile Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `privateKey` | string | ✅ | EVM private key for wallet |
| `id` | string | ✅ | Log file prefix (e.g., "TEST_001") |
| `operation` | string | ✅ | Operation type (see below) |
| `count` | number | ❌ | Retry attempts (default: unlimited) |
| `network` | string | ❌ | Override top-level network |

> **💡 Note**: JSON cannot represent `bigint`. Use decimal strings for amounts (recommended) or numbers that fit safely.

## 🔄 Supported Operations

### `bridge`
Simple token bridging across chains.

**Required**: `token`, `amount`, `toChainId`  
**Optional**: `recipient`, `gas`, `sourceChains`

```json
{
  "operation": "bridge",
  "token": "USDC",
  "amount": "1000000",
  "toChainId": 84532,
  "recipient": "0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45"
}
```

### `bridgeAndTransfer`
Bridge tokens and perform on-chain transfer.

**Required**: `token`, `amount`, `toChainId`, `recipient`  
**Optional**: `sourceChains`

```json
{
  "operation": "bridgeAndTransfer",
  "token": "USDC",
  "amount": "1500000",
  "toChainId": 137,
  "recipient": "0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45"
}
```

### `bridgeAndExecute`
Bridge tokens and execute smart contract.

**Required**: `token`, `amount`, `toChainId`, `execute.to`  
**Optional**: `sourceChains`, `execute.data`, `execute.value`, `execute.tokenApproval`

```json
{
  "operation": "bridgeAndExecute",
  "token": "USDC",
  "amount": "1000000",
  "toChainId": 8453,
  "sourceChains": [10],
  "execute": {
    "to": "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE",
    "data": "0x095ea7b3000000000000000000000000...",
    "tokenApproval": {
      "token": "USDC",
      "amount": "1000000",
      "spender": "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE"
    }
  }
}
```

### `exactInSwap`
Swap exact input amount for maximum output.

**Required**: `from[]`, `toChainId`, `toTokenAddress`  
**Optional**: none

```json
{
  "operation": "exactInSwap",
  "from": [
    {
      "chainId": 10,
      "amount": "1000000",
      "tokenAddress": "0x0b2c639c533813f4aa9d7837af63619ebd9e866b"
    }
  ],
  "toChainId": 8453,
  "toTokenAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bdad02be"
}
```

### `exactOutSwap`
Swap for exact output amount (variable input).

**Required**: `toChainId`, `toTokenAddress`, `toAmount`  
**Optional**: none

```json
{
  "operation": "exactOutSwap",
  "toChainId": 8453,
  "toTokenAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bdad02be",
  "toAmount": "500000"
}
```

## 📊 Logging & Output

### Log Files

Logs are written to `./logs/` directory:

```
logs/
  ├── TEST_001.txt           # All log entries
  └── TEST_001_errors.txt    # Error entries only
```

### Log Format

Each log entry includes:
- **Timestamp**: ISO 8601 format
- **Profile ID**: Configuration identifier
- **Operation Type**: SDK operation being performed
- **Status**: Success/failure information
- **Transaction Details**: Hashes, confirmations, gas used

### Console Output

Real-time console output shows:
- SDK initialization progress
- Balance information
- Operation status updates
- Error details with stack traces

## 🛠️ Advanced Usage

### Batch Operations

Create multiple profiles for sequential execution:

```json
{
  "profiles": [
    {
      "id": "BRIDGE_USDC",
      "operation": "bridge",
      "token": "USDC",
      "amount": "1000000",
      "toChainId": 84532,
      "count": 1
    },
    {
      "id": "SWAP_USDT",
      "operation": "exactInSwap",
      "from": [{"chainId": 84532, "amount": "1000000", "tokenAddress": "0x..."}],
      "toChainId": 1,
      "toTokenAddress": "0x...",
      "count": 1
    }
  ]
}
```

### Retry Logic

Configure retry behavior with `count` field:

```json
{
  "count": 3,    // Retry up to 3 times
  "operation": "bridge",
  // ... other params
}
```

- **`count: 0`**: Initialize SDK and show balances only (no operation)
- **`count: 1`**: Single attempt (default)
- **`count: N`**: Retry up to N times with 60-second delays between failures

### Environment-Specific Configs

Use different configs for different environments:

```bash
# Testnet
CONFIGURATION=./testnet.json INDEX=0 npm run start

# Mainnet (use with caution!)
CONFIGURATION=./mainnet.json INDEX=0 npm run start

# Local development
CONFIGURATION=./local.json INDEX=0 npm run start
```

## 🐛 Troubleshooting

### Common Issues

| Error | Solution |
|-------|----------|
| `INDEX env variable must be set` | Set `INDEX` to valid profile index: `INDEX=0 npm run start` |
| `RPC timeout` | Check RPC URLs, add fallback endpoints, verify network connectivity |
| `wallet_switchEthereumChain: no RPC configured` | Add missing chain ID to `chains` array in config |
| `Insufficient funds` | Ensure wallet has enough tokens for gas and operations |
| `Invalid private key` | Verify private key format and network compatibility |

### Debug Tips

```bash
# Enable debug logging
DEBUG=* npm run start

# Test configuration only (count: 0)
echo '{"count":0, "profiles":[{"id":"TEST","privateKey":"0x...","operation":"bridge","token":"USDC","amount":"0","toChainId":1}]}' > debug.json
CONFIGURATION=./debug.json INDEX=0 npm run start

# Check wallet connectivity
curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' https://eth.merkle.io
```

### Configuration Validation

Use this minimal test configuration to verify setup:

```json
{
  "network": "testnet",
  "chains": [[1, "https://eth.merkle.io"]],
  "profiles": [
    {
      "id": "VALIDATION_TEST",
      "privateKey": "your-testnet-key",
      "operation": "bridge",
      "token": "USDC",
      "amount": "0",
      "toChainId": 1,
      "count": 0
    }
  ]
}
```

## 🔒 Security Best Practices

### Private Key Management

```bash
# Use environment variables for production
export PRIVATE_KEY="0x..."

# In configuration.json
{
  "privateKey": "${PRIVATE_KEY}"
}
```

### Network Safety

- **Testnet First**: Always test with testnet configurations
- **Small Amounts**: Use minimal amounts for mainnet testing
- **Monitor Logs**: Check error logs for failed transactions
- **Gas Limits**: Set appropriate gas limits to prevent excessive spending

### Access Control

```bash
# Restrict file permissions
chmod 600 configuration.json
chmod 700 logs/

# Use .gitignore
echo "configuration.json" >> .gitignore
echo "logs/" >> .gitignore
echo "*.privateKeys.json" >> .gitignore
```

## 📚 Integration Examples

### CI/CD Pipeline

```yaml
# GitHub Actions example
- name: Run Nexus Test
  run: |
    echo '{"network":"testnet","chains":[[1,"${RPC_URL}"]],"profiles":[{"id":"CI_TEST","privateKey":"${TEST_KEY}","operation":"bridge","token":"USDC","amount":"1000","toChainId":84532,"count":1}]}' > ci-config.json
    CONFIGURATION=./ci-config.json INDEX=0 npm run start
  env:
    RPC_URL: ${{ secrets.RPC_URL }}
    TEST_KEY: ${{ secrets.TEST_KEY }}
```

### Docker Integration

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["sh", "-c", "CONFIGURATION=/app/config.json INDEX=${PROFILE_INDEX} npm run start"]
```

### Monitoring Integration

```javascript
// Add to main.ts for monitoring
const monitoring = {
  onSuccess: (profile, result) => {
    // Send to monitoring service
    fetch('https://monitoring.example.com/webhook', {
      method: 'POST',
      body: JSON.stringify({
        profile: profile.id,
        operation: profile.operation,
        status: 'success',
        timestamp: new Date().toISOString()
      })
    });
  },
  onError: (profile, error) => {
    // Send alert
    console.error(`Operation failed: ${profile.id} - ${error}`);
  }
};
```

## 📖 Related Documentation

- **[Nexus SDK Core](../../../README.md)** - Complete API reference
- **[Balance Checker](../balances/)** - Simple balance monitoring
- **[Web Examples](../../web/)** - Browser-based integrations
- **[Supported Networks](../../../README.md#-supported-networks)** - Available chains

## 🤝 Contributing

This example is part of the Nexus SDK ecosystem. To contribute:

1. **Test Changes**: Verify with multiple operation types
2. **Update Documentation**: Keep README synchronized with code
3. **Add Examples**: Include new operation configurations
4. **Security Review**: Ensure private key handling remains secure

## 📄 License

This project includes code originally written by Nilay27 (https://github.com/Nilay27), licensed under the MIT License.

---

**💡 Pro Tip**: Use this CLI runner as the foundation for automated testing, batch operations, or production deployment scripts. The comprehensive logging and error handling make it ideal for reliable cross-chain operations.

