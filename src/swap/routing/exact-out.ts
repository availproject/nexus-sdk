import Decimal from 'decimal.js';
import { formatUnits, parseUnits, type Hex } from 'viem';
import type { ChainListType } from '../../domain';
import { Errors } from '../../domain/errors';
import { logger } from '../../domain/utils';
import { convertGasToToken } from '../../services/intent';
import { divDecimals, mulDecimals } from '../../services/math';
import { equalFold } from '../../services/strings';
import { withTimingSpan } from '../../services/timing';
import { autoSelectSources, type SourceHolding } from '../algorithms/auto-select';
import { destinationGasSwapExactIn, determineDestinationSwaps } from '../algorithms/destination';
import {
  DST_BUFFER_MAX_USD,
  DST_BUFFER_PCT,
  EADDRESS,
  SRC_BUFFER_MAX_USD,
  SRC_BUFFER_PCT,
} from '../constants';
import { resolveCOT, resolveCurrencyId } from '../cot';
import type {
  AssetsUsedEntry,
  BridgeAsset,
  DestinationSwap,
  OraclePriceResponse,
  Source,
  SwapRoute,
} from '../types';
import { SwapMode } from '../types';
import type { RouteOptions } from '../route';
import {
  buildExecutorAddressByChain,
  buildSourceRecipientAddressByChain,
  destinationWrapperAddress,
  resolveWalletDecisions,
} from './addresses';
import {
  accumulateBridgeAsset,
  bridgedTokenForChain,
  buildSourceCotByChain,
  computeBridgeFees,
  enrichMayanBridge,
  estimateBridgeFees,
  fetchBridgeQuoteForCurrency,
  resolveBridgeProviderDecision,
} from './bridge';
import {
  buildDirectDestinationExactOutRoute,
  buildSameTokenBridgeExactOutRoute,
  classifyFastPath,
  tryFastPath,
} from './fast-paths';
import { filterExactOutBalances, selectRoughEligibleSources } from './holdings';
import { createTokenPriceResolver, type ResolvedTokenPrice } from './prices';

type ExactOutData = {
  toChainId: number;
  toTokenAddress: Hex;
  toAmountRaw: bigint;
  toNativeAmountRaw?: bigint;
  sources?: Source[];
};

type ExactOutSelection = Awaited<ReturnType<typeof autoSelectSources>>;
type ResolvedCot = ReturnType<typeof resolveCOT>;
type DestinationChain = ReturnType<ChainListType['getChainByID']>;

const resolveExactOutSources = async (
  data: ExactOutData,
  options: RouteOptions,
  destinationChain: DestinationChain
) =>
  withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_sources',
    async () => {
      const balances = filterExactOutBalances(
        options.balances,
        data,
        destinationChain,
        options.dstTokenInfo.decimals
      );
      const usableBalances = balances.filter((balance) => new Decimal(balance.amount).gt(0));
      if (usableBalances.length === 0) {
        throw Errors.insufficientBalance('No usable balances for swap route');
      }

      return {
        balances,
        holdings: usableBalances.map((balance) => ({
          chainID: balance.chainID,
          tokenAddress: balance.tokenAddress,
          amountRaw: parseUnits(balance.amount, balance.decimals),
          decimals: balance.decimals,
          symbol: balance.symbol,
          value: balance.value,
        })),
      };
    },
    { tags: { mode: SwapMode.EXACT_OUT } }
  );

