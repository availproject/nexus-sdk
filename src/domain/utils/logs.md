# Logging

This is the source of truth for SDK logging. It documents message naming, structured payloads,
production safety, and the relationship between debug logs, timing spans, and telemetry.

## Levels

- `debug` records diagnostic state and decisions. It is emitted only when debug logging is enabled
  and does not emit warning/error telemetry.
- `info` is for stable, user-relevant lifecycle information that is useful without debug mode.
- `warn` and `error` feed telemetry as well as the configured logger. Treat their message names as
  operational identifiers; do not rename or downgrade them casually.

User callbacks and observability hooks must never break a product flow. Logging must not introduce
an external call, await, retry, state mutation, or new failure path.

## Debug message contract

Use a lowercase, dot-separated literal at the production call site:

```text
<domain>.<stage>[.<mode>].<operation>.<event>
```

Swap messages therefore begin with `swap`, for example:

```ts
logger.debug('swap.route.exact_out.sources.selected', {
  sourceCount,
  sourceChainIds,
  selectionTarget: selectionTarget.toFixed(),
});

logger.debug('swap.route.provider.decision', {
  requestedProvider,
  serverProvider,
  selectedProvider,
  reason: 'source_not_mayan_enabled',
});
```

Rules:

- Use snake case inside a multiword segment.
- Prefer stable stages such as `flow`, `preflight`, `route`, `prepare`, `cache`, `execute.source`,
  `execute.bridge`, `execute.destination`, and `cleanup`.
- Prefer the event vocabulary `started`, `resolved`, `decision`, `selected`, `skipped`, `fallback`,
  `retry`, `submitted`, `confirmed`, `completed`, and `failed`.
- Keep the full message unique to one production call site. `rg -F '<message>'` must lead directly
  to the statement that emitted it.
- Keep the message as a literal in `logger.debug(...)`. Do not construct names dynamically or hide
  them behind event constants or logging wrappers.
- Put variable state in the payload, not the message.
- A genuinely shared emitting helper may own one message; its payload must identify the mode, path,
  or caller context needed to understand the invocation.

## Structured payloads

Use a small object built from state already in memory.

- Include `mode`, `routePath`, `provider`, `chainId`, `sourceChainIds`, `walletPath`, `attempt`, and
  stable `reason` values when relevant.
- Decision logs include both the selected outcome and a stable, machine-searchable reason.
- Use unit-bearing names such as `amountRaw`, `amountUsd`, and `durationMs`. Plain `amount` is for a
  human-readable string or `Decimal` value.
- Convert every `Decimal` with `.toFixed()`. Never use `.toString()`, `String(decimal)`, template
  interpolation, or implicit coercion.
- Convert `bigint` to a decimal string before logging when the logger or transport requires it.
- Prefer chain/token identifiers, counts, role names, and compact summaries over complete runtime
  objects.
- Describe wallet identities by role (`eoa`, `ephemeral`, `safe`) and ownership/equality facts when
  possible instead of logging user addresses.
- For caught failures, include a categorized error code when available and a concise message. Keep
  fallback reasons intact.
- Never log calldata, signatures, permits, authorization blobs, private keys, complete transaction
  requests, or unbounded external responses.

Even when debug output is disabled, JavaScript evaluates payload expressions before calling the
no-op logger. Payload construction must therefore be cheap, bounded, synchronous, and non-mutating.

## Timing

Use timing spans for latency measurement. Debug logs explain what the SDK decided and why. Do not
add generic reusable messages such as `timing`; they are hard to search and ambiguous at the call
site. When a non-span diagnostic still needs elapsed time, use a unique message and `durationMs`.

Separate SDK-controlled preparation from wallet prompts, transaction receipt waits, and bridge fill
waits. Never serialize parallel work merely to measure it.

## Review checklist

- The message is a literal and searching it identifies one call site.
- The stage, operation, and event describe the decision or lifecycle transition.
- Payload fields have explicit units and stable names.
- `Decimal` values use `.toFixed()`.
- The payload contains no secret, authorization material, calldata, or complete request object.
- The log performs no extra I/O and cannot change flow behavior.
- Warning/error telemetry identifiers remain stable unless the operational change is intentional.
