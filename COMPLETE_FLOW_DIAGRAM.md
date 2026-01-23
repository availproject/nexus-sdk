# Complete Flow: Arbitrum USDC + Optimism USDT → Base Aave Deposit (Gasless)

## User's Scenario

- **Wallet**: `0xUser...`
- **Source**: 120 USDC (Arbitrum) + 24 USDT (Optimism)
- **Destination**: Base Aave deposit
- **Gas**: NONE on Arbitrum or Optimism (needs sponsored transactions)

---

## Phase 1: Wallet Connection & Cosmos Account Creation

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │     │   SDK Init   │     │   MetaMask   │     │  VSC/Cosmos  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ 1. new NexusSDK({networkConfig})       │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │ 2. sdk.init(walletClient)              │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │                    │ 3. WALLET POPUP: Sign SIWE message     │
       │                    │   "Sign to create Cosmos account"       │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │<───────────────────│                    │
       │                    │   signature: 0xabc123...                │
       │                    │                    │                    │
       │                    │ 4. Derive Cosmos private key from signature
       │                    │   cosmosPrivKey = keccak256(signature)  │
       │                    │   cosmosAddress = secp256k1(cosmosPrivKey)
       │                    │   → "avail1xyz..."                      │
       │                    │                    │                    │
       │                    │ 5. GET /cosmos/auth/v1beta1/accounts/avail1xyz
       │                    │─────────────────────────────────────────>│
       │                    │                    │                    │
       │                    │<─────────────────────────────────────────│
       │                    │   404 Not Found (new account)           │
       │                    │                    │                    │
       │                    │ 6. POST /api/v1/create-feegrant         │
       │                    │   { address: "avail1xyz..." }           │
       │                    │─────────────────────────────────────────>│
       │                    │                    │                    │
       │                    │<─────────────────────────────────────────│
       │                    │   { success: true, txHash: "..." }      │
       │                    │                    │                    │
       │<───────────────────│                    │                    │
       │  Ready! cosmos: avail1xyz...           │                    │
```

### API Calls in Phase 1

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/cosmos/auth/v1beta1/accounts/{address}` | GET | - | `404` or account info |
| `/api/v1/create-feegrant` | POST | `{ address: "avail1xyz..." }` | `{ success: true, txHash: "..." }` |

---

## Phase 2: Fetch Data & Build Intent

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │     │     SDK      │     │  Cosmos gRPC │     │   VSC REST   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ 1. sdk.bridge({                        │                    │
       │      sources: [                        │                    │
       │        {chain: "arbitrum", token: "USDC", amount: "120"},   │
       │        {chain: "optimism", token: "USDT", amount: "24"}     │
       │      ],                                │                    │
       │      destination: {chain: "base", protocol: "aave"}         │
       │    })                                  │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │                    │ 2. Parallel API calls:                 │
       │                    │                    │                    │
       │                    │ GET /api/v1/get-balance/ETHEREUM/0xUser│
       │                    │─────────────────────────────────────────>│
       │                    │<─────────────────────────────────────────│
       │                    │   {                                     │
       │                    │     balances: [                         │
       │                    │       {chainId:42161, token:"USDC", balance:"120000000"},
       │                    │       {chainId:10, token:"USDT", balance:"24000000"}
       │                    │     ]                                   │
       │                    │   }                                     │
       │                    │                    │                    │
       │                    │ gRPC: ProtocolFees()                   │
       │                    │───────────────────>│                    │
       │                    │<───────────────────│                    │
       │                    │   { nexusFee: 0.1%, solverFee: 0.05% } │
       │                    │                    │                    │
       │                    │ gRPC: PriceOracleData()                │
       │                    │───────────────────>│                    │
       │                    │<───────────────────│                    │
       │                    │   { USDC: $1.00, USDT: $1.00 }         │
       │                    │                    │                    │
       │                    │ gRPC: SolverDataAll()                  │
       │                    │───────────────────>│                    │
       │                    │<───────────────────│                    │
       │                    │   { solvers: [...], routes: [...] }    │
       │                    │                    │                    │
       │                    │ 3. Build Intent Structure              │
