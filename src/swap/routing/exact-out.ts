import Decimal from 'decimal.js';
import { formatUnits, type Hex, parseUnits } from 'viem';
import type { ChainListType } from '../../domain';
import { Errors } from '../../domain/errors';
import { logger } from '../../domain/utils/logger';
import { convertGasToToken } from '../../services/intent';
import { divDecimals, mulDecimals } from '../../services/math';
import { equalFold } from '../../services/strings';
import { withTimingSpan } from '../../services/timing';
import type { RouterExclusions } from '../aggregators';
import { autoSelectSources, type SourceHolding } from '../algorithms/auto-select';
import { destinationGasSwapExactIn, determineDestinationSwaps } from '../algorithms/destination';
import {
  DST_BUFFER_MAX_USD,
  DST_BUFFER_PCT,
  EADDRESS,
  SRC_BUFFER_MAX_USD,
  SRC_BUFFER_PCT,
} from '../constants';
import { resolveCOT } from '../cot';
import type { RouteOptions } from '../route';
import type {
  AssetsUsedEntry,
  DestinationSwap,
  OraclePriceResponse,
  Source,
  SwapRoute,
} from '../types';
import { SwapMode } from '../types';
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
import { selectStableSettlement } from './settlement';

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

const quoteExactOutDestination = async (input: {
  data: ExactOutData;
  options: RouteOptions;
  dstCOT: ResolvedCot;
  destinationQuoteAddress: Hex;
  gasInCotBudgetRaw: bigint;
  needsGasSwap: boolean;
  needsTokenSwap: boolean;
  estimatedInputAmountRaw?: Decimal;
  routerExclusions?: RouterExclusions;
  timingSpan: 'flow.swap.route.quote_destination_requirement' | 'flow.swap.route.quote_destination';
}) => {
  const [tokenSwapQuote, gasSwapQuote] = await withTimingSpan(
    input.options.timing,
    input.timingSpan,
    async () =>
      Promise.all([
        input.needsTokenSwap
          ? determineDestinationSwaps({
              dst: {
                chainId: input.data.toChainId,
                token: {
                  contractAddress: input.data.toTokenAddress,
                  amountRaw: input.data.toAmountRaw,
                },
              },
              options: {
                chainList: input.options.chainList,
                aggregators: input.options.aggregators,
                cotCurrencyID: input.options.cotCurrencyId,
                estimatedInputAmountRaw: input.estimatedInputAmountRaw,
                userAddress: input.destinationQuoteAddress,
                recipientAddress: input.options.eoaAddress,
                routerExclusions: input.routerExclusions,
              },
            })
          : Promise.resolve(null),
        input.needsGasSwap
          ? destinationGasSwapExactIn({
              chainId: input.data.toChainId,
              gasAmountInCotRaw: input.gasInCotBudgetRaw,
              options: {
                chainList: input.options.chainList,
                aggregators: input.options.aggregators,
                cotCurrencyID: input.options.cotCurrencyId,
                userAddress: input.destinationQuoteAddress,
                recipientAddress: input.options.eoaAddress,
                routerExclusions: input.routerExclusions,
              },
            })
          : Promise.resolve(null),
      ]),
    {
      tags: {
        mode: SwapMode.EXACT_OUT,
        has_token_swap: input.needsTokenSwap,
        has_gas_swap: input.needsGasSwap,
      },
    }
  );

  const tokenInputAmount = input.needsTokenSwap
    ? new Decimal(
        tokenSwapQuote?.quote.input.amount ??
          formatUnits(input.data.toAmountRaw, input.options.dstTokenInfo.decimals)
      )
    : input.data.toAmountRaw > 0n
      ? divDecimals(input.data.toAmountRaw, input.dstCOT.decimals)
      : new Decimal(0);
  const gasInputAmount = gasSwapQuote
    ? divDecimals(gasSwapQuote.quote.input.amountRaw, input.dstCOT.decimals)
    : new Decimal(0);

  return {
    tokenSwapQuote,
    gasSwapQuote,
    tokenInputAmount,
    gasInputAmount,
    inputAmount: tokenInputAmount.plus(gasInputAmount),
  };
};

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

  const { tokenSwapQuote, gasSwapQuote, tokenInputAmount, gasInputAmount, inputAmount } =
    await quoteExactOutDestination({
      data,
      options,
      dstCOT,
      destinationQuoteAddress,
      gasInCotBudgetRaw,
      needsGasSwap,
      needsTokenSwap,
      estimatedInputAmountRaw,
      timingSpan: 'flow.swap.route.quote_destination_requirement',
    });

  if (needsTokenSwap && !tokenSwapQuote) {
    throw Errors.quoteFailed(
      `No destination swap quote available for chain ${data.toChainId} token ${data.toTokenAddress}`
    );
  }
  if (needsGasSwap && !gasSwapQuote) {
    throw Errors.quoteFailed(`No destination gas swap quote available for chain ${data.toChainId}`);
  }

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
  roughlyEstimatedSources: SourceHolding[]
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
    allowDirectDestination: false,
    hasGasRequest: (data.toNativeAmountRaw ?? 0n) > 0n,
    toAmountRaw: data.toAmountRaw,
    mode: SwapMode.EXACT_OUT,
  } as const;
  const fastPathClass = await withTimingSpan(
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

  if (fastPathClass?.kind === 'same-token-out') {
    const sameToken = await tryFastPath('same-token-out', () =>
      buildSameTokenBridgeExactOutRoute(data, holdings, options, fastPathClass.familyId, [
        ...new Set(
          roughlyEstimatedSources
            .filter((holding) => holding.chainID !== data.toChainId)
            .map((holding) => holding.chainID)
        ),
      ])
    );
    if (sameToken) return sameToken;
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
  bridgeQuoteResponse: NonNullable<RouteOptions['bridgeQuoteResponse']>;
  sourceChainCount: number;
}): Promise<NonNullable<SwapRoute['bridge']>> =>
  withTimingSpan(
    input.options.timing,
    'flow.swap.route.build_bridge',
    async () => {
      const { assets, grossBridged, feeSummary } = buildBridgeAssetsAndFees({
        destinationChainId: input.data.toChainId,
        quoteResponses: input.quoteResponses,
        cotSources: input.usedCOTs,
        chainList: input.options.chainList,
        currencyId: input.options.cotCurrencyId,
        bridgeQuoteResponse: input.bridgeQuoteResponse,
        dstCOTDecimals: input.dstCOT.decimals,
      });
      if (!feeSummary) {
        throw Errors.internal('Bridge assets unavailable -- cannot route cross-chain swap');
      }
      const { estimatedFees, deliveredAmount, nexusFeeModel } = feeSummary;
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
        ...(input.bridgeProvider === 'nexus' ? { nexusFeeModel } : {}),
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
        allowDirectDestination: data.toAmountRaw >= 0n && (data.toNativeAmountRaw ?? 0n) >= 0n,
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
    return buildSameTokenBridgeExactOutRoute(data, holdings, options, fastPathClass.familyId, [
      ...new Set(
        holdings
          .filter((holding) => holding.chainID !== data.toChainId)
          .map((holding) => holding.chainID)
      ),
    ]);
  }

  const priceResolver = createTokenPriceResolver(options);
  const requestedNativeAmountRaw =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? data.toNativeAmountRaw : 0n;
  const destinationPricePromise =
    data.toAmountRaw > 0n
      ? priceResolver.resolve(data.toChainId, data.toTokenAddress)
      : Promise.resolve<ResolvedTokenPrice | null>(null);
  const nativePricePromise =
    requestedNativeAmountRaw > 0n
      ? priceResolver.resolve(data.toChainId, EADDRESS)
      : Promise.resolve<ResolvedTokenPrice | null>(null);
  const dstHoldings = holdings.filter((holding) => holding.chainID === data.toChainId);
  const canTryDirectDestination =
    !options.skipFastPaths &&
    data.toAmountRaw > 0n &&
    (data.toNativeAmountRaw ?? 0n) >= 0n &&
    dstHoldings.length > 0;
  const dstHoldingPricePromises = canTryDirectDestination
    ? dstHoldings.map((holding) => priceResolver.resolve(holding.chainID, holding.tokenAddress))
    : [];

  const [destinationPrice, nativePrice] = await Promise.all([
    destinationPricePromise,
    nativePricePromise,
  ]);
  const tokenRequiredUsd =
    data.toAmountRaw <= 0n
      ? new Decimal(0)
      : destinationPrice
        ? divDecimals(data.toAmountRaw, dstTokenInfo.decimals).mul(destinationPrice.priceUsd)
        : null;
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
  if (canTryDirectDestination && directPriceGatePassed) {
    const direct = await tryFastPath('direct', () =>
      buildDirectDestinationExactOutRoute(data, holdings, options)
    );
    if (direct) return direct;
  }

  let roughlyEstimatedSources =
    requiredUsd == null ? null : selectRoughEligibleSources(holdings, requiredUsd);
  const selectedCurrencyId =
    roughlyEstimatedSources == null
      ? cotCurrencyId
      : selectStableSettlement({
          chainList,
          currentCurrencyId: cotCurrencyId,
          destinationChainId: data.toChainId,
          destinationTokenAddress: data.toTokenAddress,
          scoreHoldings: roughlyEstimatedSources,
          eligibilityHoldings: holdings,
        });
  let bridgeQuoteSourceChainIds = [
    ...new Set(
      (roughlyEstimatedSources ?? [])
        .filter((holding) => holding.chainID !== data.toChainId)
        .map((holding) => holding.chainID)
    ),
  ];
  let bridgeQuoteResponse = options.bridgeQuoteResponse;
  if (bridgeQuoteSourceChainIds.length > 0 && selectedCurrencyId !== cotCurrencyId) {
    bridgeQuoteResponse = await fetchBridgeQuoteForCurrency(
      data.toChainId,
      selectedCurrencyId,
      bridgeQuoteSourceChainIds,
      options
    );
  } else if (bridgeQuoteSourceChainIds.length > 0 && !bridgeQuoteResponse) {
    bridgeQuoteResponse = await fetchBridgeQuoteForCurrency(
      data.toChainId,
      selectedCurrencyId,
      bridgeQuoteSourceChainIds,
      options
    );
  }
  if (bridgeQuoteSourceChainIds.length > 0 && !bridgeQuoteResponse) {
    throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
  }
  const routeOptions = {
    ...options,
    cotCurrencyId: selectedCurrencyId,
    bridgeQuoteResponse,
  };
  const dstCOT = await withTimingSpan(
    options.timing,
    'flow.swap.route.resolve_settlement',
    async () => resolveCOT(data.toChainId, chainList, selectedCurrencyId),
    { tags: { mode: SwapMode.EXACT_OUT } }
  );
  const cotPrice = await priceResolver.resolve(data.toChainId, dstCOT.address as Hex);
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
    routeOptions,
    destinationChain,
    dstCOT,
    estimatedInputAmountRaw
  );

  roughlyEstimatedSources ??= selectRoughEligibleSources(holdings, inputAmount);
  logger.debug('swap.route.exact_out.rough_sources.resolved', {
    sourceChainIds: [...new Set(roughlyEstimatedSources.map((holding) => holding.chainID))],
    sourceCount: roughlyEstimatedSources.length,
    requiredAmount: inputAmount.toFixed(),
  });

  const fastPathRoute = await tryExactOutFastPaths(
    data,
    routeOptions,
    holdings,
    roughlyEstimatedSources
  );
  if (fastPathRoute) return fastPathRoute;

  if (requiredUsd == null) {
    bridgeQuoteSourceChainIds = [
      ...new Set(
        roughlyEstimatedSources
          .filter((holding) => holding.chainID !== data.toChainId)
          .map((holding) => holding.chainID)
      ),
    ];
    if (bridgeQuoteSourceChainIds.length > 0 && !bridgeQuoteResponse) {
      bridgeQuoteResponse = await fetchBridgeQuoteForCurrency(
        data.toChainId,
        selectedCurrencyId,
        bridgeQuoteSourceChainIds,
        routeOptions
      );
      routeOptions.bridgeQuoteResponse = bridgeQuoteResponse;
    }
  }

  const { bridgeProvider, minOutputUsdPerSource } = await resolveExactOutProvider(
    data,
    routeOptions,
    dstCOT,
    roughlyEstimatedSources
  );

  const destinationBuffer =
    needsTokenSwap || needsGasSwap
      ? applyBuffer(
          needsTokenSwap ? inputAmount : gasInputAmount,
          DST_BUFFER_PCT,
          DST_BUFFER_MAX_USD,
          oraclePrices,
          data.toChainId,
          dstCOT.address
        )
      : new Decimal(0);
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
      cotCurrencyId: selectedCurrencyId,
      bridgeQuoteResponse,
    },
    routeOptions
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
      cotCurrencyId: selectedCurrencyId,
      userAddressByChain: buildExecutorAddressByChain(
        initialWalletDecision.sourceExecutionPaths,
        routeOptions
      ),
      recipientAddressByChain: buildSourceRecipientAddressByChain({
        chainIds: availableSourceChainIds,
        sourceExecutionPaths: initialWalletDecision.sourceExecutionPaths,
        destinationChainId: data.toChainId,
        destinationHasSwap: needsTokenSwap || needsGasSwap,
        options: routeOptions,
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
  // selectionTarget = net delivery (sourceBufferedRequired, which includes gasInCot via inputAmount)
  // + the up-front bridge-fee estimate. The fee is already folded in, so there is no iterative
  // fee-adjusted re-select; coverage was checked against selectionTarget above.
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

  let bridge: SwapRoute['bridge'] = null;
  if (bridgeNeeded) {
    if (!bridgeQuoteResponse) {
      throw Errors.internal('Bridge fee quote unavailable -- cannot route cross-chain swap');
    }
    bridge = await buildExactOutBridge({
      data,
      options: routeOptions,
      dstCOT,
      quoteResponses,
      usedCOTs,
      gasInCot: gasInputAmount,
      bridgeProvider,
      bridgeQuoteResponse,
      sourceChainCount: allSourceChainIds.size,
    });
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
    const cot = resolveCOT(c.holding.chainID, chainList, selectedCurrencyId);
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
      settlementCurrencyId: selectedCurrencyId,
      sameTokenBridge: false,
      source: {
        swaps: quoteResponses,
        creationTime: Date.now(),
        cotByChain: buildSourceCotByChain(quoteResponses, chainList, selectedCurrencyId),
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
        getDstSwap: async (actualCotRaw: bigint, routerExclusions?: RouterExclusions) => {
          const {
            tokenSwapQuote: nextTokenSwap,
            gasSwapQuote: nextGasSwap,
            inputAmount: nextInputAmount,
          } = await quoteExactOutDestination({
            data,
            options: routeOptions,
            dstCOT,
            destinationQuoteAddress,
            gasInCotBudgetRaw,
            needsGasSwap,
            needsTokenSwap,
            routerExclusions,
            timingSpan: 'flow.swap.route.quote_destination',
          });

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
