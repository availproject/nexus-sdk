# Stress Test Engine Notes

## Purpose
This module implements a framework-agnostic stress-test engine that can be reused by the browser example or a Node.js script. It focuses on **scheduling** and **reporting** while leaving execution details to a provided callback.

## Entry Points
- `runStressTest(options)` in `engine.ts`: schedules operations based on the selected load model.
- `buildReport(operations, startedAt, endedAt, config, chainLookup)`: computes report statistics.
- `types.ts`: shared types for runs, configs, and operations.

## Load Models
- **Batch**: runs `batchSize` operations in parallel, waits for completion, then waits `delayMs` before the next batch.
- **Fixed Rate**: launches operations at a steady `ratePerSecond` (open loop), with optional `maxInFlight`.
- **Ramp**: increases rate in steps (`startRate` → `maxRate`) every `stepDurationSec` by `stepRate`, optional `maxInFlight`.
- **Soak**: runs at a fixed `ratePerSecond` for `durationMinutes`, optional `maxInFlight`.

All models enforce a **hard cap** via `totalRequests`.

## Integration Pattern
Provide:
1. A list of `Operation` objects (queued state).
2. An `execute` callback that performs the actual work and updates operation state in the caller.
3. Optional hooks (`onOperationStart`, `onOperationFinish`, `onOperationError`) for logging/metrics.

## Notes
- The engine intentionally avoids React or SDK specifics.
- `maxInFlight` is enforced by a lightweight in-flight tracker.
- In the browser demo, each operation currently creates its own `NexusClient` intentionally.
  This isolates mutable provider state (`wallet_switchEthereumChain` + signing flow) per operation
  and avoids cross-operation chain/signing races, at the cost of higher resource usage.
- Validation is minimal; callers should validate UI inputs before calling `runStressTest`.
