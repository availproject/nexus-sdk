# Swap — End‑to‑End Flow (ground truth)

How a swap is routed, approved, and executed across the three stages and the two wallet
paths — every decision point, what resolves it, and the retry/invariant rules.

> **Provenance.** Reconstructed **only from the test suite** (see *Where the tests live* below for
> the directories). The intent is
> that the tests fully specify observable behaviour; the few places they don't are called out in
> [§13 Test‑coverage gaps](#13-test-coverage-gaps). Change the test first, then this doc; treat a
> contradiction between this doc and a test as a bug in this doc.

**Conventions.** `EOA` = the user's connected wallet; `ephemeral` = a per‑session key the SDK
derives from an EOA signature; `COT` = Common Output Token (USDC by default); `SBC` = Signed
Batched Call (the 7702/Calibur execution envelope). `*Raw` = integer base units (`bigint`); human
amounts are decimal strings / `Decimal`.

**Notation (pseudocode blocks).** Blocks fenced as `text` are **illustrative, not source** —
identifiers track real functions/constants for grep‑ability, but control flow is simplified.
`#` = explainer comment (the "why"); `?` suffix = optional/conditional step (`permit?`); `→` =
"resolves to" / dispatch; `Σ` = sum across legs; `◄` flags the wallet‑path seam. Numeric
thresholds are written as their **constant names** (`SRC_BUFFER_PCT`, `DST_BUFFER_MAX_USD`, …),
pinned in `tests/swap/constants.test.ts`. Data shapes, wire formats, and rationale stay as prose /
structs / tables.

### Where the tests live

Most swap-domain unit tests live under `tests/swap/**`, but **public flow entrypoints and some
service-level units live elsewhere** — search all of these before concluding a behaviour is
untested (this map exists because that scoping mistake has bitten twice):

| Area | Tests |
|---|---|
| Flow entrypoint + execution orchestrator | `tests/swap/swap.test.ts`, `tests/swap/execution/orchestrator-structure.test.ts` |
| `swapAndExecute` (composite flow) | `tests/flows/swap-and-execute.test.ts`, `tests/flows/characterization/swap-and-execute-pipeline.test.ts` |
| `buildSwapPreflight` | `tests/services/swap-preflight.test.ts` |
| Full pipeline (preflight→route→prepare→execute) | `tests/flows/characterization/swap-pipeline.test.ts` |
| `determineSwapRoute` / `resolveWalletDecisions` | `tests/swap/route.test.ts`, `tests/swap/route-swap-supported.test.ts` |
| Selection & destination algorithms | `tests/swap/algorithms/*.test.ts` |
| Aggregators (+ adapters) | `tests/swap/aggregators/*.test.ts` |
| Intent / bridge-intent / plan / prepare | `tests/swap/{intent,bridge-intent,swap-steps-builder,prepare}.test.ts` |
| Execution (source / bridge / destination / cleanup / safe-dispatch) | `tests/swap/execution/*.test.ts` |
| Wallet primitives (SBC, stark, derived-key, cache, capabilities, eoa-executor, sweep, cot) | `tests/swap/wallet/*.test.ts`, `tests/swap/{sweep,cot}.test.ts` |
| Safe machinery | `tests/swap/safe/*.test.ts` |
| Balances | `tests/swap/balance/*.test.ts` |
| `calculateMaxForSwap` | `tests/swap/max.test.ts`, `tests/swap/characterization/max-pipeline.test.ts` |
| Economic constants | `tests/swap/constants.test.ts` |
| Wire-format characterization | `tests/swap/characterization/{sbc,safe}-wire-format.test.ts` |

---

## 1. Core model

- **COT.** The intermediate settlement token — a **per-route** currency, USDC by default
  (`CurrencyID.USDC = 1`). `resolveCOT(chainId, chainList, currencyId?)` → `{address, decimals,
  permitVariant, permitVersion, currencyId}` via `chainList.getTokenByCurrencyId`; defaults to USDC;
  throws `No COT with currencyId=<n> on chain <chainId>` when absent. The dynamic-COT fast path (B2,
  §5/§12.2) re-enters the flow with `cotCurrencyId` overridden to a stable family F (USDC/USDT) so a
  route whose sources are all F settles in F instead of round-tripping through USDC; every COT read
  descends from `options.cotCurrencyId`, and `settlementCurrencyId` records the family actually used.
- **Modes.** `EXACT_OUT` (deliver a fixed output) and `EXACT_IN` (spend fixed inputs). A
  **negative `toAmountRaw`** in EXACT_OUT is a reservation / gas‑only sentinel.
- **Smart‑account‑only.** A swap is **never dispatched directly from the EOA**. Execution always
  runs through a per‑chain smart account, of which there are **two implemented kinds**
  (`WalletPath = 'ephemeral' | 'safe'`):
  - **`ephemeral` (7702 chains):** the ephemeral key, delegated to **Calibur** via an EIP‑7702
    authorization, runs the calls as an **SBC** submitted to middleware.
  - **`safe` (non‑7702 chains):** a deterministic **Safe** owned by the ephemeral key runs the
    calls via `Safe.execTransaction`.

  The EOA only ever: signs permits, pays a fallback `approve` when permit is unavailable
  (`writeContract`), and sends native bootstrap / payable execute transactions
  (`sendTransaction`). It is a **single‑chain, serialized resource** (≤ 1 EOA op at a time).

### 1.1 The wallet‑path seam (`resolveWalletDecisions`)

```text
resolveWalletDecisions({ sourceChainIds, walletPathHints }) → { sourceExecutionPaths }
  per chain: hint ?? 'ephemeral'                       # missing chain defaults to ephemeral
  # hints come from preflight: resolveWalletPath(chainSupports7702(chain))
  #   chainSupports7702 = (chain.supports7702 !== false)     # undefined ⇒ true
  #   true → 'ephemeral'   false → 'safe'
```

This is the **single point** that assigns each chain a `WalletPath`. Both paths are fully
implemented; every execution stage reads `sourceExecutionPaths` and switches dispatch off it:

| Stage | `'ephemeral'` | `'safe'` |
|---|---|---|
| Source swap | Calibur SBC → `submitSBCs` | `dispatchSafeSource` (ensure Safe, then `createSafeExecuteTx` / EOA‑submit) |
| Bridge deposit | combined SBC `[approve, deposit]` | v1 5‑step Safe batch (`createSafeExecuteTx`) |
| Destination swap | Calibur SBC | `Safe.execTransaction` |

Routing **pre‑aligns** quotes and recipients to the chosen path: on a `'safe'` chain the
source‑swap quote's `userAddress` **and** `recipientAddress` are the **predicted Safe address**
(`predictSafeAccountAddress(ephemeral).address`); on a `'ephemeral'` chain they are the ephemeral.
Flipping a chain between 7702 and non‑7702 needs no special‑casing at the call sites — the
resolver flips the path and the stages follow.

---

## 2. Public surface

Parameter shapes (`currency-id-types.test.ts`):

- `swapWithExactIn` ← `{ sources: [{chainId, tokenAddress, amountRaw?}], toChainId, toTokenAddress }`
- `swapWithExactOut` ← `{ toChainId, toTokenAddress, toAmountRaw, sources?: [{chainId, tokenAddress}] }`
- `swapAndExecute` ← `{ toChainId, toTokenAddress, toAmountRaw, execute: {to, gas} }`
- `calculateMaxForSwap` ← `{ toChainId, toTokenAddress, sources? }`

The thin flow entrypoint is `src/flows/swap.ts`; the feature-owned stage orchestrator is
`src/swap/execution/orchestrator.ts`. The flow is invoked as `swap(input, deps, options)`:

```text
deps    = { chainList, timing?, middlewareClient, intentExplorerUrl,
            evm:  { walletClient, address },          // the EOA
            swap: { ephemeralWallet, cotCurrencyId } }
options = { onIntent?, onEvent?, preloadedBalances?, slippageTolerance? }
input   = { mode, data }                              // SwapData
```

Stages and their dev‑timing spans (no `flow.swap.root` span exists):
`flow.swap.preflight`, `…determine_route`, `…create_intent`, `…hooks`, `…execute_source`,
`…execute_bridge`, `…execute_destination`.

`src/flows/swap.ts` owns `preflight → route → approval → prepare → public result`.
`executeSwapRoute` owns `source → optional bridge → destination → stage-aware cleanup` and returns
the internal execution metadata consumed by the flow.

Event stream (`onEvent`), happy path:
```text
{status:route_building} → {status:route_ready} → {plan_preview}
→ {status:awaiting_approval} → {status:approved}
→ {plan_confirmed} → {status:executing} → {status:completed}
```
A destination failure propagates and **never** emits `{status:completed}`.

---

## 3. Worked run A — EXACT_OUT, cross‑chain, 7702/ephemeral

> **Scenario (illustrative amounts; decisions are exact).** Deliver **exactly 1.0 WETH on Base
> (8453)**. The user holds **0.5 WETH on Arbitrum (42161)**. COT = USDC. Both chains support 7702.
> Grounded in `route.test.ts` (`EXACT_OUT cross-chain → bridge populated`, `… deducts
> destination-chain COT …`) and the `execution/*` tests.

```text
swap(input = {mode: EXACT_OUT, data:{toChainId:Base, toTokenAddress:WETH, toAmountRaw:1e18}},
     deps, options):

  # ── Step 1: preflight ─────────────────────────────  emit {status:route_building}   (§4-style, §preflight)
  pf = buildSwapPreflight(input, {chainList, cotCurrencyId, eoaAddress, middlewareClient})
    aggregators      = createAggregators(mw)               # → [LiFi, Bebop, Fibrous, 0x, Mystic, Relay]
    publicClientList = createPublicClientList(chainList)
    raw              = preloaded ?? getSwapBalances(eoa)   # composite passes raw (keeps actuals for shortfall)
    reserved         = deductSwapNativeReserveFees(chainList, raw)   # reserve native gas out of source sizing
    balances         = selectSwapSources(reserved, toChainId, toToken)   # → positive-only, same-chain-first
    dstTokenInfo     = native(toToken) ? chain.nativeCurrency
                                       : fetchErc20TokenMetadata(toToken)     # → WETH/18
    quoteTok = resolveBridgeQuoteToken(input)          # the token the router will BRIDGE: the dst token
                                                       #   only when same-token bridging fires (EXACT_IN ∧
                                                       #   every source = dst family); else dstCOT. undefined
                                                       #   when no quote is needed (native COT / no COT)
    bridgeQuoteResponse = quoteTok ? getQuote(buildQuoteRequest(quoteTok)).catch(null)
                                   : null              # undefined quoteTok → no bridge-fee quote
    walletPathHints  = ({toChainId} ∪ balanceChains ∪ sourceChains)
                         .map(c → resolveWalletPath(chainSupports7702(c)))     # → {Arb:eph, Base:eph}

  # ── Step 2: route ─────────────────────────────────  emit {status:route_ready}        (§5)
  route = determineSwapRoute(input, {…pf}):
    gate(Base)                              # getChainByID ok ∧ swapSupported ≠ false   (else throw)
    cot = resolveCOT(Base)                  # → USDC
    needTokenSwap = (toToken ≠ cot)         # → true (WETH ≠ USDC) ⇒ a destination token swap
    holdings = balances − dstChain.toToken  # toAmountRaw>0 ⇒ drop Base-WETH → {0.5 WETH @ Arb}
    provider = resolveBridgeProviderDecision(dstCOT, roughBridgedPrefix)  # → 'nexus' (under threshold)  (§5)
    inputAmount.max = dstInput + min(DST_BUFFER_PCT·dstInput, DST_BUFFER_MAX_USD)    # +min(10%,$2)
    outputRequired  = max     + min(SRC_BUFFER_PCT·max,     SRC_BUFFER_MAX_USD)      # +min(2%,$1)
    buffer.amount   = outputRequired − dstInput
    source = autoSelectSources(holdings, outputRequired)             # → [WETH→USDC @ Arb]   (§6)
    bridge = (sourceChain ≠ Base) ? buildBridge(…) : null            # → bridge; collection fee = 0
             # require bridgeQuoteResponse else throw "bridge fee quote unavailable"
    dst.tokenSwap = determineDestinationSwaps(cot→WETH, receiver=EOA, taker=executor)         # (§6)
    paths = resolveWalletDecisions({sourceChainIds, walletPathHints})  # → {Arb:'ephemeral'}  ◄ seam
    dst.getDstSwap = frozen at inputAmount.max          # requote ≤ max; never creeps  (§5)

  # ── Step 3: intent ──────────────────────  emit {plan_preview}, {status:awaiting_approval}  (§8)
  intent = createSwapIntent(route, input, chainList)    # dst amount from toAmount; bridge fees set

  # ── Step 4: approval ──────────────────────────────  emit {status:approved}
  onIntent({intent, allow, deny, refresh})
    allow()                                 # deny()→throw (no cleanup); refresh()→re-route+re-preview

  # ── Step 5: plan + prepare ────────────────  emit {plan_confirmed}, {status:executing}      (§8)
  plan = createSwapPlan(route)              # ids: source_swap:Arb, bridge_intent_submission,
                                            #      bridge_deposit:Arb, bridge_fill:Base,
                                            #      destination_swap:Base   (no eoa_to_ephemeral —
                                            #      funding is the swap output / ephemeralBalance)
  prepared = prepareSwapExecution(route)    # source auth LAZY (permit, sig=null);
                                            # destination auth EAGER (signs permit)

  # ── Step 6: source swaps ──────────────────────────  (§9)
  assets = executeSourceSwaps(route.source, ctx, meta)
    path(Arb)='ephemeral' → SBC [permit?, transferFrom, approve, swap]      # native-first
    → returns [{Arb, ephemeralBalance: COT}];  meta.src = [{chid, tx_hash}]

  # ── Step 7: bridge ────────────────────────────────  (§9)
  executeSwapBridge(route.bridge, assets, ctx, meta)     # bridges EXECUTED assets, not estimate
    recipient = (dst 7702 ∧ hasDstSwap) ? ephemeralWrapper : predictedSafe        # → ephemeralWrapper
    createRequestFromIntent → submitRFFToMiddleware → depositSBC[approve, deposit] → waitForFill
    meta.intent_request_hash set; meta.has_xcs = true

  # ── Step 8: destination swap ──────────────────────  (§9)
  executeDestinationSwap(route.destination, dstTokenInfo, ctx, meta)
    tokenSwap ≠ null → path(Base)='ephemeral' → SBC [permit, transferFrom, approve, swap, transfer(leftover COT → EOA)?]
    → WETH delivered to EOA;  meta.dst = {chid, tx_hash, swaps[]}

  # ── Step 9: result ────────────────────────────────  emit {status:completed}
  return {sourceSwaps, intentExplorerUrl: `${base}/rff/${meta.intent_request_hash}`}
  # any execution failure → best-effort cleanup sweep from the ephemeral (§11); {completed} NOT emitted
```

---

## 4. Worked run B — EXACT_IN, cross‑chain, Safe source + ephemeral destination

> **Scenario (illustrative amounts; decisions are exact).** Spend **1 WETH on Arbitrum (42161,
> non‑7702 → Safe)**, receive **USDC on Base (8453, 7702)**. COT = USDC. Exercises liquidation, a
> destination that **is** COT, and the **Safe path as a first‑class execution path**. Grounded in
> `route.test.ts` (`EXACT_IN liquidates …`, `… routes source-swap recipient on non-7702 chains to
> the predicted Safe address`, `EXACT_IN dst quote spends the full cotAvailable (no source buffer) …`),
> `execution/bridge.test.ts` (Safe deposit batch), `execution/destination-swap.test.ts` (COT
> no‑op), and `safe-dispatch.test.ts`.

```text
swap(input = {mode: EXACT_IN, data:{sources:[{Arb, WETH}], toChainId:Base, toTokenAddress:USDC_BASE}}, …):

  # ── Step 1: preflight ──
  pf.walletPathHints = {Arb:'safe' (supports7702=false), Base:'ephemeral'}

  # ── Step 2: route = determineSwapRoute(input, {…pf}) ──                                   (§5)
  gate(Base);  cot = USDC
  needTokenSwap = (USDC_BASE ≠ cot)        # → FALSE: toToken IS the Base COT ⇒ no dst token swap
  holdings = resolveSources([{Arb, WETH}]) # amountRaw absent ⇒ full balance
                                           # (requested > balance ⇒ throw "Insufficient balance")
  tryBuildSameTokenBridgeRoute → null      # WETH has no currencyId (non-mesh) ⇒ COT flow            (§5)
  provider = resolveBridgeProviderDecision(dstCOT, {Arb WETH USD})  # → 'nexus' (under threshold)    (§5)
  # quote-address resolution — the seam, pre-execution:
  quote.userAddress = quote.recipientAddress = predictedSafe(Arb)   # because path=safe (else eph)  ◄ seam
  source = liquidateInputHoldings(holdings)  # WETH non-COT → quote WETH→USDC @ Arb (COT skipped)  (§6)
  # no source buffer — a failed source leg re-quotes and proceeds (no drift guard)
  dstQuoteInput = cotAvailable  # full; Seam 2 re-sizes the dst swap to the actual delivered COT (both ways), floor 0
  bridge = buildBridge(…)                   # Arb→Base; swap-produced COT → ephemeralBalance
                                            # (EXACT_IN excludes dst-chain source-swap COT from totals)
  dst.tokenSwap = null                      # destination IS COT → bridge delivers USDC directly
  paths = resolveWalletDecisions(…)         # → {Arb:'safe'}                                  ◄ seam

  # ── Step 3: intent ──  EXACT_IN, no dst swap → dst amount = human dst input directly
  # ── Step 4: approval ──  allow()
  # ── Step 5: plan ──  [source_swap:Arb, bridge_intent_submission, bridge_deposit:Arb, bridge_fill:Base]
  #                     (no destination_swap step — destination is COT)

  # ── Step 6: source swaps ──                                                                (§9)
  assets = executeSourceSwaps(route.source):
    calls = [permit|approve, transferFrom](eoa→Safe) ++ [approve(router), swap]  # WETH non-COT → EOA→Safe funds the Safe
    path(Arb)='safe' → dispatchSafeSource(calls):       # NOT an SBC — the seam flips dispatch only
      ensureSafe()                                      # skip if getCode shows already deployed
      sponsor (non-native) → middleware.createSafeExecuteTx        # no EOA tx
      native               → eoaWallet.sendTransaction(execTransaction, value=nativeValue)
                                                        #   refuse single-call value mismatch
      SafeTx EIP-712-signed by the ephemeral owner
    → swap-output COT lands at the Safe (the quote receiver)

  # ── Step 7: bridge ──                                                                      (§9)
  executeSwapBridge(route.bridge, assets):
    path(Arb)='safe' → deposit via Safe (createSafeExecuteTx), 3-step batch:
      1 transfer(ephemeral, depositValue)               # Safe → ephemeral
      2 permit(ephemeral → vault, depositValue)         # EIP-2612
      3 vault.deposit(…)                                # no sweep — Seam 1 bridges the Safe's full COT balance
    recipient = EOA                          # dst 7702 ∧ no dst swap (COT) ⇒ deliver to EOA
    RFF + waitForFill;  has_xcs = true

  # ── Step 8: destination swap ──  tokenSwap == null → NO-OP                                  (§9)
  #   bridge fill already delivered USDC to the EOA: no SBC/Safe tx, meta.dst stays null, no progress
  # ── Step 9: result ──  emit {status:completed}
```

---

## 5. Routing reference (`determineSwapRoute`)

Routing ownership is intentionally explicit:

- `src/swap/route.ts` is the stable facade: validate, dispatch by mode, log the final route, and
  preserve existing exports.
- `src/swap/routing/exact-in.ts` and `exact-out.ts` own the distinct forward and backward amount
  algorithms as named phases.
- `holdings.ts`, `addresses.ts`, `bridge.ts`, `fast-paths.ts`, and `prices.ts` contain shared routing
  mechanics.

Exact In and Exact Out are not one configurable pipeline. They share mechanics and vocabulary, but
their amount propagation and requote policies remain mode-owned.

`RouteOptions = { aggregators, bridgeQuoteResponse, chainList, cotCurrencyId, middlewareClient,
publicClientList, oraclePrices, dstTokenInfo, eoaAddress, ephemeralAddress, balances,
walletPathHints, quoteAddressHints? }`. Returned `SwapRoute`:

```text
{ type, source:{swaps[], creationTime, srcBuffer, cotByChain?},
  bridge: null | {amount, amounts:{tokenAmount,gasInCot,totalAmount}, assets[], chainID,
                  decimals, tokenAddress, estimatedFees},
  destination:{chainId, eoaToEphemeral, inputAmount:{min,max}, swap:{tokenSwap,gasSwap}, getDstSwap()},
  buffer:{amount}, dstTokenInfo,
  extras:{aggregators,oraclePrices,balances,assetsUsed,
          directDestination?:{dstHoldings,toAmountRaw,toNativeAmountRaw}},
  sourceExecutionPaths: Map<chainId, WalletPath> }
```

```text
determineSwapRoute(input, opts) -> SwapRoute:
  gate: chain = getChainByID(toChainId)               # unknown → rethrow lookup error
        require chain.swapSupported ≠ false            # else throw "does not support swap"
  if forceMayan: assertMayanSupportedDestination(dstCOT)   # fail fast before any planning work

  # ── EXACT_OUT ──
  if EXACT_OUT:
    holdings = balances filtered by `sources` allowlist (if given)
    if toAmountRaw > 0:    drop dstChain.toToken from holdings        # always (even if = COT)
    if toAmountRaw < 0:    keep dstChain.toToken, reserve abs(value)  # only surplus is usable
    if toNativeAmountRaw:  exclude dstChain native + toToken; gas → 0 # negative ⇒ reserve dst native exactly
    fastPathClass = !skipFastPaths
      ? classifyFastPath(holdings,                                   # canonical filtered source population
          allowDirectDestination = toAmountRaw >= 0 ∧ (toNativeAmountRaw ?? 0) >= 0)
      : null
    if fastPathClass == direct:                                      # all holdings on destination
      buildDirectDestinationExactOutRoute                            # authoritative full-source shape
      success → return; quote/value failure → propagate              # no pricing gate or fallback ladder
    if fastPathClass == same-token-out(F):                           # holdings + destination share F
      buildSameTokenBridgeExactOutRoute(F)                           # authoritative direct bridge
      success → return; quote/value/provider failure → propagate     # no pricing gate or fallback ladder
    cot = resolveCOT(toChainId, chainList, cotCurrencyId)
    needTokenSwap   = (toToken ≠ cot)
    prices = route-scoped keyed promises                            # chainId + normalized token address
      oracle → balance-implied (value / amount) → provider API
      non-Citrea provider fallback = RACE(LiFi token, Relay token-price)
      Citrea provider fallback = transport-owned graph.fibrous.finance token fetch
        (native normalized to ZERO_ADDRESS; direct provider request, not a middleware proxy)
      provider wait is bounded; missing price remains unknown, never a false-negative gate
    # Path A gets the first attempt, before any COT→toToken sizing quote:
    directRequiredUsd = toAmount × toTokenPrice + nativeAmount × nativePrice
    directCapacityUsd = Σ(dstHolding.amount × cachedPrice)
    if needTokenSwap ∧ dstHoldings non-empty ∧
       (required/capacity unknown ∨ directCapacityUsd ≥ directRequiredUsd):
      try buildDirectDestinationExactOutRoute                       # authoritative quotes/coverage
      success → return immediately                                  # no destination requirement quote
    inputAmount     = tokenSwapInput + gasSwapInput                   # COT the dst wrapper must receive
    RES = selectRoughEligibleSources(holdings, inputAmount)           # computed exactly once
    # ── Remaining fast paths (skipped on the B2 re-entry) ── unless options.skipFastPaths:
    #   Classify remaining routes over RES — a rough priority-ordered prefix that covers inputAmount
    #   (selectRoughEligibleSources, KEEPS dst members — biased toward Path A firing).
    #   Ladder B1 → B2 after the early Path-A attempt; a builder that throws/returns null falls through
    #   (tryFastPath, silent debug log), and the default flow continues inline.
    #   If RES classifies as Path A here, reclassify the same snapshot with A disabled: A was already
    #   attempted (or rejected by its loose USD gate) before destination requirement quoting.
    #   Path A:
    #     buildDirectDestinationExactOutRoute selects input→toToken directly on the dst chain (two-pass
    #     token→gas, §12.1), receiver = EOA. Each pass targets the ORIGINAL raw request exactly;
    #     bridge = null, dst.swap = null, directDestination = true, srcBuffer = null, buffer = 0.
    #     Persist the already filtered dstHoldings + exact raw targets for execution-time
    #     re-sizing. STRICT-ALL: either pass short ⇒ throw. The full-holdings terminal branch
    #     propagates; an opportunistic attempt lets B1/B2 continue after fallback.
    #   B1 'same-token-out': every RES member ∧ the dst token share one family F (including cot), at
    #     least one RES member is remote, no gas
    #     ⇒ buildSameTokenBridgeExactOutRoute: gross the target up through an F-denominated fee quote
    #     (gross = (toAmount + fulfilment)/(1 − bps); current cot reuses the preflight quote), fund greedily
    #     split over remote family holdings (native keeps a per-chain gas reserve). Delivered == toAmount
    #     exactly, bridge EOA→EOA, no swaps. Uniform full holdings use the terminal branch above;
    #     RES-derived B1 failures (Mayan undershoot / short holdings / no F-quote) fall back.
    #   B2 'dynamic-cot': every RES member shares a STABLE family F (USDC/USDT) ≠ dstFamily ∧ ≠ cot, F
    #     resolves as a COT on dst ⇒ buildDynamicCotExactOutRoute re-enters _exactOutRoute with
    #     {cotCurrencyId: F, bridgeQuoteResponse: fQuote, skipFastPaths: true, data.sources = family-F
    #     holdings (allowlist)} → zero source swaps, bridge F, F→toToken dst swap (+ F-denominated gas swap).
    #     Null F-quote / insufficient F ⇒ fall back to the USDC COT flow.
    provider, minOutputUsdPerSource = resolveBridgeProviderDecision(  # ← AFTER fast-path attempts
                        dstCOT, RES.filter(non-dst))                   # same immutable RES snapshot
    inputAmount.max = inputAmount + min(DST_BUFFER_PCT·in, DST_BUFFER_MAX_USD)
    outputRequired  = max         + min(SRC_BUFFER_PCT·max, SRC_BUFFER_MAX_USD)
    source = autoSelectSources(holdings, outputRequired, minOutputUsdPerSource)   # §6 (floor drops sub-$1.10 chains)

  # ── EXACT_IN ──
  if EXACT_IN:
    rawHoldings = resolveSources(sources)   # amountRaw absent ⇒ full balance; requested > balance ⇒ throw
    cot = resolveCOT(toChainId, chainList, cotCurrencyId)
    # ── Path A: direct destination swap (fast-path, gated FIRST) ── unless options.skipFastPaths:
    #   classifyFastPath(rawHoldings) == 'direct' iff EVERY source is already on toChainId ∧ toToken ≠ cot.
    #   Then buildDirectDestinationExactInRoute: each non-identity holding is swapped input→toToken
    #   directly on the dst chain (liquidateInputHoldings with outputToken = toToken), receiver = EOA;
    #   holdings that already ARE toToken pass through untouched. bridge = null, dst.swap = null,
    #   directDestination = true, srcBuffer = null, buffer = 0, inputAmount{min,max} = Σ delivered
    #   (swapped outputs + identity holdings). STRICT-ALL: any leg that fails to quote ⇒ throw ⇒ the
    #   tryFastPath envelope falls back to the same-token / COT flow below (silent, debug-logged).
    #   Gated before same-token so a same-family-on-dst set (e.g. [WETH@Base] → native ETH@Base)
    #   direct-quotes instead of mis-bridging. B2 (dynamic COT) gates AFTER same-token — see §5 ladder.
    # ── same-token direct bridge (fast-path) ── await tryBuildSameTokenBridgeRoute(rawHoldings):
    #   dstFamily = resolveCurrencyId(toToken); fires iff dstFamily set ∧ ≠ cot ∧ EVERY holding is that family.
    #   ERC-20 AND native both supported (native normalized EADDRESS→ZERO). Bridges the token directly
    #   EOA→EOA: source.swaps=[], dst.swap=null, srcBuffer=0, buffer=0; dst-chain holdings stay at the EOA.
    #   Resolves its OWN provider on the same-token (native dst ⇒ nexus); enrichMayanBridge only when mayan.
    #   USDC dst excluded (USDC IS cot). Mixed-family / non-mesh ⇒ fall through to the COT flow below.
    # ── B2 dynamic COT (fast-path, AFTER same-token) ── if classifyFastPath(rawHoldings) == 'dynamic-cot':
    #   every source shares a STABLE family F (USDC/USDT; ETH excluded) ≠ dstFamily ∧ ≠ cot, F resolves as a
    #   COT on dst. buildDynamicCotExactInRoute re-enters THIS flow with {cotCurrencyId: F, bridgeQuoteResponse:
    #   fQuote (F-denominated, mid-route), skipFastPaths: true} → sources ARE the COT ⇒ zero source swaps,
    #   bridge F, one F→toToken dst swap. settlementCurrencyId = F by construction. Null F-quote / insufficient
    #   F ⇒ fall through to the USDC COT flow below. (EXACT_OUT twin gates over RES + a family-F allowlist, §5.)
    provider, minOutputUsdPerSource = resolveBridgeProviderDecision(  # COT-route pick, on remote-holding USD
                        dstCOT, rawHoldings.filter(non-dst))
    holdings = rawHoldings
    if provider == 'mayan':                                          # Nexus skips the floor entirely
      holdings = dropSubFloorMayanChains(rawHoldings)                # drop chains whose SELECTED USD < floor
      if holdings empty: throw "Mayan bridge requires ≥ $MAYAN_MIN_USD_PER_LEG per source …"
    source        = liquidateInputHoldings(holdings)                 # §6 (COT holdings skipped)
    # no source buffer: source.srcBuffer = null (a failed leg re-quotes and proceeds, no drift guard)
    dstQuoteInput = cotAvailable            # full; dst-swap floor (inputAmount.min) = 0 — Seam 2 tracks actuals
    buffer.amount = 0                        # EXACT_IN has no buffer (no source, no dst)

  # ── bridge ──
  bridge = (all source COT on toChainId) ? null : buildBridge(…, provider)
           # cross-chain requires bridgeQuoteResponse else throw "bridge fee quote unavailable"
           # collection fee = 0 (smart-account model); coalesce same-chain assets
           # bridge funding → ephemeralBalance;  direct COT → eoaBalance
           # dstChain COT deducted → destination.eoaToEphemeral{amount,contractAddress}
           # toNativeAmountRaw ⇒ gas swap sized off its COT input: tokenAmount + gasInCot == totalAmount
  if provider == 'mayan': bridge = await enrichMayanBridge(bridge)   # fetch per-source quotes + validate (guard at call site)

  # ── destination swap ──
  if needTokenSwap:
    dst.tokenSwap = determineDestinationSwaps(cot→toToken, receiver=EOA)   # §6
    require dst.tokenSwap ≠ null else throw "destination swap quote …"     # fail loud
  else:
    dst.tokenSwap = null                                                   # destination IS COT

  # direct EOA COT on the dst chain → destination.eoaToEphemeral, moved EOA→executor before the dst swap.
  #   Set whenever (needTokenSwap ∨ needGasSwap) ∧ dstChainDirectCot>0, for BOTH wrappers (Safe &
  #   ephemeral). Same-chain COT-input swaps and gas-only funding depend on this — there's no bridge
  #   to deliver the COT.
  paths = resolveWalletDecisions({sourceChainIds, walletPathHints})        # ◄ seam (default ephemeral)
  return { type, source, bridge, destination:{…, getDstSwap}, buffer, dstTokenInfo, extras, paths }

# resolveBridgeProviderDecision(dstTokenToCheck, roughSources) -> {provider, minOutputUsdPerSource?}:
#   Asks middleware.getBridgeProvider — which owns the USD threshold + dst mayanEnabled checks — about
#   the token that ACTUALLY crosses chains and how much. The request amount = the bridged USD expressed
#   as raw dstTokenToCheck units (NOT an extra dstCOT quantity):
#     COT routes → dstTokenToCheck = dstCOT;  USD = Σ of the remote (non-dst) holdings that bridge —
#                  EXACT_IN: the SELECTED holdings;  EXACT_OUT: remote members of the one RES snapshot
#     fast path  → dstTokenToCheck = the same-token;  amount = its bridged raw  (native ⇒ skip call, force 'nexus')
#   A server 'mayan' downgrades → 'nexus' if any bridged source chain/token is itself mayan-disabled.
#   forceMayan bypasses the server call AND the downgrade (pins 'mayan'). A surviving 'mayan' sets
#   minOutputUsdPerSource = MAYAN_MIN_USD_PER_LEG (else undefined ⇒ the per-chain / autoSelect floors no-op).

# getDstSwap() requote guards (execution-time, frozen bounds):
#   EXACT_OUT: require (tokenInput + gasInput) ≤ originalBufferedMax   # max pinned, never creeps; accepted requote moves `min`
#   EXACT_IN:  no guard — the requote is accepted whatever it returns (no rate tolerance)
```

Balance→holding conversion uses `parseUnits` precision (no `Number()` rounding). `cotByChain`
carries route‑resolved COT metadata into execution. `extras.assetsUsed` amounts are normalized to
human strings (falls back to balance metadata for tokens absent from the deployment list).

**`calculateMaxForSwap` haircut denomination.** The max‑amount safety haircut (`max(3%, $3)`) is kept
in USD space. When a destination token swap exists, it applies in COT space and scales to the output
token via the swap's own ratio (unchanged). When there is **no** destination swap,
`destination.inputAmount.max` is denominated in the *destination token itself* — USDC for the default
COT‑dst flow, but the toToken / family token for the fast paths — so the `$3` floor is converted to
token units at that token's price (quote‑implied from the source swaps, else its oracle price; neither
⇒ pct‑only), never subtracted as a bare `3`. For a USDC destination this is byte‑identical to the old
`delivered − max(3%, $3)`. Pinned by `tests/swap/max.test.ts`.

