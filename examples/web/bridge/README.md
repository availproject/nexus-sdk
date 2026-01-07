# Bridge Example

Minimal Vite + TypeScript project that bridges USDC to Arbitrum Sepolia through the Nexus SDK.

## Prerequisites

- Node 18+ and npm
- EIP-1193 wallet (MetaMask, Rabby, Rainbow, Brave, Phantom) funded with Arbitrum Sepolia testnet USDC
- Browser with wallet extension enabled

## Setup

Install dependencies in the example folder:

```bash
npm install
```

## Run

Start the dev server (Vite default: http://localhost:5173):

```bash
npm run dev
```

## What this example does

- Instantiates `NexusSDK` with `network: 'testnet'`.
- Uses the preset `bridgeParams` in `src/nexus.ts` to bridge `USDC` to Arbitrum Sepolia.
- Streams bridge progress via `NEXUS_EVENTS` and updates the simple UI in `src/screens.ts`.

## Customize

- Edit `bridgeParams` in `src/nexus.ts` to change token, amount, destination chain, or recipient.
- Switch to mainnet by changing the SDK network and parameters (ensure you are comfortable spending real funds).
- Use smaller amounts while experimenting; values are in the token's smallest units.
