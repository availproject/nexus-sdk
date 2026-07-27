# Bridge — End‑to‑End Flow (ground truth)

How a bridge is quoted, the **provider** chosen (Nexus vs Mayan), the intent built and signed, and
the deposits executed and filled — every decision point, what resolves it, and the
invariant/fallback rules.

> **Provenance.** Ground truth is the current source under `src/bridge/` (plus `src/services/rff.ts`
> for RFF signing and `src/flows/bridge.ts` for the orchestrator), cross‑checked against the bridge
> test suite (see *Where the tests live*). Where a test pins a behaviour it is cited inline; treat a
> contradiction between this doc and source/tests as a bug in this doc. Change the code/test first,
> then this doc.

**Conventions.** `EOA` = the user's connected wallet (the only signer/depositor — bridge has **no**
ephemeral key, Safe, or COT). `RFF` = Request‑For‑Fill, the exact‑out intent the user signs.
`provider` ∈ `{nexus, mayan}`. `vault` = the per‑chain deposit contract. `*Raw` = integer base units
(`bigint`); human amounts are decimal strings / `Decimal`. `mayanEnabled` = a per‑chain / per‑token
flag from the deployment list.

**Notation (pseudocode blocks).** Blocks fenced as `text` are **illustrative, not source** —
identifiers track real functions/constants for grep‑ability, but control flow is simplified.
`#` = explainer comment (the "why"); `?` suffix = optional/conditional step; `→` = "resolves to" /
dispatch; `Σ` = sum across legs; `◄` flags the **provider seam** (the single Nexus/Mayan branch).
Data shapes, wire formats, and rationale stay as prose / structs / tables.

### Where the tests live

| Area | Tests |
|---|---|
| Param validation | `tests/flows/bridge-validation.test.ts` |
| Quote request + provider resolution + Mayan dst assertion | `tests/flows/bridge-quote-request.test.ts` |
| Intent build (`createBridgeIntent`, Nexus + Mayan source gating) | `tests/flows/bridge-intent-creator.test.ts` |
| USD value resolver | `tests/flows/bridge-intent-values.test.ts` |
| Allowance detection (`findInsufficientAllowanceSources`) | `tests/flows/bridge-intent-builder.test.ts` |
| Hooks (intent approve/deny/refresh, allowance selection) | `tests/flows/bridge-hooks.test.ts` |
| Full pipeline (build→preview→hook→execute→events) | `tests/flows/characterization/bridge-pipeline.test.ts` |
| Sponsored allowance SBC (bridge‑in‑swap path) | `tests/bridge/allowances/prepare-swap-sbc-7702.test.ts` |
| Transport (`submitRFF`, `getMayanQuotes`, `reportMayanNativeTx`) | `tests/transport/middleware.test.ts` |

---

## 1. Core model

- **No COT, no aggregators, no smart accounts.** Unlike swap, a bridge moves **one token** from N
  source chains to the **same token** on one destination chain. The user signs a single **exact‑out**
  RFF; a solver fills the destination. The EOA is the only signer.