---

## 6. Selection & destination algorithms

```text
autoSelectSources(holdings, outputRequired, minOutputUsdPerSource?, outputToken?) -> {quoteResponses, usedCOTs}:  # EXACT_OUT
  # outputToken (Path A): select toward a FIXED dst token on EVERY chain instead of the per-chain COT —
  #   holdings already in it are identities (used directly, no aggregator call); all quotes/convergence
  #   target it; maxConvergenceExtraRaw caps convergence input growth in its raw units (≈$0.50 via oracle,
  #   default 0.5 whole tokens). Absent ⇒ the default per-chain COT selection.
  if outputRequired == 0: return empty
  if minOutputUsdPerSource (Mayan):                     # per-chain floor, summed COT+non-COT per chainID
    drop every chain whose Σ USD < minOutputUsdPerSource         # sub-$1.10 legs Mayan won't quote
  use COT holdings directly (usedCOTs)                  # COT-first: no aggregator call
  if COT covers outputRequired: return
  rank non-COT holdings by USD value (desc)
  prefix = smallest set whose Σvalue ≥ outputRequired × PREFIX_HEADROOM (1.25)   # dust beyond prefix is never quoted
  for holding in prefix (then extend if realized output is short):
    q = RACE (firstSuccess): EXACT_OUT direct quote (precise input)
        vs EXACT_IN convergence (observed required/output correction × SAFETY_MULTIPLIER;
                                 no-quote fallback grows geometrically;
                                 cap initial + MAX_CONVERGENCE_EXTRA_COT)
        # first non-null settlement wins — the 0.5% margin keeps convergence near the EXACT_OUT input
          if minOutputUsdPerSource: lift the leg's target to ≥ minOutputUsdPerSource + chainFee  # no sub-floor partial
          both candidates null → throw "… converge …"
    quoteResponses += q
  if minOutputUsdPerSource ∧ still short ∧ chains were dropped → throw "Mayan bridge requires ≥ $X per source …"

liquidateInputHoldings(holdings, outputToken?) -> QuoteResponse[]:  # EXACT_IN
  target = outputToken ?? each chain's COT                         # Path A passes toToken; default = COT
  for h in holdings:
    if h is target: skip                                          # identity (COT, or toToken on Path A) → direct transfer
    else: q = quote(h → target, EXACT_IN); if q: emit q           # null quotes filtered
  # recipientAddressByChain threaded into every quote request (Path A ⇒ receiver = EOA on the dst chain)

determineDestinationSwaps(cot → toToken, receiver=EOA, taker=executor) -> QuoteResponse | null:
  if toToken == cot: return null                                  # no aggregator call
  return RACE (firstSuccess): EXACT_OUT direct
         vs convergence(cached USD-price seed when both token prices resolve;
                        otherwise indicative reverse seed;
                        unusable result / correction beyond the price-seed cap falls back to reverse;
                        observed under-delivery ratio × SAFETY_MULTIPLIER, round UP;
                        cap seed + MAX_CONVERGENCE_EXTRA_COT)
         # first non-null settlement wins → null only when both can't converge

destinationSwapWithExactIn(cot → outToken, EXACT_IN) -> QuoteResponse | null    # a single quote
destinationGasSwapExactIn(cot → EADDRESS, EXACT_IN, input=gasAmountInCotRaw)     # native gas, receiver=EOA
```

