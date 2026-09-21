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
- `src/transport/` owns Better Intent HTTP requests.
- `src/domain/` owns shared primitives, validation, logging, and errors.
- `src/services/` contains cross-feature helpers only.
- `src/swap/` contains public swap input types; it must not grow a local routing engine.

Lower layers must not import `src/core/`. `src/services/` must not import `src/flows/`.

Do not recreate local routing feature packages for middleware-owned behavior. New provider routing,
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

- Same-asset cross-chain moves use swaps with explicit chain IDs and token addresses.
- Exact-output swap may omit sources; middleware discovers wallet balances without SDK token
  enumeration. Explicit chain-only filters stay broad; resolve only selected token addresses.
  Never omit source filters after removing every explicit candidate.
- Exact-input swap requires explicit chain, token address, and positive `amountRaw` on every source.
- Exact-input sources and destination must share one provider across chain and token directional
  support. Exact-output candidates need individual compatibility with the destination. These checks
  use chain metadata plus token metadata fetched on demand; middleware still decides route feasibility.
- Token picker helpers fetch one filtered page (default 50, maximum 1000). Their pagination describes
  API candidates before directional filtering: advance by offset + limit, including empty pages.
  Keep selected tokens separate from search results. Optional selected sources narrow source groups.
  Destination choices and
  `confirmRouteExists` require a provider common to all selected sources. Provider groups are for
  display and must not pin a quote provider.
- Default slippage is 50 basis points unless the caller supplies another valid value or `auto`.

Do not calculate a route, quote, maximum output, or provider comparison in the SDK.

## Hooks

All intent methods use `options.hooks`:

- swap operations: `onIntent`
- swap-and-execute: `onIntent` plus top-level `beforeExecute`

`onIntent` receives `{ quote, allow, deny, refresh, attemptId }`. A refreshed quote replaces the complete
executable quote. Do not update only its public or private half.

ERC-20 approvals use the quote's minimum required amounts. Sponsored source approvals use the
quote's EIP-712 signing payload, preserving decimal integer strings without conversion to `number`.
No intent hook means auto-allow.

## Events and callbacks

The canonical `IntentEvent` union is:

- `quote`
- `step` with `started | completed | failed`
- `status` with `created | deposited | fulfilled | expired` and normalized per-source `legs`

Events expose normalized public plan steps and per-source leg status, transaction links, and errors.
They do not expose RFF payloads, signing messages, ABIs, or raw middleware responses.

User event callbacks and analytics callbacks must run through the non-blocking callback pattern.
They must not break execution. Approval hooks are intentionally flow controlling and may reject.

## Wallet ordering

Treat the EOA wallet as a single stateful resource. Serialize actions that may switch chains,
prompt, sign, approve, or send a transaction.

For an approved intent, preserve this order:

1. required ERC-20 approval broadcasts or sponsored source-approval signatures, with wallet prompts
   serialized and receipt checks running concurrently outside the wallet queue;
2. wait for all required approvals to confirm, recheck quote expiry, then intent `personal_sign`;
3. native source transactions;
4. submit all required signatures through the `signatures[]` envelope;
5. fulfillment polling.

Do not parallelize wallet prompts. Read-only API work can run concurrently when it does not race
approved quote state.

Handle receipt failures as soon as waiting starts so they cannot become unhandled rejections while
a later wallet prompt is open. Settle all submitted approval checks before returning an approval
failure, preserving each hash and its confirmed/reverted/unconfirmed state in error details.
Retry receipt lookup by known hash; never treat an RPC timeout as proof that resending is safe.

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

Use the internal reason mapping in `src/services/error-reporting.ts` for product reporting. Preserve
public codes/categories/messages. Events carry bounded reasons; messages, stacks, and raw middleware
diagnostics stay in sanitized OTel logs. Client/session/attempt IDs are per-record attributes, never
metric labels or global logger resources. Keep one canonical outcome per payment attempt, and do
not turn a polling error into a confirmed delivery failure. See [TELEMETRY.md](TELEMETRY.md).

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
