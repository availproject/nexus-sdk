# Bridge + Transfer Example

Minimal Vite + TypeScript project that bridges USDC and performs an on-chain transfer on Arbitrum Sepolia using the Nexus SDK.

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
- Uses the preset `transferParams` in `src/nexus.ts` to bridge USDC and transfer to a recipient on Arbitrum Sepolia.
- Displays bridge and transfer progress via `NEXUS_EVENTS` with a minimal UI from `src/screens.ts`.

## Customize

- Edit `transferParams` in `src/nexus.ts` to change token, amount, destination chain, or recipient.
- Switch to mainnet by changing the SDK network and parameters (only do this if you intend to spend real funds).
- Use smaller amounts while experimenting; values are in the token's smallest units.