---

## 7. Aggregators

```text
aggregateAggregators(requests, aggregators, mode):
  per request: selectForChain picks ≤ 2 aggregators by TIER (supportsChain static lists):
    TIER_1 = [Relay, Bebop, Fibrous, Mystic]; TIER_2 = [0x, LiFi]      # priority = array order
    tier-1 supporters first, top up from tier 2 to reach 2 (Citrea → Fibrous + Mystic, both tier-1); a lone supporter runs alone
    a lone 0x/Mystic pick is KEPT — with no sibling, aggregateAggregators enriches it from a token endpoint (below)
    NO adapter claims the chain → full fan-out fallback (gated adapters null locally; only Relay,
      deliberately ungated in fetchQuote, probes live)
  round 1 quotes the PRIMARY selection; if every primary adapter returns null/error for a request, a
    round 2 FALLBACK quotes the REMAINING supporters (next ≤ 2 by tier)
  each aggregator receives ONLY its selected requests (the network-call reduction); results scatter
  back into the full matrix, then per request pick the best non-null quote among the selected:
    MaximizeOutput → max output.amountRaw   (tie → first aggregator)
    MinimizeInput  → min input.amountRaw
  a throwing aggregator is skipped; all-throw / all-null → {quote:null, aggregator:first}
  then ENRICH the winner (backfillFromSiblings first, then a token endpoint if needed):
    priceUsd missing on a leg → value = amount × sibling.priceUsd     # fixes 0x/Mystic AND Bebop value=0
    0x/Mystic winner (no decimals/symbol) → borrow sibling.decimals (exact) + symbol, recompute amount;
      NO sibling → token endpoint: 0x → LiFi /v1/token (decimals+symbol+USD price), Mystic → its own
      /v1/tokens/resolve (decimals+symbol, no price → value 0); DROP only if that too yields no decimals

createAggregators(mw) → [LiFi, Bebop, Fibrous, 0x, Mystic, Relay]
```