```

### Intent Structure Built

```typescript
intent = {
  sources: [
    { chainId: 42161, token: USDC, amount: 120000000 },  // Arbitrum
    { chainId: 10, token: USDT, amount: 24000000 }       // Optimism
  ],
  destination: {
    chainId: 8453,           // Base
    recipient: "0xUser",
    minReceived: 143780000   // ~$143.78 after fees
  },
  expiry: now + 1 hour
}
```

### API Calls in Phase 2

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/v1/get-balance/ETHEREUM/{address}` | GET | - | `{ balances: [...] }` |
| gRPC `ProtocolFees()` | gRPC | - | `{ nexusFee, solverFee }` |
| gRPC `PriceOracleData()` | gRPC | - | `{ USDC: price, USDT: price }` |
| gRPC `SolverDataAll()` | gRPC | - | `{ solvers: [...], routes: [...] }` |

---

## Phase 3: Sponsored Approvals (Gasless Permits)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   MetaMask   │     │     SDK      │     │  VSC (WSS)   │     │ Arb/Opt RPC  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │                    │ 1. Check allowances (parallel):        │
       │                    │   eth_call: USDC.allowance(user, vault)│
       │                    │─────────────────────────────────────────>│ Arbitrum
       │                    │<─────────────────────────────────────────│
       │                    │   allowance: 0 (needs approval)         │
       │                    │                    │                    │
       │                    │   eth_call: USDT.allowance(user, vault)│
       │                    │─────────────────────────────────────────>│ Optimism
       │                    │<─────────────────────────────────────────│
       │                    │   allowance: 0 (needs approval)         │
       │                    │                    │                    │
       │ 2. WALLET POPUP: Sign EIP-2612 Permit for Arbitrum USDC     │
       │   Domain: {name: "USD Coin", chainId: 42161, ...}           │
       │   Message: {owner, spender: vault, value: 120e6, nonce, deadline}
       │<───────────────────│                    │                    │
       │───────────────────>│                    │                    │
       │   permitSig1: {r, s, v}                │                    │
       │                    │                    │                    │
       │ 3. WALLET POPUP: Sign EIP-2612 Permit for Optimism USDT     │
       │   Domain: {name: "Tether USD", chainId: 10, ...}            │
       │   Message: {owner, spender: vault, value: 24e6, nonce, deadline}
       │<───────────────────│                    │                    │
       │───────────────────>│                    │                    │
       │   permitSig2: {r, s, v}                │                    │
       │                    │                    │                    │
       │                    │ 4. Connect WSS: /api/v1/create-sponsored-approvals
       │                    │───────────────────>│                    │
       │                    │   WebSocket Connected                  │
       │                    │                    │                    │
       │                    │ 5. Send permits (msgpack)              │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │                    │ 6. VSC relays permit txs
       │                    │                    │   (pays gas for user!)
       │                    │                    │───────────────────>│ Arbitrum
       │                    │                    │   USDC.permit(user, vault, 120e6, sig)
       │                    │                    │                    │
       │                    │                    │───────────────────>│ Optimism
       │                    │                    │   USDT.permit(user, vault, 24e6, sig)
       │                    │                    │                    │
       │                    │ 7. Receive status updates:             │
       │                    │<───────────────────│                    │
       │                    │   {status: 0x10, idx: 0} ← Arb success │
       │                    │<───────────────────│                    │
       │                    │   {status: 0x10, idx: 1} ← Opt success │
       │                    │<───────────────────│                    │
       │                    │   {status: 0xff, idx: 0} ← All done    │
```

### Sponsored Approval Request (msgpack encoded)

```typescript
[
  {
    address: Uint8Array(32),        // User address (padded)
    chain_id: Uint8Array(32),       // 42161 (Arbitrum)
    universe: Universe.ETHEREUM,
    operations: [{
      sig_r: Uint8Array(32),
      sig_s: Uint8Array(32),
      sig_v: number,
      token_address: USDC_ADDRESS,
      value: BigInt(120000000),
      variant: PermitVariant.EIP2612
    }]
  },
  {
    chain_id: Uint8Array(32),       // 10 (Optimism)
    operations: [{
      token_address: USDT_ADDRESS,
      value: BigInt(24000000),
      // ... signature components
    }]
  }
]
```

### VSC Response Status Codes

| Status | Meaning |
|--------|---------|
| `0x10` | Collection successful for chain at `idx` |
| `0x1a` | Collection failed for chain at `idx` |
| `0xff` | Transmission complete (all done) |

---

## Phase 4: Sign & Submit RFF to Cosmos

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   MetaMask   │     │     SDK      │     │ Cosmos Chain │     │   VSC WSS    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │                    │ 1. Build OmniversalRFF                 │
       │                    │                    │                    │
       │ 2. WALLET POPUP: Sign Intent Hash                           │
       │   "Sign to confirm your bridge intent"                     │
       │   Message: intentHash (32 bytes)                           │
       │<───────────────────│                    │                    │
       │───────────────────>│                    │                    │
       │   intentSig: 0xdef456...                │                    │
       │                    │                    │                    │
       │                    │ 3. Create Cosmos message               │
       │                    │                    │                    │
       │                    │ 4. Sign & Broadcast to Cosmos:         │
       │                    │   client.signAndBroadcast(...)         │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │<───────────────────│                    │
       │                    │   TxResponse {                         │
       │                    │     code: 0,                           │
       │                    │     txHash: "ABC123...",               │
       │                    │     msgResponses: [{                   │
       │                    │       id: 789  ← INTENT ID             │
       │                    │     }]                                 │
       │                    │   }                                    │
```

