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

- `src/client/` — public client assembly, state, types, utilities, operation boundaries
- `src/intent/` — middleware, catalog, swap inputs, normalization, funding, wallet, orchestrator
- `src/execute/` — execute/simulate entrypoints, runtime, approvals, wallet capabilities
- `src/analytics/` — telemetry, timing spans, analytics providers, event definitions
- `src/domain/` — shared types, errors, constants, ABI, validation, formatting, logging
- `src/services/` — cross-feature helpers only
- `tests/` — follows source ownership, plus public API guardrails, fixtures, and helpers

## Non-Negotiables

- Treat exports from `src/index.ts` and `src/utils.ts`, plus method signatures on `NexusClient`, as
  public API. Do not change or remove them without explicit approval.
- Update `README.md` as part of any public API change. End-user docs must stay in sync with the
  shipped SDK surface.
- Keep the high-level dependency direction intact:
  - `src/client/` is the top assembly layer
  - `src/intent/` owns swap intent internals and middleware transport
  - `src/execute/` owns standalone execute entrypoints and internals
  - `src/services/` is only for cross-feature helpers
  - lower layers must not grow back-references into higher orchestration layers
- Keep feature modules beside their consumers. Use flat folders unless several related modules
  warrant a subdirectory; do not recreate single-file wrappers or pass-through barrels.
- `src/services/` must not import `src/execute/` or `src/client/`. Analytics must not import
  client, intent, or execute modules. `npm run lint:deps` enforces these boundaries.
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
- `src/client/create-client.ts`
- `src/client/base.ts`
- `src/client/types.ts`
- `src/analytics/`

Architecture and flow ownership:

- `docs/ARCHITECTURE.md`
- `src/intent/`
- `src/execute/`

Key domain and transport pieces:

- `src/domain/erc20-abi.ts`
- `src/domain/errors.ts`
- `src/domain/types.ts`
- `src/domain/validation.ts`
- `src/intent/middleware.ts`
- `src/intent/normalize.ts`

Common implementation hotspots:

- Intent: `src/intent/orchestrator.ts`, `src/intent/wallet.ts`, `src/intent/catalog.ts`,
  `src/intent/funding.ts`
- Execute: `src/execute/runtime.ts`, `src/execute/execute.ts`
- Public request construction: `src/client/base.ts`
- Execute helpers: `src/execute/allowance.ts`, `src/execute/wallet-capabilities.ts`
- Shared helpers: `src/services/chain-list.ts`, `src/services/evm.ts`

Tests to inspect first:

- `tests/public-api.test.ts`
- feature tests under `tests/intent/`, `tests/client/`, and `tests/execute/`
- type-surface guards under `tests/client/`

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
