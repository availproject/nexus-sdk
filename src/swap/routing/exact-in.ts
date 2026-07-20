import Decimal from 'decimal.js';
import { formatUnits, type Hex } from 'viem';
import { Errors } from '../../domain/errors';
import { logger } from '../../domain/utils';
import { divDecimals, mulDecimals } from '../../services/math';
import { MAYAN_MIN_USD_PER_LEG, selectMayanQuoteOutput } from '../../services/mayan';
import { equalFold } from '../../services/strings';
import { withTimingSpan } from '../../services/timing';
import { destinationSwapWithExactIn } from '../algorithms/destination';
import { liquidateInputHoldings } from '../algorithms/liquidate';
import { resolveCOT, resolveSwapSettlement } from '../cot';
import type { AssetsUsedEntry, DestinationSwap, SwapRoute } from '../types';
import { SwapMode } from '../types';
import { resolveExactInAmountBasis, selectExactInQuoteOutput } from '../amount-basis';
import type { RouteOptions } from '../route';
import {
  buildExecutorAddressByChain,
  buildSourceRecipientAddressByChain,
  destinationWrapperAddress,
  resolveWalletDecisions,
} from './addresses';
import {
  bridgedTokenForChain,
  buildBridgeAssetsAndFees,
  buildSourceCotByChain,
  enrichMayanBridge,
  fetchBridgeQuoteForCurrency,
  resolveBridgeProviderDecision,
} from './bridge';
import {
  buildDirectDestinationExactInRoute,
  buildSameTokenBridgeRoute,
  classifyFastPath,
  toTokenIsCot,
  tryFastPath,
} from './fast-paths';
import {
  dropSubFloorMayanChains,
  resolveExactInHoldings,
  sumHoldingsUsd,
  throwMayanRouteShortfall,
} from './holdings';

type ExactInData = {
  sources?: { chainId: number; amountRaw?: bigint; tokenAddress: Hex }[];
  toChainId: number;
  toTokenAddress: Hex;
};

type ExactInHolding = Awaited<ReturnType<typeof resolveExactInHoldings>>[number];
type ExactInSourceSwaps = Awaited<ReturnType<typeof liquidateInputHoldings>>;
type ResolvedCot = ReturnType<typeof resolveCOT>;

/**
 * B2 — dynamic COT (both modes). Every source shares one STABLE family F ≠ the destination family and
 * ≠ the current COT, and F resolves as a COT on the destination chain. Rather than settle through USDC
 * (source→USDC→bridge→USDC→output — two swap hops), re-enter the same route flow with `cotCurrencyId = F`
 * so the sources ARE the COT: zero source swaps, bridge F, one F→output destination swap. The re-entry
 * threads an F-denominated bridge-fee quote and sets `skipFastPaths` to stop the recursion. A null
 * F-quote or a re-entry throw (e.g. insufficient F) ⇒ the fast-path envelope falls back to the COT flow.
 */
async function buildDynamicCotExactInRoute(
  data: ExactInData,
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

const resolveExactInProviderAndHoldings = async (
  data: ExactInData,
  rawHoldings: ExactInHolding[],
  dstCOT: ResolvedCot,
  currencyId: number,
  options: RouteOptions
) => {
  const bridgedRoughHoldings = rawHoldings.filter((holding) => holding.chainID !== data.toChainId);
  const { provider, minOutputUsdPerSource } = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_provider',
    async () =>
      resolveBridgeProviderDecision(
        {
          context: 'EXACT_IN',
          dstChainId: data.toChainId,
          dstTokenToCheck: dstCOT.address as Hex,
          amountRawForRequest: mulDecimals(
            sumHoldingsUsd(bridgedRoughHoldings, options.balances, options.oraclePrices),
            dstCOT.decimals
          ),
          roughSources: bridgedRoughHoldings.map((holding) => ({
            chainID: holding.chainID,
            tokenAddress: bridgedTokenForChain(
              holding.chainID,
              holding.tokenAddress,
              options.chainList,
              currencyId
            ),
          })),
        },
        options
      ),
    { tags: { mode: SwapMode.EXACT_IN, source_chain_count: bridgedRoughHoldings.length } }
  );

  if (provider !== 'mayan') {
    return { bridgeProvider: provider, holdings: rawHoldings };
  }

  const floor = minOutputUsdPerSource ?? new Decimal(MAYAN_MIN_USD_PER_LEG);
  const filtered = dropSubFloorMayanChains(
    rawHoldings,
    options.balances,
    options.oraclePrices,
    floor
  );
  if (filtered.droppedMayanChains.length > 0) {
    logger.debug('swap.route.exact_in.mayan_floor.filtered', {
      minOutputUsdPerSource: floor.toFixed(),
      dropped: filtered.droppedMayanChains.map((chain) => ({
        chainID: chain.chainID,
        valueUsd: chain.valueUsd.toFixed(),
      })),
    });
  }
  if (filtered.holdings.length === 0) {
    throwMayanRouteShortfall(
      filtered.droppedMayanChains,
      options.chainList,
      new Decimal(0),
      new Decimal(0),
      floor
    );
  }

  return { bridgeProvider: provider, holdings: filtered.holdings };
};

