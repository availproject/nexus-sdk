# Stress Test CLI and Engine

This folder contains the reusable stress-test scheduler/metrics engine plus a Node.js CLI runner for exercising Nexus bridge flows under load.

## What lives here

- `engine.ts`: framework-agnostic load scheduler (`batch`, `fixed`, `ramp`, `soak`)
- `types.ts`: shared run/operation/report types
- `index.ts`: re-exports engine and types for programmatic use
- `cli.ts`: interactive + non-interactive Node CLI
- `provider.node.ts`: private-key-backed EVM provider adapter for Node
- `private-key.ts`: key normalization/masking helpers
- `progress.ts`: operation status transition helpers and phase timing (sign→deposit→fill)
- `tui/`: Ink-based terminal UI (live run view + post-run report)
  - `App.tsx`: top-level TUI component; switches between run and report screens
  - `RunScreen.tsx`: live operations/details/event-log panes
  - `theme.ts`: built-in colour themes
  - `run-layout.ts`: responsive layout breakpoints for wide/stacked modes
  - `types.ts`: TUI-specific state and controller types
  - `index.tsx`: `startTui()` entry point
  - `hooks/`: `useStdoutDimensions`
  - `vendor/`: vendored `InkTable` and `InkDivider` components
- `notes.md`: implementation notes for the engine internals

## Quick Start (CLI)

From repo root:

```bash
npm run stress -- wizard
```

If you use the TUI-enabled CLI from `packages/tools`, install tool dependencies first:

```bash
cd packages/tools && npm install
```

Root `npm run stress -- ...` delegates to `packages/tools`.

The wizard will prompt for:

- network config source (preset / file / json / env)
- private key source (file / env / hidden input / devnet auto-generation)
- auto-funding prompt only when selected network resolves to `NETWORK_HINT=devnet`
- token, amount
- destinations (chain IDs or `all`)
- load model + model-specific settings
- optional report file

## Non-Interactive Examples

### Batch

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network testnet \
  --token USDC \
  --amount 1 \
  --destinations 421614 \
  --load-model batch \
  --total-requests 20 \
  --batch-size 4 \
  --delay-ms 1000
```

### Fixed rate

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network testnet \
  --token USDC \
  --amount 1 \
  --destinations 421614,11155111 \
  --load-model fixed \
  --total-requests 50 \
  --rate-per-second 2 \
  --max-in-flight 5
```

### Ramp

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network testnet \
  --token USDC \
  --amount 1 \
  --destinations 421614,11155111 \
  --load-model ramp \
  --total-requests 100 \
  --start-rate 1 \
  --step-rate 1 \
  --step-duration-sec 30 \
  --max-rate 5 \
  --max-in-flight 10
```

### Soak

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network testnet \
  --token USDC \
  --amount 1 \
  --destinations 421614 \
  --load-model soak \
  --total-requests 500 \
  --rate-per-second 1 \
  --duration-minutes 10 \
  --max-in-flight 3
```

### All eligible destinations

Use `--destinations all` to broadcast to every chain that supports the token:

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network testnet \
  --token USDC \
  --amount 1 \
  --destinations all \
  --load-model batch \
  --total-requests 30 \
  --batch-size 3 \
  --delay-ms 500
```

## Network Config Options

The CLI accepts either a preset network name or a custom SDK `NetworkConfig` object.
Choose exactly one of:

| Flag | Description |
|------|-------------|
| `--network testnet\|mainnet` | Built-in preset (default: `testnet`) |
| `--network-config-file <path>` | Path to a JSON config file |
| `--network-config-json <json>` | Inline JSON string |
| `--network-config-env <ENV>` | Env var containing JSON |

### Custom network config JSON shape

```json
{
  "MIDDLEWARE_HTTP_URL": "https://your-middleware.example/",
  "MIDDLEWARE_WS_URL": "wss://your-middleware.example/",
  "INTENT_EXPLORER_URL": "https://your-explorer.example/",
  "NETWORK_HINT": "testnet"
}
```

`NETWORK_HINT` must be `"testnet"`, `"mainnet"`, or `"devnet"`.

### Local devnet with global RPC overrides

When running on local devnet, middleware may return Docker-internal RPC URLs. Use
`CHAIN_RPC_OVERRIDES` to map chain IDs to host-accessible RPC URLs globally for the run.

```json
{
  "MIDDLEWARE_HTTP_URL": "http://localhost:4050/",
  "MIDDLEWARE_WS_URL": "ws://localhost:4050/",
  "INTENT_EXPLORER_URL": "http://localhost:4050/",
  "NETWORK_HINT": "devnet",
  "CHAIN_RPC_OVERRIDES": {
    "1": "http://localhost:8545",
    "137": "http://localhost:8548",
    "8453": "http://localhost:8547",
    "42161": "http://localhost:8546"
  }
}
```

### Devnet auto-account funding

If no private key is provided and `NETWORK_HINT` is `devnet`, the CLI will:

- generate a fresh account
- fund `1000 ETH` on each chain
- fund `1000` units of `USDC` or `USDT` on each chain

Guardrails:

- `cast` must be installed and available on `PATH` (hard failure otherwise)
- auto-funding works only for `devnet`
- token must be `USDC` or `USDT`
- `knownTokens.balanceSlot` must be present for the token on every target chain

### Custom network — from file

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network-config-file ./network.json \
  --token USDC \
  --amount 1 \
  --destinations all \
  --load-model batch \
  --total-requests 10 \
  --batch-size 2 \
  --delay-ms 500
```