const resolveExactOutDestinationRequirement = async (
  data: ExactOutData,
  options: RouteOptions,
  destinationChain: DestinationChain,
  dstCOT: ResolvedCot,
  estimatedInputAmountRaw?: Decimal
) => {
  const needsTokenSwap = data.toAmountRaw > 0n && !equalFold(data.toTokenAddress, dstCOT.address);
  const requestedNativeAmountRaw =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? data.toNativeAmountRaw : 0n;
  const needsGasSwap = requestedNativeAmountRaw > 0n;
  const destinationQuoteAddress =
    needsTokenSwap || needsGasSwap
      ? destinationWrapperAddress(destinationChain, options)
      : options.eoaAddress;
  const gasInCotBudgetRaw = needsGasSwap
    ? computeGasInCotBudgetRaw({
        requestedNativeAmountRaw,
        destinationChain,
        dstCOT,
        oraclePrices: options.oraclePrices,
      })
    : 0n;

  const [tokenSwapQuote, gasSwapQuote] = await withTimingSpan(
    options.timing,
    'flow.swap.route.quote_destination_requirement',
    async () =>
      Promise.all([
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
                aggregators: options.aggregators,
                cotCurrencyID: options.cotCurrencyId,
                estimatedInputAmountRaw,
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
                aggregators: options.aggregators,
                cotCurrencyID: options.cotCurrencyId,
                userAddress: destinationQuoteAddress,
                recipientAddress: options.eoaAddress,
              },
            })
          : Promise.resolve(null),
      ]),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        has_token_swap: needsTokenSwap,
        has_gas_swap: needsGasSwap,
      },
    }
  );

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
        tokenSwapQuote?.quote.input.amount ??
          formatUnits(data.toAmountRaw, options.dstTokenInfo.decimals)
      )
    : data.toAmountRaw > 0n
      ? divDecimals(data.toAmountRaw, dstCOT.decimals)
      : new Decimal(0);
  const gasInputAmount = gasSwapQuote
    ? divDecimals(gasSwapQuote.quote.input.amountRaw, dstCOT.decimals)
    : new Decimal(0);
  const inputAmount = tokenInputAmount.plus(gasInputAmount);

  logger.debug('swap.route.exact_out.destination_requirement.resolved', {
    needsTokenSwap,
    needsGasSwap,
    tokenInputAmount: tokenInputAmount.toFixed(),
    gasInputAmount: gasInputAmount.toFixed(),
    inputAmount: inputAmount.toFixed(),
  });

  return {
    destinationQuoteAddress,
    gasInCotBudgetRaw,
    gasInputAmount,
    gasSwapQuote,
    inputAmount,
    needsGasSwap,
    needsTokenSwap,
    tokenSwapQuote,
  };
};

const tryExactOutFastPaths = async (
  data: ExactOutData,
  options: RouteOptions,
  holdings: SourceHolding[],
  roughlyEstimatedSources: SourceHolding[],
  needsTokenSwap: boolean,
  needsGasSwap: boolean
): Promise<SwapRoute | null> => {
  if (options.skipFastPaths) return null;

  const classificationInput = {
    chainList: options.chainList,
    members: roughlyEstimatedSources.map((holding) => ({
      chainID: holding.chainID,
      tokenAddress: holding.tokenAddress,
    })),
    dstChainId: data.toChainId,
    dstTokenAddress: data.toTokenAddress,
    cotCurrencyId: options.cotCurrencyId,
    allowDirectDestination: needsTokenSwap,
    hasGasRequest: needsGasSwap,
    toAmountRaw: data.toAmountRaw,
    mode: SwapMode.EXACT_OUT,
  } as const;
  let fastPathClass = await withTimingSpan(
    options.timing,
    'flow.swap.route.classify_path',
    async () => classifyFastPath(classificationInput),
    { tags: { mode: SwapMode.EXACT_OUT } }
  );
  logger.debug('swap.route.exact_out.fast_path.classified', {
    routePath: fastPathClass?.kind ?? 'default',
    sourceCount: roughlyEstimatedSources.length,
    reason: 'rough_source_shape',
  });

  if (fastPathClass?.kind === 'direct') {
    fastPathClass = await withTimingSpan(
      options.timing,
      'flow.swap.route.classify_path',
      async () => classifyFastPath({ ...classificationInput, allowDirectDestination: false }),
      { tags: { mode: SwapMode.EXACT_OUT } }
    );
    logger.debug('swap.route.exact_out.fast_path.reclassified', {
      routePath: fastPathClass?.kind ?? 'default',
      sourceCount: roughlyEstimatedSources.length,
      reason: 'direct_path_already_resolved',
    });
  }

  if (fastPathClass?.kind === 'same-token-out') {
    const sameToken = await tryFastPath('same-token-out', () =>
      buildSameTokenBridgeExactOutRoute(data, holdings, options, fastPathClass.familyId)
    );
    if (sameToken) return sameToken;
  }
  if (fastPathClass?.kind === 'dynamic-cot') {
    const dynamicCot = await tryFastPath('dynamic-cot', () =>
      buildDynamicCotExactOutRoute(data, holdings, options, fastPathClass.familyId)
    );
    if (dynamicCot) return dynamicCot;
  }
  return null;
};

