# Swap-domain characterization tests

These tests cover swap behavior that spans multiple internal stages. Public composite flow
characterization lives under `tests/flows/characterization`.

## Current files

| File | Purpose |
| --- | --- |
| `safe-wire-format.test.ts` | Locks Safe `execTransaction`, MultiSend, and EIP-712 signing assumptions |
| `execution-failures.test.ts` | Covers retry classification, requote exhaustion, destination reads, and cleanup fallback |
| `lifecycle.test.ts` | Covers `swap()` hooks, refresh, events, timing, and intent explorer results |
| `max-pipeline.test.ts` | Keeps max calculation aligned with exact-in routing, quotes, haircuts, and source attribution |
| `swap.test.ts` | Drives the complete `swap()` flow and decodes every source, bridge, and destination call |

## Safe V2 decision graph

`swap.test.ts` is the behavioral north star for swap execution. It keeps the public `swap()` flow
real and mocks only external edges: middleware, RPC, aggregator HTTP, and network broadcast.

The harness uses deterministic real viem accounts. Aggregator fixtures encode taker, receiver, and
amount into calldata, then the test decodes those values from:

- sponsored `createSafeExecuteTx` requests, including MultiSend payloads;
- EOA-signed raw transactions carrying `Safe.execTransaction` for native value.

This proves routing decisions survive preparation and reach the actual Safe call. The suite also
asserts:

- source funding, aggregator allowances, and receiver addresses;
- Nexus and Mayan bridge source/destination amounts and recipients;
- bridge deposit ordering relative to intent submission;
- destination token and gas swap sizing;
- complete dispatched-chain sets with no stray execution;
- exact-output amount continuity and bounded requotes;
- positive and negative source-output drift behavior;
- failure cleanup from Safe and ephemeral bridge custody.

All swap batches execute through the deterministic Safe. Remote swap output may still land at the
ephemeral bridge holder, but the Safe performs the swap and deposit calls. Native-value batches are
submitted by the EOA to fund the Safe; token-only batches are sponsor-broadcast.

## What stays real

- `buildSwapPreflight`
- `determineSwapRoute`
- `createSwapPlan`
- `prepareSwapExecution`
- swap execution handlers
- aggregator wrappers

## What gets mocked

- middleware APIs
- wallet network broadcast
- public-client RPC methods
- aggregator HTTP responses

Prefer assertions that prove continuity across stages. Small helper behavior belongs in focused unit
tests when it does not need the full route and execution pipeline.
