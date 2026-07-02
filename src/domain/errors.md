# errors.ts — design rationale

Sibling reference for `errors.ts`. Explains *why* the error system looks the
way it does. For *how to use it* see `docs/CONVENTIONS.md` → "Errors". For the
boundary OTel emission, see `src/services/error-telemetry.ts`.

## What this module owns

- The `NexusError<C>` base class and its 7 concrete subclasses.
- The flat `ERROR_CODES` constant — every code the SDK can throw.
- The `Errors.*` factory namespace — named constructors for common cases,
  plus per-category wrap helpers (`backend`, `execution`, `simulation`,
  `externalService`).
- The category ↔ service mapping (`ServiceFor<C>`), enforced at the type
  level so a wrong `service` value won't compile.

## Errors are flat

A `NexusError` is a single, self-contained object: `category`, `code`,
`message`, `context`, `details`. There is **no cause chain** — we don't
capture native ES2022 `cause`, and there are no `walk` / `find` /
`formatChain` helpers. When you catch an underlying error (a viem revert,
an HTTP failure), you inline its text into the message via
`formatUnknownError(error)` and throw a flat `NexusError`.

Why flat:

- **Telemetry can't walk.** SigNoz / PostHog query flat string attributes.
  They can't filter on "is there a `UserRejectedRequestError` somewhere in
  the cause chain." A nested chain would only ever be read by a human
  eyeballing one record — never alerted on. So the chain earned its
  removal.
- **Nobody branched on the chain in code either.** Consumers check the
  subclass (`err instanceof UserActionError`) or `err.category`. No code
  path called `err.find(BackendError)` to decide what to do.
- **The underlying text isn't lost** — it's inlined into `message` (and
  often also in `details`). Viem already formats its structured fields
  (contract, function, args, revert reason) into `.message` via
  `metaMessages`, so `formatUnknownError(viemError)` keeps the useful part.

The cost we accepted: `console.log(err)` no longer shows a nested
`[cause]:` block, and you lose the viem stack frames. The viem *message*
survives in `err.message`; the stack into viem internals does not.

## Why categories (flat tags, not a tree)

The 7 subclasses are flat siblings under `NexusError`, not a walked
hierarchy. Each pins a `category` and a `name`, and narrows
`context.service`:

- `ValidationError` — caller input / preconditions (no service)
- `UserActionError` — explicit user rejection (`service: 'wallet' | 'hook'`)
- `SimulationError` — pre-execution simulate path (`service: 'rpc'`)
- `ExecutionError` — runtime failure (`service: 'wallet' | 'rpc'`)
- `BackendError` — Avail middleware HTTP/WS (`service: 'middleware'`)
- `ExternalServiceError` — third-party deps (`service: 'lifi' | 'bebop' | 'coinbase'`)
- `InternalError` — true SDK invariants only (no service)

Two stable axes are more useful than one: the **category** answers "whose
fault is it" and the **code** answers "what specifically happened."

The category drives:

- **Consumer branching.** `err instanceof UserActionError` (or
  `err.category === 'user_action'`) separates "user clicked cancel" from
  "the SDK broke."
- **OTel/SigNoz alerts.** `error.category` and `error.service` are stable
  axes you can group on. Codes are too fine-grained for top-level alerts.
- **Type-narrowed `context.service`.** `ServiceFor<C>` makes
  `BackendError` always have `service: 'middleware'`, `ExecutionError`
  always `'wallet' | 'rpc'`, etc. Mismatches are compile errors.

## Why the `category/specific_noun_suffix` code shape

- The `category/` prefix mirrors the subclass — a `BackendError` always
  carries a `backend/*` code. The drift test (`tests/core/`) keeps that
  invariant honest.
- The suffix vocabulary (`_failed`, `_timeout`, `_reverted`, `_denied`,
  `_exceeded`, or none for terminal non-failure states) gives a coarse
  hint about *what kind of failure* without reading the message.
- Stable string values mean dashboards survive code refactors. Keys
  (`ERROR_CODES.FOO_BAR`) can rename freely.

