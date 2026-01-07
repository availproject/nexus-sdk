# Nexus SDK Node Example

A small **Node.js + TypeScript** runner for `@avail-project/nexus-core`.

- Reads a JSON config (`configuration.json` by default)
- Picks one `profiles[]` entry via `INDEX`
- Initializes `NexusSDK`, logs bridge balances, then runs one of the supported operations (controlled by `count`)

This is designed for **quick local testing**, **automation**, and **CLI-style execution**.

---

## Requirements

- Node.js **20+**
- npm (or compatible)
- RPC endpoints for any chain IDs you plan to use

> Security note: the config includes raw private keys. Use throwaway keys on testnets and do not commit secrets.

---

## Install

```bash
npm ci
```

---

## Run

`INDEX` selects which profile is used (0-based).

```bash
# Run profile 0 from ./configuration.json
INDEX=0 npm run start
```

Or via the helper script:

```bash
./run.sh 0
```

### Optional environment variables

- `INDEX` (required): profile index in `profiles[]`
- `CONFIGURATION` (optional): path to a JSON config file (defaults to `./configuration.json`)

Example:

```bash
CONFIGURATION=./configuration.local.json INDEX=1 npm run start
```

---

## Configuration (`configuration.json`)

Top-level schema:

```json
{
  "network": "testnet",
  "chains": [[1, "https://eth.merkle.io"]],
  "profiles": []
}
```

### `network`

Accepted values:

- `"mainnet"`
- `"testnet"`
- A fully-specified object (advanced)

Advanced `network` object shape (matches `NetworkConfig` in `@avail-project/nexus-core`):

```json
{
  "COSMOS_REST_URL": "https://…",
  "COSMOS_RPC_URL": "https://…",
  "COSMOS_WS_URL": "wss://…",
  "COSMOS_GRPC_URL": "https://…",
  "VSC_BASE_URL": "https://…",
  "VSC_WS_URL": "wss://…",
  "INTENT_EXPLORER_URL": "https://…",
  "NETWORK_HINT": 2
}
```

### `chains`

`chains` is a list of EVM RPC endpoints used by the internal wallet provider when switching chains:

```json
"chains": [
  [1, "https://eth.merkle.io"],
  [84532, "https://sepolia.base.org"]
]
```

Keep this list in sync with any `toChainId` / `from[].chainId` you use in profiles.

### `profiles[]`

Each profile combines:

- **Runner fields** used by this example (`privateKey`, `id`, `operation`, `count`, `network`)
- **Operation parameters** (passed through to the SDK call)

Common runner fields:

- `privateKey` (string, required): EVM private key
- `id` (string, required): log file prefix (e.g. `N00`)
- `operation` (string, required): one of `bridge`, `bridgeAndTransfer`, `bridgeAndExecute`, `exactInSwap`, `exactOutSwap`
- `count` (number, optional): how many times to attempt the operation
- `network` (optional): overrides top-level `network`

> JSON cannot represent `bigint`. Any `amount`/`gas`/`toAmount` values should be **decimal strings** (recommended) or numbers that fit.

Tip: set `count` to `0` to only initialize the SDK + print balances (no operation executed).

---

## Operations

Each profile includes an `operation` plus the operation-specific parameters.

Below, each operation lists **Required** vs **Optional** fields, and includes:

- a **Minimal** JSON snippet (required fields only)
- an **Example** JSON snippet (includes some optional fields)

### `bridge`

Calls `sdk.bridge(params)`.

**Required**

- `token`
- `amount`
- `toChainId`

**Optional**

- `recipient`
- `gas`
- `sourceChains`

**Minimal**

```json
{
  "operation": "bridge",
  "token": "ETH",
  "amount": "1000000000000000",
  "toChainId": 84532
}
```

**Example**

```json
{
  "operation": "bridge",
  "token": "ETH",
  "amount": "1000000000000000",
  "toChainId": 84532,
  "recipient": "0x0000000000000000000000000000000000000000",
  "sourceChains": [1],
  "gas": "0"
}
```

### `bridgeAndTransfer`