All adapters map a middleware response to a `Quote`, return `null` on throw/timeout, short‑circuit
unsupported chains **without firing a request**, and send **no API‑key headers** (the proxy handles
auth). Executable quotes use the **slippage-protected** output amount. Source-selection candidates
are requested as executable quotes from the outset so a fully consumed holding reuses one quote.
Fibrous price surveys are reserved for indicative convergence seeds: they use the lighter `/v2/route`
response, apply the configured slippage floor to `outputAmount` locally, and never enter execution;
serious Fibrous requests use `/v2/routeAndCallData`.
LiFi/Bebop surface a per-token `priceUsd`;
**0x and Mystic report amounts + tx only (no decimals/symbol/price)** — filled from a sibling quote in
`aggregateAggregators`, or, when a leg is only 0x/Mystic, from a token endpoint (0x → LiFi `/v1/token`;
Mystic → its `/v1/tokens/resolve`, no price → value 0); dropped only if neither can supply decimals.

Exact Out routing also gets lightweight token prices without constructing executable quotes. LiFi
`/token` and Relay `/currencies/token/price` race through middleware on non-Citrea chains. Citrea
instead uses a transport-owned direct fetch to `https://graph.fibrous.finance/citrea/tokens/:address`;
this is a different host from the Fibrous quote API (`https://api.fibrous.finance`). Responses are
normalized to a positive decimal value at the transport boundary, then consumed through the
route-scoped keyed-promise cache described in §5.

| Adapter | Output amount | Recipient param | Notable params | Chains / notes |
|---|---|---|---|---|
| **LiFi** | `estimate.toAmountMin` | `toAddress` | `skipSimulation=true`; `denyExchanges='openocean'` (+`fly,hyperflow,liquidswap` on 999); `exactOut=true` for EXACT_OUT | short‑circuits chains it doesn't support (e.g. Citrea/4114); surfaces per‑token `priceUsd` |
| **Bebop** | `route.quote.buyTokens.minimumAmount` | `receiver_address` | `taker_address=userAddress`; `source='arcana'`; EXACT_OUT uses `buy_amounts`; addresses **checksummed** (`getAddress`) | response nests `{tx, approvalTarget, expiry, buyTokens, sellTokens}` under `route.quote`; **picks the best of `routes[]`** (max output / min input), not `routes[0]`; missing `priceUsd` ⇒ `value=0`, backfilled from a sibling |
| **Fibrous** | survey: slippage-floored `outputAmount`; serious: `min_received` | serious: `destination` | survey: `/v2/route`; serious: `/v2/routeAndCallData`; `excludeProtocols='3'` | **EXACT_IN only** (EXACT_OUT → `null`); Citrea 4114; native input (`swap_type===0`) → `approvalAddress=zeroAddress`, `tx.value=amount_in` |
| **0x** | `minBuyAmount` (EXACT_IN) / exact `buyAmount`, input capped at `maxSellAmount` (EXACT_OUT) | `recipient` | allowance‑holder via proxy; survey (`!SERIOUS`) → indicative `/price`, SERIOUS → `/quote` (executable tx); `taker=userAddress`; `slippageBps`; `allowanceTarget` → `approvalAddress` (`zeroAddress` when null/native) | EXACT_IN **and** EXACT_OUT; `liquidityAvailable=false` → `null`; **no decimals/symbol/price** (backfilled from a sibling) |
| **Mystic** | `minBuyAmount` (slippage‑protected floor, like 0x) | `recipient` | two‑step: POST `/v1/swap/quote` then `/v1/swap/build`; `slippageBps`; survey (`!SERIOUS`) skips the simulating build call; native sell → `approvalAddress=zeroAddress` | **EXACT_IN only**; Citrea 4114 only; **no decimals/symbol/price** (backfilled from a sibling, mirrors 0x) |

---

## 8. Intent, bridge intent, plan, prepare

