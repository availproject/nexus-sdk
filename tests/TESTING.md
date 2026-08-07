# Testing Strategy

Use the smallest layer that directly observes the behavior.

## Layers

### Pure unit tests

Use no mocks for catalog lookup, response normalization, funding arithmetic, validation, and event
or result mapping. Assert exact raw units and normalized output.

### Boundary contract tests

Mock only external boundaries for middleware URLs/bodies, wallet requests, RPC reads/writes, and
receipt/status polling. Assert the wire contract and the categorized error visible to callers.

### Orchestrator tests

Drive the real canonical orchestrator with injected boundary dependencies. Assert observable order,
events, refreshed-quote replacement, submission payloads, fulfillment, expiry, timeout, and user
denial. Do not mock an SDK helper merely to assert another SDK helper called it.

### Public assembly tests

Exercise `createNexusClient` with a middleware fixture for lifecycle, network gating, public request
construction, composite funding, history, and supported-chain capabilities.

## Mock boundaries

Allowed boundaries:

- middleware responses and submissions;
- wallet prompts and transaction sends;
- deterministic RPC reads and gas estimates;
- receipt and intent-status polling;
- time/sleep injection.

Do not mock:

- `normalizeIntent*` inside normalizer tests;
- catalog lookups inside catalog tests;
- allowance/sign/send/submit sequencing inside orchestrator tests;
- funding arithmetic inside composite assembly tests.

## Helper ownership

- `tests/helpers/chains.ts` — deployment chain and chain-list fixtures
- `tests/helpers/tokens.ts` — reusable token metadata
- `tests/helpers/middleware-client.ts` — normalized middleware client fixtures
- `tests/helpers/swap.ts` — public swap input fixtures that still apply

Add a shared helper only when multiple retained suites use it. Do not add compatibility helpers for
deleted local-routing types.

## Core coverage map

- `tests/intent/normalize.test.ts`
- `tests/intent/catalog.test.ts`
- `tests/intent/funding.test.ts`
- `tests/intent/orchestrator.test.ts`
- `tests/intent/wallet.test.ts`
- `tests/transport/better-intent.test.ts`
- `tests/core/sdk-better-intent.test.ts`
- `tests/public-api.test.ts`

New middleware fields require normalizer and transport tests. New wallet or orchestration behavior
requires failure-path coverage as well as success coverage.

## Scenario names

Name scenarios after observable behavior and its condition, for example:

```text
replaces the complete executable quote after refresh
rejects when the middleware reports an expired intent
requests one raw output unit when only destination gas is missing
```

## Verification

During iteration:

```bash
npm test -- tests/path/to/focused.test.ts
npm run typecheck:tests
```

Before delivery:

```bash
npm run typecheck
npm run typecheck:tests
npm run test
npm run lint
npm run lint:deps
npm run build
npm --prefix example/browser run build
```
