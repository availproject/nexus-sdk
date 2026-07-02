# Conventions

This document is the coding reference for humans and LLMs working in the SDK. Read it together
with `docs/ARCHITECTURE.md`.

> **Module docs.** Deep, module-specific guidance lives in `*.md` files next to the code it
> documents. This document is the thin index. When a section below links out to a sibling doc, that
> doc is the source of truth — read it before changing that module.

| Module | Sibling doc | Covers |
|---|---|---|
| `src/swap/` | [`src/swap/swap.md`](../src/swap/swap.md) | Swap end-to-end flow: routing & bridge-provider (Nexus/Mayan) selection, source/destination algorithms, aggregators, intent/plan/prepare, and per-stage execution across the ephemeral & Safe wallet paths |
| `src/bridge/` | [`src/bridge/bridge.md`](../src/bridge/bridge.md) | Bridge end-to-end flow: quoting, the Nexus/Mayan provider seam, intent build, RFF signing, deposits, and fill |
| `src/domain/errors` | [`src/domain/errors.md`](../src/domain/errors.md) | Error taxonomy: the `NexusError` hierarchy, category/service codes, the boundary-catch pattern, throwing rules, and OTel surfacing |

As more modules grow sibling markdown, add a row here and point the relevant section below to it.

## Source Of Truth

- `biome.jsonc` for formatting and linting
- `tsconfig.json` for source TypeScript compiler settings
- `tsconfig.tests.json` for test compiler settings
- `package.json` for validation and build commands

## Tooling And Style

Formatting and language defaults:

- 2-space indentation
- 100-character line width
- single quotes
- semicolons always
- trailing commas use ES5 style
- arrow function parens always
- TypeScript target is `es2024`
- strict mode is enabled
- use `node:` import prefixes for Node built-ins
- prefer `const`; do not use `var`
- enum members must have explicit values
- prefer `**` over `Math.pow()`
- prefer `===` over `==`
- use `Number.isNaN()` instead of `isNaN()`

Tests:

- Vitest is the test runner
- tests live under `tests/`
- test TypeScript config relaxes unused locals and params
- Biome allows `any` in tests for mocking, but keep it contained

## Code Organization

Use the current package boundaries:

- `src/abi/` contains contract ABIs shared by runtime code
- `src/analytics/` owns telemetry, timing, analytics providers, and analytics event definitions
- `src/core/` assembles the public client and shared SDK state
- `src/flows/` contains thin public entrypoints and composition wrappers
- `src/bridge/` owns bridge-specific internals
- `src/execute/` owns shared execute internals
- `src/swap/` owns swap-specific planning, execution, and wallet logic
- `src/services/` is only for cross-feature helpers
- `src/transport/` owns middleware and simulation clients plus request lifecycle
- `src/domain/` owns shared types, errors, constants, and validation

Rules:

- `src/services/` must not import `src/flows/`
- do not move feature-specific code into `src/services/` just because it is reused by two files in
  the same feature
- prefer updating the existing feature package before creating a new top-level folder

## Public API Rules

Treat these as frozen unless the change is explicitly approved:

- exports from `src/index.ts`
- exports from `src/utils.ts`
- `NexusClient` method signatures
- stable error codes in `ERROR_CODES`

If you intentionally change public surface area:

- update or add surface tests
- update `README.md` for any end-user-visible SDK change
- update docs, examples, and migration notes as needed
- call out the breaking change clearly in review

## Domain-Specific SDK Rules

These rules are worth reading even if you already know the repo layout. They capture SDK invariants
and bug-prone areas that are easy to miss in review.

### Amounts And Units

- Public inputs and blockchain calls use raw `bigint` units.
- Internal arithmetic that needs fractional precision should use `Decimal`.
- Result, plan, and hook shapes may include both raw and human-readable values, but conversions must
  be explicit.
- Use `*Raw` suffix for raw integer units, for example `toAmountRaw`, `approvedAmountRaw`.
- Use plain `amount` for human-readable strings or `Decimal` values.
- Never do percentage or fee math directly on raw `bigint` values unless the logic is intentionally
  integer-safe.
- Never pass `Decimal` values into public params or blockchain calls.
- Never mix raw and human units in the same calculation without an explicit conversion.

### Token Decimals And Chain Metadata

- Never hardcode token decimals by symbol.
- Resolve token metadata from chain plus token identity, not from token symbol alone.
- The same symbol can have different decimals on different chains.
- For cross-chain work, source-side amounts use source token decimals and destination-side amounts
  use destination token decimals.

### Native Token Gas Reservation

