import Decimal from 'decimal.js';
import { formatUnits, type Hex } from 'viem';
import type { ChainListType } from '../../domain';
import { ZERO_ADDRESS } from '../../domain/constants/addresses';
import { Errors } from '../../domain/errors';
import { logger } from '../../domain/utils';
import { isNativeAddress } from '../../services/addresses';
import { divDecimals, mulDecimals } from '../../services/math';
import { estimateRepresentativeSwapNativeReserveFee } from '../../services/swap-native-reserve-fee';
import { equalFold } from '../../services/strings';
import { withTimingSpan } from '../../services/timing';
import type { Holding } from '../aggregators/types';
import type { SourceHolding } from '../algorithms/auto-select';
import {
  makeConvergenceExtraRaw,
  sizeDirectDestinationExactOut,
} from '../algorithms/direct-destination-size';
import { liquidateInputHoldings } from '../algorithms/liquidate';
import { B2_STABLE_CURRENCY_IDS } from '../constants';
import { type CurrencyID, resolveCOT, resolveCurrencyId } from '../cot';
import type { AssetsUsedEntry, BridgeAsset, SourceChainCOT, SwapRoute } from '../types';
import { SwapMode } from '../types';
import type { RouteOptions } from '../route';
import {
  buildExecutorAddressByChain,
  buildSourceRecipientAddressByChain,
  resolveWalletDecisions,
} from './addresses';
import {
  computeBridgeFees,
  enrichMayanBridge,
  fetchBridgeQuoteForCurrency,
  resolveBridgeProviderDecision,
} from './bridge';

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
export const toTokenIsCot = (
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
  // the destination token are one family, including the current COT; at least one source needs a
  // bridge; no gas leg (disqualified in v1); positive output. A current-COT match belongs here too:
  // it has no swap drift to buffer.
  if (
    input.mode === SwapMode.EXACT_OUT &&
    familyId === dstFamily &&
    members.some((member) => member.chainID !== dstChainId) &&
    !input.hasGasRequest &&
    input.toAmountRaw > 0n
  ) {
    return { kind: 'same-token-out', familyId };
  }

  // B2 — dynamic COT: all members share a STABLE family F distinct from both the destination family
  // and the current COT, and F resolves as a COT on the destination chain (the resolveCOT throw,
  // caught here, is the guard). ETH is excluded by B2_STABLE_CURRENCY_IDS. Requires at least one
  // off-dst-chain member: B2's whole benefit is skipping the F→USDC→bridge→USDC round-trip, so with
  // everything already on the dst chain there is no bridge to optimize (a same-chain F→toToken swap is
  // one hop either way) — firing would only add a wasted F-quote + re-entry. (toToken ≠ cot on dst is
  // Path A's job; toToken == cot is the plain same-chain liquidation.)
  if (
    familyId !== dstFamily &&
    familyId !== cotCurrencyId &&
    B2_STABLE_CURRENCY_IDS.has(familyId as CurrencyID) &&
    !members.every((member) => member.chainID === dstChainId) &&
    cotResolvesOnChain(chainList, dstChainId, familyId)
  ) {
    return { kind: 'dynamic-cot', familyId };
  }

  return null;
};

// Fast-path fallback envelope: a builder that throws or returns null falls through to the next gate
// / the default flow (silent, debug-logged). ONLY builder calls are wrapped — the default flow keeps
// its fail-loud semantics.
export const tryFastPath = async (
  path: NonNullable<FastPathClass>['kind'],
  build: () => Promise<SwapRoute | null>
): Promise<SwapRoute | null> => {
  try {
    return await build();
  } catch (error) {
    logger.debug('swap.route.fast_path.fallback', { path, error: String(error) });
    return null;
  }
};

// ---------------------------------------------------------------------------
// Same-token direct bridge (EXACT_IN fast-path)
// ---------------------------------------------------------------------------

