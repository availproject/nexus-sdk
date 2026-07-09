# Swap-Domain Characterization Tests

This directory now contains internal swap-domain characterization tests, not top-level public flow
characterization.

Public entrypoint characterization lives under
`tests/flows/characterization`.

## What belongs here

Use this directory for swap-domain behavior that spans multiple internal stages but is not itself a
public flow entrypoint.

Good examples:

- `calculateMaxForSwap()` pipeline behavior
- SBC wire-format assumptions
- internal swap orchestration seams that are broader than unit tests but narrower than full public
  flow characterization

## Current files

| File | Purpose |
| --- | --- |
| `sbc-wire-format.test.ts` | Locks wire-format assumptions for SBC transaction building and delegated execution prerequisites |
| `safe-wire-format.test.ts` | Locks the Safe `execTransaction` / MultiSend wire format and EIP-712 signing |
| `max-pipeline.test.ts` | Keeps `buildSwapPreflight`, `determineSwapRoute`, and `calculateMaxForSwap` real so max-amount behavior stays consistent with exact-in route construction, quote winner selection, haircut math, and returned source attribution |
| `swap.test.ts` | Full `swap()`-flow **decision-graph** characterization — drives the real flow and decodes **every** emitted call against the receiver/wrapper graph (see below) |

## Max pipeline coverage

`max-pipeline.test.ts` currently covers:

- non-`COT` destination max calculation using the real exact-in route
- `COT` destination max calculation using the real exact-in route
- source tokens that appear in swap balances but are not present in the deployment token list
- winning source/destination aggregator continuity between route construction and max output
- returned `sources` continuity with `route.extras.assetsUsed`
- haircut and proportional-output scaling against the real route-derived destination budget

## Swap execution decision-graph coverage (`swap.test.ts`)