**`createSwapIntent(route, input, chainList)`** — destination amount/value (token‑swap output
semantics; **Path A** (`directDestination`, no dst swap) sums the token‑role source‑swap output USD
values — oracle‑independent, the analog of a dst token‑swap's `output.value`; other no‑swap
destinations, e.g. COT, use `amount × oraclePriceUsd`, else `amount`); reservation
(`toAmountRaw ≤ 0`) → amount & value `"0"`; EXACT_IN w/o dst swap → human dst input directly; gas
from the gas‑swap output; `feesAndBuffer.bridge` set iff a bridge exists; `bridgeProvider` =
`bridge.provider` (`'nexus'`/`'mayan'`) or `null` when there's no bridge.

**`createSwapBridgeIntent`** — one **ephemeral‑backed** source per chain; recipient dynamic;
Ethereum sorted last; copies `bridge.provider`; the five‑field fees map from `bridge.estimatedFees`
(`collection → deposit`, plus `fulfilment/caGas/protocol/solver`); destination amount from
**execution‑time assets** (`executionTokenAmount = totalBridged − collection − fulfilment −
protocol`, throws if negative); **native amount stays 0** (`gasInCot` bridged as COT for the dst gas
swap). When `provider === 'mayan'` it stamps each source with its per‑source `mayanQuote` (looked up
from `bridge.mayanQuotesBySource` by `${chainID}:${address.toLowerCase()}`; throws
`Mayan quote missing for source …` if absent); Nexus leaves `mayanQuote` undefined.

**`createSwapPlan(route, chainList)`** → `{hasBridge, hasDestinationSwap, steps[]}`. Deterministic
step ids; cross‑chain ordering:

```text
source_swap:<chain>            # ascending by chainId
bridge_intent_submission
bridge_deposit:<chain>
eoa_to_ephemeral_transfer:<chain>   # only for assets with eoaBalance>0, grouped before that chain's deposit
bridge_fill:<chain>
destination_swap:<chain>            # only when a dst token OR gas swap exists (COT dst ⇒ omitted)
# No public sweep step, ever.   No-bridge COT-dst route → ['source_swap'] only.
# Path A (directDestination) → ['source_swap'] only: no bridge, no destination_swap (the source swap
#   already delivered toToken to the EOA). EXACT_IN sets the intent's destination amount from
#   inputAmount.min = Σ delivered (in toToken units, since there is no dst swap output to read).
```

**`prepareSwapExecution(route)`** → `{parsedQuotes, eoaToEphemeralTransfers}`:

```text
per transfer (reason: source | destination | bridge):
  target = the executor that runs the swap: predictedSafe on non-7702, ephemeral on 7702
           (source/bridge: per sourceExecutionPaths; destination: per chainSupports7702(dstChain).
            bridge target is the deposit executor; a non-7702 Safe batch then moves Safe→ephemeral
            for RFF funding.)
  if cachedAllowance(eoa→target) ≥ amount:  authorization = null    # skip
  elif permit supported:
    source | bridge → LAZY  {kind:'permit', call:null, signature:null}   # materialized at execution
    destination     → EAGER  signPermitForAddressAndValue(spender=target)
  else: authorization = {kind:'approve'}                            # EOA approve(target), mined before the batch
  transferCall = transferFrom(eoa, target, amount)                  # permit/approve spender == target
# bridge EOA balances converted human → raw
# source, destination, and bridge transfer specs are constructed once, then reused for cache
# queries and the single prepared-transfer build loop. Their order remains source → destination → bridge.

Path A EXACT_OUT exception:
  do not prepare per-leg source transfers                           # execution groups sibling legs by token
  retain every parsed quote
  warm permit capability + allowance state for EVERY persisted non-native dstHolding
                                                                    # a fresh requote may select an initially unused allowed token
```

---

## 9. Execution reference (per stage, per wallet path)

```text
executeSwapRoute(route, ctx) -> SwapMetadata:                  # execution/orchestrator.ts
  source = directDestination EXACT_OUT
    ? executeDirectDestinationExactOut(route, ctx, metadata)
    : executeSourceSwaps(route.source, ctx, metadata)
  if route.bridge: executeSwapBridge(route.bridge, merge(planned, source), ctx, metadata)
  reachedDestinationSwap = true                               # cleanup side switches here
  executeDestinationSwap(route.destination, route.type, ...)
  on failure: cleanup source chains before the switch, destination chain after it; rethrow
  return metadata
```

The direct-destination executor stays dedicated. Ordinary source execution, route-driven bridge
execution, and destination execution remain separate stage implementations; the orchestrator only
owns their ordering, cleanup boundary, and metadata lifetime.

```text
executeDirectDestinationExactOut(route, ctx, meta):
  # selected only for directDestination && EXACT_OUT
  swaps = route.source.swaps
  if route quote age > 45s: re-size BEFORE dispatch from persisted dstHoldings toward the ORIGINAL
                            toAmountRaw/toNativeAmountRaw (executor=taker, EOA=recipient)
  per attempt (at most 3 actual dispatches):
    order native-input legs first, then ERC-20 legs in sizer order
    per ERC-20 token:
      needed = Σ inputRaw across that token's token/gas sibling legs
      calls += [one permit?, one transferFrom(eoa→executor, needed)] before its first leg
      calls += each leg's [approve(router)?, swap]
    dispatchSourceChainBatch(one atomic dst-chain batch); reconcile a known hash; await receipt
    confirmed → meta.src += the confirmed batch and return
    confirmed revert / explicit no-broadcast result → fresh re-size, then retry
    wallet rejection / ambiguous submission or receipt result → terminal; never blindly redispatch
  cached authorization capacity is exact for canonical/Polygon-EMT permits and paid approvals,
  MAX_UINT256 for DAI/Polygon-2612 allowed=true, or the actual pre-existing allowance. A mined paid
  approval is never replayed. Silent per-token growth is capped against the ROUTE-TIME baseline.

executeSourceSwaps(source, ctx, meta) -> BridgeAsset[]:
  for each source chain (serialized — EOA is single-chain):
    path  = ctx.sourceExecutionPaths[chain]            # ◄ resolveWalletDecisions seam
    calls = [permit?, transferFrom(eoa→executor), approve(router), swap]  # ERC-20 leg; native swaps ordered first
                                                       #   funding spender/recipient = executor (Safe | ephemeral)
                                                       #   NATIVE input: skip transferFrom + approve (value rides the batch)
    ephemeral → submitSBCs(buildSBC(calls))
    safe      → dispatchSafeSource(calls)              # sponsor createSafeExecuteTx (non-native)
                                                       # permit unsupported → EOA approve(executor) via
                                                       #   writeContract, mined BEFORE the batch, kept OFF it
                                                       # native input: bootstrap Calibur (empty-calls SBC,
                                                       #   gated on cache.hasAuthCodeSet) then EOA
                                                       #   sendTransaction payable execute (no authList)
  await all receipts                                   # only AFTER every chain is dispatched
  on chain failure: requote that chain ONCE (EXACT_IN; taker=receiver = that chain's executor —
                    EOA for the direct-COT dst chain, predictedSafe on non-7702, else ephemeral)
    # EXACT_OUT: require Σ(output drop) ≤ srcBuffer, pooled across that route's source legs
    #   (directDestination EXACT_OUT never reaches this shared retry; its dedicated executor is above)
    # EXACT_IN:  srcBuffer = null → no guard; accept the re-quote and proceed (Seam 2 re-sizes the dst swap)
    still failing → rethrow                            # no sweep here — cleanup is the orchestrator's job (§11)
  # SEAM 1 (reclaim, when bridge ≠ null): read balanceOf(COT, wrapper) per chain → bridge the ACTUAL
  #   landed COT, not the quote floor (captures positive source slippage; best-effort — on a read
  #   failure fall back to the quote output). wrapper = ephemeral (7702) / predicted-Safe (non-7702).
  return assets    # ACTUAL wrapper COT balances (Seam 1) + route-resolved COT metadata; meta.src = [{chid, tx_hash}]

executeSwapBridge(bridge, executedAssets, ctx, meta):   # bridges the ACTUAL wrapper COT (Seam 1), not the route estimate
  bridgedAssets = executedAssets − dstChain − zero-balance, sorted by chainId asc   # empty ⇒ return
  → executeEphemeralBridgePath(bridge, bridgedAssets, ctx, meta):
      recipient = destinationDirectEoa ? EOA : (dst 7702 ? ephemeralWrapper : predictedSafe)
      if mayan: bridge = refreshMayanQuotesForExecution(bridge, bridgedAssets)   # re-quote per leg at
                #   the FINAL bridged amount — route-time quotes were signed for the ESTIMATE, and a
                #   source re-quote can drift the executed COT. Middleware enforces RFF source.value ==
                #   mayanQuote.effectiveAmountIn; re-quoting here makes them match (and refreshes deadline)
      intent    = createSwapBridgeIntent(bridge, bridgedAssets, recipient)   # carries provider + mayanQuotes

      # ── Mayan (intent.provider == 'mayan') → runMayanEphemeralBridge, then return ──
      per chain (approve-ONLY — NO deposit, NO sweep):
        7702     → SBC  [funding?, approve(vault, total)]
        non-7702 → Safe [funding?, transfer(eph), permit(eph → vault)]   # permit IS the allowance grant
                 submit, then WAIT for it to be MINED      # mw sponsors depositMayan() async the moment the
                                                           #   RFF lands, and fails if the allowance isn't on-chain
      after ALL approves mined:
        createRequestFromIntent → submitRFFToMiddleware(…, mayanQuotes)   # RFF only AFTER approvals
        waitForMayanFill (2 min)                          # middleware-poll only; NO on-chain vault watch

      # ── Nexus ──
      createRequestFromIntent → submitRFFToMiddleware      # RFF FIRST; deposits follow
      for each source chain (EOA serialized, ≤1 op; one deposit per chain):
        native    → EOA payable vault.deposit{value}       # no approve/permit/transfer/sweep
                    # 7702: bootstrap Calibur if !hasAuthCodeSet, then EOA execute; non-7702: Safe execTransaction{value}
        ephemeral → SBC [funding?, approve(vault, total), deposit]   # no sweep — Seam 1 bridges the full balance
        safe      → Safe batch (createSafeExecuteTx; token must be EIP-2612 permit):
                      [funding?] → transfer(eph) → permit(eph → vault) → vault.deposit   # no sweep (Seam 1 full)
        # funding? = prepared EOA→executor [permit, transferFrom], prepended when eoaBalance>0 (fast
        #   path / direct-COT — COT still at the EOA); empty when a source swap funded the executor.
        #   On non-7702 the executor is the Safe, so funds flow EOA→Safe→ephemeral (transfer(eph) above).
        eoaBalance>0 but no prepared bridge-transfer → throw ExecutionError{
            stepType:'eoa_to_ephemeral_transfer', stepId: createEoaToEphemeralTransferStepId(chainId)}
      waitForFill (DEFAULT_FILL_TIMEOUT_MINUTES = 5)        # races middleware-poll + on-chain vault watch
  meta.intent_request_hash set; meta.has_xcs = true

executeDestinationSwap(destination, dstTokenInfo, ctx, meta):
  if tokenSwap == null: return           # destination IS COT — bridge fill already delivered to EOA
                                         # (no tx, meta.dst stays null, no progress emitted)
  # SEAM 2 (reclaim): read balanceOf(COT, dstWrapper) → re-size the dst swap input from the ACTUAL
  #   delivered COT. EXACT_IN re-sizes BOTH ways — grows on surplus (more output), shrinks when a
  #   down-drifted source delivered less (never over-size, floor 0); EXACT_OUT keeps the exact output.
  #   getDstSwap re-quotes with no tolerance guard (EXACT_IN) / within [floor, ceiling] (EXACT_OUT); also on expiry.
  direct EOA COT on the dst chain (destination.eoaToEphemeral) → [permit?, transferFrom](eoa→executor) prepended (BOTH paths)
  path(dstChain):
    ephemeral → SBC [permit?, transferFrom?, approve, swap, transfer(leftover COT → EOA)?]
    safe      → Safe.execTransaction [permit?, transferFrom?, approve, swap, transfer(leftover COT → EOA)?]
  # leftover COT = balanceOf − consumed → ONE direct transfer → EOA (replaces the blind approve+Sweeper
  #   drain), skipped when ≤ 0. Output token lands at the EOA (receiver=EOA) → its dust sweep is skipped;
  #   native output NEVER swept (EADDRESS → approveNative at the Safe → GS013). gas-swap approve+swap ride the same batch
  retry: twice (3 attempts, forced requotes) then rethrow            # no fallback sweep
  meta.dst = {chid, tx_hash, swaps[]}
```

