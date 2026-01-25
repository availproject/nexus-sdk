# MetaMask + Local Anvil Setup Guide

## Overview

The bridge UI needs to connect to your **local Anvil forks**, not public networks. Your Anvil nodes run locally but use real mainnet chain IDs.

## Prerequisites

Ensure your Anvil nodes are running:

```bash
# Terminal 1: Ethereum fork (chainId: 1)
anvil --fork-url <ETHEREUM_RPC> --port 8545 --chain-id 1

# Terminal 2: Arbitrum fork (chainId: 42161)
anvil --fork-url <ARBITRUM_RPC> --port 8546 --chain-id 42161
```

## MetaMask Configuration

### Step 1: Add Local Ethereum Network

1. Open MetaMask
2. Click network dropdown (top)
3. Click "Add network" → "Add a network manually"
4. Enter these details:

**Network Name:** `Local Ethereum (Anvil)`
**New RPC URL:** `http://localhost:8545`
**Chain ID:** `1`
**Currency Symbol:** `ETH`

Click "Save"

### Step 2: Add Local Arbitrum Network

Repeat for Arbitrum:

**Network Name:** `Local Arbitrum (Anvil)`
**New RPC URL:** `http://localhost:8546`
**Chain ID:** `42161`
**Currency Symbol:** `ETH`

Click "Save"

### Step 3: Import Test Account

Import the default Anvil test account (has ETH and tokens):

1. Click account icon (top right)
2. "Import Account"
3. Select "Private Key"
4. Paste:
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
5. Click "Import"

**Account Address:** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`

### Step 4: Switch to Local Network

1. Click network dropdown
2. Select "Local Ethereum (Anvil)" or "Local Arbitrum (Anvil)"

## Using the Bridge UI

Now that MetaMask is configured:

1. **Open the app:** http://localhost:5174/
2. **Connect wallet:** Click "Connect Wallet" - MetaMask will connect using your local Anvil RPC
3. **View balances:** Balances will be fetched from middleware (which queries your local Anvil nodes)
4. **Bridge tokens:** Select chains and bridge between them

## How It Works

```
Browser (MetaMask)
    ↓ (connected to http://localhost:8545, chainId: 1)
    ↓
SDK (detects chainId: 1 → recognizes as Ethereum)
    ↓
Middleware (http://localhost:3000)
    ↓ (queries for balances)
    ↓
Anvil Nodes (localhost:8545, localhost:8546)
```

## Troubleshooting

### Error: "Environment not known/mapped"

**Cause:** MetaMask is connected to a public network or wrong chain ID

**Fix:**
1. Check MetaMask is connected to "Local Ethereum (Anvil)" or "Local Arbitrum (Anvil)"
2. Verify Anvil is running with correct chain ID: `anvil --chain-id 1` or `anvil --chain-id 42161`

### Error: "Failed to load balances"

**Cause:** Middleware can't reach Anvil nodes

**Fix:**
1. Check middleware is configured to use local Anvil RPCs
2. Verify Anvil nodes are running on ports 8545 and 8546

### Wrong balances shown

**Cause:** Anvil fork is old or doesn't have the right state

**Fix:**
1. Stop Anvil
2. Restart with fresh fork: `anvil --fork-url <RPC_URL> --fork-block-number <RECENT_BLOCK>`
3. Reconnect MetaMask

## Network Details

| Network | Chain ID | Local RPC | Forked From |
|---------|----------|-----------|-------------|
| Ethereum | 1 | http://localhost:8545 | Mainnet |
| Arbitrum | 42161 | http://localhost:8546 | Arbitrum One |
| Base | 8453 | http://localhost:8547 | Base Mainnet |

Add more networks as needed following the same pattern.

## Security Note

⚠️ **NEVER use the Anvil test private key on real networks!** It's publicly known and funds will be stolen instantly. Only use it for local testing.