export type ExactInHolding = {
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
export async function buildDirectDestinationExactInRoute(
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
  const userAddressByChain = buildExecutorAddressByChain(
    walletDecision.sourceExecutionPaths,
    options
  );

  const swaps = await withTimingSpan(
    options.timing,
    'flow.swap.route.select_sources',
    async () =>
      liquidateInputHoldings({
        holdings: swapHoldings,
        aggregators,
        chainList,
        cotCurrencyId: options.cotCurrencyId,
        userAddressByChain,
        recipientAddressByChain,
        outputToken: { contractAddress: toTokenAddress },
      }),
    {
      tags: {
        mode: SwapMode.EXACT_IN,
        route_path: 'direct_destination',
        source_leg_count: swapHoldings.length,
      },
    }
  );

  if (swaps.length !== swapHoldings.length) {
    throw Errors.quoteFailed(
      `Direct destination swap incomplete: ${swaps.length}/${swapHoldings.length} legs quoted`
    );
  }

  // Total delivered = Σ swap outputs (toToken) + Σ identity holdings (already toToken).
  const swappedDelivered = swaps.reduce(
    (sum, quote) =>
      sum.plus(divDecimals(quote.quote.output.amountRaw, quote.quote.output.decimals)),
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

  return withTimingSpan(
    options.timing,
    'flow.swap.route.assemble',
    async (): Promise<SwapRoute> => ({
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
    }),
    {
      tags: {
        mode: SwapMode.EXACT_IN,
        route_path: 'direct_destination',
        source_chain_count: 1,
        source_leg_count: swaps.length,
      },
    }
  );
}

const holdingKey = (chainID: number, tokenAddress: Hex): string =>
  `${chainID}:${tokenAddress.toLowerCase()}`;

/**
 * Path A — direct destination-chain swap (EXACT_OUT), with a two-pass carry for gas. All sources are
 * on the destination chain, so each is swapped input→toToken directly (receiver = EOA) with no bridge
 * and no destination swap. When a native gas amount is also requested, a second pass swaps the
 * REMAINDER of each source (original − what the token pass consumed) input→native. Both passes'
 * quotes land in `source.swaps` on the dst chain — one atomic batch delivering toToken + gas to the EOA.
 *
 * Both selection passes target the requested raw amounts exactly. STRICT-ALL: if either pass can't
 * cover its target, the builder throws and the fast-path envelope falls back to the default COT
 * flow.
 */
export async function buildDirectDestinationExactOutRoute(
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
  const userAddressByChain = buildExecutorAddressByChain(
    walletDecision.sourceExecutionPaths,
    options
  );

  const convergenceExtraRaw = makeConvergenceExtraRaw(oraclePrices, dstChainId);

  const requestedNativeAmountRaw =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? data.toNativeAmountRaw : 0n;
  const nativeDecimals = destinationChain.nativeCurrency.decimals;
  const swaps = await withTimingSpan(
    options.timing,
    'flow.swap.route.select_sources',
    async () =>
      sizeDirectDestinationExactOut({
        holdings: dstHoldings,
        tokenAddress: toTokenAddress,
        tokenDecimals: dstTokenInfo.decimals,
        tokenTargetRaw: data.toAmountRaw,
        nativeDecimals,
        gasTargetRaw: requestedNativeAmountRaw,
        aggregators,
        userAddressByChain,
        recipientAddressByChain,
        convergenceExtraRaw,
      }),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        route_path: 'direct_destination',
        source_leg_count: dstHoldings.length,
      },
    }
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

  return withTimingSpan(
    options.timing,
    'flow.swap.route.assemble',
    async (): Promise<SwapRoute> => ({
      type: SwapMode.EXACT_OUT,
      settlementCurrencyId: cotCurrencyId,
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
        // EXACT_OUT Path A delivers the exact toAmount straight from the source swaps; the dst-swap
        // input bounds are unread for this shape.
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
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
        directDestination: {
          dstHoldings,
          toAmountRaw: data.toAmountRaw,
          toNativeAmountRaw: requestedNativeAmountRaw,
        },
      },
      sourceExecutionPaths: walletDecision.sourceExecutionPaths,
    }),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        route_path: 'direct_destination',
        source_chain_count: 1,
        source_leg_count: swaps.length,
      },
    }
  );
}

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
    await withTimingSpan(
      options.timing,
      'flow.swap.route.resolve_provider',
      async () =>
        resolveBridgeProviderDecision(
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
        ),
      { tags: { route_path: 'same_token', source_chain_count: params.assets.length } }
    )
  ).provider;
  return withTimingSpan(
    options.timing,
    'flow.swap.route.build_bridge',
    async () => {
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
    },
    {
      tags: {
        route_path: 'same_token',
        provider,
        source_chain_count: params.assets.length,
      },
    }
  );
};

/**
 * EXACT_IN same-token direct bridge: when `resolveSwapSettlement` reports `sameTokenBridge` (every
 * source is the same non-COT bridgeable mesh family as the destination token, ERC-20 or native),
 * bridge the token directly EOA→EOA — no source swap, no destination swap, no buffers.
 */
export async function buildSameTokenBridgeRoute(
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
    const {
      estimatedFees: fees,
      totalFeeAmount: totalFee,
      deliveredAmount,
    } = computeBridgeFees({
      quoteResponse: bridgeQuoteResponse,
      grossBridged: bridgedToken,
      dstCOTDecimals: dstTokenInfo.decimals,
    });
    deliveredFromBridge = deliveredAmount;
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

  return withTimingSpan(
    options.timing,
    'flow.swap.route.assemble',
    async (): Promise<SwapRoute> => ({
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
    }),
    {
      tags: {
        mode: SwapMode.EXACT_IN,
        route_path: 'same_token',
        provider: bridge?.provider ?? 'none',
        source_chain_count: assets.length,
      },
    }
  );
}

/**
 * B1 — EXACT_OUT same-token direct bridge (mirror of buildSameTokenBridgeRoute). Every source and the
 * destination token share one mesh family F, so bridge F directly EOA→EOA — no swaps, no buffers.
 * This includes the current COT family. Grosses up the exact target through the bridge fee so
 * delivered == toAmount:
 * `gross = (toAmount + fulfilment) / (1 − fulfillmentBps/1e4)`, using a correctly F-denominated
 * quote. Funds via a greedy split over priority-ordered remote family holdings (native holdings keep
 * a per-chain gas reserve). Shortfall / Mayan undershoot / no F-quote ⇒ throw ⇒ the fast-path
 * envelope falls back to the COT flow.
 */
export async function buildSameTokenBridgeExactOutRoute(
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
  const fQuote = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_settlement',
    async () =>
      settlementCurrencyId === options.cotCurrencyId && options.bridgeQuoteResponse
        ? options.bridgeQuoteResponse
        : fetchBridgeQuoteForCurrency(dstChainId, settlementCurrencyId, options),
    { tags: { mode: SwapMode.EXACT_OUT, route_path: 'same_token' } }
  );
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

  const { estimatedFees: fees } = computeBridgeFees({
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

  return withTimingSpan(
    options.timing,
    'flow.swap.route.assemble',
    async (): Promise<SwapRoute> => ({
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
    }),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        route_path: 'same_token',
        provider: bridge.provider,
        source_chain_count: assets.length,
      },
    }
  );
}