Progress states: `source_swap`/`destination_swap` = `started→submitted→confirmed`;
`eoa_to_ephemeral_transfer` = `wallet_prompted→submitted→confirmed`; plus
`bridge_intent_submission`, `bridge_deposit`, `bridge_fill`.

---

## 10. Wallet primitives & Safe machinery

**SBC / Calibur (`createSBCTxFromCalls`)** → `{chainId, address:<ephemeral>, calls,
revertOnFailure:true, signature, deadline, nonce, keyHash, authorizationList?}`. 32‑byte‑padded
`deadline/nonce/keyHash/calls[].value`; `deadline ≈ now + SBC_DEADLINE_MINUTES (15)`. EIP‑712 domain
`{name:'Calibur', version:'1.0.0', verifyingContract:<ephemeral>, salt:pad(CALIBUR_ADDRESS,32)}`,
primaryType `SignedBatchedCall`, signature recovers to the ephemeral (`executor = zeroAddress`),
ABI‑packed `(bytes signature, bytes hookData='0x')`. Delegation present (`0xef0100…` prefix) → omit
`authorizationList`; else include it (`address = CALIBUR_ADDRESS`, on‑chain `getTransactionCount`
nonce; fields `{address, chainId(32B), nonce, r, s, v}`).

**Ephemeral key** — `deriveEphemeralKey(walletClient, address, domain)` asks the EOA to
`signMessage` a fixed SIWE‑like message (`Sign in to enable Avail Nexus swap … Account:
<lowercased> / Domain: <domain> / Identifier: avail-nexus`) and derives a deterministic
`PrivateKeyAccount`; failure → `ephemeralKeyFailed`. Storage key
`nexus-sdk-v2:ephemeral-signature:<lowercased>:<domain>`. `getPrivateKeyFromEthSignature` (Stark
grind, golden‑parity with `@starkware-industries/starkware-crypto-utils`) depends only on the first
32 bytes (r), output `< STARK_N`, ≤63 hex, throws `expected 130-char hex signature` on bad input.

**`SwapCache`** batches RPC: `addAllowanceQuery`→multicall; `addSetCodeQuery`→`getCode`
(`hasAuthCodeSet` detects `0xef0100`); `addNativeAllowanceQuery`→`nativeAllowance` on the
Calibur‑delegated account; `addPermitQuery`→chain‑list metadata, else a multicall probe. Multicall
failure falls back to `0n` (never throws).

**`createSweeperTxs(token, receiver, chainId, cache?, ephemeralOwner?)`** — the blind drain: ERC20 →
`[approve, sweepERC20]`; native → `[approveNative(→CALIBUR), sweepERC7914(→SWEEPER)]`; a sufficient
cached allowance drops the approve; undefined cache → safe fallback (include approve). Now reserved for
the **failure cleanup** (§11) and the destination fallback when the `balanceOf` read fails.

**`buildRefundSweepCall(token, amount, eoa)`** — the success-path COT return: ONE `erc20.transfer(eoa,
amount)` (native → bare value send). The destination swap returns the *known* leftover COT
(`balanceOf − consumed`) with this instead of the blind `createSweeperTxs` drain — no approve, no
external Sweeper CALL; emitted only when the leftover is > 0.

**EOA dispatch primitives (`eoa-executor`)** — `executeViaEoa` (`wallet_sendCalls` +
`experimental_fallback`, then `waitForCallsStatus`; throws `failed`/`no receipt`), `dispatchViaEoa`
(switch chain, send without waiting), `waitForDispatchedEoaCalls`.

**Safe** — `predictSafeAccountAddress(owner)` → `{address, factoryAddress, initializer}`,
deterministic (owner `0x1111…` → `0x9eAc…5cf9`). **EnsureAuth** EIP‑712 (`NexusSafeEnsure`, domain
`{name:'NexusSafeEnsureAuth', version:'1', chainId, verifyingContract: SAFE_PROXY_FACTORY_ADDRESS}`,
anti‑replay via chainId+deadline). **SafeTx** minimal domain (`chainId` + `verifyingContract` only).
MultiSend packs `op(1)‖to(20)‖value(32)‖dataLen(32)‖data`. `createSafeMiddlewareClient` →
`getSafeAccountAddress` / `ensureSafeAccount` / `createSafeExecuteTx` (POST `/api/v1/*`).
`createSafeClient.ensure()` skips middleware when already deployed; `.execute()` single‑action
(`operation 0`, reverting `nonce()`→0); `.executeBatch()` MultiSendCallOnly **DELEGATECALL**
(`operation 1`). `dispatchSafeSource` ensures the Safe, then sponsor (`createSafeExecuteTx`) or
native EOA‑submit (`execTransaction`, refuses single‑call value mismatch).

---

## 11. Failure cleanup (`cleanupStrandedCot`)

```text
# Caller (swap/execution/orchestrator.ts) decides whether to sweep, what, and where — then reads only that:
resolveFailureSweepCurrencyId(route):                  # → currencyId | null
  directDestination → null                             # Path A: one atomic batch on one chain, no later stage ⇒ nothing strands
  sameTokenBridge ∧ bridge.provider == 'nexus' → null  # deposits the exact amount directly; nothing strands ⇒ skip
  else → route.settlementCurrencyId                     # COT for swap routes; the bridged family for a Mayan same-token
chainIds = reachedDestinationSwap                       # stage flag: COT moved to the dst chain once the dst swap starts,
  ? [route.destination.chainId]                         #   otherwise it sits on the source chains that swapped to COT
  : metadata.src.map(chid)

cleanupStrandedCot({currencyId, chainIds, ctx}):        # ONLY on execution failure, and only when currencyId != null
  for chainId in chainIds:                              # no getBalancesForSwap — one known token, one holder, per chain
    holder = chainSupports7702 ? ephemeral : predictedSafe
    cot    = resolveCOT(chainId, currencyId)
    bal    = isNative(cot) ? getBalance(holder) : cot.balanceOf(holder)   # single targeted read
    if bal > 0: group{chainId, holder, [transfer(cot, bal → eoa)]}        # direct transfer of the read amount
  dispatchSweepGroups(groups)                           # shared w/ init sweep: 7702→SBC, non-7702→Safe execTransaction
  # best-effort; never rethrows / masks the original error. pre-execution failures (deny, routing) never reach here.
```

Source reclaim, destination reclaim/dust inspection, and cleanup all use
`execution/settlement-balance.ts:readSettlementBalanceRaw`; native and ERC-20 settlement reads
therefore share one `getBalance`/`balanceOf` boundary.

---

## 12. Retry & invariant summary

### 12.1 Amount‑pathing & drift graph

How every execution amount is derived and how a drift — a source re‑quote or realized slippage —
propagates. Two execution **seams** re‑read the ACTUAL on‑chain balance and re‑size to it; the
principle is *execution tracks actuals, while route‑time quotes/buffers are conservative floors*.

```text
holding.amountRaw (route)
   │  aggregator @ route → quote.output            # the minReceived FLOOR shown to the user
   ▼
source swap executes ──[attempt-0 dispatch fail]──⟳ requoteFailedChains (ONCE, re-quote @ holding)
   │                       ▣ EXACT_OUT: Σnew ≥ Σold − srcBuffer (POOLED; an over-leg offsets an under-leg)
   │                            else EXTERNAL_RATES_DRIFT_EXCEEDED → abort
   │                          EXACT_IN: no guard — accept the re-quote and proceed
   ▼
SEAM 1  balanceOf(COT, sourceWrapper)              ◄ the COT that ACTUALLY landed (≥ floor: realized slippage)
   │  reclaimFromActualBalance = bridge ≠ null → bridge the ACTUAL, not the quote (best-effort)
   ▼
bridge assets (executed)
   ├──────────────────────────────┬──────────────────────────────────────┐
   ▼                              ▼                                       ▼
RFF source.value = executed       MAYAN: refresh effectiveAmountIn64       NEXUS: destination = Σ(executed) − route-time fees
   = intent.source.amountRaw       = re-quote @ the executed amount          DERIVED (not refreshed) — gives MORE on more input;
   (Nexus deposit = RFF value,      → value == effectiveAmountIn64            the only route-time-frozen term is the FEE
    no signed quote → no mismatch)     (the a4ba539 invariant)
   ▼
bridge fill → COT at dstWrapper
   ▼
SEAM 2  balanceOf(COT, dstWrapper)                 ◄ the COT that ACTUALLY arrived
   │  dst swap re-sized: EXACT_IN tracks the actual balance BOTH ways (grow on surplus → MORE output,
   │  shrink on a short source → no over-size, floor 0); EXACT_OUT keeps the EXACT output.
   │  getDstSwap ⟳ re-quote: EXACT_IN no tolerance guard; EXACT_OUT within [floor, ceiling] (≤3 attempts)
   ▼
leftover = balanceOf − consumed → ONE transfer(→ EOA)   ◄ skipped if ≤ 0 (replaces the blind Sweeper drain)
```

**Path A (directDestination) short‑circuits this graph.** EXACT_OUT selects input→toToken *directly* on
the dst chain in two passes — token toward the original `toAmountRaw`, then gas toward the original
`toNativeAmountRaw` over the REMAINDER of each source (`original − token-pass input`, floor 0). There is
**no output buffer, bridge, or destination swap**: neither Seam fires and both passes land in
`source.swaps`, one atomic batch delivering the exact requested token and native amounts to the EOA.
The route persists the post-allowlist `dstHoldings` universe and both raw targets; it does not reconstruct
them from global balances or from prior leg outputs.

