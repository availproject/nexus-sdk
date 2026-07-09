import type { BridgeProvider } from '@avail-project/nexus-types';
import Decimal from 'decimal.js';
import { formatUnits, type Hex, parseUnits, toHex } from 'viem';
import {
  assertMayanSupportedDestination,
  resolveBridgeProvider,
} from '../bridge/intent/quote-request';
import type { ChainListType, TokenInfo } from '../domain';
import { ZERO_ADDRESS } from '../domain/constants/addresses';
import { Errors } from '../domain/errors';
import { logger } from '../domain/utils';
import { buildQuoteRequest } from '../bridge/intent/quote-request';
import { isNativeAddress } from '../services/addresses';
import { convertGasToToken } from '../services/intent';
import { estimateRepresentativeSwapNativeReserveFee } from '../services/swap-native-reserve-fee';
import { divDecimals, mulDecimals } from '../services/math';
import { MAYAN_MIN_USD_PER_LEG, quoteMayanLegs } from '../services/mayan';
import { equalFold } from '../services/strings';
import type { MiddlewareSwapPreflightClient } from '../transport';
import type { Aggregator, Holding, QuoteResponse } from './aggregators/types';
import { autoSelectSources, type SourceHolding } from './algorithms/auto-select';
import {
  destinationGasSwapExactIn,
  destinationSwapWithExactIn,
  determineDestinationSwaps,
} from './algorithms/destination';
import { liquidateInputHoldings } from './algorithms/liquidate';
import {
  B2_STABLE_CURRENCY_IDS,
  DST_BUFFER_MAX_USD,
  DST_BUFFER_PCT,
  DST_RECLAIM_DEDUCTION_PCT,
  EADDRESS,
  EXACT_OUT_PROVIDER_BUFFER,
  SRC_BUFFER_MAX_USD,
  SRC_BUFFER_PCT,
} from './constants';
import { type CurrencyID, resolveCOT, resolveCurrencyId, resolveSwapSettlement } from './cot';
import { predictSafeAccountAddress } from './safe/predict';
import type {
  AssetsUsedEntry,
  BridgeAsset,
  BridgeQuoteResponse,
  DestinationSwap,
  FlatBalance,
  OraclePriceResponse,
  PublicClientList,
  Source,
  SourceChainCOT,
  SwapData,
  SwapRoute,
  WalletPath,
} from './types';
import { SwapMode } from './types';
import { chainSupports7702, resolveWalletPath } from './wallet/capabilities';

// ---------------------------------------------------------------------------
// Options for route determination
// ---------------------------------------------------------------------------

export type RouteOptions = {
  aggregators: Aggregator[];
  bridgeQuoteResponse?: BridgeQuoteResponse | null;
  chainList: ChainListType;
  cotCurrencyId: CurrencyID;
  middlewareClient: MiddlewareSwapPreflightClient;
  publicClientList: PublicClientList;
  oraclePrices: OraclePriceResponse;
  dstTokenInfo: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  eoaAddress: Hex;
  ephemeralAddress: Hex;
  balances: FlatBalance[];
  walletPathHints: Map<number, WalletPath>;
  quoteAddressHints?: Map<number, Hex>;
  forceMayan: boolean;
  // Recursion stop for the B2 dynamic-COT re-entry: when a fast path re-enters `_exactInRoute` /
  // `_exactOutRoute` with an overridden `cotCurrencyId`, it sets this so the re-entered call runs
  // the default COT flow instead of re-classifying and looping. Never set by public callers.
  skipFastPaths?: boolean;
};

type WalletDecision = {
  sourceExecutionPaths: Map<number, WalletPath>;
};

// ---------------------------------------------------------------------------
// determineSwapRoute
// ---------------------------------------------------------------------------

// Drop selected source chains whose aggregate bridged USD can't clear Mayan's per-leg quote floor.
// Mayan-only — Nexus has no per-leg minimum, so this runs only inside the `bridgeProvider==='mayan'`
// branch. It aggregates over the SELECTED holdings (prorated to the chosen amount via `holdingUsd`),
// NOT the wallet's full balances — so only a chain that actually carries a selected source can be
// dropped, and a partial selection is judged on what really bridges. EXACT_IN's source-selection
// (`liquidateInputHoldings`) only sees non-COT holdings, so the COT+non-COT per-chain constraint is
// enforced here, before COT splitting.
const dropSubFloorMayanChains = <H extends SelectedHolding>(
  holdings: H[],
  balances: FlatBalance[],
  oraclePrices: OraclePriceResponse,
  minOutputUsdPerSource: Decimal
): { holdings: H[]; droppedMayanChains: { chainID: number; valueUsd: Decimal }[] } => {
  const valueByChain = new Map<number, Decimal>();
  for (const holding of holdings) {
    valueByChain.set(
      holding.chainID,
      (valueByChain.get(holding.chainID) ?? new Decimal(0)).plus(
        holdingUsd(holding, balances, oraclePrices)
      )
    );
  }
  const dropped: { chainID: number; valueUsd: Decimal }[] = [];
  for (const [chainID, total] of valueByChain) {
    if (total.lt(minOutputUsdPerSource)) {
      dropped.push({ chainID, valueUsd: total });
    }
  }
  const droppedSet = new Set(dropped.map((entry) => entry.chainID));
  return {
    holdings: holdings.filter((h) => !droppedSet.has(h.chainID)),
    droppedMayanChains: dropped,
  };
};

const throwMayanRouteShortfall = (
  droppedChains: { chainID: number; valueUsd: Decimal }[],
  chainList: ChainListType,
  remaining: Decimal,
  outputRequired: Decimal,
  minOutputUsdPerSource: Decimal
): never => {
  const sorted = [...droppedChains].sort((a, b) => b.valueUsd.comparedTo(a.valueUsd));
  const list = sorted
    .map((entry) => {
      const name = chainList.getChainByID(entry.chainID)?.name ?? `chain ${entry.chainID}`;
      return `${name}: $${entry.valueUsd.toFixed(2)}`;
    })
    .join(', ');
  const tail =
    remaining.gt(0) && outputRequired.gt(0)
      ? ` Eligible liquidity ($${outputRequired.minus(remaining).toFixed(2)}) is below required ($${outputRequired.toFixed(2)}).`
      : ' No Mayan-eligible source chains remain.';
  throw Errors.insufficientBalance(
    `Mayan bridge requires ≥ $${minOutputUsdPerSource.toFixed(2)} USD per source. ` +
      `Chains [${list}] were excluded.${tail}`
  );
};

// Decide the bridge provider (Mayan vs Nexus) once, at the start of a route, by asking the
// middleware (which owns the USD threshold + destination mayanEnabled checks) about the
// *bridged* amount — the token that actually crosses chains. A server "mayan" is downgraded
// to "nexus" when any bridged source chain/token is itself mayan-disabled, so the per-source
// quote step can't later reject the route. `forceMayan` skips that downgrade (and
// `resolveBridgeProvider` skips the server call entirely). The return shape is unchanged —
// `minOutputUsdPerSource` set only for a final Mayan pick — so every downstream consumer
// (the per-chain filter, `autoSelectSources`) is untouched.
const resolveBridgeProviderDecision = async (
  params: {
    context: string; // route path, for diagnostics: 'EXACT_IN' | 'EXACT_OUT' | 'fast-path'
    dstChainId: number;
    dstTokenToCheck: Hex; // COT for COT routes; the same-token for the fast path
    amountRawForRequest: bigint; // raw units of dstTokenToCheck — the bridged amount
    roughSources: { chainID: number; tokenAddress: Hex }[]; // bridged sources, for the gate
  },
  options: Pick<RouteOptions, 'middlewareClient' | 'chainList' | 'forceMayan'>
): Promise<{ provider: BridgeProvider; minOutputUsdPerSource?: Decimal }> => {
  const request = {
    destination: {
      chain_id: toHex(params.dstChainId),
      contract_address: params.dstTokenToCheck,
      amount: params.amountRawForRequest.toString(),
    },
  };
  // The exact getBridgeProvider request (what crosses chains + how much) and the bridged sources
  // the Mayan-eligibility gate will check. forceMayan short-circuits the server call.
  logger.debug('swap.provider:request', {
    context: params.context,
    forceMayan: options.forceMayan,
    request,
    bridgedSources: params.roughSources,
  });

  const serverProvider = await resolveBridgeProvider(
    options.middlewareClient,
    request,
    options.forceMayan
  );

  // A "mayan" server pick is viable only if every bridged source is Mayan-enabled, else the
  // per-source quote step would reject it — so we downgrade to Nexus. forceMayan keeps the pick.
  const disabledSource =
    !options.forceMayan && serverProvider === 'mayan'
      ? firstMayanDisabledSource(options.chainList, params.roughSources)
      : null;
  const finalProvider: BridgeProvider = disabledSource ? 'nexus' : serverProvider;

  // The decision and *why* — the single line to read when a route picked Nexus unexpectedly.
  logger.debug('swap.provider:decision', {
    context: params.context,
    serverProvider,
    finalProvider,
    reason: options.forceMayan
      ? 'forceMayan: provider pinned to mayan'
      : serverProvider !== 'mayan'
        ? 'server chose nexus (bridged amount below USD threshold, or destination not mayan-enabled)'
        : disabledSource
          ? `downgraded to nexus: bridged source chain ${disabledSource.chainID} token ${disabledSource.tokenAddress} is ${disabledSource.reason}`
          : 'mayan: server chose mayan and all bridged sources are mayan-enabled',
    minOutputUsdPerSource: finalProvider === 'mayan' ? MAYAN_MIN_USD_PER_LEG : undefined,
  });

  return {
    provider: finalProvider,
    minOutputUsdPerSource:
      finalProvider === 'mayan' ? new Decimal(MAYAN_MIN_USD_PER_LEG) : undefined,
  };
};

// Find the first bridged source that disqualifies a Mayan route — mirrors the (throwing) source
// eligibility checks in `enrichMayanBridge`, but returns the offending source + reason instead
// of throwing so the decision can downgrade to Nexus and log *why*. `null` ⇒ all sources eligible.
// Any lookup miss (e.g. native resolved by zero-address) counts as disqualifying, biasing to Nexus.
const firstMayanDisabledSource = (
  chainList: ChainListType,
  sources: { chainID: number; tokenAddress: Hex }[]
): { chainID: number; tokenAddress: Hex; reason: string } | null => {
  for (const source of sources) {
    try {
      if (!chainList.getChainByID(source.chainID)?.mayanEnabled) {
        return { ...source, reason: 'chain not mayan-enabled' };
      }
      if (!chainList.getTokenByAddress(source.chainID, source.tokenAddress)?.mayanEnabled) {
        return { ...source, reason: 'token not mayan-enabled' };
      }
    } catch {
      return { ...source, reason: 'chain/token lookup failed' };
    }
  }
  return null;
};

// The token a source chain actually bridges on a COT route: the chain's COT (source holdings are
// liquidated to it before bridging), falling back to the holding's own token if the chain has no
// COT. Used so the Mayan-eligibility gate judges the bridged token (e.g. USDC), not the pre-swap
// source token (e.g. USDT) — which never leaves the source chain.
const bridgedTokenForChain = (
  chainID: number,
  fallbackToken: Hex,
  chainList: ChainListType,
  currencyId: number
): Hex => {
  try {
    return resolveCOT(chainID, chainList, currencyId).address as Hex;
  } catch {
    return fallbackToken;
  }
};

type SelectedHolding = { chainID: number; tokenAddress: Hex; amountRaw: bigint; decimals: number };

// USD value of a single selected holding. Prefers the precomputed FlatBalance.value (prorated when
// the holding spends only part of the balance), falls back to oracle price, and is 0 when neither
// is available — which understates the value and biases to Nexus (the safe default).
const holdingUsd = (
  holding: SelectedHolding,
  balances: FlatBalance[],
  oraclePrices: OraclePriceResponse
): Decimal => {
  const balance = balances.find(
    (b) => b.chainID === holding.chainID && equalFold(b.tokenAddress, holding.tokenAddress)
  );
  if (balance) {
    const availableRaw = parseUnits(balance.amount, balance.decimals);
    if (availableRaw > 0n) {
      const ratio = new Decimal(holding.amountRaw.toString()).div(availableRaw.toString());
      return new Decimal(balance.value).mul(ratio);
    }
  }
  const oracle = oraclePrices.find(
    (price) =>
      price.chainId === holding.chainID && equalFold(price.tokenAddress, holding.tokenAddress)
  );
  if (oracle) {
    return divDecimals(holding.amountRaw, holding.decimals).mul(oracle.priceUsd);
  }
  return new Decimal(0);
};

// USD value of a set of holdings, used to size the EXACT_IN provider-check amount.
const sumHoldingsUsd = (
  holdings: SelectedHolding[],
  balances: FlatBalance[],
  oraclePrices: OraclePriceResponse
): Decimal =>
  holdings.reduce(
    (sum, holding) => sum.plus(holdingUsd(holding, balances, oraclePrices)),
    new Decimal(0)
  );

// Rough survey of which holdings would bridge for an EXACT_OUT route, used only to size the
// provider check. Walks priority-ordered holdings (the order `autoSelectSources` also sees)
// until the destination requirement is covered, then reports the value/sources that aren't
// already on the destination chain. It deliberately overshoots by EXACT_OUT_PROVIDER_BUFFER
// and may diverge from the real selection — the kept Mayan checks in `enrichMayanBridge`
// are the backstop for that.
// Greedy leading prefix of `holdings` (already priority-ordered) whose cumulative USD value first
// reaches `targetUsd` — the shared core of the EXACT_OUT provider survey and the RES gate. Includes
// the holding that tips the running total over the target; reads only `value`, so it preserves H.
export const greedyUsdPrefix = <H extends { value: number }>(
  holdings: H[],
  targetUsd: Decimal
): H[] => {
  const prefix: H[] = [];
  let accumulated = new Decimal(0);
  for (const holding of holdings) {
    if (accumulated.gte(targetUsd)) break;
    accumulated = accumulated.plus(holding.value);
    prefix.push(holding);
  }
  return prefix;
};

