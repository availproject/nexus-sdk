import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { mulDecimals } from '../services/math';
import { MAX_SWAP_HAIRCUT_MIN_USDC, MAX_SWAP_HAIRCUT_PCT } from './constants';
import { buildSwapPreflight } from './preflight';
import { determineSwapRoute } from './route';
import type { SwapData, SwapMaxParams, SwapMaxResult, SwapParams } from './types';
import { SwapMode } from './types';

type SwapMaxExecutionParams = Pick<
  SwapParams,
  'chainList' | 'cotCurrencyId' | 'eoaAddress' | 'middlewareClient'
> & {
  ephemeralAddress: Hex;
  forceMayan?: boolean;
};

// ---------------------------------------------------------------------------
// calculateMaxForSwap
// ---------------------------------------------------------------------------

/**
 * Calculates the maximum amount a user can swap for a given destination token.
 *
 * Algorithm:
 * 1. Determine route using EXACT_IN mode with all available balances
 * 2. Extract total COT available (destination.inputAmount.max)
 * 3. Apply haircut: max(3% of cotAmount, 3 USDC)
 * 4. If destination has token swap: scale output proportionally
 * 5. If destination IS COT: use adjusted COT directly
 */
export async function calculateMaxForSwap(
  input: SwapMaxParams,
  options: SwapMaxExecutionParams
): Promise<SwapMaxResult> {
  // Build a synthetic EXACT_IN input using all available balances
  const swapData: SwapData = {
    mode: SwapMode.EXACT_IN,
    data: {
      sources: (input.sources ?? []).map((source) => ({
        chainId: source.chainId,
        tokenAddress: source.tokenAddress,
      })),
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
    },
  };

  const preflight = await buildSwapPreflight(swapData, {
    chainList: options.chainList,
    cotCurrencyId: options.cotCurrencyId,
    eoaAddress: options.eoaAddress,
    middlewareClient: options.middlewareClient,
  });

  // Determine route to figure out max COT available
  const route = await determineSwapRoute(swapData, {
    aggregators: preflight.aggregators,
    bridgeQuoteResponse: preflight.bridgeQuoteResponse,
    chainList: options.chainList,
    middlewareClient: options.middlewareClient,
    publicClientList: preflight.publicClientList,
    oraclePrices: preflight.oraclePrices,
    dstTokenInfo: preflight.dstTokenInfo,
    eoaAddress: options.eoaAddress,
    ephemeralAddress: options.ephemeralAddress,
    balances: preflight.balances,
    walletPathHints: preflight.walletPathHints,
    cotCurrencyId: options.cotCurrencyId,
    forceMayan: options.forceMayan ?? false,
  });
  const cotAmount = route.destination.inputAmount.max;

  // Apply haircut: max(3% of cotAmount, 3 USDC)
  const haircutPct = cotAmount.mul(MAX_SWAP_HAIRCUT_PCT);
  const haircutMin = new Decimal(MAX_SWAP_HAIRCUT_MIN_USDC);
  const haircut = Decimal.max(haircutPct, haircutMin);
  const adjusted = cotAmount.minus(haircut);

  const resolvedTokenInfo = route.dstTokenInfo;
  const tokenSwap = route.destination.swap.tokenSwap;

  if (tokenSwap) {
    // Scale output by adjusted / quoteInput ratio
    const quoteInput = new Decimal(tokenSwap.quote.input.amount);
    const quoteOutput = new Decimal(tokenSwap.quote.output.amount);
    const scaleFactor = adjusted.div(quoteInput);
    const adjustedOutput = quoteOutput.mul(scaleFactor);

    return {
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
      maxAmount: adjustedOutput.toFixed(resolvedTokenInfo.decimals),
      maxAmountRaw: mulDecimals(adjustedOutput, resolvedTokenInfo.decimals),
      symbol: resolvedTokenInfo.symbol,
      decimals: resolvedTokenInfo.decimals,
      sources: route.extras.assetsUsed.map((a) => ({
        chainId: a.chainID,
        tokenAddress: a.tokenAddress,
        symbol: a.symbol,
        decimals: a.decimals,
        amount: a.amount,
      })),
    };
  }

  // Destination IS COT — use adjusted directly
  return {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    maxAmount: adjusted.toFixed(resolvedTokenInfo.decimals),
    maxAmountRaw: mulDecimals(adjusted, resolvedTokenInfo.decimals),
    symbol: resolvedTokenInfo.symbol,
    decimals: resolvedTokenInfo.decimals,
    sources: route.extras.assetsUsed.map((a) => ({
      chainId: a.chainID,
      tokenAddress: a.tokenAddress,
      symbol: a.symbol,
      decimals: a.decimals,
      amount: a.amount,
    })),
  };
}