const resolveExactOutProvider = async (
  data: ExactOutData,
  options: RouteOptions,
  dstCOT: ResolvedCot,
  roughlyEstimatedSources: SourceHolding[]
) => {
  const bridgedSources = roughlyEstimatedSources.filter(
    (holding) => holding.chainID !== data.toChainId
  );
  const bridgedAmountUsd = bridgedSources.reduce(
    (sum, holding) => sum.plus(holding.value),
    new Decimal(0)
  );
  const roughSources = bridgedSources.map((holding) => ({
    chainID: holding.chainID,
    tokenAddress: holding.tokenAddress,
  }));
  const { provider, minOutputUsdPerSource } = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_provider',
    async () =>
      resolveBridgeProviderDecision(
        {
          context: 'EXACT_OUT',
          dstChainId: data.toChainId,
          dstTokenToCheck: dstCOT.address as Hex,
          amountRawForRequest: mulDecimals(bridgedAmountUsd, dstCOT.decimals),
          roughSources: roughSources.map((source) => ({
            chainID: source.chainID,
            tokenAddress: bridgedTokenForChain(
              source.chainID,
              source.tokenAddress,
              options.chainList,
              options.cotCurrencyId
            ),
          })),
        },
        options
      ),
    { tags: { mode: SwapMode.EXACT_OUT, source_chain_count: roughSources.length } }
  );

  logger.debug('swap.route.exact_out.provider_summary.resolved', {
    bridgedAmountUsd: bridgedAmountUsd.toFixed(),
    sourceChainIds: roughSources.map((source) => source.chainID),
    sourceCount: roughSources.length,
    bridgeProvider: provider,
    minOutputUsdPerSource: minOutputUsdPerSource?.toFixed(),
  });
  return { bridgeProvider: provider, minOutputUsdPerSource };
};

const buildExactOutBridge = async (input: {
  data: ExactOutData;
  options: RouteOptions;
  dstCOT: ResolvedCot;
  quoteResponses: ExactOutSelection['quoteResponses'];
  usedCOTs: ExactOutSelection['usedCOTs'];
  gasInCot: Decimal;
  bridgeProvider: Awaited<ReturnType<typeof resolveBridgeProviderDecision>>['provider'];
  sourceChainCount: number;
}): Promise<NonNullable<SwapRoute['bridge']>> =>
  withTimingSpan(
    input.options.timing,
    'flow.swap.route.build_bridge',
    async () => {
      const assetsByChain = new Map<number, BridgeAsset>();
      for (const swap of input.quoteResponses) {
        if (swap.chainID === input.data.toChainId) continue;
        const cot = resolveCOT(swap.chainID, input.options.chainList, input.options.cotCurrencyId);
        accumulateBridgeAsset(assetsByChain, {
          chainID: swap.chainID,
          contractAddress: cot?.address ?? swap.quote.output.contractAddress,
          decimals: cot?.decimals ?? swap.quote.output.decimals,
          balance: 'ephemeralBalance',
          amount: new Decimal(swap.quote.output.amount),
        });
      }
      for (const usedCot of input.usedCOTs) {
        if (usedCot.holding.chainID === input.data.toChainId) continue;
        const cot = resolveCOT(
          usedCot.holding.chainID,
          input.options.chainList,
          input.options.cotCurrencyId
        );
        accumulateBridgeAsset(assetsByChain, {
          chainID: usedCot.holding.chainID,
          contractAddress: cot?.address ?? usedCot.holding.tokenAddress,
          decimals: cot?.decimals ?? 6,
          balance: 'eoaBalance',
          amount: usedCot.amountUsed,
        });
      }
      const assets = [...assetsByChain.values()];
      const grossBridged = assets.reduce(
        (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
        new Decimal(0)
      );
      const bridgeQuoteResponse = input.options.bridgeQuoteResponse;
      if (!bridgeQuoteResponse) {
        throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
      }
      const { estimatedFees, deliveredAmount } = computeBridgeFees({
        quoteResponse: bridgeQuoteResponse,
        grossBridged,
        dstCOTDecimals: input.dstCOT.decimals,
      });
      const deliveredTokenAmount = Decimal.max(
        deliveredAmount.minus(input.gasInCot),
        new Decimal(0)
      );

      let bridge: NonNullable<SwapRoute['bridge']> = {
        amount: grossBridged,
        amounts: {
          tokenAmount: deliveredTokenAmount,
          gasInCot: input.gasInCot,
          totalAmount: grossBridged,
        },
        assets,
        chainID: input.data.toChainId,
        decimals: input.dstCOT.decimals,
        tokenAddress: input.dstCOT.address as Hex,
        estimatedFees,
        provider: input.bridgeProvider,
      };
      if (input.bridgeProvider === 'mayan') {
        bridge = await enrichMayanBridge(bridge, input.options);
      }
      return bridge;
    },
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        provider: input.bridgeProvider,
        source_chain_count: input.sourceChainCount,
      },
    }
  );

