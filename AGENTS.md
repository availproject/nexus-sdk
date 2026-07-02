# AGENTS.md

Guide for humans and LLMs making changes in `@avail-project/nexus-core`.

## Start Here

Read these before editing:

- `README.md` for the end-user SDK surface, examples, and integration expectations
- `docs/ARCHITECTURE.md` for current package ownership and request flows
- `docs/CONVENTIONS.md` for style rules and SDK-specific coding conventions
- `src/index.ts` and `src/utils.ts` for the public export surfaces
- `tests/public-api.test.ts` for the public API guardrails

When docs and implementation disagree, trust the current code and tests first, then update docs as
part of the same change.

## What This Repo Is

A headless TypeScript SDK for cross-chain EVM operations: bridging, swapping, smart contract
execution, and balance discovery. The public client is created with `createNexusClient`.

## Repo Map

- `src/abi/` — contract ABIs used by bridge, execute, and swap flows
- `src/analytics/` — telemetry, timing spans, analytics providers, event definitions
- `src/core/` — public SDK assembly, client factory, client types, event adapters
- `src/flows/` — thin public orchestration and composition entrypoints
- `src/bridge/` — bridge-specific preview, intent, allowance, execution, progress
- `src/execute/` — execute runtime and execute-progress mapping
- `src/swap/` — routing, preflight, execution, wallet logic, progress
- `src/services/` — cross-feature helpers only
- `src/transport/` — middleware and simulation clients, request lifecycle
- `src/domain/` — types, errors, constants, validation, shared utilities
- `tests/` — mirrors `src/` and includes public API and type-surface tests

## Non-Negotiables

- Treat exports from `src/index.ts` and `src/utils.ts`, plus method signatures on `NexusClient`, as
  public API. Do not change or remove them without explicit approval.
- Update `README.md` as part of any public API change. End-user docs must stay in sync with the
  shipped SDK surface.
- Keep the high-level dependency direction intact:
  - `src/core/` is the top assembly layer
  - `src/flows/` stays thin
  - `src/bridge/`, `src/execute/`, and `src/swap/` own feature internals
  - `src/services/` is only for cross-feature helpers
  - lower layers must not grow back-references into higher orchestration layers
- Keep package boundaries intact. `src/core/` is the assembly layer. `src/flows/` stays thin.
  Bridge-only code belongs in `src/bridge/`, swap-only code in `src/swap/`, shared execute code in
  `src/execute/`, and only cross-feature helpers belong in `src/services/`.
- `src/services/` must not import `src/flows/`. This is CI-enforced by `npm run lint:deps`.
- Normalize external API and contract responses at the transport boundary before they reach
  business logic.
- Use `Errors.*` / the `NexusError` subclasses from `src/domain/errors.ts` for validation, state,
  user-action, and execution errors. There is no `NexusStepError` — step-scoped failures are the
  applicable subclass carrying `context.stepId` / `context.stepType` / `context.chainId`.
- User callbacks must not break flows. Follow the existing progress-emitter and
  `runNonBlocking(...)` pattern.
- Preserve unit correctness. Public inputs and on-chain calls use raw `bigint` values. Plans,
  results, and hooks may also expose human-readable strings, but conversions must be explicit.
  Never hardcode token decimals across chains.
- Never consume 100% of a native-token balance if gas is still needed for later steps.
- When refactoring internals, delete dead code paths instead of keeping parallel implementations
  "just in case". Do not introduce public breaking changes unless approved.
- If you change package ownership, request flow behavior, or conventions, update the corresponding
  docs in the same change.

## Where To Look

Public surface and client assembly:

- `src/index.ts`
- `src/utils.ts`
- `src/core/sdk/client.ts`
- `src/core/sdk/base.ts`
- `src/core/types.ts`
- `src/analytics/`

Architecture and flow ownership:

- `docs/ARCHITECTURE.md`
- `src/flows/`
- `src/bridge/`
- `src/execute/`
- `src/swap/`

Key domain and transport pieces:

- `src/abi/`
- `src/domain/errors.ts`
- `src/domain/types/`
- `src/domain/utils/validation.ts`
- `src/transport/middleware.ts`
- `src/transport/ws-request.ts`

Common implementation hotspots:

- Bridge: `src/bridge/intent/`, `src/bridge/allowances/`, `src/bridge/executor.ts`,
  `src/bridge/progress.ts`
- Execute: `src/execute/runtime.ts`, `src/execute/progress.ts`
- Swap: `src/swap/route.ts`, `src/swap/preflight.ts`, `src/swap/prepare.ts`,
  `src/swap/execution/`, `src/swap/progress.ts`
- Shared helpers: `src/services/chain-list.ts`, `src/services/balances.ts`,
  `src/services/fee-estimation.ts`, `src/services/wallet-capabilities.ts`

Tests to inspect first:

- `tests/public-api.test.ts`
- feature tests under `tests/flows/`, `tests/swap/`, `tests/services/`, `tests/transport/`
- surface and type tests under `tests/types/`

## Change Checklist

Before coding:

- Identify whether the change touches the public surface, request flow behavior, or package
  boundaries.
- Find the closest existing implementation and matching tests before introducing new structure.

Before finishing:

- `npm run typecheck`
- `npm run test`
- `npm run lint`
- `npm run lint:deps` if imports or file placement changed
- Update `README.md` after any public API change
- Update docs and tests when exported types, conventions, or request flows changed