const partitionExactInHoldings = (
  holdings: ExactInHolding[],
  options: Pick<RouteOptions, 'chainList'>,
  currencyId: number
): { cotHoldings: ExactInHolding[]; nonCotHoldings: ExactInHolding[] } => {
  const isCot = (holding: ExactInHolding) => {
    try {
      return equalFold(
        holding.tokenAddress,
        resolveCOT(holding.chainID, options.chainList, currencyId).address
      );
    } catch {
      return false;
    }
  };

  return {
    cotHoldings: holdings.filter(isCot),
    nonCotHoldings: holdings.filter((holding) => !isCot(holding)),
  };
};

const buildExactInBridge = async (input: {
  data: ExactInData;
  options: RouteOptions;
  dstCOT: ResolvedCot;
  currencyId: number;
  sourceSwaps: ExactInSourceSwaps;
  cotHoldings: ExactInHolding[];
  destinationChainCot: Decimal;
  cotAvailableForDestination: Decimal;
  bridgeProvider: Awaited<ReturnType<typeof resolveBridgeProviderDecision>>['provider'];
  sourceChainCount: number;
}): Promise<{ bridge: SwapRoute['bridge']; cotAvailableForDestination: Decimal }> =>
  withTimingSpan(
    input.options.timing,
    'flow.swap.route.build_bridge',
    async () => {
      const { assets, grossBridged: bridgedCOT, feeSummary } = buildBridgeAssetsAndFees({
        destinationChainId: input.data.toChainId,
        quoteResponses: input.sourceSwaps,
        cotSources: input.cotHoldings.map((holding) => ({ holding })),
        chainList: input.options.chainList,
        currencyId: input.currencyId,
        bridgeQuoteResponse: input.options.bridgeQuoteResponse,
        dstCOTDecimals: input.dstCOT.decimals,
        exactInAmountBasis: input.options.exactInAmountBasis,
      });
      if (!feeSummary) {
        return { bridge: null, cotAvailableForDestination: input.cotAvailableForDestination };
      }
      const {
        estimatedFees,
        totalFeeAmount,
        deliveredAmount: effectiveBridgedToDestination,
        nexusFeeModel,
      } = feeSummary;
      if (effectiveBridgedToDestination.lte(0)) {
        throw Errors.insufficientBalance(
          `Bridge fees (${totalFeeAmount.toString()}) exceed bridged COT (${bridgedCOT.toString()})`
        );
      }

      let cotAvailableForDestination = input.destinationChainCot.plus(
        effectiveBridgedToDestination
      );
      let bridge: NonNullable<SwapRoute['bridge']> = {
        amount: bridgedCOT,
        amounts: {
          tokenAmount: effectiveBridgedToDestination,
          gasInCot: new Decimal(0),
          totalAmount: bridgedCOT,
        },
        assets,
        chainID: input.data.toChainId,
        decimals: input.dstCOT.decimals,
        tokenAddress: input.dstCOT.address as Hex,
        estimatedFees,
        ...(input.bridgeProvider === 'nexus' ? { nexusFeeModel } : {}),
        provider: input.bridgeProvider,
      };

      if (input.bridgeProvider === 'mayan') {
        bridge = await enrichMayanBridge(bridge, input.options);
        if (bridge.mayanQuotesBySource) {
          const mayanDelivered = [...bridge.mayanQuotesBySource.values()].reduce(
            (sum, quote) =>
              Decimal.add(
                sum,
                selectMayanQuoteOutput(
                  quote,
                  bridge.decimals,
                  resolveExactInAmountBasis(input.options.exactInAmountBasis)
                )
              ),
            new Decimal(0)
          );
          cotAvailableForDestination = input.destinationChainCot.plus(mayanDelivered);
          bridge = { ...bridge, amounts: { ...bridge.amounts, tokenAmount: mayanDelivered } };
        }
      }

      return { bridge, cotAvailableForDestination };
    },
    {
      tags: {
        mode: SwapMode.EXACT_IN,
        provider: input.bridgeProvider,
        source_chain_count: input.sourceChainCount,
      },
    }
  );

