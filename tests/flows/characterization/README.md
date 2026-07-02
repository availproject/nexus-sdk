# Flow Characterization Tests

This directory contains characterization tests for public flow entrypoints.

These tests should start from a real public API and keep the internal pipeline real for that API.
Only true external boundaries should be mocked.

## Core rule

A flow characterization test should:

1. start from a public entrypoint
2. keep the internal orchestration and stage transitions real
3. mock only external I/O
4. assert continuity across stages, not isolated snapshots

If a test mocks a major internal leg of the public API under test, it is no longer a full flow
characterization test.

## What belongs here

Public entrypoint coverage such as:

- `bridge()`
- `swap()`
- `bridgeAndExecute()`
- `swapAndExecute()`

## What stays real

Depending on the entrypoint, this usually means keeping these real:

- preflight / preview-state builders
- route / intent construction
- plan creation
- prepare / execution shaping
- source / bridge / destination execution handlers
- flow-level event and progress translation

## What gets mocked

Only external edges should be mocked:

- middleware APIs
- wallet client APIs
- public client RPC methods
- receipt / watcher / polling boundaries

## Current files

| File | Purpose |
| --- | --- |
| `bridge-pipeline.test.ts` | Public `bridge()` characterization: intent build/refresh, plan preview/confirmation, allowance gating, request submission, vault deposit progress, fill completion, and event resilience |
| `bridge-and-execute-pipeline.test.ts` | Public `bridgeAndExecute()` characterization with the real nested bridge leg and real execute leg, mocking only middleware, wallet, and RPC boundaries |
| `swap-pipeline.test.ts` | Public `swap()` characterization with the real internal pipeline from preflight through prepare and execution |
| `swap-and-execute-pipeline.test.ts` | Public `swapAndExecute()` characterization with the real nested swap leg and real execute leg, including both execute-only and funding-required paths |

## Good assertions

Good flow-characterization assertions prove continuity:

- the preview plan is the one that gets confirmed
- route or intent decisions explain prepared execution and final tx shapes
- bridge and swap progress events map to the right plan steps
- a failure in observational event handling does not fail the real operation

Bad assertions:

- snapshotting a public result without checking how it came from earlier stages
- mocking route/prep/execution internals inside a file that claims to characterize the full flow

## Boundary with swap-domain characterization

Internal swap-domain characterization still belongs under `tests/swap/characterization`.
Examples:

- max pipeline behavior
- SBC wire format
- internal swap orchestration seams that are not themselves public flow entrypoints
