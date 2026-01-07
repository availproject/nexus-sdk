# Nexus SDK Examples

Reference guide for the example projects under `examples/`. Each example is self-contained and uses Vite for local development.

## Prerequisites

- Node 18+ and npm
- Browser wallet with EIP-1193 support (MetaMask, Rabby, Rainbow, Brave, Phantom)
- Testnet or mainnet funds that match the example defaults (see catalog below)
- For the WASM example: Rust toolchain (stable) with the `wasm32-unknown-unknown` target

## Quick start (web examples)

1. `cd examples/web/<example>`
2. Install deps: `npm install`
3. Run locally: `npm run dev` (Vite defaults to http://localhost:5173)

## Example catalog

- `web/bridge`: Bridge USDC to Arbitrum Sepolia using the Nexus SDK bridge flow (testnet).
- `web/bridge-and-transfer`: Bridge USDC and transfer to a recipient on Arbitrum Sepolia (testnet).
- `web/swap-with-exact-in`: Swap USDT → USDC on Arbitrum mainnet with a fixed input amount (mainnet by default).
- `web/swap-with-exact-out`: Swap to a target amount of USDT on Arbitrum mainnet with a flexible input (mainnet by default).
- `web/wasm`: Macroquad (Rust) canvas UI compiled to WebAssembly; calls the Nexus SDK bridge + transfer flow in the browser (testnet).

## Notes

- Amounts in the examples are expressed in token base units; edit the params in each `src/nexus.ts` to change tokens, chains, or sizes.
- Swap examples default to mainnet and will prompt for real approvals/spend—switch the SDK network and params to testnet tokens if you prefer to experiment safely.
- The WASM example must run `./build.sh` once before installing and starting the frontend.
