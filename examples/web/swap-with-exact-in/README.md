# Swap (Exact In) Example

Minimal Vite + TypeScript project that swaps USDT → USDC on Arbitrum using the Nexus SDK `swapWithExactIn` method.

## Prerequisites

- Node 18+ and npm
- EIP-1193 wallet (MetaMask, Rabby, Rainbow, Brave, Phantom) funded with USDT on Arbitrum **mainnet** (default config)
- Browser with wallet extension enabled

> The default params use mainnet tokens and will ask for real approvals/spend. Reduce the amount or switch to a test network before trying it with production wallets.

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

- Instantiates `NexusSDK` with `network: 'mainnet'`.
- Uses the preset `swapParams` in `src/nexus.ts` to swap USDT to USDC on Arbitrum.
- Emits swap progress via `NEXUS_EVENTS` and renders a minimal UI from `src/screens.ts`.

## Customize

- Edit `swapParams` in `src/nexus.ts` to adjust tokens, chains, or amounts (values are in token base units).
- To run on testnet, change the SDK network to `'testnet'` and swap params to testnet-compatible tokens.
- Lower the swap amounts while experimenting to avoid unnecessary approvals and gas costs.