Execution belongs to `executeDirectDestinationExactOut`, not the shared multi-chain source retry. A
route older than 45 seconds is re-sized before its first dispatch. A confirmed atomic revert (or an
explicit provider result proving no broadcast) re-runs the same two-pass sizer, then may retry, for at
most three actual dispatches. Quote/sizing failure consumes no dispatch slot and is reported as
`EXTERNAL_RATES_DRIFT_EXCEEDED` with the selected aggregator service. A known hash is reconciled; an
ambiguous submission/receipt outcome is terminal, and wallet rejection never re-prompts. ERC-20 inputs
are grouped by token: one authorization plus one summed `transferFrom` precedes that token's ordered
`[approve?, swap]` legs. Silent input growth is compared to the **route-time** per-token sum (never the
previous attempt) and capped at `min(2%, $1)` in input units; a newly selected silent token therefore
starts at zero. Growth requiring a fresh permit/approval remains user-consented. EXACT_IN Path A is
unchanged: no buffer and no gas pass, with `inputAmount.min = Σ delivered`.

**The asymmetry that made Mayan special.** Source drift is tolerated everywhere by a buffer/range or
absorbed by re‑derivation — *except* the Mayan per‑leg `effectiveAmountIn64`, the one EXACT, per‑leg,
signed value with no buffer. A drift that's harmless elsewhere (even an UPWARD drift the pooled source
guard waves through) breaks `value == effectiveAmountIn64`, so only Mayan needs the execution‑time
re‑quote (`refreshMayanQuotesForExecution`). Nexus needs none: its destination is `Σ(executed) − fees`,
a formula over the (already‑updated) inputs, so it tracks them automatically.

### 12.2 Invariants

- **Buffers applied once.** The default EXACT_OUT swap path has a dst buffer `min(10%, $2)` +
  source buffer `min(2%, $1)`;
  EXACT_IN has **no buffer** (no source buffer, no dst buffer). (Values: `DST_BUFFER_PCT`/`DST_BUFFER_MAX_USD`,
  `SRC_BUFFER_PCT`/`SRC_BUFFER_MAX_USD` —
  pinned in `tests/swap/constants.test.ts`.) `getDstSwap` never lets the EXACT_OUT max ceiling
  creep upward. **`route.buffer.amount`** (→ intent `feesAndBuffer.buffer`) carries the whole
  buffer in COT units: EXACT_OUT `outputRequired − dstInput` (dst + source combined); `0` on EXACT_IN
  and on the same-token direct bridge (no swap buffer to defend).
- **Same-token direct bridge skips swaps AND buffers** (EXACT_IN). When every source is the same
  non-COT bridgeable mesh family as the destination token — **ERC-20 or native** (native normalized
  EADDRESS→ZERO) — the route bridges the token directly EOA→EOA: no source/destination swap,
  `srcBuffer`/`buffer` = 0 (no slippage to defend — the only deduction is the bridge fee, taken from
  `bridgeQuoteResponse` and scaled to the token's decimals). USDC dst is excluded (already the COT);
  mixed-family / non-mesh inputs fall back to the COT flow. The fast path resolves its **own**
  provider on the same-token (native dst ⇒ `nexus`) and calls `enrichMayanBridge` when that pick is
  Mayan, so it can route Mayan, not just Nexus.
- **Same-token direct bridge, EXACT_OUT mirror (B1).** The EXACT_OUT twin bridges the family token F,
  including the current COT family, directly EOA→EOA too when at least one source is remote
  (`sameTokenBridge: true`,
  `settlementCurrencyId = F`, `swaps: []`,
  `srcBuffer`/`buffer` = 0), but sizes by **grossing the exact target up through the fee** so the
  delivered amount is exactly `toAmount`: `gross = (toAmount + fulfilment) / (1 − fulfillmentBps/1e4)`.
  The fee quote is **F-denominated**: the current COT reuses its preflight quote, while a non-COT F is
  fetched mid-route (`fetchBridgeQuoteForCurrency`) rather than using a mismatched COT quote. Funding
  is a **greedy split** over priority-ordered remote family holdings (`use = min(available, remaining)`); ERC-20 and
  **native** F both supported (native holdings keep a per-chain gas reserve via
  `estimateRepresentativeSwapNativeReserveFee` so the deposit can pay its own gas — never 100% native).
  `filterExactOutBalances` drops the dst-chain F (= toToken), so funding is all-remote. Provider/enrich
  is shared with EXACT_IN (`finalizeSameTokenBridge`); Mayan is allowed but, since it prices per leg and
  can undershoot the exact target (no convergence loop in v1), a `Σ minReceived < toAmount` check
  throws. When the full filtered holdings and destination share F, B1 runs before COT
  settlement/pricing and is terminal: builder failures propagate. RES-derived B1 remains
  opportunistic and falls back to the COT flow. **Positive gas requests are disqualified in v1**;
  the future path delivers gas via the RFF's native amount, which `createSwapBridgeIntent` pins to 0
  today.
- **Direct destination (Path A) skips the bridge AND buffers** (EXACT_IN). When every source is
  already on the destination chain and `toToken ≠ cot`, the route swaps each source input→toToken
  directly on that chain (receiver = EOA) — no bridge, no destination swap, `directDestination = true`,
  `srcBuffer = null`, `buffer = 0`. Holdings already equal to toToken pass through untouched;
  `inputAmount.min = inputAmount.max = Σ delivered` (swapped outputs + those identity holdings), in
  toToken units. STRICT-ALL: any leg that can't quote makes the builder throw and the fast-path
  envelope falls back to the same-token / COT flow. The whole route is one atomic per-chain batch
  (`revertOnFailure`), so the failure sweep is skipped (§11).
- **Direct destination (Path A) EXACT_OUT delivers exact outputs with a dedicated executor.** The
  EXACT_OUT twin swaps input→toToken directly on the dst chain (`directDestination = true`,
  `bridge = null`, `dst.swap = null`, receiver = EOA), with token and optional gas passes targeting
  the original raw requests exactly. Its route has `srcBuffer = null` and
  `route.buffer.amount = '0'`; the output-side source retry guard is not used. Before destination
  pricing or settlement work, the canonical filtered holdings are classified. If they are all on the
  destination chain, Path A is authoritative for non-negative token requests: it returns on success
  and propagates quote/value failure without trying RES, B1/B2, or the default COT route. This applies
  whether holdings came from all balances or a user `sources` allowlist, and also covers COT
  destinations and gas-only requests. Negative reservation sentinels retain the composite-flow
  routing behavior below. For mixed-chain holdings, the loose gate compares the requested
  token/native USD value against filtered destination-holding USD capacity using the route-scoped
  price cache. Missing prices mean “unknown”
  and allow the authoritative direct quote attempt; only a clear priced shortfall skips it. A direct
  hit therefore never pays for the discarded COT→destination sizing/convergence sequence. The real
  two-pass quotes and strict coverage remain authoritative; a gate miss or builder failure lets B1/B2
  and the default route continue. Execution re-sizes only from persisted, filtered
  `dstHoldings`, preserves the route-time executor/EOA quote addresses, groups ERC-20 funding per
  token, and retries only after a definitive failure (§12.1). The whole batch is atomic, so failure
  cleanup is skipped.
  `dstHoldings.amountRaw` is an **already usable** ceiling: preflight and composite-flow balance inputs
  must have deducted any native gas reserve before routing. This executor consumes that ceiling and
  never estimates or deducts a second reserve.
- **Dynamic COT (B2) re-enters the flow with a different settlement family** (both modes). When every
  source shares one STABLE family F (USDC/USDT — ETH excluded) that is ≠ the destination family and ≠
  the current COT, F resolves as a COT on the dst chain, and **at least one source is off the dst chain**
  (there's a bridge to optimize — an all-on-dst set saves nothing and is left to Path A / plain
  liquidation), the route would otherwise round-trip source→USDC→bridge→USDC→output (two swap hops). Instead B2 re-enters `_exactInRoute`/`_exactOutRoute`
  with `{cotCurrencyId: F, bridgeQuoteResponse: fQuote, skipFastPaths: true}` (`fQuote` an F-denominated
  quote fetched mid-route): now the sources ARE the COT, so **zero source swaps**, the bridge carries F,
  and a single F→output destination swap runs (gas swap, if any, denominated in F). Every COT read
  descends from `options.cotCurrencyId`, so `settlementCurrencyId` lands as F by construction (a failed
  route sweeps F, not USDC) and the stray `liquidateInputHoldings(cotCurrencyId: options.cotCurrencyId)`
  is fixed to the settlement `currencyId`. `skipFastPaths` stops the recursion. EXACT_OUT additionally
  passes `data.sources = the family-F holdings` as the allowlist so every re-entered source is a COT;
  EXACT_IN needs none (the gate proved uniformity). A null F-quote or an insufficient-F re-entry throw ⇒
  fall back to the USDC COT flow. F = USDC is today's flow (a no-op).
- **Bridge provider (Mayan vs Nexus) is one decision, fed the *bridged* amount.**
  `resolveBridgeProviderDecision` asks the middleware's `getBridgeProvider` (which owns the USD
  threshold + dst `mayanEnabled` checks) about the token that actually crosses chains and how much.
  The request carries a **single** `destination` — `contract_address` is the bridged token and
  `amount` is the bridged **USD expressed in that token's raw units** (not an added dstCOT quantity):
  COT routes send `dstCOT` + the summed USD of the *remote* (non-dst) holdings (EXACT_IN: the
  **selected** holdings; EXACT_OUT: the remote members of the same single RES snapshot used for
  fast-path classification);
  the same-token fast path sends that token + its bridged raw amount. A `mayan` reply downgrades to
  `nexus` when any bridged source chain/token is itself mayan-disabled; `forceMayan` bypasses **both**
  the server call and the downgrade. A surviving `mayan` sets `minOutputUsdPerSource =
  MAYAN_MIN_USD_PER_LEG` (else `undefined`, making the floors no-op) and `enrichMayanBridge` attaches
  per-source quotes (called only under the `provider === 'mayan'` branch at each bridge site). The floor is applied only under an explicit `provider === 'mayan'` branch:
  EXACT_IN's `dropSubFloorMayanChains` measures each **selected** chain's USD **prorated to the
  chosen amount** (`holdingUsd`, not the full wallet balance); EXACT_OUT hands the floor to
  `autoSelectSources`. Both modes share the per-chain aggregation in
  `algorithms/mayan-floor.ts:filterMayanSourcesByChain` while retaining their distinct value inputs
  and error semantics. A native fast-path destination defaults to `nexus` (the server can't price a
  zero-address token).