### Custom network — inline JSON

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network-config-json '{"MIDDLEWARE_HTTP_URL":"https://your-middleware.example/","MIDDLEWARE_WS_URL":"wss://your-middleware.example/","INTENT_EXPLORER_URL":"https://your-explorer.example/","NETWORK_HINT":"testnet"}' \
  --token USDC \
  --amount 1 \
  --destinations 421614 \
  --load-model fixed \
  --total-requests 20 \
  --rate-per-second 2
```

### Custom network — from env var

```bash
export NEXUS_NETWORK_CONFIG='{"MIDDLEWARE_HTTP_URL":"https://your-middleware.example/","MIDDLEWARE_WS_URL":"wss://your-middleware.example/","INTENT_EXPLORER_URL":"https://your-explorer.example/","NETWORK_HINT":"testnet"}'
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network-config-env NEXUS_NETWORK_CONFIG \
  --token USDC \
  --amount 1 \
  --destinations all \
  --load-model soak \
  --total-requests 200 \
  --rate-per-second 1 \
  --duration-minutes 5
```

## Private Key Input

| Method | Example |
|--------|---------|
| Inline flag | `--private-key 0x...` |
| File path | `--private-key-file .secrets/stress.key` |
| Default env var | `NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run ...` |
| Custom env var | `--private-key-env MY_KEY_VAR` |
| Hidden prompt | Wizard / interactive `run` when the key is not set |
| Devnet auto-generated | Omit private key with `NETWORK_HINT=devnet` |

To avoid exposing the key in shell history, use the wizard and select **File** as the key source. The wizard prompts for a file path; if the file doesn't exist it prompts for the key (hidden input) and writes it to the file with restricted permissions. Subsequent runs can skip the wizard and pass `--private-key-file .secrets/stress.key` directly.

## Output and Reports

| Flag | Effect |
|------|--------|
| `--json` | Print full JSON payload (`report` + `operations`) to stdout |
| `--no-tui` / `--plain` | Disable the TUI; use plain log lines instead |
| `--report-file <path>` | Write the same JSON payload to a file |
| `--dry-run` | Validate and print the resolved config without executing |
| `--verbose` | More progress log lines |
| `--quiet` | Minimal output |
| `--theme <name>` | TUI colour theme (see below) |

CLI output prints only private key source label (`file:<path>`, `env:<name>`, `direct`, or `auto-generated on devnet`) and never the key value.

`Ctrl+C` stops new scheduling, waits for in-flight operations to settle, then prints a partial report.

### TUI themes

Available themes for `--theme`:

| Name | Description |
|------|-------------|
| `lipgloss-charm` | Magenta/cyan accents, vivid status colours (default) |
| `dracula-vivid` | Bright Dracula palette |
| `catppuccin-mocha-pop` | Catppuccin Mocha with bold accents |
| `neon-tokyo` | High-contrast neon on dark |

```bash
NEXUS_STRESS_PRIVATE_KEY=0x... npm run stress -- run \
  --network testnet --token USDC --amount 1 --destinations all \
  --load-model batch --total-requests 10 --batch-size 2 --delay-ms 500 \
  --theme dracula-vivid
```

### TUI keyboard controls — live run

| Key | Action |
|-----|--------|
| `Tab` | Cycle focus: Operations → Details → Event Log |
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `s` | Request stop (waits for in-flight ops to settle) |
| `r` | Open report (available once run finishes) |
| `q` / `Esc` | Quit (available once run finishes) |

When **Event Log** is focused:

| Key | Action |
|-----|--------|
| `g` | Scroll to top, disable auto-follow |
| `G` | Scroll to bottom, re-enable auto-follow |

Auto-follow is enabled by default: the event log tracks new events as they arrive. Pressing `↑`/`k` disables it; pressing `G` re-enables it.

### TUI keyboard controls — report screen

| Key | Action |
|-----|--------|
| `1` | Overview tab (summary + latency + errors) |
| `2` | Charts tab (latency profile, duration distribution, operation trend, chain volume) |
| `3` | Chains tab (per-chain breakdown table) |
| `b` | Back to live run screen |
| `q` / `Esc` | Quit |

## Safety Notes

- Stress testing is intended for testnet/sandbox usage only.
- The runner uses max-allowance approvals in the bridge hooks to reduce repeated approval prompts under load.
- Do not use a private key that controls real-value funds.

## Engine Reuse (Node API)

The scheduling engine is importable from `./index` (or from within `packages/tools`):

```ts
import { runStressTest, buildReport } from './stress-test';
```

- `runStressTest(options)` — schedules operations according to the chosen load model and calls your executor for each one
- `buildReport(operations, startedAt, endedAt, config, chainLookup)` — aggregates results into a structured report

You provide the operation executor and optional hooks for start/finish/error events. See `notes.md` for load model behaviour details.