// RES — Roughly Estimated Sources. EXACT_OUT fast-path gating can't see explicit sources, so it
// estimates them: the greedy priority-ordered prefix that covers the destination requirement (× a
// small headroom), KEEPING dst-chain members (unlike the provider survey below, which drops them).
// `sortSourcesByPriority` puts dst-chain holdings first, so RES is structurally biased toward Path A
// firing, and the prefix ≈ what `autoSelectSources` would pick. It is ONLY the gate population;
// funding walks use the full holding sets so RES headroom never starves buffers/fees.
export const selectRoughEligibleSources = <H extends { value: number }>(
  holdings: H[],
  dstUsd: Decimal,
  headroom: number = EXACT_OUT_PROVIDER_BUFFER
): H[] => greedyUsdPrefix(holdings, dstUsd.mul(1 + headroom));

const roughSelectBridgedSourcesForProviderCheck = (
  holdings: { chainID: number; tokenAddress: Hex; value: number }[],
  dstUsd: Decimal,
  dstChainId: number
): { bridgedAmountUsd: Decimal; roughSources: { chainID: number; tokenAddress: Hex }[] } => {
  const bridged = selectRoughEligibleSources(holdings, dstUsd).filter(
    (holding) => holding.chainID !== dstChainId
  );
  return {
    bridgedAmountUsd: bridged.reduce((sum, holding) => sum.plus(holding.value), new Decimal(0)),
    roughSources: bridged.map((holding) => ({
      chainID: holding.chainID,
      tokenAddress: holding.tokenAddress,
    })),
  };
};

// ---------------------------------------------------------------------------
// Fast-path classification & fallback envelope
// ---------------------------------------------------------------------------

export type FastPathClass =
  | { kind: 'direct' } // A — direct destination-chain swap (both modes)
  | { kind: 'same-token-out'; familyId: number } // B1 — same-family direct bridge, EXACT_OUT mirror
  | { kind: 'dynamic-cot'; familyId: number } // B2 — dynamic COT selection (both modes)
  | null;

// The single bridgeable mesh family shared by ALL members, or undefined when any member is non-mesh
// or the families differ. Strict-ALL: one disqualifying member forces the default flow (no hybrids).
const uniformMemberFamily = (
  chainList: ChainListType,
  members: { chainID: number; tokenAddress: Hex }[]
): number | undefined => {
  if (members.length === 0) return undefined;
  const first = resolveCurrencyId(chainList, members[0].chainID, members[0].tokenAddress);
  if (first == null) return undefined;
  return members.every(
    (member) => resolveCurrencyId(chainList, member.chainID, member.tokenAddress) === first
  )
    ? first
    : undefined;
};

const cotResolvesOnChain = (
  chainList: ChainListType,
  chainId: number,
  currencyId: number
): boolean => {
  try {
    resolveCOT(chainId, chainList, currencyId);
    return true;
  } catch {
    return false;
  }
};

// Whether the destination token IS the COT (⇒ no destination token swap). Defensive: a chain with no
// COT can't have toToken == COT, so treat it as needing a swap.
const toTokenIsCot = (
  chainList: ChainListType,
  chainId: number,
  toTokenAddress: Hex,
  cotCurrencyId: number
): boolean => {
  try {
    return equalFold(toTokenAddress, resolveCOT(chainId, chainList, cotCurrencyId).address);
  } catch {
    return false;
  }
};

// Pure routing-time classifier for the three fast paths. `members` are the sources to judge:
// resolved holdings for EXACT_IN, the RES prefix for EXACT_OUT. Check order encodes the product
// decision A → B1 → B2; the first match wins and the caller gates on it (silent fallback on null).
export const classifyFastPath = (input: {
  chainList: ChainListType;
  members: { chainID: number; tokenAddress: Hex }[];
  dstChainId: number;
  dstTokenAddress: Hex;
  cotCurrencyId: number;
  needsTokenSwap: boolean;
  hasGasRequest: boolean;
  toAmountRaw: bigint;
  mode: SwapMode;
}): FastPathClass => {
  const { chainList, members, dstChainId, dstTokenAddress, cotCurrencyId } = input;
  if (members.length === 0) return null;

  // A — direct destination swap: every member already on the destination chain AND a token swap is
  // actually needed. toToken == COT (needsTokenSwap false) is already optimal via the no-bridge
  // COT-dst path (swap.md §8), so A stays out of its way.
  if (input.needsTokenSwap && members.every((member) => member.chainID === dstChainId)) {
    return { kind: 'direct' };
  }

  const familyId = uniformMemberFamily(chainList, members);
  if (familyId == null) return null;
  const dstFamily = resolveCurrencyId(chainList, dstChainId, dstTokenAddress);

  // B1 — same-family direct bridge (EXACT_OUT mirror of buildSameTokenBridgeRoute). All members and
  // the destination token are one non-COT family; no gas leg (disqualified in v1); positive output.
  if (
    input.mode === SwapMode.EXACT_OUT &&
    familyId === dstFamily &&
    familyId !== cotCurrencyId &&
    !input.hasGasRequest &&
    input.toAmountRaw > 0n
  ) {
    return { kind: 'same-token-out', familyId };
  }

  // B2 — dynamic COT: all members share a STABLE family F distinct from both the destination family
  // and the current COT, and F resolves as a COT on the destination chain (the resolveCOT throw,
  // caught here, is the guard). ETH is excluded by B2_STABLE_CURRENCY_IDS.
  if (
    familyId !== dstFamily &&
    familyId !== cotCurrencyId &&
    B2_STABLE_CURRENCY_IDS.has(familyId as CurrencyID) &&
    cotResolvesOnChain(chainList, dstChainId, familyId)
  ) {
    return { kind: 'dynamic-cot', familyId };
  }

  return null;
};

// Fast-path fallback envelope: a builder that throws or returns null falls through to the next gate
// / the default flow (silent, debug-logged). ONLY builder calls are wrapped — the default flow keeps
// its fail-loud semantics.
const tryFastPath = async (
  path: NonNullable<FastPathClass>['kind'],
  build: () => Promise<SwapRoute | null>
): Promise<SwapRoute | null> => {
  try {
    return await build();
  } catch (error) {
    logger.debug('swap.fastpath:fallback', { path, error: String(error) });
    return null;
  }
};

const BRIDGE_FEE_ESTIMATE_OVERSELECT = 0.1;

// Up-front bridge-fee estimate, provider-agnostic, from a rough ~110%-of-requirement source survey
// (an upper bound — a larger rough input yields a larger absolute fee, and same-token COT bridges
// barely move). Folded into the EXACT_OUT *selection* target so the real `autoSelectSources` covers
// the fee in a single pass — mirroring v1's `bridgeOutputWithFees`. The bridge's net delivery target
// is sized off `sourceBufferedRequired` separately and is unaffected.
//   - mayan: quote each per-chain leg and sum `input − minReceived` (the per-leg haircut)
//   - nexus: the backend fee model — fulfilment fee + bridged amount × fulfillmentBps
const estimateBridgeFees = async (
  params: {
    provider: BridgeProvider;
    holdings: { chainID: number; value: number }[];
    dstUsd: Decimal;
    dstChainId: number;
    dstCOT: { address: string; decimals: number };
    cotCurrencyId: number;
    bridgeQuoteResponse: BridgeQuoteResponse | null | undefined;
  },
  options: Pick<RouteOptions, 'chainList' | 'middlewareClient'>
): Promise<Decimal> => {
  // Rough per-chain bridged COT (≈ USD), over-selected to ~110% of the destination requirement.
  const target = params.dstUsd.mul(1 + BRIDGE_FEE_ESTIMATE_OVERSELECT);
  const usdByChain = new Map<number, Decimal>();
  let accumulated = new Decimal(0);
  for (const holding of params.holdings) {
    if (accumulated.gte(target)) break;
    accumulated = accumulated.plus(holding.value);
    if (holding.chainID === params.dstChainId) continue; // dst-chain COT isn't bridged
    usdByChain.set(
      holding.chainID,
      (usdByChain.get(holding.chainID) ?? new Decimal(0)).plus(holding.value)
    );
  }
  const bridgedUsd = [...usdByChain.values()].reduce((sum, v) => sum.plus(v), new Decimal(0));
  if (bridgedUsd.lte(0)) return new Decimal(0);

  if (params.provider === 'mayan') {
    const legs: { chainId: number; tokenAddress: Hex; amountRaw: bigint }[] = [];
    for (const [chainID, usd] of usdByChain) {
      let cot: ReturnType<typeof resolveCOT>;
      try {
        cot = resolveCOT(chainID, options.chainList, params.cotCurrencyId);
      } catch {
        continue; // a chain with no COT can't be a clean COT Mayan leg; skip from the estimate
      }
      legs.push({
        chainId: chainID,
        tokenAddress: cot.address as Hex,
        amountRaw: mulDecimals(usd, cot.decimals),
      });
    }
    if (legs.length === 0) return new Decimal(0);
    const quotes = await quoteMayanLegs(options.middlewareClient, {
      legs,
      destination: { chainId: params.dstChainId, tokenAddress: params.dstCOT.address as Hex },
    });
    return quotes.reduce((sum, q) => {
      const usd = usdByChain.get(q.chainId);
      if (!usd) return sum;
      return sum.plus(
        Decimal.max(usd.minus(new Decimal(q.quote.minReceived.toString())), new Decimal(0))
      );
    }, new Decimal(0));
  }

  // nexus: fixed fulfilment fee + protocol bps on the bridged amount.
  if (!params.bridgeQuoteResponse) return new Decimal(0);
  const fulfilmentFee = divDecimals(
    params.bridgeQuoteResponse.destination.fulfillmentFeeToken,
    params.dstCOT.decimals
  );
  const protocolFee = bridgedUsd.mul(params.bridgeQuoteResponse.fulfillmentBps).div(10000);
  return fulfilmentFee.plus(protocolFee);
};