// ---------------------------------------------------------------------------
// EXACT_IN route
// ---------------------------------------------------------------------------

export async function _exactInRoute(data: ExactInData, options: RouteOptions): Promise<SwapRoute> {
  const { aggregators, chainList, oraclePrices, dstTokenInfo, walletPathHints } = options;
  const destinationChain = chainList.getChainByID(data.toChainId);
  const exactInAmountBasis = resolveExactInAmountBasis(options.exactInAmountBasis);

  // Build holdings from input
  const rawHoldings = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_sources',
    async () => resolveExactInHoldings(data.sources ?? [], options.balances),
    { tags: { mode: SwapMode.EXACT_IN } }
  );

  if (rawHoldings.length === 0) {
    throw Errors.insufficientBalance('No usable balances for swap route');
  }

  // ── Fast paths (skipped on the B2 re-entry, which sets skipFastPaths). Classified once; Path A
  // gates before the same-token dispatch, B2 after it (see the ladder). ──
  const fastPathClass = options.skipFastPaths
    ? null
    : await withTimingSpan(
        options.timing,
        'flow.swap.route.classify_path',
        async () =>
          classifyFastPath({
            chainList,
            members: rawHoldings.map((h) => ({
              chainID: h.chainID,
              tokenAddress: h.tokenAddress,
            })),
            dstChainId: data.toChainId,
            dstTokenAddress: data.toTokenAddress,
            cotCurrencyId: options.cotCurrencyId,
            allowDirectDestination: !toTokenIsCot(
              chainList,
              data.toChainId,
              data.toTokenAddress,
              options.cotCurrencyId
            ),
            hasGasRequest: false,
            toAmountRaw: 0n,
            mode: SwapMode.EXACT_IN,
          }),
        { tags: { mode: SwapMode.EXACT_IN } }
      );
  logger.debug('swap.route.exact_in.fast_path.classified', {
    routePath: fastPathClass?.kind ?? 'default',
    reason: options.skipFastPaths ? 'fast_paths_disabled' : 'source_shape',
    sourceChainIds: [...new Set(rawHoldings.map((holding) => holding.chainID))],
    sourceCount: rawHoldings.length,
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
  const settlement = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_settlement',
    async () =>
      resolveSwapSettlement(
        chainList,
        SwapMode.EXACT_IN,
        rawHoldings.map((h) => ({ chainId: h.chainID, tokenAddress: h.tokenAddress })),
        data.toChainId,
        data.toTokenAddress,
        options.cotCurrencyId
      ),
    { tags: { mode: SwapMode.EXACT_IN } }
  );
  logger.debug('swap.route.exact_in.settlement.decision', {
    routePath: settlement.sameTokenBridge ? 'same_token' : 'cot',
    settlementCurrencyId: settlement.currencyId,
    sourceChainIds: [...new Set(rawHoldings.map((holding) => holding.chainID))],
  });
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

  const { bridgeProvider, holdings } = await resolveExactInProviderAndHoldings(
    data,
    rawHoldings,
    dstCOT,
    currencyId,
    options
  );
  const { cotHoldings, nonCotHoldings } = partitionExactInHoldings(holdings, options, currencyId);

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
      ? await withTimingSpan(
          options.timing,
          'flow.swap.route.select_sources',
          async () =>
            liquidateInputHoldings({
              holdings: nonCotHoldings,
              aggregators,
              chainList: options.chainList,
              // Settlement currency (= options.cotCurrencyId in the default flow, = F on the B2 re-entry),
              // NOT options.cotCurrencyId — matches the tryResolveCOT split above and keeps every COT read
              // in this flow on one source.
              cotCurrencyId: currencyId,
              userAddressByChain,
              recipientAddressByChain,
            }),
          {
            tags: {
              mode: SwapMode.EXACT_IN,
              source_chain_count: new Set(nonCotHoldings.map((holding) => holding.chainID)).size,
              source_leg_count: nonCotHoldings.length,
            },
          }
        )
      : [];

  // Combined COT from direct + swap outputs
  let totalCOT = new Decimal(0);
  for (const c of cotHoldings) {
    const cot = resolveCOT(c.chainID, chainList, currencyId);
    totalCOT = totalCOT.plus(divDecimals(c.amountRaw, cot.decimals));
  }
  for (const q of sourceSwaps) {
    totalCOT = totalCOT.plus(selectExactInQuoteOutput(q.quote, exactInAmountBasis).amount);
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
    .reduce(
      (sum, q) => sum.plus(selectExactInQuoteOutput(q.quote, exactInAmountBasis).amount),
      new Decimal(0)
    );
  const destinationChainCot = destinationChainDirectCot.plus(destinationChainSwapCot);
  const { bridge, cotAvailableForDestination } = allOnDstChain
    ? { bridge: null, cotAvailableForDestination: totalCOT }
    : await buildExactInBridge({
        data,
        options,
        dstCOT,
        currencyId,
        sourceSwaps,
        cotHoldings,
        destinationChainCot,
        cotAvailableForDestination: totalCOT,
        bridgeProvider,
        sourceChainCount: allChainIds.size,
      });

  // Shared EXACT_IN destination-swap quote at a given COT input (human units), used by the initial
  // route and both execution-time requote paths. No rate-tolerance guard — a requote is accepted
  // whatever it returns.
  const quoteDstSwapAtInput = async (inputHuman: Decimal): Promise<DestinationSwap | null> => {
    if (!needsTokenSwap) return null;
    const quote = await withTimingSpan(
      options.timing,
      'flow.swap.route.quote_destination',
      async () =>
        destinationSwapWithExactIn({
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
        }),
      { tags: { mode: SwapMode.EXACT_IN } }
    );
    if (!quote) return null;
    return { tokenSwap: quote, gasSwap: null };
  };

  // EXACT_IN quotes the destination swap at the FULL available COT — there is no source buffer.
  // A source leg that requotes lower simply delivers less COT; Seam 2 (getDstSwap) re-sizes the
  // dst swap down to whatever actually lands, so there is no floor to reserve here.
  if (needsTokenSwap && cotAvailableForDestination.gt(0)) {
    const quotedSwap = await quoteDstSwapAtInput(cotAvailableForDestination);
    if (!quotedSwap) {
      throw Errors.quoteFailed(
        `No destination swap quote available for chain ${data.toChainId} token ${data.toTokenAddress}`
      );
    }
    dstSwap = quotedSwap;
  }

  const assetsUsed: AssetsUsedEntry[] = holdings.map((h) => ({
    chainID: h.chainID,
    tokenAddress: h.tokenAddress,
    symbol: h.symbol,
    decimals: h.decimals,
    amount: formatUnits(h.amountRaw, h.decimals),
  }));

  const balances = options.balances;

  return withTimingSpan(
    options.timing,
    'flow.swap.route.assemble',
    async (): Promise<SwapRoute> => ({
      type: SwapMode.EXACT_IN,
      exactInAmountBasis,
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
        // Re-size the dst swap from the COT that actually landed at the wrapper (`actualCotRaw`). No
        // floor and no upper clamp — `actual` IS the real on-chain balance, and Exact In must consume
        // it completely so settlement-token dust is not returned to the user. The source reclaim can
        // deliver above the route estimate and that surplus is converted here too.
        getDstSwap: (actualCotRaw: bigint) => {
          const actual = divDecimals(actualCotRaw, dstCOT.decimals);
          return quoteDstSwapAtInput(actual);
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
    }),
    {
      tags: {
        mode: SwapMode.EXACT_IN,
        provider: bridge === null ? 'none' : bridgeProvider,
        source_chain_count: allChainIds.size,
        source_leg_count: sourceSwaps.length,
      },
    }
  );
}