### OmniversalRFF Structure

```typescript
omniversalRFF = {
  protobufRFF: {
    destinationChainID: 8453,              // Base
    destinationUniverse: Universe.ETHEREUM,
    destinations: [{
      recipient: "0xUser",
      currencies: [{
        token: USDC_BASE_ADDRESS,
        amount: 143780000                  // ~$143.78 after fees
      }]
    }],
    sources: [
      { chainId: 42161, token: USDC, amount: 120000000 },
      { chainId: 10, token: USDT, amount: 24000000 }
    ],
    expiresAt: 1705432800,
    creator: "avail1xyz..."
  },
  intentHash: keccak256(...)
}
```

### Cosmos Transaction

```typescript
// Message sent to Cosmos chain
{
  typeUrl: "/xarchain.chainabstraction.MsgCreateRequestForFunds",
  value: {
    creator: "avail1xyz...",
    destinationChainID: 8453,
    destinations: [...],
    sources: [...],
    signatures: [intentSig],
    expiresAt: 1705432800
  }
}

// Response
MsgCreateRequestForFundsResponse {
  id: Long(789)  // This is your INTENT ID
}
```

---

## Phase 5: Token Collection via VSC

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     SDK      │     │   VSC WSS    │     │   Arbitrum   │     │   Optimism   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ 1. Connect WSS: /api/v1/create-rff     │                    │
       │───────────────────>│                    │                    │
       │   WebSocket Connected                  │                    │
       │                    │                    │                    │
       │ 2. Send intent ID (msgpack):           │                    │
       │   { id: 789 }      │                    │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │                    │ 3. VSC calls Vault.collectTokens()     │
       │                    │   (using the permits from Phase 3)     │
       │                    │                    │                    │
       │                    │   ArbitrumVault.transferFrom(          │
       │                    │     user, vault, 120 USDC              │
       │                    │   )                │                    │
       │                    │───────────────────>│                    │
       │                    │<───────────────────│                    │
       │                    │   txHash: 0x111... │                    │
       │                    │                    │                    │
       │                    │   OptimismVault.transferFrom(          │
       │                    │     user, vault, 24 USDT               │
       │                    │   )                │                    │
       │                    │─────────────────────────────────────────>│
       │                    │<─────────────────────────────────────────│
       │                    │   txHash: 0x222... │                    │
       │                    │                    │                    │
       │ 4. Receive collection status:          │                    │
       │<───────────────────│                    │                    │
       │   {status: 0x10, idx: 0}               │ ← Arbitrum collected
       │<───────────────────│                    │                    │
       │   {status: 0x10, idx: 1}               │ ← Optimism collected
       │<───────────────────│                    │                    │
       │   {status: 0xff, idx: 0, errored: false}  ← All complete    │
       │                    │                    │                    │
       │ 5. Close WebSocket │                    │                    │
```

### VSC Create-RFF Request

```typescript
// Sent via WebSocket (msgpack encoded)
{ id: 789 }
```

### VSC Create-RFF Response Stream

```typescript
// Response 1: Arbitrum collection success
{ status: 0x10, idx: 0, errored: false }

// Response 2: Optimism collection success
{ status: 0x10, idx: 1, errored: false }