The behavioral north star for the swap flow. It drives the **real** `swap()` orchestrator
(`src/flows/swap`) end-to-end and decodes **every** emitted on-chain call — source-swap,
bridge/COT deposit, fast-path funding, destination-swap — asserting each call's
`owner`/`spender`/`taker`/`receiver`/`amount` against the receiver/wrapper decision graph documented
in [`src/swap/swap.md` §14](../../../src/swap/swap.md#14-receiver--wrapper-decision-graph). Every row
of that graph is a green assertion here.

> Unlike the rest of this directory (internal seams), this file drives the **public** `swap()`
> entrypoint — it lives here because its job is to pin the *cross-stage* decision graph, not a single
> stage.

**How it stays honest (mock only the true external edges):**

- **Real wallets.** `EOA` and `ephemeral` are real `privateKeyToAccount`s (fixed keys). The EOA
  wrapper really RLP-encodes + secp256k1-signs `sendTransaction`/`writeContract` and the test decodes
  the captured raw tx (`parseTransaction`) — only the network *send* is faked. The ephemeral signs SBC
  / permit / Safe / intent payloads for real.
- **Echo aggregator.** The mock aggregator encodes the request's `taker`/`receiver`/`amount` into a
  real `SWAP(...)` calldata blob (`MOCK_SWAP_ABI`). `parseQuote` passes `txData.tx.data` through
  verbatim, so the test decodes it back out of the batch — proving routing computed the right values
  *and* execution wrapped them into the right wrapper. (Stronger than checking the quote request.)
- **Capture seams:** `submitSBCs` (read `SBCTx.calls` directly — pre-Calibur), `createSafeExecuteTx`
  (decode the MultiSend), and EOA raw txs at the wallet (Calibur-`execute` unwrapped). Middleware APIs
  are canned; public-client `balanceOf` is served by a wrapper-COT tracker that records the COT each
  source swap produces and each bridge delivers, so the #84/#86 reclaim bridges the actually-landed COT
  (a flat `0` would zero the reclaim'd bridge and skip the destination's surplus transfer).

**Beyond per-call decoding, the suite also pins:**

- **Signing is verified, not assumed.** Every EOA-submitted tx is independently recovered
  (`recoverTransactionAddress`) back to the EOA — the native deposit / source-swap / approve really
  carry a valid signature. (SBC/Safe EIP-712 signature *recovery* is owned by the sibling
  `sbc-wire-format` / `safe-wire-format` / `safe-tx` tests; not re-done here.)
- **The bridge intent.** The submitted RFF payload is decoded — each `sources[].value` /
  `destinations[].value` / `recipient_address` is asserted against the bridged amounts (Nexus exact;
  Mayan source exact, destination quote-derived). Native Mayan additionally decodes the
  `depositMayan` RFF struct (source value/chain, `recipientAddress`, `destinationChainID`).
- **Cross-seam ordering.** Nexus deposits land **after** the RFF is registered; Mayan vault-approves
  land **before** it and the native `reportMayanNativeTx` **after** it (`invocationCallOrder`).
- **Global completeness.** Representative scenarios assert the *complete* set of chains that emitted a
  batch — no stray work on an unexpected chain.
- **EXACT_OUT amount chain.** Derived (non-literal) source/bridge amounts are pinned as an observable
  chain: source-swap COT output == vault-approved COT == RFF source value, and the dst swap consumes
  ≤ that bridged total to deliver the exact requested output.
- **Amount flow under a source drift.** A second describe block induces executed ≠ planned and pins the
  #84/#86 reclaim: the bridge deposits the COT that actually landed (`balanceOf`, Seam 1), the Nexus
  destination re-derives from it (delivers MORE on positive slippage), the Mayan per-leg quote refreshes
  so `RFF source.value == effectiveAmountIn64` (the a4ba539 invariant), and a failed source dispatch +
  moved rate exercises the pooled `srcBuffer` guard (tolerate within budget / abort
  `EXTERNAL_RATES_DRIFT_EXCEEDED` beyond). See `swap.md` §12.1 for the amount-pathing graph.

Harness lives in [`tests/helpers/swap-characterization.ts`](../../helpers/swap-characterization.ts).

**Scenario matrix (61, all green).** 53 execution scenarios close the full provider × bridge-receiver grid (plus the fast-path expansion: Path A, same-token B1/EXACT_OUT, dynamic-COT B2), plus the 8-scenario amount-flow-under-drift block (above):

| bridge receiver | Nexus | Mayan |
| --- | --- | --- |
| `EOA` (no dst swap) | ✓ | ✓ |
| `EPH` (7702 dst + swap) | ✓ | ✓ |
| `SAFE` (non-7702 dst + swap) | ✓ | ✓ |

Across that grid the suite also covers: both modes (EXACT_IN / EXACT_OUT); all source wrappers
(7702 SBC, Safe MultiSend, native EOA-signed, mixed native+ERC20, mixed 7702+Safe); COT-direct
fast-path vs swap-sourced (funding-leg present/absent) on **both** wrappers; **Path A direct
destination** (all sources on dst chain → input→toToken source swap, receiver = EOA, no bridge, no
dst swap; EXACT_OUT also delivers a native gas leg in the same batch via the two-pass carry);
destination ops (COT no-swap, token swap, gas swap, token+gas combined,
Safe-destination gas swap); the native same-token `depositMayan{value}` + `reportMayanNativeTx`
path; the **same-token EXACT_OUT mirror** (B1: USDT→USDT, gross-up split deposits, delivered exact);
and **dynamic-COT** (B2: all-USDT sources → WETH settle in USDT — no source swaps, USDT deposits +
bridge, dst swap pulls USDT, EXACT_OUT even sizes the gas swap in USDT).

**Behavioral facts it pins (verify the test before changing these):**

- Gas top-up is **EXACT_OUT-only** — `_exactInRoute` always sets `gasSwap: null`.
- **Path A** (all sources already on the dst chain, `toToken ≠ COT`) emits ONE atomic batch per
  chain — `[permit, transferFrom(EOA→wrapper), approve(router), swap(taker=wrapper, receiver=EOA)]`
  per leg — no bridge (`submitRFF` never called), no destination swap, no leftover return. EXACT_IN
  swaps the full holding (no buffer, no reclaim deduction); EXACT_OUT selects `toAmount + srcBuffer`
  and over-delivers the surplus to the EOA, and with a native gas request runs a second pass over the
  remainder (`toNative + gasSrcBuffer`) so ONE batch carries two output tokens — toToken and native
  gas — both to the EOA (A6).
- The bridge/vault identity is always the **ephemeral**, even on a non-7702 source (Safe → ephemeral
  transfer, then ephemeral signs the vault permit).
- **Native participates in provider selection** like any token — `forceMayan` routes a native
  same-token bridge through Mayan (EOA-submitted `depositMayan`); non-forced native with an
  unverifiable Mayan source downgrades to Nexus `vault.deposit{value}`.

**Out of scope** (tracked, not here): `swapAndExecute` (a separate entrypoint —
`tests/flows/swap-and-execute*`), and the retry-EXHAUSTION / fill-timeout / cleanup paths. A single
source re-quote (drift, including the over-buffer `EXTERNAL_RATES_DRIFT_EXCEEDED` abort) IS covered
(above); a leg that exhausts its retries, the destination 3-attempt exhaustion, and the fill-timeout
cleanup are not.

## What stays real

Depending on the internal entrypoint, these tests should keep the relevant swap-domain stages real:

- `buildSwapPreflight`
- `determineSwapRoute`
- `createSwapPlan`
- `prepareSwapExecution`
- swap execution handlers
- aggregator wrappers

## What gets mocked

Only true external edges should be mocked:

- middleware APIs
- wallet client methods
- public client RPC methods

## Good assertions

Good swap-domain characterization assertions prove continuity across internal stages:

- route choices explain max output and returned sources
- quote winner selection propagates to later stage data
- internal orchestration decisions affect prepare/execution ownership correctly

Avoid treating small helper behavior as characterization if unit tests already cover it fully.
