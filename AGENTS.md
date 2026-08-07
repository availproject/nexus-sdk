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

- `src/abi/` — contract ABIs used by retained execute and approval flows
- `src/analytics/` — telemetry, timing spans, analytics providers, event definitions
- `src/core/` — public SDK assembly, client factory, and client types
- `src/flows/` — thin execute entrypoint and shared execute dependencies
- `src/intent/` — Better Intent catalog, normalization, funding, wallet, and orchestrator
- `src/execute/` — standalone execute runtime
- `src/swap/` — public swap input types only
- `src/services/` — cross-feature helpers only
- `src/transport/` — deployment and Better Intent middleware client
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
  - `src/intent/` owns bridge/swap intent internals
  - `src/execute/` owns standalone execute internals
  - `src/services/` is only for cross-feature helpers
  - lower layers must not grow back-references into higher orchestration layers
- Keep package boundaries intact. `src/core/` is the assembly layer. `src/flows/` stays thin.
  API-backed bridge/swap behavior belongs in `src/intent/`, shared execute code in `src/execute/`,
  and only cross-feature helpers belong in `src/services/`.
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
- `src/intent/`
- `src/execute/`
- `src/swap/`

Key domain and transport pieces:

- `src/abi/`
- `src/domain/errors.ts`
- `src/domain/types/`
- `src/domain/utils/validation.ts`
- `src/transport/middleware.ts`
- `src/intent/normalize.ts`

Common implementation hotspots:

- Intent: `src/intent/orchestrator.ts`, `src/intent/wallet.ts`, `src/intent/catalog.ts`,
  `src/intent/funding.ts`
- Execute: `src/execute/runtime.ts`, `src/flows/execute.ts`
- Public request construction: `src/core/sdk/base.ts`
- Shared helpers: `src/services/chain-list.ts`, `src/services/allowance-utils.ts`,
  `src/services/wallet-capabilities.ts`

Tests to inspect first:

- `tests/public-api.test.ts`
- feature tests under `tests/intent/`, `tests/core/`, `tests/flows/`, and `tests/transport/`
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