// Response 3: All done
{ status: 0xff, idx: 0, errored: false }
```

---

## Phase 6: Solver Fulfillment & Aave Deposit

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     SDK      │     │ Cosmos WSS   │     │    Solver    │     │     Base     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ 1. Subscribe to fill event:            │                    │
       │   WSS /websocket   │                    │                    │
       │───────────────────>│                    │                    │
       │   {                │                    │                    │
       │     method: "subscribe",               │                    │
       │     params: {                          │                    │
       │       query: "xarchain.chainabstraction.RFFFulfilledEvent.id='789'"
       │     }              │                    │                    │
       │   }                │                    │                    │
       │                    │                    │                    │
       │                    │                    │ 2. Solver monitors RFF #789
       │                    │                    │    Sees: 120 USDC + 24 USDT
       │                    │                    │    collected, dest: Base
       │                    │                    │                    │
       │                    │                    │ 3. Solver executes on Base:
       │                    │                    │   BaseVault.fulfill(         │
       │                    │                    │     rffId: 789,              │
       │                    │                    │     recipient: 0xUser,       │
       │                    │                    │     token: USDC,             │
       │                    │                    │     amount: 143780000        │
       │                    │                    │   )                          │
       │                    │                    │───────────────────>│
       │                    │                    │<───────────────────│
       │                    │                    │   txHash: 0xFULFILL...
       │                    │                    │                    │
       │                    │                    │ 4. Solver submits proof
       │                    │                    │   MsgFulfillRFF {...}        │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │ 5. Receive fill event:                 │                    │
       │<───────────────────│                    │                    │
       │   {                │                    │                    │
       │     result: {      │                    │                    │
       │       events: {    │                    │                    │
       │         "xarchain...RFFFulfilledEvent.id": ["789"]          │
       │       }            │                    │                    │
       │     }              │                    │                    │
       │   }                │                    │                    │
       │                    │                    │                    │
       │ 6. SDK now has ~143.78 USDC on Base!   │                    │
       │                    │                    │                    │
       │ 7. Execute Aave deposit:               │                    │
       │   AaveLendingPool.supply(              │                    │
       │     USDC, 143780000, 0xUser, 0         │                    │
       │   )                │                    │                    │
       │─────────────────────────────────────────────────────────────>│
       │<─────────────────────────────────────────────────────────────│
       │   txHash: 0xAAVE...│                    │                    │
       │                    │                    │                    │
       │ 8. COMPLETE! User has aUSDC on Base    │                    │
```

### Cosmos WebSocket Subscription

```typescript
// Subscribe request
{
  id: "0",
  jsonrpc: "2.0",
  method: "subscribe",
  params: {
    query: "xarchain.chainabstraction.RFFFulfilledEvent.id='\"789\"'"
  }
}

// Event received when solver fulfills
{
  result: {
    events: {
      "xarchain.chainabstraction.RFFFulfilledEvent.id": ["\"789\""]
    }
  }
}
```

---

## Summary: All Wallet Popups

| # | Popup | Purpose |
|---|-------|---------|
| 1 | Sign SIWE message | Create Cosmos account |
| 2 | Sign EIP-2612 Permit | Approve Arbitrum USDC |
| 3 | Sign EIP-2612 Permit | Approve Optimism USDT |
| 4 | Sign Intent Hash | Confirm RFF |

**Total: 4 signatures, 0 gas paid by user**

---

## Summary: All API Calls

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cosmos/auth/v1beta1/accounts/{addr}` | GET | Check Cosmos account |
| `/api/v1/create-feegrant` | POST | Get gas grant |
| `/api/v1/get-balance/ETHEREUM/{addr}` | GET | Fetch user balances |
| gRPC `ProtocolFees()` | gRPC | Get fee structure |
| gRPC `PriceOracleData()` | gRPC | Get token prices |
| gRPC `SolverDataAll()` | gRPC | Get solver routes |
| Arbitrum RPC `USDC.allowance()` | eth_call | Check approval |
| Optimism RPC `USDT.allowance()` | eth_call | Check approval |
| `wss://.../api/v1/create-sponsored-approvals` | WebSocket | Relay gasless permits |
| Cosmos `MsgCreateRequestForFunds` | Cosmos TX | Submit RFF on-chain |
| `wss://.../api/v1/create-rff` | WebSocket | Trigger token collect |
| `wss://cosmos/websocket` | WebSocket | Wait for solver fill |
| Base RPC `AaveLendingPool.supply()` | eth_send | Final Aave deposit |

---

## Key Files Reference

| Phase | File | Lines |
|-------|------|-------|
| Cosmos account | `src/sdk/ca-base/ca.ts` | 394-416 |
| Fee grant | `src/sdk/ca-base/utils/cosmos.utils.ts` | 26-37 |
| Build intent | `src/sdk/ca-base/requestHandlers/bridge.ts` | 108-190 |
| Sign permits | `src/sdk/ca-base/utils/contract.utils.ts` | 259-360 |
| Sponsored approvals | `src/sdk/ca-base/requestHandlers/bridge.ts` | 558-754 |
| RFF creation | `src/sdk/ca-base/utils/rff.utils.ts` | 87-227 |
| Cosmos submit | `src/sdk/ca-base/utils/cosmos.utils.ts` | 39-70 |
| Token collection | `src/sdk/ca-base/utils/api.utils.ts` | 494-577 |
| Fill check | `src/sdk/ca-base/utils/cosmos.utils.ts` | 158-220 |