Calls `sdk.bridgeAndTransfer(params)`.

**Required**

- `token`
- `amount`
- `toChainId`
- `recipient`

**Optional**

- `sourceChains`

**Minimal**

```json
{
  "operation": "bridgeAndTransfer",
  "token": "USDC",
  "amount": "1500000",
  "toChainId": 137,
  "recipient": "0x0000000000000000000000000000000000000000"
}
```

**Example**

```json
{
  "operation": "bridgeAndTransfer",
  "token": "USDC",
  "amount": "1500000",
  "toChainId": 137,
  "recipient": "0x0000000000000000000000000000000000000000",
  "sourceChains": [1, 10]
}
```

### `bridgeAndExecute`

Calls `sdk.bridgeAndExecute(params)`.

**Required**

- `token`
- `amount`
- `toChainId`
- `execute`
- `execute.to`

**Optional**

- `sourceChains`
- `execute.data`
- `execute.value`
- `execute.gas`
- `execute.gasPrice`
- `execute.enableTransactionPolling`
- `execute.transactionTimeout`
- `execute.waitForReceipt`
- `execute.receiptTimeout`
- `execute.requiredConfirmations`
- `execute.tokenApproval`
- `enableTransactionPolling`
- `transactionTimeout`
- `waitForReceipt`
- `receiptTimeout`
- `requiredConfirmations`
- `recentApprovalTxHash`

**Minimal**

```json
{
  "operation": "bridgeAndExecute",
  "token": "USDC",
  "amount": "1000000",
  "toChainId": 8453,
  "execute": {
    "to": "0x0000000000000000000000000000000000000000"
  }
}
```

**Example**

```json
{
  "operation": "bridgeAndExecute",
  "token": "USDC",
  "amount": "1000000",
  "toChainId": 8453,
  "sourceChains": [10],
  "execute": {
    "to": "0x0000000000000000000000000000000000000000",
    "data": "0x",
    "tokenApproval": {
      "token": "USDC",
      "amount": "1000000",
      "spender": "0x0000000000000000000000000000000000000000"
    }
  }
}
```

### `exactInSwap`

Calls `sdk.swapWithExactIn(params)`.

**Required**

- `from`
- `from[].chainId`
- `from[].amount`
- `from[].tokenAddress`
- `toChainId`
- `toTokenAddress`

**Optional**

- none

**Minimal**

```json
{
  "operation": "exactInSwap",
  "from": [
    {
      "chainId": 10,
      "amount": "1000000",
      "tokenAddress": "0x0000000000000000000000000000000000000000"
    }
  ],
  "toChainId": 8453,
  "toTokenAddress": "0x0000000000000000000000000000000000000000"
}
```

### `exactOutSwap`

Calls `sdk.swapWithExactOut(params)`.

**Required**

- `toChainId`
- `toTokenAddress`
- `toAmount`

**Optional**

- none

**Minimal**

```json
{
  "operation": "exactOutSwap",
  "toChainId": 8453,
  "toTokenAddress": "0x0000000000000000000000000000000000000000",
  "toAmount": "1000000"
}
```

---

## Logs

Logs are written to `./logs/`.

For a profile `id` of `N00`:

```
logs/
  N00.txt
  N00_errors.txt
```

- `N00.txt` contains all entries
- `N00_errors.txt` contains only error entries

---

## Troubleshooting

### `INDEX env variable must be set`

Set `INDEX` to a valid index in `profiles[]`:

```bash
INDEX=0 npm run start
```

### RPC / network errors

- Ensure every chain you reference has a matching entry in `chains`
- Ensure your RPC URLs are reachable and not rate-limited
- If you use an advanced `network` object, verify keys match `NetworkConfig` exactly

### `wallet_switchEthereumChain: no RPC configured for chain ...`

Add the missing chain ID to `chains`. In practice, the SDK may switch across several chains during initialization and routing, so it's safest to include RPCs for all chains you expect the SDK to touch (commonly including `1` for Ethereum).


## Credit

This project includes code originally written by Nilay27 (https://github.com/Nilay27), licensed under the MIT License.