- **Convergence bounded** — `SAFETY_MULTIPLIER` (1.005). A usable under-delivering quote scales the
  next input by `requiredOutput / actualOutput` before applying that margin; a no-quote retry uses
  geometric growth. Destination convergence starts from cached USD prices when possible and lazily
  falls back to the old reverse survey after an unusable price-seeded result or when its observed
  correction exceeds the price seed's cap. Input growth remains capped at the active seed +
  `MAX_CONVERGENCE_EXTRA_COT` (0.5), and unchanged rounded raw requests are never repeated;
  non-convergence throws (source) / returns null (destination).
- **Shared source re‑quote once (non-direct routes).** EXACT_OUT: summed leg drops must stay within
  `srcBuffer` (boundary inclusive), pooled across the route's source legs; otherwise
  `EXTERNAL_RATES_DRIFT_EXCEEDED`. EXACT_IN has no guard and accepts the re-quote. Still failing means
  re-throw, with no sweep at this layer. Path A EXACT_OUT does not enter this code; its exact-target,
  three-dispatch policy and silent-input growth guard are described above.
- **Destination re‑quote twice** (`MAX_RETRIES`; 3 attempts), then re‑throw without a fallback sweep.
  EXACT_IN has no rate‑tolerance guard on the re‑quote; EXACT_OUT keeps its frozen `[floor, ceiling]`.
- **Aggregator failures non‑fatal** at the aggregation layer.
- **EOA single‑chain & serialized**; **all chains dispatched before receipts** (source stage).
- **Fail loud at routing** (see §5) — never emit an inconsistent plan.
- **Cleanup only on execution failure**, swept from the ephemeral; **native never swept, COT always
  swept** back to the EOA.
- **Smart‑account‑only**: no EOA‑direct swap dispatch; `'ephemeral'` (Calibur SBC) and `'safe'`
  (Safe) are both first‑class, chosen per chain by `resolveWalletDecisions`. Collection fee stubbed
  to `0`; bridge funding tagged `ephemeralBalance`, direct COT (`eoaBalance`) moved EOA→ephemeral
  inside the deposit batch.

---

## 13. Test‑coverage gaps

The gaps from the original audit have been addressed:
- _**`buildSwapPreflight`** — covered by `tests/services/swap-preflight.test.ts`: parallel
  oracle/balance fetch, preloaded short‑circuit, the bridge‑quote branches (resolved / native‑COT /
  no‑COT / `getQuote` rejects), native vs. ERC20 `dstTokenInfo`, `walletPathHints`
  (7702→ephemeral / non‑7702→safe), and debug logging. (It pre‑existed under `tests/services/`;
  the null‑branch / native / safe‑path cases were merged in and a duplicate
  `tests/swap/preflight.test.ts` was removed.)_
- _**Economic constants** — `tests/swap/constants.test.ts` pins the buffer/haircut/convergence/
  retry/slippage values to source. (This corrected the EXACT_OUT source buffer from a guessed
  `0.5%` to the real `SRC_BUFFER_PCT = 2%` — the worked route example clamps to `$1` under either
  percentage, so it couldn't disambiguate.)_
- _**`max-pipeline.test.ts`** — the stale "`describe()` is `.skip'd`" header was removed; it runs
  and passes under the smart‑account‑only model._
- _**`swapAndExecute`** — already covered: the post‑swap `execute({to, gas})` behaviour lives in
  `tests/flows/swap-and-execute.test.ts` (≈27 behavioural tests) +
  `tests/flows/characterization/swap-and-execute-pipeline.test.ts`, the correct home for a public
  flow entrypoint. `tests/swap/currency-id-types.test.ts` only type‑checks its params, which is
  what made it look uncovered from inside `tests/swap`._

Mayan bridge **execution** is now exercised end‑to‑end by
`tests/swap/characterization/swap.test.ts` (§14): the approve‑only batches (7702 `approve(VAULT)` /
non‑7702 `transfer→permit`, no deposit/sweep), the native `depositMayan{value}` +
`reportMayanNativeTx` path, and the EPH/Safe destination receivers — all decoded from the real
emitted calls. That suite mocks the middleware boundary, so a focused `tests/swap/execution/*` unit
for `runMayanEphemeralBridge`'s **wait‑for‑mine‑then‑RFF ordering** and the 2‑minute
`waitForMayanFill` (neither asserted by the characterization suite) is the remaining Mayan‑execution
gap. Mayan routing/intent/selection stay covered by `route-mayan.test.ts`, `bridge-intent.test.ts`,
`auto-select-mayan-min.test.ts`, and `route.test.ts`'s provider‑parity block.

Source selection is `selectSwapSources` (`src/swap/balance/swap-balances`, pure filter/sort of a
provided `FlatBalance[]`); the address‑driven fetch + display shaping is `getBalancesForSwap`
(`src/services/balances`). The native gas reserve is deducted once, at the preflight source‑sizing
chokepoint (`deductSwapNativeReserveFees`), so the composite flow keeps raw balances for its
destination‑gas shortfall while the router still sizes against reserve‑adjusted balances.

---

## 14. Receiver / wrapper decision graph

A single cross‑cutting view of **who receives, who owns, who spends** at every call site — the
decision §5/§6 (routing) and §9 (execution) spread across stages, distilled per leg. It answers
"for *this* leg, what is the `taker`/`receiver` of the swap, and the `owner`/`spender`/recipient of
each permit/transfer/approve?" without re‑reading the whole flow.

**Pinned end‑to‑end by `tests/swap/characterization/swap.test.ts`** (61 scenarios — see its
[`README.md`](../../tests/swap/characterization/README.md)). That suite drives the **real** `swap()`,
decodes every emitted SBC / Safe‑MultiSend / EOA‑signed call, and asserts these exact
`owner`/`spender`/`taker`/`receiver`/`amount` values across both modes, both providers (Nexus /
Mayan), and all three wrappers — the whole grid below is a green assertion, not narrative.

**Symbols.** `EOA` user wallet · `EPH` ephemeral · `SAFE = predictSafeAccountAddress(EPH)` ·
`WRAPPER(c) = 7702(c) ? EPH : SAFE` (per‑chain) · `ROUTER` aggregator router · `VAULT` bridge vault ·
`COT` USDC · `destination_swap = tokenSwap || gasSwap` (EXACT_IN never has a gas swap, so there it's
just the token swap — §5).

```text
# ── source-swap receiver  (buildSourceRecipientAddressByChain) ──
if chain == dstChain ∧ ¬destination_swap:  receiver = EOA            # COT is the final token here → deliver direct
else:                                       receiver = WRAPPER(chain)    # output stays at the wrapper, to be bridged / dst-swapped
# cross-chain legs IGNORE destination_swap — only the same-as-dst leg can short-circuit to the EOA.
# Path A (directDestination): EVERY source is on dstChain with no destination_swap, so every leg takes
#   the receiver = EOA short-circuit — the swap delivers toToken straight to the user, taker = WRAPPER.

# ── source swaps (per chain; §9 for dispatch)  ERC-20 legs fund EOA→WRAPPER first, then swap ──
(7702) → SBC  [permit/approve(owner=EOA, spender=EPH),  transferFrom(EOA→EPH),  approve(EPH→ROUTER),  swap(pullFrom=EPH,  receiver=<above>)]
(safe) → Safe [permit/approve(owner=EOA, spender=SAFE), transferFrom(EOA→SAFE), approve(SAFE→ROUTER), swap(pullFrom=SAFE, receiver=<above>)]
# native input → skip funding + approve; the input value rides the batch (EOA-submitted on 7702).

# ── bridge receiver  (resolveBridgeRecipient) ──   the RFF fill target on the dst chain
if ¬destination_swap:  EOA                          # no dst swap → bridge delivers straight to the EOA
elif 7702(dstChain):   EPH                          # 7702 dst + dst swap → ephemeral runs the swap
else:                  SAFE                          # non-7702 dst + dst swap → predicted Safe runs it
# Same-token direct bridge (EXACT_IN) AND its EXACT_OUT mirror (B1) have no dst swap → recv = EOA; the
#   pre-bridge calls below are the fast-path funding+deposit shape (COT/token still at the EOA).

# ── pre-bridge calls (per source chain ≠ dstChain; §9)  the vault is ALWAYS driven by EPH ──
#   funding? = [permit/approve(owner=EOA, spender=WRAPPER), transferFrom(EOA→WRAPPER)] — present only on the
#              fast path (COT still at the EOA); EMPTY when a source swap already funded the wrapper.
NEXUS  7702   → [funding?, approve(EPH→VAULT), vault.deposit]                      # Seam 1 bridges the full balance → no sweep
NEXUS  safe   → [funding?, transfer(SAFE→EPH), permit(owner=EPH, spender=VAULT), vault.deposit]   # no sweep (Seam 1 full)
NEXUS  native → EOA payable vault.deposit{value}                      # no approve/permit/transfer/sweep
MAYAN  7702   → [funding?, approve(EPH→VAULT)]                        # NO deposit / NO sweep — middleware sponsors depositMayan()
MAYAN  safe   → [funding?, transfer(SAFE→EPH), permit(owner=EPH, spender=VAULT)]   # NO deposit / NO sweep
MAYAN  native → EOA payable vault.depositMayan{value} + reportMayanNativeTx
# ordering: Mayan approves are submitted + MINED before the RFF; Nexus deposits run AFTER submitRFF (§9).

# ── destination swap (iff destination_swap; on WRAPPER(dstChain), §9) ──
#   funds are already at the wrapper from the bridge fill; the same-chain fast path prepends EOA→WRAPPER funding.
(7702) → SBC  [funding?, approve(EPH→ROUTER),  swap(pullFrom=EPH,  taker=EPH,  receiver=EOA), transfer(leftover COT→EOA)?]
(safe) → Safe [funding?, approve(SAFE→ROUTER), swap(pullFrom=SAFE, taker=SAFE, receiver=EOA), transfer(leftover COT→EOA)?]
# receiver=EOA for BOTH the token swap and the gas swap. Leftover COT (balanceOf − consumed) → ONE direct
# transfer → EOA (replaces the blind approve+Sweeper drain), skipped when ≤ 0. The output token lands at the
# EOA so its dust sweep is skipped; gas-swap native → EOA, never swept.
```

Two invariants this view makes explicit (both asserted by the suite):

- **The bridge/vault identity is always EPH**, even on a non‑7702 source — the SAFE is a transient
  holder that `transfer(SAFE→EPH)`s, then EPH signs the vault permit. Swap output is tagged
  `ephemeralBalance` regardless of the wrapper that produced it (§9).
- **Provider choice is leg‑independent of the receiver** — Nexus vs Mayan only changes the
  *pre‑bridge* shape (real deposit vs. allowance‑only + sponsored `depositMayan`); the
  source/bridge/destination *receivers* are identical either way. **Native participates in provider
  selection like any token** (the same‑token fast path normalizes native → `ZERO_ADDRESS` and asks
  `getBridgeProvider`; `forceMayan` routes a native bridge through Mayan → EOA‑submitted
  `depositMayan`).
