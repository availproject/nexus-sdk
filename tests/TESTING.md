# Testing Strategy

This document defines how the Nexus SDK test suite should be structured and how behavior may be
consolidated without losing coverage. Read it with
[`docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) and
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Test Layers

Use the smallest layer that observes the behavior directly.

### Pure unit tests

Pure logic belongs in a test that mirrors the production path and uses no mocks. Prefer concrete
inputs and exact outputs for arithmetic, normalization, validation, mapping, and selection logic.

### Focused contract tests

Keep focused tests for boundaries whose wire format or authentication details are the behavior:
ABI encoding, signed payloads, transaction serialization, middleware request normalization,
public exports, type surfaces, and vendor adapters.

### Characterization tests

Cross-stage behavior belongs in characterization tests that execute the real orchestration and
feature internals. Assert observable plans, results, errors, events, lifecycle transitions,
decoded calls, and externally submitted payloads.

An assertion that only checks whether one mocked SDK-internal function called another is forbidden.
It restates the implementation call graph and cannot prove the integrated behavior.

## Mock Boundaries

Mocks are allowed at injected or external boundaries:

- middleware responses and submissions;
- wallet prompts and network sends;
- deterministic public-client reads;
- receipt watchers and fulfilment polling;
- aggregator HTTP requests.

Do not mock SDK-internal intent builders, route stages, allowance logic, request-for-funds logic,
progress mapping, or execution stages in characterization coverage.

`tests/swap/route.test.ts` has one documented exception: it may mock the auto-select, liquidate,
and destination algorithm seams so the route facade can retain focused validation and composition
coverage. Holdings and native-reserve estimation must run through their real implementations.

## Shared Helpers

Use the existing helper owners instead of redefining local builders:

- `tests/helpers/chains.ts` owns chain and chain-list factories;
- `tests/helpers/tokens.ts` owns reusable token constants and token fixtures;
- `tests/helpers/public-client.ts` owns deterministic public-client builders;
- `tests/helpers/balances.ts` owns balance and oracle-price builders;
- `tests/helpers/middleware-client.ts` owns middleware client fixtures;
- feature characterization helpers own only capture, decoding, and scenario controls specific to
  that feature.

Add capabilities to these owners when a surviving suite needs a shared shape. Do not add
compatibility wrappers only for a test that is scheduled for deletion.

## Scenario Design

Name scenarios after observable behavior and the condition that produces it, for example:

```text
retries an unbroadcast bridge deposit after a structured middleware failure
re-emits the refreshed plan before executing an allowed swap
```

Table-drive families that differ only by provider, wallet path, mode, or input shape. Keep
separate specs when their failure paths, emitted lifecycle, or decoded wire formats differ.

## Subsuming Existing Tests

Before deleting a spec, record exactly one classification in the PR evidence:

- `DROP`: the spec only echoes calls or arguments to an SDK-internal function mocked by the test;
- `SUBSUMED`: a surviving test observes the same behavior; cite its file and exact spec title;
- `PORT`: meaningful behavior is not observed elsewhere; add a characterization or focused
  contract spec and cite its new title.

No deletion candidate may be removed while it contains an unclassified spec.

For each deletion batch:

1. Generate LCOV on the exact production-source revision used for the baseline.
2. Save `coverage/lcov.info` outside the worktree.
3. Run coverage after porting and deletion.
4. Compare exact branch identities with the tracked comparator.
5. Restore coverage or document each intentionally uncovered branch in the PR evidence.

The comparator reports recursively selected scopes. `src/swap/**` includes every instrumented file
below `src/swap/`; it is not the direct-files-only row in the text coverage table.

```bash
npm run test:coverage
cp coverage/lcov.info /tmp/nexus-baseline.lcov

# After the refactor batch:
npm run test:coverage
npm run coverage:compare -- /tmp/nexus-baseline.lcov coverage/lcov.info
```

The comparator exits non-zero and prints the exact file, line, block, and branch for every branch
that was covered in the baseline and is uncovered or missing in the current report.

## Verification

Use focused tests while iterating:

```bash
npm test -- tests/path/to/focused.test.ts
npm run typecheck:tests
```

Finish every independently reviewable refactor layer with:

```bash
npm run lint
npm run lint:deps
npm run typecheck
npm run typecheck:tests
npm run test
```

Run `npm run test:coverage` and the LCOV comparator for broad ports, deletion batches, and the final
PR evidence.