- When selecting balances that include native tokens, reserve gas for later steps.
- Do not drain native balances needed for approvals, deposits, swaps, bridge funding, or execution.
- Changes touching source selection or max-amount logic should be checked against native-token edge
  cases.

### Boundary Normalization

- Validate external responses as early as possible.
- Normalize middleware and contract response shapes before passing them into business logic.
- Normalize address formats at the boundary. Middleware may return padded or otherwise non-canonical
  values; internal code should use canonical `Hex` shapes.
- Business logic should consume normalized internal types, not raw API payloads.

### Shared Logic And Duplication

- If the same logic is needed in multiple runtime paths, centralize it in the owning feature package
  or in `src/services/` if it is truly cross-feature.
- Do not duplicate wallet capability parsing, fee calculations, source selection rules, or event
  mapping with slight variations.
- Before creating a new helper in `src/services/`, verify that the logic is actually shared across
  features and not just duplicated within one feature.

### Errors

The SDK uses flat, categorized errors: an abstract `NexusError<C>` base with 7 concrete
subclasses (`ValidationError`, `UserActionError`, `SimulationError`, `ExecutionError`,
`BackendError`, `ExternalServiceError`, `InternalError`), a stable `category/specific_noun_suffix`
code, and no cause chain.

The full reference — category/service taxonomy, the boundary-catch pattern, throwing rules,
factory guidance, OTel surfacing, consumer handling, and pitfalls — lives in
[`src/domain/errors.md`](../src/domain/errors.md). Read it before adding or changing error
handling.

### Hooks And Events

Hook placement:

- `bridge` and `bridgeAndTransfer` use `options.hooks.onIntent` and `options.hooks.onAllowance`
- swap operations use `options.hooks.onIntent` only
- `bridgeAndExecute` and `swapAndExecute` use top-level `onIntent`
- composite execute flows use `beforeExecute` when needed

Defaults:

- no `onIntent` hook means auto-allow intent
- no allowance hook means default to minimum necessary approvals

Event emission:

- wrap user callback emission so callback failures do not crash the flow
- follow existing progress-emitter patterns in bridge, execute, and swap code
- emitted events are discriminated on `type`; progress events also use `stepType` and `state`
- if a new flow emits progress, keep its event union aligned with the existing bridge, swap, and
  execute patterns

### Wallet Capability And Source Selection Rules

- Reuse the shared wallet capability helpers instead of re-implementing `getCapabilities(...)`
  parsing in feature code.
- Treat the user's EOA wallet as a single-chain, stateful resource: serialize across chains any
  operation that can `switchChain`, prompt the wallet, sign typed data, send an EOA transaction, or
  write an approval. Non-EOA work (quote fetching, read-only public-client calls, ephemeral SBC
  construction and submission, receipt waits) may run in parallel. Tests touching multi-chain EOA
  behavior must assert concurrent EOA wallet operations never exceed one.

Swap source selection, wallet-path resolution, and execution ordering — including the value-prefix
survey and the native ephemeral source-swap bootstrap — are documented in
[`src/swap/swap.md`](../src/swap/swap.md), which is the source of truth for the swap flow. Read it
before changing that flow.

### Refactoring

- Prefer one canonical implementation per behavior.
- Delete dead internal paths after a refactor instead of leaving compatibility shims around.
- Preserve public behavior unless the change is explicitly approved.
- When extracting shared logic, place it in `src/services/` only if it is genuinely cross-feature;
  otherwise keep it in the owning feature package.
- If a refactor changes flow ownership or package boundaries, update `docs/ARCHITECTURE.md`.
- If tests still pass without exercising the new implementation, fix the tests instead of keeping
  the old path around.

## Naming And File Placement

- prefer `to*` names for destination-side operation params, for example `toChainId`,
  `toTokenSymbol`, `toAmountRaw`
- prefer `sources` for source selection arrays
- prefer `*Params` for public inputs
- prefer `*Options` for optional operation config
- prefer `*Result` for return shapes
- prefer `*Event` for emitted event unions
- prefer `*Plan` and `*Step` for execution planning types
- `get*` should imply a value is returned or an error is thrown
- `find*` should imply missing values are allowed

For filenames:

- prefer lowercase hyphenated filenames for new function-oriented modules
- keep existing local patterns when working in areas that already use class-oriented PascalCase
  files, such as analytics and provider code
- mirror `src/` structure in `tests/` where practical

## Validation Commands

Use the smallest relevant set while iterating, then run the full checks before finishing:

- `npm run typecheck`
- `npm run test`
- `npm run lint`
- `npm run lint:deps` when dependency direction could be affected
- `npm run test:coverage` when validating riskier or broader behavior changes