- **Two deposit submission modes** (`steps.ts:createVaultDepositStep`, `submissionMode`):
  - **native source → `local_wallet`**: the user's wallet sends the `deposit` (Nexus) /
    `depositMayan` (Mayan) tx itself, carrying `value` (native can't be pulled).
  - **ERC‑20 source → `middleware`**: the user only **pre‑approves** the vault (allowance step); the
    solver/middleware pulls the funds via the signed request. The SDK never sends an ERC‑20 deposit
    tx — it just watches the on‑chain `Deposit` / `DepositMayan` event to mark the leg done
    (`watchIntentCollections`).
- **Exact‑out request.** `toAmountRaw` is the amount to **deliver** on the destination chain;
  `toNativeAmountRaw` is optional destination gas. The intent picks sources to cover that plus fees.

### 1.1 The provider seam (`resolveBridgeProvider`)

```text
resolveBridgeProvider(mw, request, forceMayan) -> 'nexus' | 'mayan':        ◄ the only provider branch
  if forceMayan: return 'mayan'                       # config flag (SDK `forceMayan`), skips the server call
  return mw.getBridgeProvider(request).provider       # server owns the USD threshold / routing decision
  # request = buildBridgeProviderRequest(dstToken, dstChainId, tokenAmount)
  #         = { destination: { chain_id, contract_address, amount } }
```

This single call (`quote-request.ts`) decides the path. The resolved `provider` rides on
`BridgeIntentDraft.provider` and **every** downstream stage — intent build, RFF serialization,
executor — switches off it. `forceMayan` additionally calls `assertMayanSupportedDestination`
(dst chain **and** token must be `mayanEnabled`) up front so an unsupported forced route fails loud
before any work (`builder.ts`, `bridge-quote-request.test.ts`).

---

## 2. Public surface

`executeBridge(input, options?)` / `simulateBridge(input)` (`src/core/sdk/base.ts` →
`src/flows/bridge.ts`). `simulateBridge` runs build + preview only (no signing/execution).

```text
input  : BridgeParams = { toTokenSymbol, toAmountRaw, toChainId,
                          recipient?, toNativeAmountRaw?, sources?: number[] }   # params.ts (zod)
         # toAmountRaw==0 ∧ toNativeAmountRaw==0 → throw; recipient defaults to the EOA
options: { hooks: {onIntent?, onAllowance?}, onEvent?, fillTimeoutMinutes? }     # resolveHooks fills defaults
deps   : { chainList, middlewareClient, intentExplorerUrl, evm:{walletClient,address},
           forceMayan }                                                          # forceMayan from SDK config
```

Default hooks (`hooks/defaults.ts`): `onIntent` auto‑**allows**; `onAllowance` auto‑selects
**`'min'`** for every flagged source.

Status stream (`onEvent`), happy path (`bridge-pipeline.test.ts`):
```text
{status:intent_building} → {status:intent_ready} → {plan_preview}
→ {status:awaiting_approval} → {status:approved} → {plan_confirmed}
→ {status:awaiting_allowance_selection}?         # only if an allowance is short
→ {status:executing} → … plan_progress … → {status:completed}
```
A fill failure emits `bridge_fill:failed` and **never** `{status:completed}`; the failed event is
emitted at most once (`progress.ts` `failedEventEmitted` guard).

Result: `{ intentExplorerUrl: <base>/rff/<requestHash>, intent: BridgeIntent, sourceTxs }`
(`getIntentExplorerUrl`; empty `baseURL` → `''`).

---

## 3. Worked run A — Nexus, EXACT_OUT, multi‑source

> **Scenario (illustrative amounts; decisions are exact).** Deliver **100 USDC on Base**. The user
> holds USDC on **Arbitrum** and **Ethereum**. `getBridgeProvider` → `nexus`. Grounded in
> `bridge-intent-creator.test.ts` (`applies protocol BPS and fulfillment fee…`, `sorts sources by
> amount DESC with Ethereum last`, `skips sources where deposit fee exceeds balance`).

```text
executeBridge({toTokenSymbol:USDC, toAmountRaw:100e6, toChainId:Base}, deps, options):

  # ── build intent ───────────────────────────────  emit {status:intent_building}
  intent = buildBridgeIntent({…, forceMayan:false}):                                 (§5)
    parallel:
      balances      = getBalancesForBridge(eoa)
      oraclePrices  = getOraclePrices()
      provider      = resolveBridgeProvider(mw, {dst:USDC@Base, amount:100e6}, false) # → 'nexus'  ◄ seam
    quoteSources  = explicit sources ?? positive eligible USDC balance chains
    quoteResponse = getQuote(buildQuoteRequest(USDC, Base, quoteSources)) # scoped deposit + fulfilment fees
    createBridgeIntent(provider='nexus'):                                             (§5)
      availableSources  = balances on every chain ≠ Base                # depositFee via 'deposit'
      baseAmount        = 100 + gasInToken                              # gasInToken=0 here
      payableAmount     = baseAmount × (1 + fulfillmentBps/1e4) + fulfillmentFeeToken
      allowedSources    = filter by `sources` allowlist; sort Ethereum-last, then balance DESC
      greedy fill: per source  usable = balance − depositFee; used = min(usable, remaining)
                   skip if depositFee ≥ balance;  remaining>0 at end → throw Insufficient balance
      destination.amount = 100;  fees = {caGas: Σdeposit+fulfil, deposit, fulfillment, protocol, solver:0}

  # ── preview + approval ───  emit {status:intent_ready},{plan_preview},{status:awaiting_approval}
  previewState = buildBridgePreviewState(intent)   # convertIntent + createBridgePlan + allowance scan (§7)
  onIntent({intent, allow, deny, refresh})         # allow()→proceed; refresh(srcChains)→re-route+re-preview
  emit {status:approved}, {plan_confirmed}

  # ── allowances ──  if any ERC-20 source allowance < amount+depositFee:               (§7)
  emit {status:awaiting_allowance_selection}; onAllowance({sources, allow, deny})  # default 'min'
  prepareBridgeExecution(selections)               # approve(vault) per short source

  # ── execute ─────────────────────────────────────  emit {status:executing}
  executeBridgeFromIntent(intent):                 # provider≠'mayan' → shared executor              (§8)
    sign RFF (createRequestFromIntent)             # EOA signs MESSAGE_PREFIX+keccak256(request)
    watchIntentCollections(Deposit)                # ERC-20 legs: watch on-chain event
    submitRFFToMiddleware(request, signature)
    executeVaultDeposits:  native → local deposit(value);  ERC-20 → middleware-collected (emit started)
    waitForFill            # race: timeout vs mw poll vs on-chain dst vault fulfilment (EVM dst)
  emit {status:completed}; return {intentExplorerUrl, intent, sourceTxs}
```

---

## 4. Worked run B — Mayan, EXACT_OUT via quote‑once + swing‑leg convergence

> **Scenario (illustrative amounts; decisions are exact).** Deliver **100 USDT on Arbitrum**; user
> holds USDT on **Polygon** and **Optimism**; `getBridgeProvider` → `mayan` (or `forceMayan`).
> Grounded in `bridge-intent-creator.test.ts` (`excludes Mayan-disabled source chains…`, the
> `Mayan exact-out convergence` block) and `creator.ts createMayanBridgeIntent`.

```text
createBridgeIntent(provider='mayan') → createMayanBridgeIntent:    # try/catch → Nexus fallback (§5,§11)
  gate: dst chain.mayanEnabled ∧ dstToken.mayanEnabled  else throw
  # Step 1: source inventory — keep only sources where source chain AND token are mayanEnabled
  #         depositFee looked up with 'depositMayan' → match.depositMayanFeeToken (not depositFeeToken)
  # Step 2: per-leg floor = $1.10 USD  (×2 for native ETH → Ethereum mainnet)
  #         keep sources with usableUsd ≥ $1.10 ∧ usable ≥ minimumAmount; sort by usableUsd DESC
  # Step 3: gas drop — capped per chain (ETH .05, BSC .02, Polygon .2, Avax .1, Arb .01);
  #         native destination + gas drop → throw; modelled INSIDE the Mayan route, not an RFF dest

  # Steps 4-7: quote once, then trim ONE leg — Mayan quotes are EXACT-IN, RFF is EXACT-OUT.
  # Step 4: ONE batched getMayanQuotes with every eligible leg at its FULL usable amount,
  #         gas drop on the largest leg (index 0 after the usableUsd-desc sort). maxOut[i] = minReceived.
  # Step 5: commit the largest legs in full until Σ maxOut ≥ amount; if even all legs maxed are short
  #         → throw Insufficient balance (detected in ONE round, not three).
  # Step 6: the last committed leg is the SWING. Keep the others at full; trim the swing to the
  #         residual needFromSwing = amount − Σ(other committed maxOut):
  #           estimate input = needFromSwing / leg-rate, clamped to [minimumAmount, usable]
  #           re-quote that single leg (≤ MAYAN_SWING_MAX_QUOTES); accept the first input whose
  #           minReceived ≥ needFromSwing. The leg at full usable already covers the residual, so a
  #           solution always exists; worst case it stays at full usable. Overshoot is confined to
  #           this one leg and bounded by one per-leg minimum (accepted).
  # Step 7: materialize selectedSources from the committed legs (input, depositFee, scaledValue, quote)

  destination.amount = finalAmountOut (= Σ committed minReceived)   # ≥ amount
  fees = { caGas:0, deposit:Σdeposit,
           fulfillment: totalAmountIn − totalAmountOut,
           protocol:    Σ(leg.amount × (protocolBps ?? 3)/1e4),
           solver:      fulfillment − protocol }
```

Execution then runs the **Mayan executor** (§8): native legs call `depositMayan` with the
encoded route data and report back via `reportMayanNativeTx`; the RFF carries **one destination per
leg**.

---

## 5. Intent build reference

`buildBridgeIntent` (`intent/builder.ts`) fetches balances, oracle prices, and provider selection in
parallel. It then scopes `getQuote` to caller-provided source chains, or to positive eligible
same-currency balances after the existing native-gas reservation when no source allowlist was
provided. The balance-derived USD resolver still prefers balance pricing before its oracle fallback
(`bridge-intent-values.test.ts`).

`buildQuoteRequest` (`quote-request.ts`) requires explicit source chain IDs and resolves the
same-currency token only on those chains (currencyId first, symbol fallback, native skipped). The
destination remains present on the first call so middleware can calculate the fulfillment fee; the
source entries supply the applicable per-source deposit fees without contacting unrelated chains.

`createBridgeIntent` (`intent/creator.ts`) branches on `provider`:

```text
NEXUS:
  availableSources = balances(chain ≠ dst), depositFee = lookupDepositFee('deposit')   # native ⇒ 0
  baseAmount    = requiredAmount + gasInToken
  payableAmount = baseAmount × (1 + fulfillmentBps/1e4) + fulfillmentFeeToken
  allowedSources= allowlist-filtered; sortSourcesForFeeAllocation = Ethereum(id 1) LAST, then balance DESC
  greedy: usable = balance − depositFee; used = min(usable, remaining); skip depositFee ≥ balance
          remaining > 0 after all sources → throw Insufficient balance
  destination.amount = requiredAmount
  fees = { caGas: Σdeposit + fulfillmentFee, deposit: Σdeposit,
           fulfillment: fulfillmentFee, protocol: baseAmount × bps/1e4, solver: 0 }

MAYAN: createMayanBridgeIntent  (§4) — mayanEnabled gating, $1.10 per-leg floor, quote-once + swing-leg
       convergence (one batched getMayanQuotes at full usable, then trim the last leg), gas drop inside
       the route. On ANY throw → falls back to createBridgeIntent({…, provider:'nexus'}); if THAT throws
       too → "Mayan failed: … Nexus fallback failed: …"
```

The readable projection (`intent/readable.ts convertIntent`) exposes `fees = {caGas, protocol,
solver, total: caGas+protocol+solver, totalValue: max(ΣsourceValue − dstValue, 0)}` and carries
`mayanQuote` through on each source. `BridgeIntentDraft` (internal, `Decimal`) → `BridgeIntent`
(public, strings) at every hook/preview/result boundary.

---

## 6. RFF creation & signing (`services/rff.ts`)

`createRequestFromIntent` ABI‑encodes the request, hashes it (`keccak256`), and asks the EOA to
`signMessage(MESSAGE_PREFIX + hash)`. The Nexus/Mayan split lives in
`getSourcesAndDestinationsForRFF`:

| | Nexus | Mayan |
|---|---|---|
| **destinations** | **one** — `value = destination.amountRaw` | **one per source leg** — `value = leg.mayanQuote.minReceived` |
| **gas drop** | folded into destinations: native dst → add to value; ERC‑20 dst → extra zero‑address destination | **not serialized** — lives in the Mayan route payload |
| **expiry** | `now + INTENT_EXPIRY` | **min** `mayanQuote.deadline64` across legs |
| **`submitRFF` payload** | `{request, signature}` | `{request, signature, mayanQuotes[]}` |

Signing also guards that the wallet's signer address matches the configured EOA address, and maps
user‑rejection to `userRejectedIntentSignature`.

---

## 7. Hooks, allowances, plan, preview

**Preview** (`preview.ts`): `convertIntent` + `createBridgePlan` + an allowance scan
(`buildHookStateFromIntent` → `getAllowances`). Emitted as `plan_preview`, re‑emitted on every
`refresh`.

**Intent hook** (`hooks/approval.ts resolveBridgeIntentApproval`): `onIntent({intent, allow, deny,
refresh})`. `allow()` → proceed; `deny()` → throw `userDeniedIntent`; `refresh(sourceChains?)` →
rebuild the intent with a new source allowlist and re‑preview (no‑op once accepted).

**Allowance detection** (`intent/builder.ts findInsufficientAllowanceSources`): for each selected
source that is **non‑native and not the destination chain**, `requiredAllowance = amountRaw +
depositFeeRaw`; flag when it exceeds the current allowance (keyed by chain + token + holder;
`bridge-intent-builder.test.ts`).

**Allowance hook** (`resolveBridgeAllowanceSelections`): only runs when something is short.
`onAllowance({sources, allow, deny})`; `allow(selections)` requires `selections.length ===
sources.length` else `invalidAllowance`; `deny()` → `userRejectedAllowance`.
`prepareBridgeExecution` (`allowances/prepare.ts`) then `approve`s the vault per source (EOA tx /
sponsored).

**Plan** (`steps.ts createBridgePlan`), deterministic ids:
```text
allowance_approval:<chain>:<token>   # per short ERC-20 source
request_signing
request_submission
vault_deposit:<chain>:<token>        # per source where chain ≠ dst;  submissionMode native→local_wallet / ERC-20→middleware
bridge_fill:<dstChain>
```

---

## 8. Execution reference (`executor.ts`, `mayan-executor.ts`)

`executeBridgeFromIntent` dispatches on `intent.provider`: `'mayan'` →
`executeMayanBridgeFromIntent`, else the shared Nexus executor. Both share the skeleton; the Mayan
deltas are flagged ◄.

```text
executeBridgeFromIntent(intent, {walletClient, address, chainList, middlewareClient, dstChain, …}):
  1 sign      createRequestFromIntent → {rffRequest, depositRequest, signature, requestHash}  (§6)
  2 watch     watchIntentCollections(requestHash, sources, isMayan?)   # ERC-20 legs only:
              event = isMayan ? 'DepositMayan' (VAULT_ABI_MAYAN) : 'Deposit'                  ◄
  3 submit    submitRFFToMiddleware(rffRequest, signature, [mayanQuotes if mayan])             ◄
  4 deposits  executeVaultDeposits / executeMayanVaultDeposits:
                per source where chain ≠ dst:
                  native (EVM universe ∧ isNativeAddress — ZERO/EADDRESS, 20-byte or bytes32-padded):
                    switchChain → simulate → writeContract → waitForTxReceipt
                    Nexus: vault.deposit(depositRequest, signature, i)
                    Mayan: vault.depositMayan(toMayanDepositRequest(rff), signature, i,           ◄
                           encodeMayanRouteData(getRoutesDataFromQuote(quote)))  value = s.value
                    Mayan: after receipt → mw.reportMayanNativeTx(requestHash,{source_index,tx_hash}) ◄
                  ERC-20: emit vault_deposit:started only — middleware collects via allowance;
                          the watcher (step 2) fires vault_deposit:completed on the event
                await all native receipts
  5 fill      Nexus waitForFill:      race timeout vs mw poll vs on-chain dst vault fulfilment (EVM dst)
              Mayan waitForMayanFill:  race timeout vs mw poll ONLY (no on-chain dst watch)          ◄
  6 finish    if dst is EVM: switchChain back; return {intentExplorerUrl, requestHash, sourceTxs}
  on any failure: stopCollectionWatchers; rethrow
```

`fillTimeoutMinutes` defaults to `DEFAULT_FILL_TIMEOUT_MINUTES`; a timeout → `BackendError`
(`BACKEND_FULFILMENT_WAIT_TIMEOUT`). Native deposits are sent **serially** (one `switchChain` +
prompt per chain); their receipt‑confirm + `reportMayanNativeTx` run concurrently via
`Promise.all`.

---

## 9. Progress / event mapping (`progress.ts`)

`createBridgeProgressEmitter` maps executor `BridgeExecutionProgressUpdate`s (and the allowance
service's `AllowanceExecutionProgressUpdate`s, which drive the `allowance_approval` row) onto the
typed `plan_progress` stream by looking the step up in the confirmed (or latest preview) plan.
Per‑step states:

```text
request_signing      : wallet_prompted → completed | failed
request_submission   : started → completed | failed
allowance_approval   : wallet_prompted → submitted → confirmed | failed
vault_deposit        : started | wallet_prompted → submitted → confirmed → completed | failed
bridge_fill          : waiting → completed | failed
```

All emits run through `runNonBlocking` (a throwing `onEvent` can't break execution); the first
`failed` wins and suppresses later failures. Vault‑deposit lookup tolerates a zero‑padded token
address (`bridge-pipeline.test.ts`, "padded token address").

---

## 10. Fees

| field | Nexus | Mayan |
|---|---|---|
| `caGas` | `Σ depositFee + fulfillmentFee` | `0` |
| `deposit` | `Σ depositFee` | `Σ depositFee` |
| `fulfillment` | `fulfillmentFeeToken` (from quote) | `totalAmountIn − totalAmountOut` |
| `protocol` | `baseAmount × fulfillmentBps / 1e4` | `Σ(leg.amount × (protocolBps ?? 3) / 1e4)` |
| `solver` | `0` | `fulfillment − protocol` |

Deposit fee per source comes from the deploy quote: `depositFeeToken` (Nexus) vs
`depositMayanFeeToken` (Mayan); native sources are always `0`. The public `total` is
`caGas + protocol + solver`.

---

## 11. Retry & invariant summary

- **Provider is one decision, server‑owned.** `resolveBridgeProvider` either honours `forceMayan` or
  asks `getBridgeProvider` (which owns the USD threshold). `forceMayan` also asserts the destination
  is Mayan‑supported up front.
- **Mayan silently falls back to Nexus at build time.** Any throw inside `createMayanBridgeIntent`
  rebuilds the intent as `provider:'nexus'`; only a *double* failure surfaces. Once an intent is
  built `provider:'mayan'`, execution is committed to the Mayan path.
- **Mayan per‑leg floor `$1.10`** (×2 for native ETH → mainnet); sources below it are dropped before
  selection.
- **Mayan convergence is quote‑once + swing‑leg.** One batched `getMayanQuotes` prices every eligible
  leg at full usable; the largest legs are committed in full and only the **last (swing) leg** is
  trimmed (≤ `MAYAN_SWING_MAX_QUOTES` re‑quotes) to the residual output. Convergence is guaranteed
  (the swing at full usable already covers the residual), insufficiency is detected in **one** round
  (`Σ all‑max < amount`), and any overshoot is confined to the swing leg and bounded by one per‑leg
  minimum (accepted by design). Replaces the old ≤3‑round proportional‑rescale loop that could miss
  the target and fall back to Nexus.
- **Mayan gas drop** is chain‑capped and rides the **largest** leg only; it lives in the route
  payload, never as an RFF destination. Native destination + gas drop is rejected.
- **Exact‑out source selection** (Nexus) is greedy over `usable = balance − depositFee`, Ethereum
  ordered last; a leftover `remainingPayable` throws `Insufficient balance`.
- **Deposit submission**: native = user's wallet (`deposit`/`depositMayan` with `value`); ERC‑20 =
  middleware‑collected via allowance + signed request, observed by the on‑chain event watcher. The
  EOA is single‑chain and serialized for native deposits.
- **Fill waiting**: Nexus races middleware poll **and** an on‑chain dst‑vault fulfilment watch (EVM
  dst); Mayan races the middleware poll only. Timeout → `BACKEND_FULFILMENT_WAIT_TIMEOUT`; a fill
  failure never emits `{status:completed}`.
- **Hooks are pure decisions** — `onIntent`/`onAllowance` approve/deny/refresh but perform no
  approvals; the allowance count must match the flagged‑source count.

---

## 12. Coverage notes

- Intent‑build logic (Nexus selection/fees, Mayan source gating, and the quote‑once + swing‑leg
  convergence) is covered by `bridge-intent-creator.test.ts` (`Mayan exact-out convergence` block);
  the full build→preview→hook→execute→event path by `bridge-pipeline.test.ts`; provider resolution +
  Mayan dst assertion by `bridge-quote-request.test.ts`.
- The Mayan **executor** native path (`depositMayan` + route encoding + `reportMayanNativeTx`) is
  exercised mainly through the transport tests rather than a dedicated `executeMayanBridgeFromIntent`
  unit — the thinnest spot if the deposit ABI or `reportMayanNativeTx` wire shape changes.
