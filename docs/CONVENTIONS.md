# Conventions

Read this with [Architecture](ARCHITECTURE.md). Source and tests take precedence when documentation
and behavior disagree.

## Sources of truth

- `biome.jsonc` — formatting and linting
- `tsconfig.json` and `tsconfig.tests.json` — compiler rules
- `package.json` — validation/build commands
- `src/index.ts`, `src/utils.ts`, and `src/core/types.ts` — public surface
- `tests/public-api.test.ts` — public export guardrails
- [`src/domain/errors.md`](../src/domain/errors.md) — error taxonomy
- [`src/domain/utils/logs.md`](../src/domain/utils/logs.md) — logging rules

## Style

- 2-space indentation
- 100-character line width
- single quotes and semicolons
- ES5 trailing commas
- strict TypeScript, target `es2024`
- `node:` prefixes for Node built-ins
- prefer `const`, arrow functions, `===`, and `Number.isNaN()`
- use lowercase hyphenated filenames for new function-oriented modules

Vitest is the test runner. Mirror `src/` under `tests/` where practical.

## Package ownership

- `src/core/` assembles the public client and owns top-level SDK state.
- `src/intent/` owns Better Intent types, normalization, catalog lookup, funding, wallet actions,
  and the canonical orchestrator.
- `src/execute/` owns reusable EVM execute internals.
- `src/flows/` stays thin and currently contains only the execute entrypoint/dependencies.
- `src/transport/` owns deployment and Better Intent HTTP requests.
- `src/domain/` owns shared primitives, validation, logging, deployment types, and errors.
- `src/services/` contains cross-feature helpers only.
- `src/swap/` contains public swap input types; it must not grow a local routing engine.

Lower layers must not import `src/core/`. `src/services/` must not import `src/flows/`.

Do not recreate bridge/swap feature packages for middleware-owned behavior. New provider routing,
quote selection, fee calculation, and source allocation belong in Better Intent middleware, not the
SDK.

## Public API changes

Treat exports from `src/index.ts` and `src/utils.ts`, `NexusClient` method signatures, and stable
error codes as public API.

When intentionally changing them:

- update public API and type-surface tests;
- update `README.md` in the same change;
- update the browser example if an integration shape changes;
- call out breaking behavior in review.

Do not keep dead internal paths or public aliases that preserve obsolete semantics. Cheap aliases
are acceptable only when they describe the same normalized model.

## External boundary normalization

- Parse external responses at the transport boundary.
- Business logic consumes normalized types, never raw middleware payloads.
- Normalize EVM chain references and addresses once.
- Parse raw decimal strings into `bigint` once.
- Keep private execution instructions separate from public `IntentQuote`.
- Schema failures are backend errors, not unchecked `TypeError` failures.

Add a normalizer test before adding a new middleware field to business logic.

## Amounts and token identity

- Public inputs and blockchain calls use raw `bigint` values.
- Use a `*Raw` suffix for raw units.
- Human-readable amounts are strings and conversions must be explicit.
- Never infer decimals from symbol; resolve by chain plus token address/identity.
- Never mix raw and readable units in one calculation.
- Do not stringify `Decimal` with `.toString()` when plain decimal notation is required; use
  `.toFixed()`.

Native balances must retain enough value for subsequent gas. Composite funding must account for
both the requested output and the later execute value/gas.

## Intent request construction

- Bridge is same-asset exact-output and resolves sources through the token catalog.
- Exact-output swap may omit sources for server selection.
- Exact-input swap requires explicit chain, token address, and positive `amountRaw` on every source.
- Default slippage is 50 basis points unless the caller supplies another valid value or `auto`.
- `forceMayan` is a preferred-provider request; never calculate provider thresholds locally.

Do not calculate a route, quote, maximum output, or provider comparison in the SDK.

## Hooks

All intent methods use `options.hooks`:

- bridge operations: `onIntent` and `onAllowance`
- swap operations: `onIntent`
- composite operations: the matching hooks plus top-level `beforeExecute`

`onIntent` receives `{ quote, allow, deny, refresh }`. A refreshed quote replaces the complete
executable quote. Do not update only its public or private half.

`onAllowance` receives normalized deficits and accepts `min`, `max`, a raw `bigint`, or a raw integer
string per required allowance. Validate the selection count and minimum.

No hook means auto-allow with minimum approvals.

## Events and callbacks

The canonical `IntentEvent` union is:

- `quote`
- `step` with `started | completed | failed`
- `status` with `created | deposited | fulfilled | expired`

Events expose normalized public plan steps. They do not expose RFF payloads, signing messages, ABIs,
or raw middleware responses.

User event callbacks and analytics callbacks must run through the non-blocking callback pattern.
They must not break execution. Approval hooks are intentionally flow controlling and may reject.

## Wallet ordering

Treat the EOA wallet as a single stateful resource. Serialize actions that may switch chains,
prompt, sign, approve, or send a transaction.

For an approved intent, preserve this order:

1. required ERC-20 approvals;
2. intent `personal_sign`;
3. native source transactions;
4. submit;
5. fulfillment polling.

Do not parallelize wallet prompts. Read-only API work can run concurrently when it does not race
approved quote state.

## Composite operations

Composite methods may calculate only destination funding requirements:

- fresh output-token balance;
- fresh native balance;
- execute value;
- simulated execute gas cost;
- resulting token and gas shortfalls.

They must not reconstruct an intent route. Execute only after the funding intent is fulfilled.

If only gas is missing for a non-native output token, request one raw output unit plus the gas drop.

## Errors

Use `Errors.*` and the `NexusError` subclasses. Preserve stable category/code/context semantics.

- input/state errors → `ValidationError`
- user denial → `UserActionError`
- wallet/RPC execution → `ExecutionError`
- middleware/schema/status failures → `BackendError`
- SDK invariants → `InternalError`

Include `context.stepId`, `stepType`, and `chainId` when an error is step scoped. There is no
`NexusStepError`.

## Logging and telemetry

Logs must be searchable, stable, and sanitized. They must not add I/O, mutate flow state, or create
a failure path. See [`src/domain/utils/logs.md`](../src/domain/utils/logs.md).

Public method failures are emitted at the operation boundary. Categorize once near the failing
boundary; do not repeatedly wrap a `NexusError`.

## Refactoring

- Keep one canonical implementation per behavior.
- Delete replaced code and tests instead of retaining fallback paths.
- Add the closest behavioral test before changing behavior.
- Compare public exports, inputs, results, hooks, errors, and events when restructuring.
- Update architecture docs when ownership or request flow changes.

## Verification

Use focused checks while iterating, then finish with:

```bash
npm run typecheck
npm run typecheck:tests
npm run test
npm run lint
npm run lint:deps
npm run build
```

Also build `example/browser` when public balance, catalog, hook, event, or result types change.
