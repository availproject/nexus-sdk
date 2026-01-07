# WASM Bridge + Transfer Example

Macroquad (Rust) UI compiled to WebAssembly that calls the Nexus SDK bridge + transfer flow from TypeScript glue code.

## Prerequisites

- Node 18+ and npm
- Rust toolchain (stable) with the `wasm32-unknown-unknown` target
- EIP-1193 wallet in your browser with Arbitrum Sepolia testnet USDC

## Build & Install

From `examples/web/wasm`:

```bash
# Compile Rust to wasm and copy artifacts into frontend/build/program.wasm
./build.sh

# Install frontend dependencies
cd frontend
npm install
```

## Run

Start the Vite dev server (defaults to http://localhost:5173):

```bash
cd frontend
npm run dev
```

## What this example does

- Rust `backend/` renders a Macroquad canvas UI, compiled to wasm via `build_release.sh`.
- TypeScript glue in `frontend/src/glue` exposes `initialize_nexus` and `initiate_bridge_and_transfer` so Rust can call into the SDK.
- `frontend/src/nexus.ts` initializes `NexusSDK` (testnet) with a browser wallet and streams bridge progress back into Rust through exported wasm callbacks.

## Customize

- Adjust transfer parameters or SDK network in `frontend/src/nexus.ts`.
- Tweak Rust UI/logic in `backend/src` and rerun `./build.sh` to regenerate the wasm.
