# Nexus SDK Balance Checker

A simple Node.js + TypeScript example that checks bridge balances across multiple networks using `@avail-project/nexus-core`.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm ci
```

## Configuration

Edit `configuration.json`:

```json
{
  "networks": ["testnet", "mainnet"],
  "chains": [
    [1, "https://eth.merkle.io"],
    [84532, "https://sepolia.base.org"]
  ],
  "privateKeys": ["your-private-key-here"]
}
```

- `networks`: Networks to check balances on
- `chains`: EVM chain IDs and their RPC URLs
- `privateKeys`: EVM private keys for the wallets to check

## Run

```bash
npm start
```

Use optional environment variable to specify config file:

```bash
CONFIGURATION=./custom.json npm start
```

## What it does

For each private key and network:
- Initializes NexusSDK
- Fetches bridge balances
- Displays non-zero balances and their chain breakdowns

## Security

Never commit real private keys. Use testnet keys for experimentation.