// Enriches a Mayan bridge with per-source quotes: validates the destination + every source is
// Mayan-eligible (the mayanEnabled flags, throwing if not — a backstop for the decision-time gate),
// then fetches and attaches the per-source Mayan quotes. The bridge MUST already have
// `provider: 'mayan'`; callers branch with `if (provider === 'mayan')` and invoke this only then, so
// the Mayan-vs-Nexus decision stays at the call site rather than being an internal no-op guard.
//
// TODO(mayan-undershoot): Σ minAmountOut from per-source quotes may be less
// than `bridge.amount`. The swap buffer should absorb that; if not, port the
// 3-attempt convergence loop from `createMayanBridgeIntent` in
// src/bridge/intent/creator.ts.
export const enrichMayanBridge = async (
  bridge: NonNullable<SwapRoute['bridge']>,
  options: Pick<RouteOptions, 'chainList' | 'middlewareClient'>
): Promise<NonNullable<SwapRoute['bridge']>> => {
  // Defensive: destination check is also done up-front in determineSwapRoute when
  // forceMayan is true, but the threshold path can also land us here.
  assertMayanSupportedDestination(options.chainList, bridge.chainID, bridge.tokenAddress);

  for (const asset of bridge.assets) {
    const sourceChain = options.chainList.getChainByID(asset.chainID);
    if (!sourceChain.mayanEnabled) {
      // Backstop: the decision-time gate should have downgraded to Nexus already; reaching here
      // means the rough sources diverged from the final assets.
      logger.warn('swap.mayan:source-chain-disabled', {
        chainID: asset.chainID,
        tokenAddress: asset.contractAddress,
      });
      throw Errors.invalidInput(
        `Mayan bridge selected but source chain ${asset.chainID} is disabled for Mayan`
      );
    }
    const sourceToken = options.chainList.getTokenByAddress(asset.chainID, asset.contractAddress);
    if (!sourceToken.mayanEnabled) {
      logger.warn('swap.mayan:source-token-disabled', {
        chainID: asset.chainID,
        tokenAddress: asset.contractAddress,
      });
      throw Errors.invalidInput(
        `Mayan bridge selected but source token ${asset.contractAddress} on chain ${asset.chainID} is disabled for Mayan`
      );
    }
  }

  // Per-source Mayan legs derived from the bridge assets (what each leg sends and the
  // destination token it must deliver). Swap leaves the leg amounts at the full produced
  // balance — the COT selection upstream already sized them — and only prices them here.
  const legs = bridge.assets.map((asset) => ({
    chainId: asset.chainID,
    tokenAddress: asset.contractAddress,
    amountRaw: mulDecimals(asset.eoaBalance.plus(asset.ephemeralBalance), asset.decimals),
  }));
  logger.debug('swap.mayan:quote-request', {
    legs: legs.map((leg) => ({ ...leg, amountRaw: leg.amountRaw.toString() })),
    destinationChainId: bridge.chainID,
    destinationToken: bridge.tokenAddress,
  });
  const quotes = await quoteMayanLegs(options.middlewareClient, {
    legs,
    destination: { chainId: bridge.chainID, tokenAddress: bridge.tokenAddress },
  });

  const mayanQuotesBySource = new Map<string, (typeof quotes)[number]['quote']>(
    quotes.map((quote) => [`${quote.chainId}:${quote.tokenAddress.toLowerCase()}`, quote.quote])
  );

  // Mayan's fee is the per-leg haircut baked into `minReceived` (gross bridged − Σ minReceived), not
  // the Nexus fulfilment/protocol the call site stubbed via `computeBridgeFees`. Overwrite
  // `estimatedFees` so the route's public fee surface — and `executionTokenAmount` (= totalBridged −
  // fee = Σ minReceived) in `bridge-intent.ts` — are truthful for a Mayan bridge.
  const grossBridged = bridge.assets.reduce(
    (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
    new Decimal(0)
  );
  const delivered = [...mayanQuotesBySource.values()].reduce(
    (sum, quote) => sum.plus(new Decimal(quote.minReceived.toString())),
    new Decimal(0)
  );
  const haircut = Decimal.max(grossBridged.minus(delivered), new Decimal(0));

  return {
    ...bridge,
    provider: 'mayan',
    mayanQuotesBySource,
    estimatedFees: {
      collection: new Decimal(0),
      fulfilment: new Decimal(0),
      caGas: new Decimal(0),
      protocol: haircut,
      solver: new Decimal(0),
    },
  };
};

// Never-throwing snapshot of a built route for the [DEBUG-LOG] trace, so a tester (or we)
// can reconstruct the exact scenario from the real amounts instead of guessing inputs.
const summarizeRouteForLog = (input: SwapData, route: SwapRoute) => {
  const str = (v: unknown) => (v == null ? v : String(v));
  const mayanLeg = (q: unknown) => {
    const m = (q ?? {}) as Record<string, unknown>;
    return {
      effectiveAmountIn: m.effectiveAmountIn,
      minReceived: m.minReceived,
      deadline64: m.deadline64,
    };
  };
  try {
    return {
      mode: input.mode,
      toChainId: input.data.toChainId,
      toToken: input.data.toTokenAddress,
      srcBuffer: str(route.source?.srcBuffer),
      sourceSwaps: route.source?.swaps?.map((s) => ({
        chainId: s.chainID,
        in: `${s.quote?.input?.amount} ${s.quote?.input?.symbol}`,
        out: `${s.quote?.output?.amount} ${s.quote?.output?.symbol}`,
      })),
      bridge: route.bridge
        ? {
            provider: route.bridge.provider,
            amountIn: str(route.bridge.amount),
            tokenAmountOut: str(route.bridge.amounts?.tokenAmount),
            assets: route.bridge.assets?.map((a) => ({
              chainId: a.chainID,
              token: a.contractAddress,
              eoaBalance: str(a.eoaBalance),
              ephemeralBalance: str(a.ephemeralBalance),
            })),
            mayanLegs: route.bridge.mayanQuotesBySource
              ? [...route.bridge.mayanQuotesBySource.entries()].map(([source, q]) => ({
                  source,
                  ...mayanLeg(q),
                }))
              : undefined,
            estimatedFees: route.bridge.estimatedFees && {
              collection: str(route.bridge.estimatedFees.collection),
              fulfilment: str(route.bridge.estimatedFees.fulfilment),
              protocol: str(route.bridge.estimatedFees.protocol),
            },
          }
        : null,
      destination: {
        chainId: route.destination?.chainId,
        inputMin: str(route.destination?.inputAmount?.min),
        inputMax: str(route.destination?.inputAmount?.max),
        hasTokenSwap: Boolean(route.destination?.swap?.tokenSwap),
      },
    };
  } catch (error) {
    return { summaryError: String(error) };
  }
};

export const determineSwapRoute = async (
  input: SwapData,
  options: RouteOptions
): Promise<SwapRoute> => {
  const destinationChain = options.chainList.getChainByID(input.data.toChainId);
  if (!destinationChain) {
    throw Errors.chainNotFound(input.data.toChainId);
  }
  if (destinationChain.swapSupported === false) {
    throw Errors.invalidInput(`Destination chain ${input.data.toChainId} does not support swaps`);
  }

  // forceMayan: fail fast before any planning work if destination doesn't support Mayan.
  // Bridge happens through USDC (the COT), so check the USDC token on the destination.
  if (options.forceMayan) {
    const dstCOT = resolveCOT(input.data.toChainId, options.chainList, options.cotCurrencyId);
    assertMayanSupportedDestination(options.chainList, input.data.toChainId, dstCOT.address as Hex);
  }

  const route =
    input.mode === SwapMode.EXACT_OUT
      ? await _exactOutRoute(input.data, options)
      : await _exactInRoute(input.data, options);

  logger.debug('[DEBUG-LOG] swap.route:created', summarizeRouteForLog(input, route));

  return route;
};

const buildSourceCotByChain = (
  swaps: Array<{ chainID: number }>,
  chainList: ChainListType,
  currencyId?: number
): Map<number, SourceChainCOT> => {
  return new Map(
    [...new Set(swaps.map((swap) => swap.chainID))].map((chainId) => {
      const cot = resolveCOT(chainId, chainList, currencyId);
      return [
        chainId,
        {
          contractAddress: cot.address,
          decimals: cot.decimals,
          currencyId: cot.currencyId,
        },
      ] as const;
    })
  );
};

// Nexus bridge fees. The protocol bps applies to `grossBridged` — the COT actually sent into the
// bridge (Σ assets) — in BOTH routes, so the fee no longer differs by route (EXACT_IN was already
// gross; EXACT_OUT used to size it off the smaller net delivery). The Mayan branch records its own
// haircut in `enrichMayanBridge` instead.
const computeBridgeFees = (params: {
  quoteResponse: BridgeQuoteResponse;
  grossBridged: Decimal;
  dstCOTDecimals: number;
}): NonNullable<SwapRoute['bridge']>['estimatedFees'] => {
  const fulfilment = divDecimals(
    params.quoteResponse.destination.fulfillmentFeeToken,
    params.dstCOTDecimals
  );
  const protocol = params.grossBridged.mul(params.quoteResponse.fulfillmentBps).div(10000);
  // Collection (per-source deposit) fee only applies when the EOA funds the bridge directly,
  // which our smart-account-only model no longer supports — bridge funding always flows
  // through the ephemeral, which the solver covers gas for. Keep the field for the public
  // SwapRoute surface, but stub it at zero.
  const collection = new Decimal(0);
  return {
    collection,
    fulfilment,
    caGas: collection.plus(fulfilment),
    protocol,
    solver: new Decimal(0),
  };
};

// Fetch a bridge-fee quote denominated in a specific currency's token on the destination chain.
// The fast paths bridge a NON-USDC family token, whose fees follow the quoted token — so they must
// quote that token mid-route rather than reuse the preflight USDC quote (a decimal trap). Returns
// null on any failure (unknown token, getQuote reject) → the caller falls back to the COT flow.
const fetchBridgeQuoteForCurrency = async (
  dstChainId: number,
  currencyId: number,
  options: Pick<RouteOptions, 'chainList' | 'middlewareClient'>
): Promise<BridgeQuoteResponse | null> => {
  try {
    const token = options.chainList.getTokenByCurrencyId(dstChainId, currencyId);
    const quoteToken = isNativeAddress(token.contractAddress)
      ? options.chainList.getNativeToken(dstChainId)
      : token;
    const request = buildQuoteRequest(options.chainList, quoteToken, dstChainId);
    return await options.middlewareClient.getQuote(request);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// EXACT_OUT route
// ---------------------------------------------------------------------------

async function _exactOutRoute(
  data: {
    toChainId: number;
    toTokenAddress: Hex;
    toAmountRaw: bigint;
    toNativeAmountRaw?: bigint;
    sources?: { tokenAddress: Hex; chainId: number }[];
  },
  options: RouteOptions
): Promise<SwapRoute> {
  const {
    cotCurrencyId,
    aggregators,
    chainList,
    oraclePrices,
    dstTokenInfo,
    eoaAddress,
    walletPathHints,
  } = options;
  const destinationChain = chainList.getChainByID(data.toChainId);

  const dstCOT = resolveCOT(data.toChainId, chainList, cotCurrencyId);
  // Gate dst-swap work on a positive shortfall: a negative/zero toAmountRaw means
  // there's nothing to deliver to the user (reservation or gas-only funding), so we
  // skip the destination aggregator call entirely.
  const needsTokenSwap = data.toAmountRaw > 0n && !equalFold(data.toTokenAddress, dstCOT.address);
  const balances = filterExactOutBalances(
    options.balances,
    data,
    destinationChain,
    dstTokenInfo.decimals
  );
  const usableBalances = balances.filter((balance) => new Decimal(balance.amount).gt(0));
  if (usableBalances.length === 0) {
    throw Errors.insufficientBalance('No usable balances for swap route');
  }

  const holdings = usableBalances.map((balance) => ({
    chainID: balance.chainID,
    tokenAddress: balance.tokenAddress,
    amountRaw: parseUnits(balance.amount, balance.decimals),
    decimals: balance.decimals,
    symbol: balance.symbol,
    value: balance.value,
  }));
  const availableSourceChainIds = new Set(holdings.map((holding) => holding.chainID));
  const initialWalletDecision = resolveWalletDecisions({
    sourceChainIds: availableSourceChainIds,
    walletPathHints,
  });
  const requestedNativeAmountRaw =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? data.toNativeAmountRaw : 0n;
  const needsGasSwap = requestedNativeAmountRaw > 0n;
  // Dst quote taker = the dst wrapper (ephemeral on 7702, Safe on non-7702). Both token
  // and gas swaps run inside the wrapper, so the taker is the wrapper whenever either
  // swap is needed. When neither runs, fall back to the EOA so signatures don't see
  // undefined.
  const destinationQuoteAddress =
    needsTokenSwap || needsGasSwap
      ? destinationWrapperAddress(destinationChain, options)
      : eoaAddress;
  const gasInCotBudgetRaw = needsGasSwap
    ? computeGasInCotBudgetRaw({
        requestedNativeAmountRaw,
        destinationChain,
        dstCOT,
        oraclePrices,
      })
    : 0n;

  const [tokenSwapQuote, gasSwapQuote] = await Promise.all([
    needsTokenSwap
      ? determineDestinationSwaps({
          dst: {
            chainId: data.toChainId,
            token: {
              contractAddress: data.toTokenAddress,
              amountRaw: data.toAmountRaw,
            },
          },
          options: {
            chainList: options.chainList,
            aggregators,
            cotCurrencyID: cotCurrencyId,
            userAddress: destinationQuoteAddress,
            recipientAddress: options.eoaAddress,
          },
        })
      : Promise.resolve(null),
    needsGasSwap
      ? destinationGasSwapExactIn({
          chainId: data.toChainId,
          gasAmountInCotRaw: gasInCotBudgetRaw,
          options: {
            chainList: options.chainList,
            aggregators,
            cotCurrencyID: cotCurrencyId,
            userAddress: destinationQuoteAddress,
            recipientAddress: options.eoaAddress,
          },
        })
      : Promise.resolve(null),
  ]);

  // No aggregator could quote COT → toToken on the destination chain (chain or pair
  // unsupported, or no liquidity). Without a quote we'd produce a route with tokenSwap=null
  // and finalWalletPath=ephemeral, which crashes at progress-emit time on a missing
  // destination_swap plan step. Fail loudly here instead.
  if (needsTokenSwap && !tokenSwapQuote) {
    throw Errors.quoteFailed(
      `No destination swap quote available for chain ${data.toChainId} token ${data.toTokenAddress}`
    );
  }
  if (needsGasSwap && !gasSwapQuote) {
    throw Errors.quoteFailed(`No destination gas swap quote available for chain ${data.toChainId}`);
  }

  const tokenInputAmount = needsTokenSwap
    ? new Decimal(
        tokenSwapQuote?.quote.input.amount ?? formatUnits(data.toAmountRaw, dstTokenInfo.decimals)
      )
    : data.toAmountRaw > 0n
      ? divDecimals(data.toAmountRaw, dstCOT.decimals)
      : new Decimal(0);
  const gasInputAmount = gasSwapQuote
    ? divDecimals(gasSwapQuote.quote.input.amountRaw, dstCOT.decimals)
    : new Decimal(0);
  // dst-wrapper COT requirement spans both swaps; gas is part of inputAmount so the requote
  // rate guard checks the sum, not just the token swap's input.
  const inputAmount = tokenInputAmount.plus(gasInputAmount);

  // The dst COT requirement split into token vs gas — if `inputAmount` is "only the eth amount"
  // the token leg collapsed (e.g. the held dst token was filtered out, so tokenInputAmount fell to
  // the COT direct path / 0) and the provider check + selection are sized off gas alone.
  logger.debug('swap.exactout:dst-requirement', {
    needsTokenSwap,
    needsGasSwap,
    tokenInputAmount: tokenInputAmount.toString(),
    gasInputAmount: gasInputAmount.toString(),
    inputAmount: inputAmount.toString(),
  });

  // ── Fast paths (skipped on the B2 re-entry). Classified over RES — the rough priority-ordered
  // prefix that covers the dst requirement — since EXACT_OUT sources aren't explicit. Path A discards
  // the sizing quotes above and re-selects input→toToken directly; the default flow continues inline.
  if (!options.skipFastPaths) {
    const roughEligible = selectRoughEligibleSources(holdings, inputAmount);
    const fastPathClass = classifyFastPath({
      chainList,
      members: roughEligible.map((holding) => ({
        chainID: holding.chainID,
        tokenAddress: holding.tokenAddress,
      })),
      dstChainId: data.toChainId,
      dstTokenAddress: data.toTokenAddress,
      cotCurrencyId,
      needsTokenSwap,
      hasGasRequest: needsGasSwap,
      toAmountRaw: data.toAmountRaw,
      mode: SwapMode.EXACT_OUT,
    });
    if (fastPathClass?.kind === 'direct') {
      const direct = await tryFastPath('direct', () =>
        buildDirectDestinationExactOutRoute(data, holdings, options)
      );
      if (direct) return direct;
    }
    if (fastPathClass?.kind === 'same-token-out') {
      const sameToken = await tryFastPath('same-token-out', () =>
        buildSameTokenBridgeExactOutRoute(data, holdings, options, fastPathClass.familyId)
      );
      if (sameToken) return sameToken;
    }
    if (fastPathClass?.kind === 'dynamic-cot') {
      const b2 = await tryFastPath('dynamic-cot', () =>
        buildDynamicCotExactOutRoute(data, holdings, options, fastPathClass.familyId)
      );
      if (b2) return b2;
    }
  }

  // Resolve the bridge provider now that the dst COT requirement (inputAmount, ≈ USD since the
  // COT is USDC) is known. A rough greedy survey of priority-ordered holdings tells the server
  // which token actually bridges and how much, so the Mayan-vs-Nexus pick is at parity with the
  // other routes. The result still drives `minOutputUsdPerSource` for `autoSelectSources` below.
  const { bridgedAmountUsd, roughSources } = roughSelectBridgedSourcesForProviderCheck(
    holdings,
    inputAmount,
    data.toChainId
  );
  const { provider: bridgeProvider, minOutputUsdPerSource } = await resolveBridgeProviderDecision(
    {
      context: 'EXACT_OUT',
      dstChainId: data.toChainId,
      dstTokenToCheck: dstCOT.address as Hex,
      amountRawForRequest: mulDecimals(bridgedAmountUsd, dstCOT.decimals),
      // Judge Mayan eligibility on the bridged token (the per-chain COT), not the pre-swap source
      // token — autoSelectSources liquidates every source to the COT before bridging.
      roughSources: roughSources.map((s) => ({
        chainID: s.chainID,
        tokenAddress: bridgedTokenForChain(s.chainID, s.tokenAddress, chainList, cotCurrencyId),
      })),
    },
    options
  );

  logger.debug('swap.exactout:provider', {
    bridgedAmountUsd: bridgedAmountUsd.toString(),
    roughSources,
    bridgeProvider,
    minOutputUsdPerSource: minOutputUsdPerSource?.toString(),
  });

  const destinationBuffer = applyBuffer(
    inputAmount,
    DST_BUFFER_PCT,
    DST_BUFFER_MAX_USD,
    oraclePrices,
    dstCOT.address
  );
  const destinationBufferedInput = inputAmount.plus(destinationBuffer);
  const originalDestinationMaxInput = new Decimal(destinationBufferedInput);
  const sourceBuffer = applyBuffer(
    destinationBufferedInput,
    SRC_BUFFER_PCT,
    SRC_BUFFER_MAX_USD,
    oraclePrices,
    dstCOT.address
  );
  const sourceBufferedRequired = destinationBufferedInput.plus(sourceBuffer);
  // Estimate the bridge fee up front and add it to the *selection* target (not the net delivery
  // target `sourceBufferedRequired`) so a single `autoSelectSources` pass produces enough COT to
  // survive the bridge haircut — mirrors v1's `bridgeOutputWithFees`.
  const bridgeFeeEstimate = await estimateBridgeFees(
    {
      provider: bridgeProvider,
      holdings,
      dstUsd: inputAmount,
      dstChainId: data.toChainId,
      dstCOT,
      cotCurrencyId,
      bridgeQuoteResponse: options.bridgeQuoteResponse,
    },
    options
  );
  const selectionTarget = sourceBufferedRequired.plus(bridgeFeeEstimate);

  logger.debug('swap.exactout:selection-target', {
    inputAmount: inputAmount.toString(),
    destinationBufferedInput: destinationBufferedInput.toString(),
    sourceBufferedRequired: sourceBufferedRequired.toString(),
    bridgeFeeEstimate: bridgeFeeEstimate.toString(),
    selectionTarget: selectionTarget.toString(),
  });
  const dstSwap: DestinationSwap = { tokenSwap: tokenSwapQuote, gasSwap: gasSwapQuote };
  const dstInputAmount = { min: inputAmount, max: destinationBufferedInput };
  const selectSources = (outputRequired: Decimal) =>
    autoSelectSources({
      holdings,
      outputRequired,
      aggregators,
      chainList,
      cotCurrencyId,
      dstChainId: data.toChainId,
      bridgeQuoteResponse: options.bridgeQuoteResponse,
      userAddressByChain: buildExecutorAddressByChain(
        initialWalletDecision.sourceExecutionPaths,
        options
      ),
      recipientAddressByChain: buildSourceRecipientAddressByChain({
        chainIds: availableSourceChainIds,
        sourceExecutionPaths: initialWalletDecision.sourceExecutionPaths,
        destinationChainId: data.toChainId,
        destinationHasSwap: needsTokenSwap || needsGasSwap,
        options,
      }),
      minOutputUsdPerSource,
    });

  // Source selection
  const { quoteResponses, usedCOTs } = await selectSources(selectionTarget);

  logger.debug('swap.exactout:selected', {
    selectionTarget: selectionTarget.toString(),
    swaps: quoteResponses.map((q) => ({
      chainID: q.chainID,
      in: `${q.quote.input.amount} ${q.quote.input.symbol}`,
      out: q.quote.output.amount,
    })),
    directCOTs: usedCOTs.map((c) => ({
      chainID: c.holding.chainID,
      amountUsed: c.amountUsed.toString(),
    })),
  });

  const calculateCoveredOutput = () =>
    usedCOTs
      .reduce((sum, cot) => sum.plus(cot.amountUsed), new Decimal(0))
      .plus(
        quoteResponses.reduce(
          (sum, response) => sum.plus(response.quote.output.amount),
          new Decimal(0)
        )
      );
  const collectSourceChainIds = () => {
    const sourceChainIds = new Set<number>();
    for (const q of quoteResponses) sourceChainIds.add(q.chainID);
    for (const c of usedCOTs) sourceChainIds.add(c.holding.chainID);
    return sourceChainIds;
  };
  const coveredOutput = calculateCoveredOutput();

  if (coveredOutput.lt(selectionTarget)) {
    throw Errors.insufficientBalance('Available balances do not cover required output');
  }

  const allSourceChainIds = collectSourceChainIds();
  const allOnDstChain = [...allSourceChainIds].every((id) => id === data.toChainId);
  if (!allOnDstChain && !options.bridgeQuoteResponse) {
    throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
  }
  const gasInCot = gasInputAmount;
  // selectionTarget = net delivery (sourceBufferedRequired, which includes gasInCot via inputAmount)
  // + the up-front bridge-fee estimate. The fee is already folded in, so there is no iterative
  // fee-adjusted re-select; coverage was checked against selectionTarget above.
  const requiredSourceOutput = selectionTarget;

  if (coveredOutput.lt(requiredSourceOutput)) {
    throw Errors.insufficientBalance('Available balances do not cover required output');
  }

  const walletDecision = resolveWalletDecisions({
    sourceChainIds: allSourceChainIds,
    walletPathHints,
  });
  const destinationChainDirectCot = usedCOTs
    .filter((entry) => entry.holding.chainID === data.toChainId)
    .reduce((sum, entry) => sum.plus(entry.amountUsed), new Decimal(0));
  const destinationChainSwapCot = quoteResponses
    .filter((entry) => entry.chainID === data.toChainId)
    .reduce((sum, entry) => sum.plus(entry.quote.output.amount), new Decimal(0));
  const destinationChainCot = destinationChainDirectCot.plus(destinationChainSwapCot);

  // bridgeTotalCot = full COT delivery to dst wrapper; split into token vs gas for accounting.
  const bridgeTotalCot = Decimal.max(
    sourceBufferedRequired.minus(destinationChainCot),
    new Decimal(0)
  );
  const bridgeNeeded = !allOnDstChain && bridgeTotalCot.gt(0);

  // Build bridge assets. Bridge funding always flows through the ephemeral identity (RFF
  // `parties` are the ephemeral), so swap-output COT is tagged as `ephemeralBalance` even
  // when the source chain executes via Safe — the Safe → ephemeral transfer lives in the
  // bridge deposit batch, not in the asset bookkeeping.
  let bridge: SwapRoute['bridge'] = null;
  if (bridgeNeeded) {
    const assets: BridgeAsset[] = [];
    for (const q of quoteResponses) {
      if (q.chainID === data.toChainId) continue;
      const cot = resolveCOT(q.chainID, chainList, cotCurrencyId);
      const outputAmount = new Decimal(q.quote.output.amount);
      const existing = assets.find((asset) => asset.chainID === q.chainID);
      if (existing) {
        existing.ephemeralBalance = existing.ephemeralBalance.plus(outputAmount);
      } else {
        assets.push({
          chainID: q.chainID,
          contractAddress: cot?.address ?? q.quote.output.contractAddress,
          decimals: cot?.decimals ?? q.quote.output.decimals,
          eoaBalance: new Decimal(0),
          ephemeralBalance: outputAmount,
        });
      }
    }
    for (const c of usedCOTs) {
      if (c.holding.chainID === data.toChainId) continue;
      const cot = resolveCOT(c.holding.chainID, chainList, cotCurrencyId);
      const existing = assets.find((a) => a.chainID === c.holding.chainID);
      if (existing) {
        existing.eoaBalance = existing.eoaBalance.plus(c.amountUsed);
      } else {
        assets.push({
          chainID: c.holding.chainID,
          contractAddress: cot?.address ?? c.holding.tokenAddress,
          decimals: cot?.decimals ?? 6,
          eoaBalance: c.amountUsed,
          ephemeralBalance: new Decimal(0),
        });
      }
    }

    // Forward model (mirrors EXACT_IN): the bridge sends the actual selected COT (Σ assets), the fee
    // applies to that gross, and it delivers gross − fee. The dst swap consumes its target; any
    // over-selected surplus strands at the wrapper (swept by cleanupStrandedCot).
    const grossBridged = assets.reduce(
      (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
      new Decimal(0)
    );
    const bridgeQuoteResponse = options.bridgeQuoteResponse;
    if (!bridgeQuoteResponse) {
      throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
    }
    const fees = computeBridgeFees({
      quoteResponse: bridgeQuoteResponse,
      grossBridged,
      dstCOTDecimals: dstCOT.decimals,
    });
    const totalFeeAmount = fees.collection.plus(fees.fulfilment).plus(fees.protocol);
    const deliveredTokenAmount = Decimal.max(
      grossBridged.minus(totalFeeAmount).minus(gasInCot),
      new Decimal(0)
    );

    bridge = {
      amount: grossBridged,
      amounts: {
        tokenAmount: deliveredTokenAmount,
        gasInCot,
        totalAmount: grossBridged,
      },
      assets,
      chainID: data.toChainId,
      decimals: dstCOT.decimals,
      tokenAddress: dstCOT.address as Hex,
      estimatedFees: fees,
      provider: bridgeProvider,
    };
    if (bridgeProvider === 'mayan') {
      bridge = await enrichMayanBridge(bridge, options);
    }
  }

  // Build buffer amount string
  const bufferAmount = sourceBufferedRequired.minus(dstInputAmount.min).toString();

  // Build assets used
  const assetsUsed: AssetsUsedEntry[] = [];
  for (const q of quoteResponses) {
    assetsUsed.push({
      chainID: q.chainID,
      tokenAddress: q.holding.tokenAddress,
      symbol: q.quote.input.symbol,
      decimals: q.quote.input.decimals,
      amount: q.quote.input.amount,
    });
  }
  for (const c of usedCOTs) {
    const cot = resolveCOT(c.holding.chainID, chainList, cotCurrencyId);
    const cotToken = chainList.getTokenByAddress(c.holding.chainID, cot.address as Hex);
    assetsUsed.push({
      chainID: c.holding.chainID,
      tokenAddress: c.holding.tokenAddress,
      symbol: cotToken?.symbol ?? 'COT',
      decimals: cot.decimals,
      amount: c.amountUsed.toString(),
    });
  }

  return {
    type: SwapMode.EXACT_OUT,
    settlementCurrencyId: cotCurrencyId,
    sameTokenBridge: false,
    source: {
      swaps: quoteResponses,
      creationTime: Date.now(),
      cotByChain: buildSourceCotByChain(quoteResponses, chainList, cotCurrencyId),
      srcBuffer: sourceBuffer,
      // Bridge the actual source balance so each chain's extra (buffer + realized slippage)
      // consolidates at the destination, returned there in a single transfer.
      reclaimFromActualBalance: bridge !== null,
    },
    bridge,
    destination: {
      chainId: data.toChainId,
      // The gas swap also runs on the wrapper, so direct dst-chain COT must be handed off even
      // when there is no token swap (gas-only funding has no bridge to deliver the COT).
      eoaToEphemeral:
        (needsTokenSwap || needsGasSwap) && destinationChainDirectCot.gt(0)
          ? {
              amount: mulDecimals(destinationChainDirectCot, dstCOT.decimals),
              contractAddress: dstCOT.address as Hex,
            }
          : null,
      inputAmount: dstInputAmount,
      swap: dstSwap,
      getDstSwap: async (actualCotRaw: bigint) => {
        const [nextTokenSwap, nextGasSwap] = await Promise.all([
          needsTokenSwap
            ? determineDestinationSwaps({
                dst: {
                  chainId: data.toChainId,
                  token: {
                    contractAddress: data.toTokenAddress,
                    amountRaw: data.toAmountRaw,
                  },
                },
                options: {
                  chainList,
                  aggregators,
                  cotCurrencyID: cotCurrencyId,
                  userAddress: destinationQuoteAddress,
                  recipientAddress: options.eoaAddress,
                },
              })
            : Promise.resolve(null),
          needsGasSwap
            ? destinationGasSwapExactIn({
                chainId: data.toChainId,
                gasAmountInCotRaw: gasInCotBudgetRaw,
                options: {
                  chainList,
                  aggregators,
                  cotCurrencyID: cotCurrencyId,
                  userAddress: destinationQuoteAddress,
                  recipientAddress: options.eoaAddress,
                },
              })
            : Promise.resolve(null),
        ]);

        const nextTokenInputAmount = needsTokenSwap
          ? new Decimal(
              nextTokenSwap?.quote.input.amount ??
                formatUnits(data.toAmountRaw, dstTokenInfo.decimals)
            )
          : data.toAmountRaw > 0n
            ? divDecimals(data.toAmountRaw, dstCOT.decimals)
            : new Decimal(0);
        const nextGasInputAmount = nextGasSwap
          ? divDecimals(nextGasSwap.quote.input.amountRaw, dstCOT.decimals)
          : new Decimal(0);
        const nextInputAmount = nextTokenInputAmount.plus(nextGasInputAmount);

        // Budget = the larger of the route-time max and the COT that actually landed. The srcBuffer
        // was bridged on top of the destination buffer, so when destination drift pushes the requote
        // past the route max it can still fill out of what's really at the wrapper instead of failing.
        const maxBudget = Decimal.max(
          originalDestinationMaxInput,
          divDecimals(actualCotRaw, dstCOT.decimals)
        );
        if (nextInputAmount.gt(maxBudget)) {
          throw Errors.ratesChangedBeyondTolerance(
            mulDecimals(nextInputAmount, dstCOT.decimals),
            `max budget: ${maxBudget.toString()}`
          );
        }

        dstInputAmount.min = nextInputAmount;
        dstInputAmount.max = maxBudget;

        if (!nextTokenSwap && !nextGasSwap) return null;
        return { tokenSwap: nextTokenSwap, gasSwap: nextGasSwap };
      },
    },
    buffer: { amount: bufferAmount },
    dstTokenInfo: dstTokenInfo,
    extras: {
      aggregators,
      oraclePrices,
      balances,
      assetsUsed,
    },
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
  };
}

// ---------------------------------------------------------------------------
// Same-token direct bridge (EXACT_IN fast-path)
// ---------------------------------------------------------------------------

type ExactInHolding = {
  chainID: number;
  tokenAddress: Hex;
  amountRaw: bigint;
  decimals: number;
  symbol: string;
};

// Native-normalized token equality: two addresses are the same swap token when they match, or both
// resolve to native (swap internals carry native as EADDRESS; some balances use ZERO_ADDRESS).
const isSameSwapToken = (a: Hex, b: Hex): boolean =>
  equalFold(a, b) || (isNativeAddress(a) && isNativeAddress(b));

/**
 * Path A — direct destination-chain swap (EXACT_IN). Every source is already on the destination
 * chain, so there's no bridge and no destination swap: each non-identity holding is swapped
 * input→toToken directly (receiver = EOA), and holdings that already ARE the destination token pass
 * through untouched. The whole route is one atomic per-chain batch delivering toToken to the EOA.
 *
 * Strict-ALL: if any leg fails to quote, the route can't deliver the full amount, so it throws and
 * the fast-path envelope falls back to the default COT flow (which may bridge or double-hop instead).
 */
async function buildDirectDestinationExactInRoute(
  data: { toChainId: number; toTokenAddress: Hex },
  holdings: ExactInHolding[],
  options: RouteOptions
): Promise<SwapRoute> {
  const { aggregators, chainList, oraclePrices, dstTokenInfo, walletPathHints } = options;
  const dstChainId = data.toChainId;
  const toTokenAddress = data.toTokenAddress;

  // Split identity holdings (already the destination token) from those needing a swap.
  const identityHoldings = holdings.filter((h) => isSameSwapToken(h.tokenAddress, toTokenAddress));
  const swapHoldings = holdings.filter((h) => !isSameSwapToken(h.tokenAddress, toTokenAddress));

  const walletDecision = resolveWalletDecisions({
    sourceChainIds: new Set(holdings.map((h) => h.chainID)),
    walletPathHints,
  });
  // No destination swap on this chain (the swap output IS the final token) → recipient = EOA.
  const recipientAddressByChain = buildSourceRecipientAddressByChain({
    chainIds: holdings.map((h) => h.chainID),
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
    destinationChainId: dstChainId,
    destinationHasSwap: false,
    options,
  });
  // Taker = the per-chain wrapper (Calibur ephemeral / predicted Safe) that executes the swap.
  const userAddressByChain = buildExecutorAddressByChain(walletDecision.sourceExecutionPaths, options);

  const swaps = await liquidateInputHoldings({
    holdings: swapHoldings,
    aggregators,
    chainList,
    cotCurrencyId: options.cotCurrencyId,
    userAddressByChain,
    recipientAddressByChain,
    outputToken: { contractAddress: toTokenAddress },
  });

  if (swaps.length !== swapHoldings.length) {
    throw Errors.quoteFailed(
      `Direct destination swap incomplete: ${swaps.length}/${swapHoldings.length} legs quoted`
    );
  }

  // Total delivered = Σ swap outputs (toToken) + Σ identity holdings (already toToken).
  const swappedDelivered = swaps.reduce(
    (sum, quote) => sum.plus(divDecimals(quote.quote.output.amountRaw, quote.quote.output.decimals)),
    new Decimal(0)
  );
  const identityDelivered = identityHoldings.reduce(
    (sum, holding) => sum.plus(divDecimals(holding.amountRaw, holding.decimals)),
    new Decimal(0)
  );
  const totalDelivered = swappedDelivered.plus(identityDelivered);

  const assetsUsed: AssetsUsedEntry[] = holdings.map((holding) => ({
    chainID: holding.chainID,
    tokenAddress: holding.tokenAddress,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount: formatUnits(holding.amountRaw, holding.decimals),
  }));

  return {
    type: SwapMode.EXACT_IN,
    // No bridge/cleanup on Path A (directDestination skips the sweep), but keep the COT for the
    // public surface's settlement currency.
    settlementCurrencyId: options.cotCurrencyId,
    sameTokenBridge: false,
    directDestination: true,
    source: {
      swaps,
      creationTime: Date.now(),
      cotByChain: new Map<number, SourceChainCOT>(),
      srcBuffer: null,
      reclaimFromActualBalance: false,
    },
    bridge: null,
    destination: {
      chainId: dstChainId,
      eoaToEphemeral: null,
      inputAmount: { min: totalDelivered, max: totalDelivered },
      swap: { tokenSwap: null, gasSwap: null },
      getDstSwap: async () => null,
    },
    buffer: { amount: '0' },
    dstTokenInfo,
    extras: { aggregators, oraclePrices, balances: options.balances, assetsUsed },
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
  };
}

// Oracle lookups key native as ZERO_ADDRESS, but swap internals carry it as EADDRESS — normalize.
const oracleKey = (tokenAddress: Hex): Hex =>
  isNativeAddress(tokenAddress) ? ZERO_ADDRESS : tokenAddress;

const holdingKey = (chainID: number, tokenAddress: Hex): string =>
  `${chainID}:${tokenAddress.toLowerCase()}`;

/**
 * Path A — direct destination-chain swap (EXACT_OUT), with a two-pass carry for gas. All sources are
 * on the destination chain, so each is swapped input→toToken directly (receiver = EOA) with no bridge
 * and no destination swap. When a native gas amount is also requested, a second pass swaps the
 * REMAINDER of each source (original − what the token pass consumed) input→native. Both passes'
 * quotes land in `source.swaps` on the dst chain — one atomic batch delivering toToken + gas to the EOA.
 *
 * The selection target is buffered (`toAmount + srcBuffer`, `toNative + gasSrcBuffer`) so a
 * re-quote can't drop the delivery below the requested amount; over-delivery lands at the EOA.
 * STRICT-ALL: if either pass can't cover its target, the builder throws and the fast-path envelope
 * falls back to the default COT flow.
 */
async function buildDirectDestinationExactOutRoute(
  data: { toChainId: number; toTokenAddress: Hex; toAmountRaw: bigint; toNativeAmountRaw?: bigint },
  holdings: SourceHolding[],
  options: RouteOptions
): Promise<SwapRoute> {
  const { aggregators, chainList, oraclePrices, dstTokenInfo, walletPathHints, cotCurrencyId } =
    options;
  const dstChainId = data.toChainId;
  const destinationChain = chainList.getChainByID(dstChainId);
  const toTokenAddress = data.toTokenAddress;

  // Path A executes only on the dst chain (no bridge) → only dst-chain holdings are usable.
  const dstHoldings = holdings.filter((holding) => holding.chainID === dstChainId);

  const walletDecision = resolveWalletDecisions({
    sourceChainIds: new Set([dstChainId]),
    walletPathHints,
  });
  const recipientAddressByChain = buildSourceRecipientAddressByChain({
    chainIds: [dstChainId],
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
    destinationChainId: dstChainId,
    destinationHasSwap: false,
    options,
  });
  const userAddressByChain = buildExecutorAddressByChain(walletDecision.sourceExecutionPaths, options);

  const priceUsdFor = (tokenAddress: Hex): Decimal | undefined =>
    oraclePrices.find((price) => equalFold(price.tokenAddress, oracleKey(tokenAddress)))?.priceUsd;
  // ≈$0.50 of the output token in raw units (convergence extra-input cap). No price ⇒ undefined
  // (autoSelectSources defaults to 0.5 whole tokens).
  const convergenceExtraRaw = (tokenAddress: Hex, decimals: number): Decimal | undefined => {
    const price = priceUsdFor(tokenAddress);
    if (!price || price.lte(0)) return undefined;
    return new Decimal('0.5').div(price).mul(Decimal.pow(10, decimals));
  };
  const toUsd = (amountHuman: Decimal, tokenAddress: Hex): Decimal => {
    const price = priceUsdFor(tokenAddress);
    return price ? amountHuman.mul(price) : amountHuman; // fallback: treat as USD (≈$1)
  };

  // ── Pass 1: token ──
  const toTokenHuman = divDecimals(data.toAmountRaw, dstTokenInfo.decimals);
  const srcBuffer = applyBuffer(
    toTokenHuman,
    SRC_BUFFER_PCT,
    SRC_BUFFER_MAX_USD,
    oraclePrices,
    oracleKey(toTokenAddress)
  );
  const tokenResult = await autoSelectSources({
    holdings: dstHoldings,
    outputRequired: toTokenHuman.plus(srcBuffer),
    aggregators,
    chainList,
    cotCurrencyId,
    outputToken: {
      contractAddress: toTokenAddress,
      decimals: dstTokenInfo.decimals,
      maxConvergenceExtraRaw: convergenceExtraRaw(toTokenAddress, dstTokenInfo.decimals),
    },
    userAddressByChain,
    recipientAddressByChain,
  });
  const tokenDeliveredRaw =
    tokenResult.quoteResponses.reduce((sum, quote) => sum + quote.quote.output.amountRaw, 0n) +
    tokenResult.usedCOTs.reduce(
      (sum, used) => sum + mulDecimals(used.amountUsed, used.holding.decimals),
      0n
    );
  if (tokenDeliveredRaw < data.toAmountRaw) {
    throw Errors.quoteFailed('Direct destination EXACT_OUT: token selection cannot cover toAmount');
  }

  // ── Pass 2: gas (remainder-carry) ──
  const requestedNativeAmountRaw =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? data.toNativeAmountRaw : 0n;
  let gasSwaps: QuoteResponse[] = [];
  let gasSrcBuffer: Decimal | undefined;
  if (requestedNativeAmountRaw > 0n) {
    const nativeDecimals = destinationChain.nativeCurrency.decimals;
    const remainderHoldings = subtractConsumedHoldings(dstHoldings, tokenResult);
    const toNativeHuman = divDecimals(requestedNativeAmountRaw, nativeDecimals);
    gasSrcBuffer = applyBuffer(
      toNativeHuman,
      SRC_BUFFER_PCT,
      SRC_BUFFER_MAX_USD,
      oraclePrices,
      ZERO_ADDRESS
    );
    const gasResult = await autoSelectSources({
      holdings: remainderHoldings,
      outputRequired: toNativeHuman.plus(gasSrcBuffer),
      aggregators,
      chainList,
      cotCurrencyId,
      outputToken: {
        contractAddress: EADDRESS as Hex,
        decimals: nativeDecimals,
        maxConvergenceExtraRaw: convergenceExtraRaw(ZERO_ADDRESS, nativeDecimals),
      },
      userAddressByChain,
      recipientAddressByChain,
    });
    gasSwaps = gasResult.quoteResponses;
    const gasDeliveredRaw = gasSwaps.reduce((sum, quote) => sum + quote.quote.output.amountRaw, 0n);
    if (gasDeliveredRaw < requestedNativeAmountRaw) {
      throw Errors.quoteFailed('Direct destination EXACT_OUT: gas selection cannot cover toNativeAmount');
    }
  }

  const swaps = [...tokenResult.quoteResponses, ...gasSwaps];
  if (swaps.length === 0) {
    throw Errors.quoteFailed('Direct destination EXACT_OUT produced no swap legs');
  }

  // buffer.amount = USD equivalent of both buffers (oracle, fallback $1/token).
  const bufferUsd = toUsd(srcBuffer, toTokenAddress).plus(
    gasSrcBuffer ? toUsd(gasSrcBuffer, ZERO_ADDRESS) : new Decimal(0)
  );

  // Consumed input per source (aggregated across both passes) → assetsUsed.
  const consumedByKey = new Map<string, { holding: Holding; raw: bigint }>();
  for (const swap of swaps) {
    const key = holdingKey(swap.chainID, swap.holding.tokenAddress);
    const prev = consumedByKey.get(key);
    consumedByKey.set(key, {
      holding: swap.holding,
      raw: (prev?.raw ?? 0n) + swap.quote.input.amountRaw,
    });
  }
  const assetsUsed: AssetsUsedEntry[] = [...consumedByKey.values()].map(({ holding, raw }) => ({
    chainID: holding.chainID,
    tokenAddress: holding.tokenAddress,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount: formatUnits(raw, holding.decimals),
  }));

  return {
    type: SwapMode.EXACT_OUT,
    settlementCurrencyId: cotCurrencyId,
    sameTokenBridge: false,
    directDestination: true,
    source: {
      swaps,
      creationTime: Date.now(),
      cotByChain: new Map<number, SourceChainCOT>(),
      srcBuffer,
      gasSrcBuffer,
      reclaimFromActualBalance: false,
    },
    bridge: null,
    destination: {
      chainId: dstChainId,
      eoaToEphemeral: null,
      // EXACT_OUT Path A delivers the exact toAmount straight from the source swaps; the dst-swap
      // input bounds are unread for this shape.
      inputAmount: { min: new Decimal(0), max: new Decimal(0) },
      swap: { tokenSwap: null, gasSwap: null },
      getDstSwap: async () => null,
    },
    buffer: { amount: bufferUsd.toString() },
    dstTokenInfo,
    extras: { aggregators, oraclePrices, balances: options.balances, assetsUsed },
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
  };
}

// Remainder holdings after a token pass: original − consumed input per source (floor 0), with USD
// value scaled proportionally so the gas pass's prefix survey stays accurate.
const subtractConsumedHoldings = (
  holdings: SourceHolding[],
  result: { quoteResponses: QuoteResponse[]; usedCOTs: { holding: Holding; amountUsed: Decimal }[] }
): SourceHolding[] => {
  const consumedByKey = new Map<string, bigint>();
  const add = (chainID: number, tokenAddress: Hex, raw: bigint) => {
    const key = holdingKey(chainID, tokenAddress);
    consumedByKey.set(key, (consumedByKey.get(key) ?? 0n) + raw);
  };
  for (const quote of result.quoteResponses) {
    add(quote.chainID, quote.holding.tokenAddress, quote.quote.input.amountRaw);
  }
  for (const used of result.usedCOTs) {
    add(used.holding.chainID, used.holding.tokenAddress, mulDecimals(used.amountUsed, used.holding.decimals));
  }
  const remainders: SourceHolding[] = [];
  for (const holding of holdings) {
    const consumed = consumedByKey.get(holdingKey(holding.chainID, holding.tokenAddress)) ?? 0n;
    const remainderRaw = holding.amountRaw > consumed ? holding.amountRaw - consumed : 0n;
    if (remainderRaw > 0n) {
      const ratio = new Decimal(remainderRaw.toString()).div(holding.amountRaw.toString());
      remainders.push({
        ...holding,
        amountRaw: remainderRaw,
        value: new Decimal(holding.value).mul(ratio).toNumber(),
      });
    }
  }
  return remainders;
};

// Resolve the bridge provider on the same-token being bridged, assemble the bridge object, and
// enrich it when the pick is Mayan. Shared by both same-token builders — EXACT_IN derives delivery
// from the gross, EXACT_OUT grosses up from the target, then each finalizes here. forceMayan
// short-circuits inside resolveBridgeProviderDecision; native is priced like any token (the caller
// already normalized it to ZERO_ADDRESS).
const finalizeSameTokenBridge = async (
  params: {
    assets: BridgeAsset[];
    grossBridged: Decimal;
    tokenAmount: Decimal;
    fees: NonNullable<SwapRoute['bridge']>['estimatedFees'];
    dstChainId: number;
    dstTokenAddress: Hex;
    dstTokenDecimals: number;
  },
  options: RouteOptions
): Promise<NonNullable<SwapRoute['bridge']>> => {
  const provider = (
    await resolveBridgeProviderDecision(
      {
        context: 'fast-path',
        dstChainId: params.dstChainId,
        dstTokenToCheck: params.dstTokenAddress,
        amountRawForRequest: mulDecimals(params.grossBridged, params.dstTokenDecimals),
        roughSources: params.assets.map((asset) => ({
          chainID: asset.chainID,
          tokenAddress: asset.contractAddress,
        })),
      },
      options
    )
  ).provider;
  const bridge: NonNullable<SwapRoute['bridge']> = {
    amount: params.grossBridged,
    amounts: {
      tokenAmount: params.tokenAmount,
      gasInCot: new Decimal(0),
      totalAmount: params.grossBridged,
    },
    assets: params.assets,
    chainID: params.dstChainId,
    decimals: params.dstTokenDecimals,
    tokenAddress: params.dstTokenAddress,
    estimatedFees: params.fees,
    provider,
  };
  return provider === 'mayan' ? enrichMayanBridge(bridge, options) : bridge;
};

/**
 * EXACT_IN same-token direct bridge: when `resolveSwapSettlement` reports `sameTokenBridge` (every
 * source is the same non-COT bridgeable mesh family as the destination token, ERC-20 or native),
 * bridge the token directly EOA→EOA — no source swap, no destination swap, no buffers.
 */
async function buildSameTokenBridgeRoute(
  data: { toChainId: number; toTokenAddress: Hex },
  holdings: ExactInHolding[],
  options: RouteOptions,
  settlementCurrencyId: number
): Promise<SwapRoute> {
  const { oraclePrices, dstTokenInfo, walletPathHints, aggregators } = options;
  const dstChainId = data.toChainId;
  // Swap internals carry native as EADDRESS, but the bridge intent's `getTokenByAddress` lookup
  // only resolves ZERO_ADDRESS as native — normalize both the bridged token and source assets.
  const dstTokenAddress: Hex = isNativeAddress(dstTokenInfo.contractAddress)
    ? ZERO_ADDRESS
    : (dstTokenInfo.contractAddress as Hex);

  // dst-chain holdings already sit at the EOA as the right token; only other-chain holdings are
  // bridged. Bridge funding is EOA-held (no swap happened) → eoaBalance.
  const assets: BridgeAsset[] = [];
  let dstChainBalance = new Decimal(0);
  for (const holding of holdings) {
    const amount = divDecimals(holding.amountRaw, holding.decimals);
    if (holding.chainID === dstChainId) {
      dstChainBalance = dstChainBalance.plus(amount);
      continue;
    }
    assets.push({
      chainID: holding.chainID,
      contractAddress: isNativeAddress(holding.tokenAddress) ? ZERO_ADDRESS : holding.tokenAddress,
      decimals: holding.decimals,
      eoaBalance: amount,
      ephemeralBalance: new Decimal(0),
    });
  }

  if (assets.length > 0 && !options.bridgeQuoteResponse) {
    throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
  }

  let bridge: SwapRoute['bridge'] = null;
  let deliveredFromBridge = new Decimal(0);
  if (assets.length > 0) {
    const bridgedToken = assets.reduce(
      (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
      new Decimal(0)
    );
    const bridgeQuoteResponse = options.bridgeQuoteResponse;
    if (!bridgeQuoteResponse) {
      throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
    }
    const fees = computeBridgeFees({
      quoteResponse: bridgeQuoteResponse,
      grossBridged: bridgedToken,
      dstCOTDecimals: dstTokenInfo.decimals,
    });
    const totalFee = fees.collection.plus(fees.fulfilment).plus(fees.protocol);
    deliveredFromBridge = bridgedToken.minus(totalFee);
    if (deliveredFromBridge.lte(0)) {
      throw Errors.insufficientBalance(
        `Bridge fees (${totalFee.toString()}) exceed bridged amount (${bridgedToken.toString()})`
      );
    }
    // The fast path participates in provider selection too, querying the server with the actual
    // bridged same-token (not the COT). Native is priced like any other token (already normalized to
    // ZERO_ADDRESS above); forceMayan still short-circuits inside resolveBridgeProviderDecision.
    bridge = await finalizeSameTokenBridge(
      {
        assets,
        grossBridged: bridgedToken,
        tokenAmount: deliveredFromBridge,
        fees,
        dstChainId,
        dstTokenAddress,
        dstTokenDecimals: dstTokenInfo.decimals,
      },
      options
    );
  }

  const finalDelivered = deliveredFromBridge.plus(dstChainBalance);
  const walletDecision = resolveWalletDecisions({
    sourceChainIds: new Set(holdings.map((holding) => holding.chainID)),
    walletPathHints,
  });
  const assetsUsed: AssetsUsedEntry[] = holdings.map((holding) => ({
    chainID: holding.chainID,
    tokenAddress: holding.tokenAddress,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount: formatUnits(holding.amountRaw, holding.decimals),
  }));

  return {
    type: SwapMode.EXACT_IN,
    settlementCurrencyId,
    sameTokenBridge: true,
    source: {
      swaps: [],
      creationTime: Date.now(),
      cotByChain: new Map<number, SourceChainCOT>(),
      srcBuffer: new Decimal(0),
    },
    bridge,
    destination: {
      chainId: dstChainId,
      eoaToEphemeral: null,
      inputAmount: { min: finalDelivered, max: finalDelivered },
      swap: { tokenSwap: null, gasSwap: null },
      getDstSwap: async () => null,
    },
    buffer: { amount: '0' },
    dstTokenInfo,
    extras: {
      aggregators,
      oraclePrices,
      balances: options.balances,
      assetsUsed,
    },
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
  };
}

/**
 * B1 — EXACT_OUT same-token direct bridge (mirror of buildSameTokenBridgeRoute). Every source and the
 * destination token share one non-COT mesh family F, so bridge F directly EOA→EOA — no swaps, no
 * buffers. Grosses up the exact target through the bridge fee so delivered == toAmount:
 * `gross = (toAmount + fulfilment) / (1 − fulfillmentBps/1e4)`, fees from an F-denominated quote (never
 * the preflight USDC quote). Funds via a greedy split over priority-ordered remote family holdings
 * (native holdings keep a per-chain gas reserve). Shortfall / Mayan undershoot / no F-quote ⇒ throw ⇒
 * the fast-path envelope falls back to the COT flow.
 */
async function buildSameTokenBridgeExactOutRoute(
  data: { toChainId: number; toTokenAddress: Hex; toAmountRaw: bigint },
  holdings: SourceHolding[],
  options: RouteOptions,
  settlementCurrencyId: number
): Promise<SwapRoute> {
  const { chainList, oraclePrices, dstTokenInfo, walletPathHints, aggregators, publicClientList } =
    options;
  const dstChainId = data.toChainId;
  const dstTokenAddress: Hex = isNativeAddress(dstTokenInfo.contractAddress)
    ? ZERO_ADDRESS
    : (dstTokenInfo.contractAddress as Hex);

  // F-denominated bridge-fee quote (fees follow the bridged token — the preflight USDC quote would be
  // a decimal trap). Null ⇒ fall back.
  const fQuote = await fetchBridgeQuoteForCurrency(dstChainId, settlementCurrencyId, options);
  if (!fQuote) {
    throw Errors.internal('Same-token EXACT_OUT: bridge fee quote unavailable');
  }

  // Gross up the exact target so delivered == toAmount after fees.
  const toAmountHuman = divDecimals(data.toAmountRaw, dstTokenInfo.decimals);
  const fulfilment = divDecimals(fQuote.destination.fulfillmentFeeToken, dstTokenInfo.decimals);
  const bpsFraction = new Decimal(fQuote.fulfillmentBps).div(10000);
  if (bpsFraction.gte(1)) {
    throw Errors.internal('Same-token EXACT_OUT: fulfillmentBps >= 100%');
  }
  const grossBridged = toAmountHuman.plus(fulfilment).div(new Decimal(1).minus(bpsFraction));

  // Greedy split over priority-ordered remote family-F holdings. Native holdings keep a per-chain gas
  // reserve so the deposit tx can pay for itself (never consume 100% native).
  const familyHoldings = holdings.filter(
    (holding) =>
      holding.chainID !== dstChainId &&
      resolveCurrencyId(chainList, holding.chainID, holding.tokenAddress) === settlementCurrencyId
  );
  const assets: BridgeAsset[] = [];
  const usedHoldings: { holding: SourceHolding; used: Decimal }[] = [];
  let remaining = grossBridged;
  for (const holding of familyHoldings) {
    if (remaining.lte(0)) break;
    let available = divDecimals(holding.amountRaw, holding.decimals);
    if (isNativeAddress(holding.tokenAddress)) {
      const reserveRaw = await estimateRepresentativeSwapNativeReserveFee({
        chain: chainList.getChainByID(holding.chainID),
        publicClient: publicClientList.get(holding.chainID),
      });
      available = Decimal.max(
        available.minus(divDecimals(reserveRaw, holding.decimals)),
        new Decimal(0)
      );
    }
    const use = Decimal.min(available, remaining);
    if (use.lte(0)) continue;
    assets.push({
      chainID: holding.chainID,
      contractAddress: isNativeAddress(holding.tokenAddress) ? ZERO_ADDRESS : holding.tokenAddress,
      decimals: holding.decimals,
      eoaBalance: use,
      ephemeralBalance: new Decimal(0),
    });
    usedHoldings.push({ holding, used: use });
    remaining = remaining.minus(use);
  }
  if (remaining.gt(0)) {
    throw Errors.insufficientBalance(
      `Same-token EXACT_OUT: family holdings cannot cover the grossed-up target (${remaining.toString()} short)`
    );
  }

  const fees = computeBridgeFees({
    quoteResponse: fQuote,
    grossBridged,
    dstCOTDecimals: dstTokenInfo.decimals,
  });
  const bridge = await finalizeSameTokenBridge(
    {
      assets,
      grossBridged,
      tokenAmount: toAmountHuman,
      fees,
      dstChainId,
      dstTokenAddress,
      dstTokenDecimals: dstTokenInfo.decimals,
    },
    options
  );

  // Mayan prices per leg and can undershoot the exact target (no convergence loop in v1). If the
  // enriched quotes don't cover toAmount, fall back to the COT flow (which converges to it).
  if (bridge.provider === 'mayan' && bridge.mayanQuotesBySource) {
    const delivered = [...bridge.mayanQuotesBySource.values()].reduce(
      (sum, quote) => sum.plus(new Decimal(quote.minReceived.toString())),
      new Decimal(0)
    );
    if (delivered.lt(toAmountHuman)) {
      throw Errors.insufficientBalance(
        'Same-token EXACT_OUT: Mayan quotes undershoot the exact target'
      );
    }
  }

  const walletDecision = resolveWalletDecisions({
    sourceChainIds: new Set(assets.map((asset) => asset.chainID)),
    walletPathHints,
  });
  const assetsUsed: AssetsUsedEntry[] = usedHoldings.map(({ holding, used }) => ({
    chainID: holding.chainID,
    tokenAddress: holding.tokenAddress,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount: used.toString(),
  }));

  return {
    type: SwapMode.EXACT_OUT,
    settlementCurrencyId,
    sameTokenBridge: true,
    source: {
      swaps: [],
      creationTime: Date.now(),
      cotByChain: new Map<number, SourceChainCOT>(),
      srcBuffer: new Decimal(0),
    },
    bridge,
    destination: {
      chainId: dstChainId,
      eoaToEphemeral: null,
      inputAmount: { min: toAmountHuman, max: toAmountHuman },
      swap: { tokenSwap: null, gasSwap: null },
      getDstSwap: async () => null,
    },
    buffer: { amount: '0' },
    dstTokenInfo,
    extras: { aggregators, oraclePrices, balances: options.balances, assetsUsed },
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
  };
}

/**
 * B2 — dynamic COT (both modes). Every source shares one STABLE family F ≠ the destination family and
 * ≠ the current COT, and F resolves as a COT on the destination chain. Rather than settle through USDC
 * (source→USDC→bridge→USDC→output — two swap hops), re-enter the same route flow with `cotCurrencyId = F`
 * so the sources ARE the COT: zero source swaps, bridge F, one F→output destination swap. The re-entry
 * threads an F-denominated bridge-fee quote and sets `skipFastPaths` to stop the recursion. A null
 * F-quote or a re-entry throw (e.g. insufficient F) ⇒ the fast-path envelope falls back to the COT flow.
 */
async function buildDynamicCotExactInRoute(
  data: { sources?: { chainId: number; amountRaw?: bigint; tokenAddress: Hex }[]; toChainId: number; toTokenAddress: Hex },
  options: RouteOptions,
  familyId: number
): Promise<SwapRoute | null> {
  const fQuote = await fetchBridgeQuoteForCurrency(data.toChainId, familyId, options);
  if (!fQuote) return null;
  // EXACT_IN needs no source allowlist — the classifier already proved every holding is family F.
  return _exactInRoute(data, {
    ...options,
    cotCurrencyId: familyId,
    bridgeQuoteResponse: fQuote,
    skipFastPaths: true,
  });
}

async function buildDynamicCotExactOutRoute(
  data: { toChainId: number; toTokenAddress: Hex; toAmountRaw: bigint; toNativeAmountRaw?: bigint; sources?: Source[] },
  holdings: SourceHolding[],
  options: RouteOptions,
  familyId: number
): Promise<SwapRoute | null> {
  const fQuote = await fetchBridgeQuoteForCurrency(data.toChainId, familyId, options);
  if (!fQuote) return null;
  // EXACT_OUT sources aren't explicit, so restrict the re-entry to the family-F holdings (the allowlist
  // `filterExactOutBalances` honors) → every source is a COT ⇒ zero source swaps. Insufficient F inside
  // ⇒ throws `insufficientBalance` ⇒ tryFastPath falls back.
  const sources: Source[] = holdings
    .filter((h) => resolveCurrencyId(options.chainList, h.chainID, h.tokenAddress) === familyId)
    .map((h) => ({ chainId: h.chainID, tokenAddress: h.tokenAddress }));
  return _exactOutRoute(
    { ...data, sources },
    { ...options, cotCurrencyId: familyId, bridgeQuoteResponse: fQuote, skipFastPaths: true }
  );
}

// ---------------------------------------------------------------------------
// EXACT_IN route
// ---------------------------------------------------------------------------

async function _exactInRoute(
  data: {
    sources?: { chainId: number; amountRaw?: bigint; tokenAddress: Hex }[];
    toChainId: number;
    toTokenAddress: Hex;
  },
  options: RouteOptions
): Promise<SwapRoute> {
  const { aggregators, chainList, oraclePrices, dstTokenInfo, walletPathHints } = options;
  const destinationChain = chainList.getChainByID(data.toChainId);

  // Build holdings from input
  const rawHoldings = resolveExactInHoldings(data.sources ?? [], options.balances);

  if (rawHoldings.length === 0) {
    throw Errors.insufficientBalance('No usable balances for swap route');
  }

  // ── Fast paths (skipped on the B2 re-entry, which sets skipFastPaths). Classified once; Path A
  // gates before the same-token dispatch, B2 after it (see the ladder). ──
  const fastPathClass = options.skipFastPaths
    ? null
    : classifyFastPath({
        chainList,
        members: rawHoldings.map((h) => ({ chainID: h.chainID, tokenAddress: h.tokenAddress })),
        dstChainId: data.toChainId,
        dstTokenAddress: data.toTokenAddress,
        cotCurrencyId: options.cotCurrencyId,
        needsTokenSwap: !toTokenIsCot(chainList, data.toChainId, data.toTokenAddress, options.cotCurrencyId),
        hasGasRequest: false,
        toAmountRaw: 0n,
        mode: SwapMode.EXACT_IN,
      });
  // Path A — direct destination swap. Classified BEFORE the same-token dispatch so a
  // same-family-on-dst-chain set (e.g. [WETH@Base] → native ETH@Base) direct-quotes input→toToken
  // instead of hitting the same-token bridge and delivering the wrong token.
  if (fastPathClass?.kind === 'direct') {
    const direct = await tryFastPath('direct', () =>
      buildDirectDestinationExactInRoute(data, rawHoldings, options)
    );
    if (direct) return direct;
  }

  // Settlement decision — shared with preflight via `resolveSwapSettlement` so the fee-quote token
  // and the route can't drift. `sameTokenBridge` ⇒ every source is the same non-COT mesh family as
  // the destination, so bridge that token directly EOA→EOA (skips the COT round-trip + buffers and
  // makes its own provider decision). Otherwise settle through the COT.
  const settlement = resolveSwapSettlement(
    chainList,
    SwapMode.EXACT_IN,
    rawHoldings.map((h) => ({ chainId: h.chainID, tokenAddress: h.tokenAddress })),
    data.toChainId,
    data.toTokenAddress,
    options.cotCurrencyId
  );
  if (settlement.sameTokenBridge) {
    return buildSameTokenBridgeRoute(data, rawHoldings, options, settlement.currencyId);
  }

  // B2 — dynamic COT: gated AFTER the same-token dispatch (a same-family-as-dst set already returned
  // above). Re-enters this flow with cotCurrencyId = F so the sources ARE the COT (zero source swaps).
  if (fastPathClass?.kind === 'dynamic-cot') {
    const b2 = await tryFastPath('dynamic-cot', () =>
      buildDynamicCotExactInRoute(data, options, fastPathClass.familyId)
    );
    if (b2) return b2;
  }

  // COT round-trip: settle in the COT. `settlement.currencyId === options.cotCurrencyId` here (any
  // same-token case returned above); thread it so every resolveCOT in this flow uses one source.
  const currencyId = settlement.currencyId;
  const dstCOT = resolveCOT(data.toChainId, chainList, currencyId);

  // Resolve the COT-route bridge provider from the *bridged* USD — the value of the non-dst
  // holdings that actually cross chains (not the sum of all balances). The pick drives
  // `minOutputUsdPerSource`, which the per-chain filter below uses to drop chains whose
  // post-source-swap USDC leg can't clear Mayan's quote floor. EXACT_IN doesn't go through
  // autoSelectSources, so that filter runs here against the user's holdings before COT splitting.
  const bridgedRoughHoldings = rawHoldings.filter((h) => h.chainID !== data.toChainId);
  const { provider: bridgeProvider, minOutputUsdPerSource } = await resolveBridgeProviderDecision(
    {
      context: 'EXACT_IN',
      dstChainId: data.toChainId,
      dstTokenToCheck: dstCOT.address as Hex,
      amountRawForRequest: mulDecimals(
        sumHoldingsUsd(bridgedRoughHoldings, options.balances, oraclePrices),
        dstCOT.decimals
      ),
      // The Mayan-eligibility gate must judge the token that actually crosses chains: a COT route
      // liquidates every source to the COT before bridging, so the bridged token is the per-chain
      // COT, not the source holding's token. (Falls back to the holding token if a source chain has
      // no COT.) Matches the execution backstop in enrichMayanBridge, which checks the COT asset.
      roughSources: bridgedRoughHoldings.map((h) => ({
        chainID: h.chainID,
        tokenAddress: bridgedTokenForChain(h.chainID, h.tokenAddress, chainList, currencyId),
      })),
    },
    options
  );

  // Mayan-only: drop selected source chains whose bridged USD can't clear Mayan's per-leg quote
  // floor (`minOutputUsdPerSource`, set only for a Mayan pick). Nexus has no per-leg minimum, so
  // its holdings pass through untouched — keeping the provider branch obvious at the call site.
  let holdings = rawHoldings;
  if (bridgeProvider === 'mayan') {
    const floor = minOutputUsdPerSource ?? new Decimal(MAYAN_MIN_USD_PER_LEG);
    const filtered = dropSubFloorMayanChains(rawHoldings, options.balances, oraclePrices, floor);
    holdings = filtered.holdings;

    if (filtered.droppedMayanChains.length > 0) {
      // Why a selected source chain didn't make the Mayan bridge: its bridged USD is below the floor.
      logger.debug('swap.mayan:dropped-sub-floor-chains', {
        minOutputUsdPerSource: floor.toString(),
        dropped: filtered.droppedMayanChains.map((c) => ({
          chainID: c.chainID,
          valueUsd: c.valueUsd.toString(),
        })),
      });
    }

    if (holdings.length === 0) {
      throwMayanRouteShortfall(
        filtered.droppedMayanChains,
        chainList,
        new Decimal(0),
        new Decimal(0),
        floor
      );
    }
  }

  // Separate COT vs non-COT
  const tryResolveCOT = (chainId: number) => {
    try {
      return resolveCOT(chainId, chainList, currencyId);
    } catch {
      return undefined;
    }
  };

  const cotHoldings = holdings.filter((h) => {
    const cot = tryResolveCOT(h.chainID);
    return cot && equalFold(h.tokenAddress, cot.address);
  });
  const nonCotHoldings = holdings.filter((h) => {
    const cot = tryResolveCOT(h.chainID);
    return !cot || !equalFold(h.tokenAddress, cot.address);
  });

  // Bridge check: any source not on destination chain?
  const allOnDstChain = holdings.every((h) => h.chainID === data.toChainId);
  const allChainIds = new Set(holdings.map((h) => h.chainID));
  if (!allOnDstChain && !options.bridgeQuoteResponse) {
    throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
  }

  // Destination swap
  const needsTokenSwap = !equalFold(data.toTokenAddress, dstCOT.address);
  const walletDecision = resolveWalletDecisions({
    sourceChainIds: allChainIds,
    walletPathHints,
  });
  const destinationQuoteAddress = needsTokenSwap
    ? destinationWrapperAddress(destinationChain, options)
    : options.eoaAddress;
  const userAddressByChain = buildExecutorAddressByChain(
    walletDecision.sourceExecutionPaths,
    options
  );
  const recipientAddressByChain = buildSourceRecipientAddressByChain({
    chainIds: allChainIds,
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
    destinationChainId: data.toChainId,
    destinationHasSwap: needsTokenSwap,
    options,
  });

  // Liquidate non-COT holdings to COT
  const sourceSwaps =
    nonCotHoldings.length > 0
      ? await liquidateInputHoldings({
          holdings: nonCotHoldings,
          aggregators,
          chainList: options.chainList,
          // Settlement currency (= options.cotCurrencyId in the default flow, = F on the B2 re-entry),
          // NOT options.cotCurrencyId — matches the tryResolveCOT split above and keeps every COT read
          // in this flow on one source.
          cotCurrencyId: currencyId,
          userAddressByChain,
          recipientAddressByChain,
        })
      : [];

  // Combined COT from direct + swap outputs
  let totalCOT = new Decimal(0);
  for (const c of cotHoldings) {
    const cot = resolveCOT(c.chainID, chainList, currencyId);
    totalCOT = totalCOT.plus(divDecimals(c.amountRaw, cot.decimals));
  }
  for (const q of sourceSwaps) {
    totalCOT = totalCOT.plus(q.quote.output.amount);
  }

  let dstSwap: DestinationSwap = { tokenSwap: null, gasSwap: null };

  const destinationChainDirectCot = cotHoldings
    .filter((holding) => holding.chainID === data.toChainId)
    .reduce(
      (sum, holding) => sum.plus(divDecimals(holding.amountRaw, dstCOT.decimals)),
      new Decimal(0)
    );
  // Source-swap COT produced on the destination chain stays put (it isn't bridged), so it must
  // be added back when the bridge branch recomputes the destination total — otherwise the local
  // swap output silently vanishes from the delivered amount (display-only when toToken IS COT,
  // a real under-sized dst swap otherwise). Mirrors `_exactOutRoute`'s `destinationChainSwapCot`.
  const destinationChainSwapCot = sourceSwaps
    .filter((q) => q.chainID === data.toChainId)
    .reduce((sum, q) => sum.plus(q.quote.output.amount), new Decimal(0));
  const destinationChainCot = destinationChainDirectCot.plus(destinationChainSwapCot);
  let cotAvailableForDestination = totalCOT;

  // Bridge
  let bridge: SwapRoute['bridge'] = null;
  if (!allOnDstChain) {
    const assets: BridgeAsset[] = [];
    for (const q of sourceSwaps) {
      if (q.chainID === data.toChainId) continue;
      const cot = resolveCOT(q.chainID, chainList, currencyId);
      const outputAmount = new Decimal(q.quote.output.amount);
      const existing = assets.find((asset) => asset.chainID === q.chainID);
      if (existing) {
        existing.ephemeralBalance = existing.ephemeralBalance.plus(outputAmount);
      } else {
        assets.push({
          chainID: q.chainID,
          contractAddress: cot?.address ?? q.quote.output.contractAddress,
          decimals: cot?.decimals ?? q.quote.output.decimals,
          eoaBalance: new Decimal(0),
          ephemeralBalance: outputAmount,
        });
      }
    }
    for (const c of cotHoldings) {
      if (c.chainID === data.toChainId) continue;
      const cot = resolveCOT(c.chainID, chainList, currencyId);
      const cotAmount = divDecimals(c.amountRaw, cot?.decimals ?? 6);
      const existing = assets.find((asset) => asset.chainID === c.chainID);
      if (existing) {
        existing.eoaBalance = existing.eoaBalance.plus(cotAmount);
      } else {
        assets.push({
          chainID: c.chainID,
          contractAddress: cot?.address ?? c.tokenAddress,
          decimals: cot?.decimals ?? 6,
          eoaBalance: cotAmount,
          ephemeralBalance: new Decimal(0),
        });
      }
    }

    if (assets.length > 0) {
      const bridgedCOT = assets.reduce(
        (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
        new Decimal(0)
      );
      const bridgeQuoteResponse = options.bridgeQuoteResponse;
      if (!bridgeQuoteResponse) {
        throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
      }
      const fees = computeBridgeFees({
        quoteResponse: bridgeQuoteResponse,
        grossBridged: bridgedCOT,
        dstCOTDecimals: dstCOT.decimals,
      });
      const totalFeeAmount = fees.collection.plus(fees.fulfilment).plus(fees.protocol);
      const effectiveBridgedToDestination = bridgedCOT.minus(totalFeeAmount);
      if (effectiveBridgedToDestination.lte(0)) {
        throw Errors.insufficientBalance(
          `Bridge fees (${totalFeeAmount.toString()}) exceed bridged COT (${bridgedCOT.toString()})`
        );
      }
      cotAvailableForDestination = destinationChainCot.plus(effectiveBridgedToDestination);
      bridge = {
        amount: bridgedCOT,
        amounts: {
          tokenAmount: effectiveBridgedToDestination,
          gasInCot: new Decimal(0),
          totalAmount: bridgedCOT,
        },
        assets,
        chainID: data.toChainId,
        decimals: dstCOT.decimals,
        tokenAddress: dstCOT.address as Hex,
        estimatedFees: fees,
        provider: bridgeProvider,
      };

      if (bridgeProvider === 'mayan') {
        bridge = await enrichMayanBridge(bridge, options);
        // Mayan's actual delivered COT (Σ minReceived) is known only after the per-leg quote and
        // supersedes the Nexus-fee estimate above — size the destination swap off what actually
        // lands, otherwise the dst swap is quoted for more COT than the bridge delivers and fails.
        if (bridge.mayanQuotesBySource) {
          const mayanDelivered = [...bridge.mayanQuotesBySource.values()].reduce(
            (sum, quote) => Decimal.add(sum, new Decimal(quote.minReceived.toString())),
            new Decimal(0)
          );
          cotAvailableForDestination = destinationChainCot.plus(mayanDelivered);
          bridge = { ...bridge, amounts: { ...bridge.amounts, tokenAmount: mayanDelivered } };
        }
      }
    }
  }

  // EXACT_IN quotes the destination swap at the FULL available COT — there is no source buffer.
  // A source leg that requotes lower simply delivers less COT; Seam 2 (getDstSwap) re-sizes the
  // dst swap down to whatever actually lands, so there is no floor to reserve here.
  if (needsTokenSwap && cotAvailableForDestination.gt(0)) {
    const dstQuote = await destinationSwapWithExactIn({
      chainId: data.toChainId,
      input: {
        amountRaw: mulDecimals(cotAvailableForDestination, dstCOT.decimals),
        tokenAddress: dstCOT.address,
      },
      outputToken: data.toTokenAddress,
      options: {
        chainList,
        aggregators,
        userAddress: destinationQuoteAddress,
        recipientAddress: options.eoaAddress,
      },
    });
    if (!dstQuote) {
      throw Errors.quoteFailed(
        `No destination swap quote available for chain ${data.toChainId} token ${data.toTokenAddress}`
      );
    }
    dstSwap = { tokenSwap: dstQuote, gasSwap: null };
  }

  // Shared EXACT_IN destination-swap quote at a given COT input (human units), used by both
  // execution-time requote paths. No rate-tolerance guard — a requote is accepted whatever it returns.
  const quoteDstSwapAtInput = async (inputHuman: Decimal): Promise<DestinationSwap | null> => {
    if (!needsTokenSwap) return null;
    const q = await destinationSwapWithExactIn({
      chainId: data.toChainId,
      input: {
        amountRaw: mulDecimals(inputHuman, dstCOT.decimals),
        tokenAddress: dstCOT.address,
      },
      outputToken: data.toTokenAddress,
      options: {
        chainList,
        aggregators,
        userAddress: destinationQuoteAddress,
        recipientAddress: options.eoaAddress,
      },
    });
    if (!q) return null;
    return { tokenSwap: q, gasSwap: null };
  };

  const assetsUsed: AssetsUsedEntry[] = holdings.map((h) => ({
    chainID: h.chainID,
    tokenAddress: h.tokenAddress,
    symbol: h.symbol,
    decimals: h.decimals,
    amount: formatUnits(h.amountRaw, h.decimals),
  }));

  const balances = options.balances;

  return {
    type: SwapMode.EXACT_IN,
    settlementCurrencyId: currencyId,
    sameTokenBridge: false,
    source: {
      swaps: sourceSwaps,
      creationTime: Date.now(),
      cotByChain: buildSourceCotByChain(sourceSwaps, chainList, currencyId),
      // EXACT_IN: no source buffer — a failed leg re-quotes and proceeds with no drift guard.
      srcBuffer: null,
      // Only meaningful when a bridge runs — execution bridges the actual wrapper balance so
      // positive source slippage reaches the destination instead of being swept at the source.
      reclaimFromActualBalance: bridge !== null,
    },
    bridge,
    destination: {
      chainId: data.toChainId,
      // Direct COT held at the EOA on the destination chain needs to land at the wrapper before
      // the dst swap can pull it. The wrapper is the ephemeral on 7702 chains and the predicted
      // Safe on non-7702 chains; prepare/execution move the COT EOA→wrapper for both (the transfer
      // targets whichever executor runs the swap). Same-chain COT-input swaps rely on this too —
      // there's no bridge to deliver the COT, so it must be moved from the EOA directly.
      eoaToEphemeral:
        needsTokenSwap && destinationChainDirectCot.gt(0)
          ? {
              amount: mulDecimals(destinationChainDirectCot, dstCOT.decimals),
              contractAddress: dstCOT.address as Hex,
            }
          : null,
      // `min` is the getDstSwap floor: 0 when a dst swap runs, so a down-drifted source can never
      // over-size the dst swap (Seam 2 tracks the actual landed COT). With no dst swap (COT dst) it
      // collapses to the full available COT — the delivered amount the intent shows. `max` is the
      // full COT the execution-time reclaim may spend up to.
      inputAmount: {
        min: needsTokenSwap ? new Decimal(0) : cotAvailableForDestination,
        max: cotAvailableForDestination,
      },
      swap: dstSwap,
      // Re-size the dst swap from the COT that actually landed at the wrapper (`actualCotRaw`): the
      // input tracks that balance (less a small deduction). No floor and no upper clamp — `actual` IS
      // the real on-chain balance and `deducted < actual`, so it can never over-spend; the source
      // reclaim can deliver above the route estimate and that surplus is spent here, not swept.
      getDstSwap: (actualCotRaw: bigint) => {
        const actual = divDecimals(actualCotRaw, dstCOT.decimals);
        const execInput = actual.mul(new Decimal(1).minus(DST_RECLAIM_DEDUCTION_PCT));
        return quoteDstSwapAtInput(execInput);
      },
    },
    // EXACT_IN has no buffer (no source buffer, no dst buffer).
    buffer: { amount: '0' },
    dstTokenInfo: dstTokenInfo,
    extras: {
      aggregators,
      oraclePrices,
      balances,
      assetsUsed,
    },
    sourceExecutionPaths: walletDecision.sourceExecutionPaths,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyBuffer(
  amount: Decimal,
  pct: number,
  maxUsd: number,
  oraclePrices: OraclePriceResponse,
  tokenAddress: Hex
): Decimal {
  const pctBuffer = amount.mul(pct);
  const entry = oraclePrices.find((p) => equalFold(p.tokenAddress, tokenAddress));
  const tokenPrice = entry ? entry.priceUsd.toNumber() : 1;
  const maxBufferInToken = new Decimal(maxUsd).div(tokenPrice);
  return Decimal.min(pctBuffer, maxBufferInToken);
}

export function resolveWalletDecisions(input: {
  sourceChainIds: Iterable<number>;
  walletPathHints: Map<number, WalletPath>;
}): WalletDecision {
  const chainIds = [...new Set(input.sourceChainIds)];
  const sourceExecutionPaths = new Map<number, WalletPath>();
  for (const chainId of chainIds) {
    // Preflight populates hints from each chain's 7702 support — 'ephemeral' for 7702 (Calibur
    // SBC), 'safe' for non-7702. Default to 'ephemeral' for any chain the preflight didn't
    // include, mirroring the chainSupports7702 default.
    sourceExecutionPaths.set(chainId, input.walletPathHints.get(chainId) ?? 'ephemeral');
  }
  return { sourceExecutionPaths };
}

function resolveWalletAddress(walletPath: WalletPath, options: RouteOptions): Hex {
  return walletPath === 'safe'
    ? predictSafeAccountAddress(options.ephemeralAddress).address
    : options.ephemeralAddress;
}

function buildExecutorAddressByChain(
  sourceExecutionPaths: Map<number, WalletPath>,
  options: RouteOptions
): Map<number, Hex> {
  return new Map(
    [...sourceExecutionPaths.entries()].map(([chainId, walletPath]) => [
      chainId,
      resolveWalletAddress(walletPath, options),
    ])
  );
}

// Source-swap recipient. Output stays at the per-chain wrapper unless this is the same-chain
// COT-destination case (no dst swap step) — there it can go straight to the user's EOA.
function buildSourceRecipientAddressByChain(input: {
  chainIds: Iterable<number>;
  sourceExecutionPaths: Map<number, WalletPath>;
  destinationChainId: number;
  destinationHasSwap: boolean;
  options: RouteOptions;
}): Map<number, Hex> {
  return new Map(
    [...new Set(input.chainIds)].map((chainId) => {
      // Same-chain + COT destination: no wrapper round-trip, deliver to EOA directly.
      if (chainId === input.destinationChainId && !input.destinationHasSwap) {
        return [chainId, input.options.eoaAddress];
      }
      const path = input.sourceExecutionPaths.get(chainId);
      if (!path) {
        return [chainId, input.options.ephemeralAddress];
      }
      return [chainId, resolveWalletAddress(path, input.options)];
    })
  );
}

// Destination quote taker — the on-chain executor of the dst aggregator swap. For 7702 chains
// it's the Calibur-delegated ephemeral; for non-7702 it's the predicted Safe wrapper.
function destinationWrapperAddress(
  destinationChain: ReturnType<ChainListType['getChainByID']>,
  options: RouteOptions
): Hex {
  return resolveWalletAddress(resolveWalletPath(chainSupports7702(destinationChain)), options);
}

// Convert the user's requested native amount into a COT budget for the destination gas swap.
// Used as the EXACT_IN input to `destinationGasSwapExactIn`; the aggregator decides how much
// native to deliver. Throws when the dst chain's native price isn't in the oracle response —
// the caller already gated on requestedNativeAmountRaw > 0n, so a missing price is fatal.
function computeGasInCotBudgetRaw(input: {
  requestedNativeAmountRaw: bigint;
  destinationChain: ReturnType<ChainListType['getChainByID']>;
  dstCOT: { address: Hex; decimals: number };
  oraclePrices: OraclePriceResponse;
}): bigint {
  const gasInNative = divDecimals(
    input.requestedNativeAmountRaw,
    input.destinationChain.nativeCurrency.decimals
  );
  const budget = convertGasToToken(
    {
      contractAddress: input.dstCOT.address,
      decimals: input.dstCOT.decimals,
    },
    input.oraclePrices,
    input.destinationChain.id,
    input.destinationChain.universe,
    gasInNative
  );
  return mulDecimals(budget, input.dstCOT.decimals);
}

function deductReservedBalance(
  balances: FlatBalance[],
  chainId: number,
  tokenAddress: Hex,
  reserveRaw: bigint,
  decimals: number
): FlatBalance[] {
  const reserved = divDecimals(reserveRaw, decimals);
  return balances.map((balance) => {
    if (balance.chainID !== chainId || !equalFold(balance.tokenAddress, tokenAddress)) {
      return balance;
    }

    const remaining = new Decimal(balance.amount).sub(reserved);
    if (remaining.lte(0)) {
      return { ...balance, amount: '0', value: 0 };
    }

    const ratio = remaining.div(balance.amount);
    return {
      ...balance,
      amount: remaining.toString(),
      value: ratio.mul(balance.value).toNumber(),
    };
  });
}

// toAmountRaw / toNativeAmountRaw sentinel semantics (same shape for both, ported from v1):
//   > 0n : shortfall — bridge this much. The dst-chain toToken / native is reserved for
//          the caller's use (swapAndExecute) or for the user receiving "on top" of their
//          existing balance (direct swap), so it must NOT appear as a swap source.
//   < 0n : surplus — reserve abs(value) of the dst-chain toToken / native; any remainder
//          is usable as a source.
// 0n is a no-op for that side.
function filterExactOutBalances(
  balances: FlatBalance[],
  data: {
    toChainId: number;
    toTokenAddress: Hex;
    toAmountRaw: bigint;
    toNativeAmountRaw?: bigint;
    sources?: Source[];
  },
  destinationChain: { nativeCurrency: { decimals: number } },
  dstTokenDecimals: number
): FlatBalance[] {
  let filtered = balances;

  if (data.sources && data.sources.length > 0) {
    const sources = data.sources;
    filtered = filtered.filter((balance) =>
      sources.some(
        (source) =>
          source.chainId === balance.chainID && equalFold(source.tokenAddress, balance.tokenAddress)
      )
    );
  }

  const removeNativeToken =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? (EADDRESS as Hex) : undefined;
  const removeDstToken = data.toAmountRaw > 0n ? data.toTokenAddress : undefined;

  if (removeDstToken || removeNativeToken) {
    filtered = filtered.filter((balance) => {
      if (balance.chainID !== data.toChainId) return true;
      if (removeDstToken && equalFold(balance.tokenAddress, removeDstToken)) return false;
      if (removeNativeToken && equalFold(balance.tokenAddress, removeNativeToken)) return false;
      return true;
    });
  }

  if (data.toAmountRaw < 0n) {
    filtered = deductReservedBalance(
      filtered,
      data.toChainId,
      data.toTokenAddress,
      -data.toAmountRaw,
      dstTokenDecimals
    );
  }

  if (data.toNativeAmountRaw != null && data.toNativeAmountRaw < 0n) {
    filtered = deductReservedBalance(
      filtered,
      data.toChainId,
      EADDRESS as Hex,
      -data.toNativeAmountRaw,
      destinationChain.nativeCurrency.decimals
    );
  }

  // The sources allowlist + dst-token/native removal + reservation, in vs out — the single line to
  // read when EXACT_OUT seems to ignore (or over-filter) the requested sources.
  logger.debug('swap.exactout:filter-balances', {
    requestedSources: data.sources,
    in: balances.map((b) => ({
      chainID: b.chainID,
      token: b.tokenAddress,
      symbol: b.symbol,
      amount: b.amount,
    })),
    out: filtered.map((b) => ({
      chainID: b.chainID,
      token: b.tokenAddress,
      symbol: b.symbol,
      amount: b.amount,
    })),
  });

  return filtered;
}

function resolveExactInHoldings(
  requestedSources: { chainId: number; amountRaw?: bigint; tokenAddress: Hex }[],
  balances: FlatBalance[]
): {
  chainID: number;
  tokenAddress: Hex;
  amountRaw: bigint;
  decimals: number;
  symbol: string;
}[] {
  if (requestedSources.length === 0) {
    return balances
      .filter((balance) => new Decimal(balance.amount).gt(0))
      .map((balance) => ({
        chainID: balance.chainID,
        tokenAddress: balance.tokenAddress,
        amountRaw: parseUnits(balance.amount, balance.decimals),
        decimals: balance.decimals,
        symbol: balance.symbol,
      }));
  }

  return requestedSources.flatMap((source) => {
    const balance = balances.find(
      (entry) =>
        entry.chainID === source.chainId && equalFold(entry.tokenAddress, source.tokenAddress)
    );
    if (!balance || new Decimal(balance.amount).lte(0)) {
      throw Errors.insufficientBalance('Requested source has no usable balance');
    }

    const availableRaw = parseUnits(balance.amount, balance.decimals);
    const amountRaw = source.amountRaw ?? availableRaw;

    if (amountRaw > availableRaw) {
      throw Errors.insufficientBalance('Requested source amount exceeds available balance');
    }

    return amountRaw > 0n
      ? [
          {
            chainID: source.chainId,
            tokenAddress: source.tokenAddress,
            amountRaw,
            decimals: balance.decimals,
            symbol: balance.symbol,
          },
        ]
      : [];
  });
}