---

# V2 Protocol Flow (Statekeeper API)

The v2 protocol simplifies the bridging flow by replacing Cosmos chain submission and VSC WebSocket calls with a single REST API.

## V2 vs V1 Comparison

| Aspect | V1 (Cosmos) | V2 (Statekeeper) |
|--------|-------------|------------------|
| RFF Submission | Cosmos `signAndBroadcast` | REST `POST /rff` |
| Identifier | `intentID` (Long/number) | `requestHash` (bytes32 hex) |
| Token Collection | VSC WebSocket | Statekeeper handles internally |
| Fill Checking | Cosmos WebSocket + gRPC | Statekeeper polling `GET /rff/:hash` |
| Complexity | High (multiple WebSockets) | Low (single REST API) |

## V2 Statekeeper API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | Detailed status (sync state, chain cursors) |
| `/rff` | POST | Submit new RFF |
| `/rff/:hash` | GET | Get RFF by hash |
| `/rffs` | GET | List RFFs (with filters) |

---

## V2 Phase 1: Wallet Connection (Simplified)

In v2, no Cosmos account creation is needed. The user only needs an EVM wallet.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │     │   SDK Init   │     │   MetaMask   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. new NexusSDK({networkConfig})       │
       │───────────────────>│                    │
       │                    │                    │
       │ 2. sdk.init(walletClient)              │
       │───────────────────>│                    │
       │                    │                    │
       │<───────────────────│                    │
       │  Ready! evm: 0xUser...                 │
```

**No Cosmos setup required in v2!**

---

## V2 Phase 2: Fetch Data & Build Intent

Same as v1 - fetches balances from VSC and builds intent structure.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │     │     SDK      │     │   VSC REST   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. sdk.bridge({...})                   │
       │───────────────────>│                    │
       │                    │                    │
       │                    │ 2. GET /api/v1/get-balance/ETHEREUM/0xUser
       │                    │───────────────────>│
       │                    │<───────────────────│
       │                    │   { balances: [...] }
       │                    │                    │
       │                    │ 3. Build Intent    │
```

---

## V2 Phase 3: Approvals (Same as V1)

Token approvals still use VSC sponsored approvals WebSocket.

---

## V2 Phase 4: Sign & Submit RFF to Statekeeper

**This is the key difference from v1.**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   MetaMask   │     │     SDK      │     │ Statekeeper  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │                    │ 1. Build V2 Request│
       │                    │   (matches Solidity Vault struct)
       │                    │                    │
       │ 2. WALLET POPUP: Sign Request Hash     │
       │   Message: keccak256(abi.encode(request))
       │<───────────────────│                    │
       │───────────────────>│                    │
       │   signature: 0xabc123...               │
       │                    │                    │
       │                    │ 3. POST /rff       │
       │                    │   {                │
       │                    │     request: {...},│
       │                    │     signature: "0x..."
       │                    │   }                │
       │                    │───────────────────>│
       │                    │                    │
       │                    │<───────────────────│
       │                    │   {                │
       │                    │     request_hash: "0xdef789..."
       │                    │   }                │
       │                    │                    │
       │                    │ ← REQUEST HASH is the unique ID
```

### V2 Request Structure

```typescript
// Matches Solidity Vault.sol exactly
interface V2Request {
  sources: Array<{
    universe: 0 | 1;           // 0=EVM, 1=Tron
    chain_id: string;          // U256 hex
    contract_address: string;  // bytes32 hex
    value: string;             // U256 hex
    fee: string;               // U256 hex
  }>;
  destination_universe: 0 | 1;
  destination_chain_id: string;
  recipient_address: string;   // bytes32 hex
  destinations: Array<{
    contract_address: string;
    value: string;
  }>;
  nonce: string;               // U256 hex (random)
  expiry: string;              // U256 hex (unix timestamp)
  parties: Array<{
    universe: 0 | 1;
    address: string;           // bytes32 hex
  }>;
}
```

### API Request/Response

```typescript
// POST /rff
// Request Body:
{
  request: V2Request,
  signature: "0x..."  // 65 bytes, EIP-191 signed
}