## The boundary-catch pattern

When a catch wraps a wallet/RPC/SDK call, follow this layering:

1. **Pre-classified `NexusError` passes through unchanged.** If upstream
   already typed the error, trust it. Re-wrapping would overwrite the
   top-level category — which is exactly what telemetry and consumers read.
2. **Known user rejection becomes `UserActionError`.** Use
   `isUserRejectedRequest(error)` (which walks *viem's* own chain) and
   throw the matching `Errors.userRejected*` factory.
3. **Everything else falls through to `ExecutionError`** (or the
   category-appropriate wrap helper), with the underlying text inlined.
   `ExecutionError` is the fallback for genuinely unknown errors — not a
   catch-all.

Concretely:

```ts
.catch((error) => {
  const stepError =
    error instanceof NexusError
      ? error                                          // (1) trust upstream
      : isUserRejectedRequest(error)
        ? Errors.userRejectedTxSend()                  // (2) known rejection
        : new ExecutionError(                          // (3) unknown — inline text
            ERROR_CODES.EXEC_TX_SEND_FAILED,
            `Failed to send transaction: ${formatUnknownError(error)}`,
            { context: { service: 'wallet', /* stepId, stepType, chainId */ } }
          );
  onProgress?.({ state: 'failed', error: formatUnknownError(stepError) });
  throw stepError;
});
```

The `NexusError` pass-through (1) only matters where the catch wraps a
function that itself classifies errors — e.g. `createRequestFromIntent`,
`signPermitForAddressAndValue`. For direct viem calls (`writeContract`,
`sendTransaction`, `signMessage`) the error is always raw viem; the check
is a no-op and should be omitted (don't write code for impossible cases).

Why this matters: a user clicking "reject" should surface as
`error.category === 'user_action'` at the **top level**. If we re-wrap it in
`ExecutionError`, the top-level category becomes `'execution'` and consumer
branching mislabels the rejection as an SDK failure. With no cause chain,
the top-level *is* the only classification — there's no inner error to fall
back to.

Helpers that add step context (like `toStepError` in `allowances.ts`) must
also pass `NexusError` through rather than wrapping unconditionally.

**The one discipline this requires:** the underlying error's text must
actually reach the top-level `message`. A hardcoded `'Failed to send
transaction'` with the viem text dropped loses the useful part. Always
inline `formatUnknownError(error)` (or keep it in `details`) so the
information survives.

## Handling a NexusError as an SDK consumer

```ts
import { NexusError, UserActionError } from '@avail-project/nexus-core';

try {
  await sdk.bridge({ /* ... */ });
} catch (err) {
  if (err instanceof UserActionError) {
    return; // user clicked "reject" — usually swallow, no error toast
  }
  if (err instanceof NexusError) {
    // err.code      — stable identifier for fine-grained branching
    // err.category  — broad bucket if you prefer category over subclass
    // err.message   — user-presentable (no "Backend: " prefix)
    // err.context   — { service, stepId, stepType, chainId }
    // err.details   — operation-specific metadata
    showToast(err.message);
    reportToSentry({ code: err.code, category: err.category, context: err.context });
  } else {
    showToast('Something went wrong.'); // not from our SDK
  }
}
```

Map `err.code` to custom UX yourself — the SDK deliberately doesn't ship a
`userMessage` field, an `isRetryable` flag, or a `formatError()` helper.
Those decisions depend on your UI, and a second message field just drifts
out of sync with `err.message`.

## Adding a new code

Before adding a code, check if an existing one fits. Drift is the enemy —
two codes meaning the same thing makes alerts and dashboards unreliable.

When you do add one:

1. Add the `ERROR_CODES.FOO_BAR` entry in the right section. The
   `category/` prefix must match the subclass it will be thrown on.
2. Pick the suffix from the vocabulary (`_failed`, `_timeout`,
   `_reverted`, `_denied`, `_exceeded`, none).
3. If it's a recurring case, add a named factory (`Errors.foo()`). One
   call site → throw the subclass directly with a literal code; multiple
   call sites → factory.

## Adding a new factory

Named factories serve two purposes: they shorten common throw sites and
they pin the right `category` + `service` so call sites can't accidentally
mismatch.

- For known-shape errors that take no runtime data:
  `Errors.foo(): UserActionError` (see `userRejectedAllowance`,
  `userRejectedIntentSignature`, `userRejectedTxSend`).
- For wrapping an unknown failure into a category: the per-category wrap
  helpers `Errors.backend(msg, opts)`, `Errors.execution(msg, opts)`,
  `Errors.simulation(msg, opts)`, `Errors.externalService(msg, opts)`.
  Inline the underlying text into `msg` via `formatUnknownError(cause)` at
  the call site — the helpers don't take a `cause` argument.

There is no `userActionWithCause` / `internalWithCause`: user rejections
go through the named `userRejected*` factories, and internal errors are
invariants constructed with a clear message (`Errors.internal(msg)`), not
wrapped external causes.

## OTel surfacing

`error-telemetry.ts:extractErrorAttrs` reads the **top-level**
`error.category`, `error.code`, `error.context.service`,
`error.context.stepId|stepType|chainId`, `error.message`, and
`error.details` (sanitized). There is no `error.chain` and no
`error.rootCause.*` — the error is flat, so the top-level *is* the whole
story.

Implication: re-wrapping a `UserActionError` in `ExecutionError` emits
`error.category: 'execution'` and there's no inner error to recover the
real category from. The boundary pattern above is what keeps the top-level
honest.

`error.details` still runs through the recursive sanitizer before emission
(bigint→string, long-hex truncation, `[redacted]` for
`signature`/`privateKey`/`mnemonic`).

## Throwing rules (quick reference)

- Prefer a named factory (`Errors.sdkNotInitialized()`,
  `Errors.transactionReverted(hash)`, `Errors.userRejectedTxSend()`, …) when
  one covers the case.
- For unexpected external failures use the per-category wrap helpers
  (`Errors.backend`, `Errors.execution`, `Errors.simulation`,
  `Errors.externalService`), inlining the underlying text into the message.
- Use `Errors.internal(msg)` only for genuine SDK invariants, never as a
  generic wrap.
- For step-bound failures throw the subclass directly with
  `context: { service, stepId, stepType, chainId }`. There is no separate
  `NexusStepError` — step metadata is just category-agnostic context fields.
- Follow the boundary-catch order above; `ExecutionError` is the fallback
  for genuinely unknown errors, not a catch-all.
- Don't downgrade an already-categorized error (see Pitfalls).
- Messages should say what was expected and what was found where practical.
- Don't silently coerce invalid inputs into a happy path.
- Don't emit to OTel from throw sites. Emission is centralized in
  `error-telemetry.ts:reportOperationError`, which runs from every
  public-method catch and the utility helpers (`getCoinbaseRates`,
  `getSupportedChains`). Let the boundary catch it.

## Pitfalls

- **Don't use `InternalError` as a generic wrap.** It means "SDK invariant
  violated" (an unmapped branch, an impossible state). A failed wallet
  signature is *not* internal — it's `execution` or `user_action`.
- **Don't downgrade categorized errors.** If a `BackendError` flows into a
  catch that re-wraps everything as `ExecutionError`, alerts filtering on
  `error.service === 'middleware'` go silent. Use the pass-through pattern.
- **Don't hide the underlying text behind a hardcoded message.** Inline
  `formatUnknownError(error)` into the message (or keep it in `details`).
  Otherwise the viem/HTTP detail is gone — there's no `cause` to recover it
  from.
- **Don't add new codes speculatively.** Codes are part of the public
  surface. Adding one only to throw it once, in a path an existing code
  already covers, is drift.

## Related files

- `src/services/is-user-rejected-request.ts` — viem-aware rejection
  detector. Walks *viem's* own `BaseError` chain (not ours).
- `src/services/error-telemetry.ts` — the flat OTel boundary emitter.
- `docs/CONVENTIONS.md` → "Errors" — throwing rules and style.