// ---------------------------------------------------------------------------
// EXACT_OUT route
// ---------------------------------------------------------------------------

export async function _exactOutRoute(
  data: ExactOutData,
  options: RouteOptions
): Promise<SwapRoute> {
  const { cotCurrencyId, aggregators, chainList, oraclePrices, dstTokenInfo, walletPathHints } =
    options;
  const destinationChain = chainList.getChainByID(data.toChainId);
  const { balances, holdings } = await resolveExactOutSources(data, options, destinationChain);

  const fastPathClass = options.skipFastPaths
    ? null
    : classifyFastPath({
        chainList,
        members: holdings,
        dstChainId: data.toChainId,
        dstTokenAddress: data.toTokenAddress,
        cotCurrencyId,
        allowDirectDestination:
          data.toAmountRaw >= 0n && (data.toNativeAmountRaw ?? 0n) >= 0n,
        hasGasRequest: (data.toNativeAmountRaw ?? 0n) > 0n,
        toAmountRaw: data.toAmountRaw,
        mode: SwapMode.EXACT_OUT,
      });

  if (fastPathClass?.kind === 'direct') {
    logger.debug('swap.route.exact_out.path.selected', {
      routePath: 'direct_destination',
      reason: 'destination_only_holdings',
      chainId: data.toChainId,
      sourceCount: holdings.length,
    });
    return buildDirectDestinationExactOutRoute(data, holdings, options);
  }

  if (fastPathClass?.kind === 'same-token-out') {
    logger.debug('swap.route.exact_out.same_token.selected', {
      routePath: 'same_token',
      reason: 'same_currency_holdings',
      chainId: data.toChainId,
      sourceCount: holdings.length,
      settlementCurrencyId: fastPathClass.familyId,
    });
    return buildSameTokenBridgeExactOutRoute(data, holdings, options, fastPathClass.familyId);
  }

  const dstCOT = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_settlement',
    async () => resolveCOT(data.toChainId, chainList, cotCurrencyId),
    { tags: { mode: SwapMode.EXACT_OUT } }
  );
  const priceResolver = createTokenPriceResolver(options);
  const directNeedsTokenSwap =
    data.toAmountRaw > 0n && !equalFold(data.toTokenAddress, dstCOT.address);
  const destinationPricePromise = priceResolver.resolve(data.toChainId, data.toTokenAddress);
  const cotPricePromise = priceResolver.resolve(data.toChainId, dstCOT.address as Hex);
  const requestedNativeAmountRaw =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? data.toNativeAmountRaw : 0n;
  const nativePricePromise =
    !options.skipFastPaths && directNeedsTokenSwap && requestedNativeAmountRaw > 0n
      ? priceResolver.resolve(data.toChainId, EADDRESS)
      : Promise.resolve<ResolvedTokenPrice | null>(null);
  const dstHoldings = holdings.filter((holding) => holding.chainID === data.toChainId);
  const dstHoldingPricePromises =
    !options.skipFastPaths && directNeedsTokenSwap
      ? dstHoldings.map((holding) => priceResolver.resolve(holding.chainID, holding.tokenAddress))
      : [];

  const destinationPrice = await destinationPricePromise;
  const nativePrice = await nativePricePromise;
  const tokenAmount = divDecimals(data.toAmountRaw, dstTokenInfo.decimals);
  const tokenRequiredUsd = destinationPrice ? tokenAmount.mul(destinationPrice.priceUsd) : null;
  const gasRequiredUsd =
    requestedNativeAmountRaw === 0n
      ? new Decimal(0)
      : nativePrice
        ? divDecimals(requestedNativeAmountRaw, destinationChain.nativeCurrency.decimals).mul(
            nativePrice.priceUsd
          )
        : null;
  const requiredUsd =
    tokenRequiredUsd && gasRequiredUsd ? tokenRequiredUsd.plus(gasRequiredUsd) : null;

  let dstHoldingsUsd = new Decimal(0);
  let hasUnpricedDstHolding = false;
  for (let i = 0; i < dstHoldingPricePromises.length; i++) {
    const price = await dstHoldingPricePromises[i];
    if (!price) {
      hasUnpricedDstHolding = true;
      continue;
    }
    dstHoldingsUsd = dstHoldingsUsd.plus(
      divDecimals(dstHoldings[i].amountRaw, dstHoldings[i].decimals).mul(price.priceUsd)
    );
  }

  const directPriceGatePassed =
    requiredUsd == null || hasUnpricedDstHolding || dstHoldingsUsd.gte(requiredUsd);
  logger.debug('swap.route.exact_out.direct_price_gate.resolved', {
    destinationPriceSource: destinationPrice?.source ?? 'none',
    nativePriceSource: nativePrice?.source ?? 'none',
    requiredUsd: requiredUsd?.toFixed(),
    dstHoldingsUsd: dstHoldingsUsd.toFixed(),
    hasUnpricedDstHolding,
    passed: directPriceGatePassed,
  });
  if (
    !options.skipFastPaths &&
    directNeedsTokenSwap &&
    dstHoldings.length > 0 &&
    directPriceGatePassed
  ) {
    const direct = await tryFastPath('direct', () =>
      buildDirectDestinationExactOutRoute(data, holdings, options)
    );
    if (direct) return direct;
  }

  const cotPrice = await cotPricePromise;
  const estimatedInputAmountRaw =
    tokenRequiredUsd && cotPrice
      ? tokenRequiredUsd
          .div(cotPrice.priceUsd)
          .mul(Decimal.pow(10, dstCOT.decimals))
          .toDecimalPlaces(0, Decimal.ROUND_CEIL)
      : undefined;
  const availableSourceChainIds = new Set(holdings.map((holding) => holding.chainID));
  const initialWalletDecision = resolveWalletDecisions({
    sourceChainIds: availableSourceChainIds,
    walletPathHints,
  });
  const {
    destinationQuoteAddress,
    gasInCotBudgetRaw,
    gasInputAmount,
    gasSwapQuote,
    inputAmount,
    needsGasSwap,
    needsTokenSwap,
    tokenSwapQuote,
  } = await resolveExactOutDestinationRequirement(
    data,
    options,
    destinationChain,
    dstCOT,
    estimatedInputAmountRaw
  );

  const roughlyEstimatedSources = selectRoughEligibleSources(holdings, inputAmount);
  logger.debug('swap.route.exact_out.rough_sources.resolved', {
    sourceChainIds: [...new Set(roughlyEstimatedSources.map((holding) => holding.chainID))],
    sourceCount: roughlyEstimatedSources.length,
    requiredAmount: inputAmount.toFixed(),
  });

  const fastPathRoute = await tryExactOutFastPaths(
    data,
    options,
    holdings,
    roughlyEstimatedSources,
    needsTokenSwap,
    needsGasSwap
  );
  if (fastPathRoute) return fastPathRoute;

  const { bridgeProvider, minOutputUsdPerSource } = await resolveExactOutProvider(
    data,
    options,
    dstCOT,
    roughlyEstimatedSources
  );

  const destinationBuffer = applyBuffer(
    inputAmount,
    DST_BUFFER_PCT,
    DST_BUFFER_MAX_USD,
    oraclePrices,
    data.toChainId,
    dstCOT.address
  );
  const destinationBufferedInput = inputAmount.plus(destinationBuffer);
  const originalDestinationMaxInput = new Decimal(destinationBufferedInput);
  const sourceBuffer = applyBuffer(
    destinationBufferedInput,
    SRC_BUFFER_PCT,
    SRC_BUFFER_MAX_USD,
    oraclePrices,
    data.toChainId,
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

  logger.debug('swap.route.exact_out.selection_target.resolved', {
    inputAmount: inputAmount.toFixed(),
    destinationBufferedInput: destinationBufferedInput.toFixed(),
    sourceBufferedRequired: sourceBufferedRequired.toFixed(),
    bridgeFeeEstimate: bridgeFeeEstimate.toFixed(),
    selectionTarget: selectionTarget.toFixed(),
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
  const { quoteResponses, usedCOTs } = await withTimingSpan(
    options.timing,
    'flow.swap.route.select_sources',
    async () => selectSources(selectionTarget),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        source_chain_count: availableSourceChainIds.size,
        source_leg_count: holdings.length,
      },
    }
  );

  logger.debug('swap.route.exact_out.sources.selected', {
    selectionTarget: selectionTarget.toFixed(),
    swaps: quoteResponses.map((q) => ({
      chainID: q.chainID,
      inputAmount: q.quote.input.amount,
      inputSymbol: q.quote.input.symbol,
      outputAmount: q.quote.output.amount,
      outputSymbol: q.quote.output.symbol,
    })),
    directCOTs: usedCOTs.map((c) => ({
      chainID: c.holding.chainID,
      amountUsed: c.amountUsed.toFixed(),
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

  const bridge = bridgeNeeded
    ? await buildExactOutBridge({
        data,
        options,
        dstCOT,
        quoteResponses,
        usedCOTs,
        gasInCot,
        bridgeProvider,
        sourceChainCount: allSourceChainIds.size,
      })
    : null;

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

  return withTimingSpan(
    options.timing,
    'flow.swap.route.assemble',
    async (): Promise<SwapRoute> => ({
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
          const [nextTokenSwap, nextGasSwap] = await withTimingSpan(
            options.timing,
            'flow.swap.route.quote_destination',
            async () =>
              Promise.all([
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
              ]),
            {
              tags: {
                mode: SwapMode.EXACT_OUT,
                has_token_swap: needsTokenSwap,
                has_gas_swap: needsGasSwap,
              },
            }
          );

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
    }),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        provider: bridge === null ? 'none' : bridgeProvider,
        source_chain_count: allSourceChainIds.size,
        source_leg_count: quoteResponses.length,
        has_token_swap: needsTokenSwap,
        has_gas_swap: needsGasSwap,
      },
    }
  );
}

async function buildDynamicCotExactOutRoute(
  data: ExactOutData,
  holdings: SourceHolding[],
  options: RouteOptions,
  familyId: number
): Promise<SwapRoute | null> {
  const fQuote = await fetchBridgeQuoteForCurrency(data.toChainId, familyId, options);
  if (!fQuote) return null;
  // Restrict the re-entry to the family-F holdings (the allowlist `filterExactOutBalances` honors) →
  // every source is a COT ⇒ zero source swaps. Insufficient F inside throws `insufficientBalance` ⇒
  // tryFastPath falls back.
  const sources: Source[] = holdings
    .filter((h) => resolveCurrencyId(options.chainList, h.chainID, h.tokenAddress) === familyId)
    .map((h) => ({ chainId: h.chainID, tokenAddress: h.tokenAddress }));
  return _exactOutRoute(
    { ...data, sources },
    { ...options, cotCurrencyId: familyId, bridgeQuoteResponse: fQuote, skipFastPaths: true }
  );
}

function applyBuffer(
  amount: Decimal,
  pct: number,
  maxUsd: number,
  oraclePrices: OraclePriceResponse,
  chainId: number,
  tokenAddress: Hex
): Decimal {
  const pctBuffer = amount.mul(pct);
  // Filter by chainId: oraclePrices spans every chain, and a native (ZERO_ADDRESS) — or any token
  // sharing an address across chains — would otherwise match the first entry, mispricing the maxUsd
  // cap (e.g. POL vs ETH). Same reason as findOraclePriceUsd in max.ts.
  const entry = oraclePrices.find(
    (p) => p.chainId === chainId && equalFold(p.tokenAddress, tokenAddress)
  );
  const tokenPrice = entry ? entry.priceUsd.toNumber() : 1;
  const maxBufferInToken = new Decimal(maxUsd).div(tokenPrice);
  return Decimal.min(pctBuffer, maxBufferInToken);
}

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