// Response:
{
  request_hash: "0xdef789..."  // bytes32, unique identifier
}
```

---

## V2 Phase 5: Token Collection (Handled by Statekeeper)

**In v2, the SDK does NOT need to trigger collection.** The statekeeper handles this automatically.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     SDK      │     │ Statekeeper  │     │   Chains     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ (SDK just waits)   │                    │
       │                    │ 1. Statekeeper detects new RFF
       │                    │                    │
       │                    │ 2. Triggers collection on source chains
       │                    │───────────────────>│
       │                    │<───────────────────│
       │                    │                    │
       │                    │ 3. Updates RFF status: "deposited"
```

---

## V2 Phase 6: Wait for Fulfillment (Polling)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     SDK      │     │ Statekeeper  │     │    Solver    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. GET /rff/0xdef789...                │
       │───────────────────>│                    │
       │<───────────────────│                    │
       │   { status: "deposited" }              │
       │                    │                    │
       │ (poll every 2s)    │                    │
       │                    │                    │
       │                    │ 2. Solver sees deposited RFF
       │                    │<───────────────────│
       │                    │                    │
       │                    │ 3. Solver fulfills on destination
       │                    │───────────────────>│
       │                    │                    │
       │                    │ 4. Updates status: "fulfilled"
       │                    │                    │
       │ 5. GET /rff/0xdef789...                │
       │───────────────────>│                    │
       │<───────────────────│                    │
       │   { status: "fulfilled" }              │
       │                    │                    │
       │ 6. DONE! User has funds on destination │
```

### RFF Status Lifecycle

```
created → deposited → fulfilled
                  ↘ expired (if timeout)
```

---

## V2 Summary: All Wallet Popups

| # | Popup | Purpose |
|---|-------|---------|
| 1 | Sign EIP-2612 Permit(s) | Approve source tokens |
| 2 | Sign Request Hash | Confirm RFF |

**Total: 2-3 signatures (depending on sources), 0 gas paid by user**

---

## V2 Summary: All API Calls

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/get-balance/ETHEREUM/{addr}` | GET | Fetch user balances (VSC) |
| `wss://.../api/v1/create-sponsored-approvals` | WebSocket | Relay gasless permits (VSC) |
| `POST /rff` | POST | Submit RFF (Statekeeper) |
| `GET /rff/:hash` | GET | Poll for status (Statekeeper) |

---

## V2 Key Files Reference

| Phase | File | Function |
|-------|------|----------|
| V2 Types | `src/commons/types/index.ts` | `V2Request`, `V2SourcePair`, etc. |
| Statekeeper Client | `src/sdk/ca-base/utils/api.utils.ts` | `StatekeeperClient` class |
| V2 Request Creation | `src/sdk/ca-base/utils/rff.utils.ts` | `createV2RequestFromIntent()` |
| V2 Execute | `src/sdk/ca-base/requestHandlers/bridge.ts` | `executeV2()`, `processRFFv2()` |
| V2 Fill Check | `src/sdk/ca-base/requestHandlers/bridge.ts` | `waitForFillV2()` |

---

## Local Development Setup

Services required for local testing:

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Statekeeper database |
| Anvil (ETH) | 8545 | Local Ethereum |
| Anvil (ARB) | 8546 | Local Arbitrum |
| Anvil (BASE) | 8547 | Local Base |
| Anvil (POLY) | 8548 | Local Polygon |
| Statekeeper | 9080 | V2 RFF API |
| Solver | 9081 | Fulfillment service |

---

## V2 Middleware Protocol (localhost:3000)

### Balance Fetching
1. SDK → `GET /api/v1/balance/evm/:address` → Middleware
2. Middleware → Fetches from all chain RPCs → Returns JSON
3. Response: `{ "42161": { currencies: [...], total_usd, universe, errored } }`

### Approval Creation
1. SDK → `WSS /api/v1/create-sponsored-approvals` → Middleware
2. Middleware → Submits permit txs to chains → Returns streamed responses
3. Response per chain: `{ chainId, address, errored, txHash }`

### RFF Submission
1. SDK → `POST /api/v1/rff` → Middleware → Statekeeper
2. Statekeeper validates & stores → Returns request_hash
3. Response: `{ request_hash: "0x..." }`

### RFF Status
1. SDK → `GET /api/v1/rff/:hash` → Middleware → Statekeeper
2. Response: `{ request, request_hash, signature, status, solver }`
