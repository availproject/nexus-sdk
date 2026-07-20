import { assertMayanSupportedDestination } from '../bridge/intent/quote-request';
import type { ChainListType, TimingSpanHooks, TokenInfo } from '../domain';
import { Errors } from '../domain/errors';
import { logger } from '../domain/utils';
import type { MiddlewareSwapPreflightClient } from '../transport';
import type { Hex } from 'viem';
import type Decimal from 'decimal.js';
import type { Aggregator } from './aggregators/types';
import { type CurrencyID, resolveCOT } from './cot';
import { _exactInRoute } from './routing/exact-in';
import { _exactOutRoute } from './routing/exact-out';
import type {
  BridgeQuoteResponse,
  FlatBalance,
  OraclePriceResponse,
  PublicClientList,
  SwapData,
  SwapRoute,
  WalletPath,
} from './types';
import { SwapMode } from './types';
import { type ExactInAmountBasis, resolveExactInAmountBasis, selectExactInQuoteOutput } from './amount-basis';

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
  timing?: TimingSpanHooks;
  // Exact In only. Direct internal route callers default conservatively to protected minimums.
  exactInAmountBasis?: ExactInAmountBasis;
  // Recursion stop for the B2 dynamic-COT re-entry: when a fast path re-enters `_exactInRoute` /
  // `_exactOutRoute` with an overridden `cotCurrencyId`, it sets this so the re-entered call runs
  // the default COT flow instead of re-classifying and looping. Never set by public callers.
  skipFastPaths?: boolean;
};

// Never-throwing snapshot of a built route for the debug trace, so a tester (or we)
// can reconstruct the exact scenario from the real amounts instead of guessing inputs.
const summarizeRouteForLog = (input: SwapData, route: SwapRoute) => {
  const amountBasis = resolveExactInAmountBasis(route.exactInAmountBasis);
  const decimal = (value: Decimal | null | undefined) => value?.toFixed();
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
      ...(input.mode === SwapMode.EXACT_IN ? { exactInAmountBasis: amountBasis } : {}),
      toChainId: input.data.toChainId,
      toToken: input.data.toTokenAddress,
      sourceBuffer: decimal(route.source?.srcBuffer),
      sourceSwaps: route.source?.swaps?.map((s) => ({
        chainId: s.chainID,
        inputAmount: s.quote?.input?.amount,
        inputSymbol: s.quote?.input?.symbol,
        outputAmount:
          input.mode === SwapMode.EXACT_IN
            ? selectExactInQuoteOutput(s.quote, amountBasis).amount
            : s.quote?.output?.amount,
        outputSymbol: s.quote?.output?.symbol,
      })),
      bridge: route.bridge
        ? {
            provider: route.bridge.provider,
            inputAmount: decimal(route.bridge.amount),
            tokenOutputAmount: decimal(route.bridge.amounts?.tokenAmount),
            assets: route.bridge.assets?.map((a) => ({
              chainId: a.chainID,
              token: a.contractAddress,
              eoaBalance: decimal(a.eoaBalance),
              ephemeralBalance: decimal(a.ephemeralBalance),
            })),
            mayanLegs: route.bridge.mayanQuotesBySource
              ? [...route.bridge.mayanQuotesBySource.entries()].map(([source, q]) => ({
                  source,
                  ...mayanLeg(q),
                }))
              : undefined,
            estimatedFees: route.bridge.estimatedFees && {
              collection: decimal(route.bridge.estimatedFees.collection),
              fulfilment: decimal(route.bridge.estimatedFees.fulfilment),
              protocol: decimal(route.bridge.estimatedFees.protocol),
            },
          }
        : null,
      destination: {
        chainId: route.destination?.chainId,
        inputMin: decimal(route.destination?.inputAmount?.min),
        inputMax: decimal(route.destination?.inputAmount?.max),
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

  logger.debug('swap.route.result.completed', summarizeRouteForLog(input, route));

  return route;
};

export { resolveWalletDecisions } from './routing/addresses';
export { enrichMayanBridge } from './routing/bridge';
export { classifyFastPath, type FastPathClass } from './routing/fast-paths';
export { greedyUsdPrefix, selectRoughEligibleSources } from './routing/holdings';
