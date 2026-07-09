import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { ZERO_ADDRESS } from '../domain/constants/addresses';
import { isNativeAddress } from '../services/addresses';
import { mulDecimals } from '../services/math';
import { equalFold } from '../services/strings';
import { MAX_SWAP_HAIRCUT_MIN_USDC, MAX_SWAP_HAIRCUT_PCT } from './constants';
import { buildSwapPreflight } from './preflight';
import { determineSwapRoute } from './route';
import type {
  OraclePriceResponse,
  SwapData,
  SwapMaxParams,
  SwapMaxResult,
  SwapParams,
  SwapRoute,
} from './types';
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
  const resolvedTokenInfo = route.dstTokenInfo;
  const tokenSwap = route.destination.swap.tokenSwap;
  const sources = route.extras.assetsUsed.map((a) => ({
    chainId: a.chainID,
    tokenAddress: a.tokenAddress,
    symbol: a.symbol,
    decimals: a.decimals,
    amount: a.amount,
  }));

  if (tokenSwap) {
    // A destination token swap exists → `destination.inputAmount.max` is COT (USDC). Take the
    // max(3%, $3) haircut in COT space, then scale the adjusted COT to the output token via the
    // dst swap's own input→output ratio.
    const cotAmount = route.destination.inputAmount.max;
    const haircut = Decimal.max(
      cotAmount.mul(MAX_SWAP_HAIRCUT_PCT),
      new Decimal(MAX_SWAP_HAIRCUT_MIN_USDC)
    );
    const adjusted = cotAmount.minus(haircut);
    const quoteInput = new Decimal(tokenSwap.quote.input.amount);
    const quoteOutput = new Decimal(tokenSwap.quote.output.amount);
    const adjustedOutput = quoteOutput.mul(adjusted.div(quoteInput));

    return {
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
      maxAmount: adjustedOutput.toFixed(resolvedTokenInfo.decimals),
      maxAmountRaw: mulDecimals(adjustedOutput, resolvedTokenInfo.decimals),
      symbol: resolvedTokenInfo.symbol,
      decimals: resolvedTokenInfo.decimals,
      sources,
    };
  }

  // No destination swap → `destination.inputAmount.max` is delivered in the DESTINATION token, which
  // is only USDC in the default COT-dst flow (Path A delivers toToken, a same-token bridge the family
  // token). Keep the haircut in USD space and convert the $3 floor into delivered-token units.
  const adjustedDelivered = applyDeliveredTokenHaircut(route);
  return {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    maxAmount: adjustedDelivered.toFixed(resolvedTokenInfo.decimals),
    maxAmountRaw: mulDecimals(adjustedDelivered, resolvedTokenInfo.decimals),
    symbol: resolvedTokenInfo.symbol,
    decimals: resolvedTokenInfo.decimals,
    sources,
  };
}

// The max(3%, $3) safety haircut for a route with no destination swap, where
// `destination.inputAmount.max` is denominated in the destination token itself (USDC in the default
// COT-dst flow, toToken for Path A, the family token for a same-token bridge). The 3% part is
// unit-free; the $3 floor is converted to token units at the delivered token's price so a bare
// subtraction can't mean "3 ETH" on an ETH route. Price source: quote-implied (Σ output.value over
// the source swaps) when swaps exist, else the delivered token's oracle price; neither ⇒ pct-only.
// Clamped at 0. For a USDC destination usdBasis ≈ delivered, so this stays byte-identical to the old
// `delivered − max(3%, $3)`. See swap.md §5.
function applyDeliveredTokenHaircut(route: SwapRoute): Decimal {
  const delivered = route.destination.inputAmount.max;
  const clampToPositive = (value: Decimal): Decimal => Decimal.max(value, new Decimal(0));
  const pctOnly = (): Decimal => clampToPositive(delivered.mul(1 - MAX_SWAP_HAIRCUT_PCT));

  const sourceSwaps = route.source.swaps;
  if (sourceSwaps.length > 0) {
    // Quote-implied price. Scaling `delivered` by (usdBasis − haircutUsd)/usdBasis subtracts the
    // haircut converted at that price (algebraically `delivered − max(delivered×3%, $3/price)`).
    const usdBasis = sourceSwaps.reduce(
      (sum, quote) => sum.plus(quote.quote.output.value),
      new Decimal(0)
    );
    if (usdBasis.lte(0)) return pctOnly();
    const haircutUsd = Decimal.max(
      usdBasis.mul(MAX_SWAP_HAIRCUT_PCT),
      new Decimal(MAX_SWAP_HAIRCUT_MIN_USDC)
    );
    return clampToPositive(delivered.mul(usdBasis.minus(haircutUsd)).div(usdBasis));
  }

  // Same-token pure bridge: no quotes to imply a price → oracle price of the delivered token. Oracle
  // entries key native as ZERO_ADDRESS, but a native dst token carries EADDRESS — normalize so ETH↔ETH
  // bridges hit the oracle floor (max(3%, $3/price)) instead of falling through to pct-only.
  const priceUsd = findOraclePriceUsd(
    route.extras.oraclePrices,
    route.destination.chainId,
    isNativeAddress(route.dstTokenInfo.contractAddress)
      ? ZERO_ADDRESS
      : (route.dstTokenInfo.contractAddress as Hex)
  );
  if (!priceUsd || priceUsd.lte(0)) return pctOnly();
  const floorToken = new Decimal(MAX_SWAP_HAIRCUT_MIN_USDC).div(priceUsd);
  const haircut = Decimal.max(delivered.mul(MAX_SWAP_HAIRCUT_PCT), floorToken);
  return clampToPositive(delivered.minus(haircut));
}

const findOraclePriceUsd = (
  oraclePrices: OraclePriceResponse,
  chainId: number,
  tokenAddress: Hex
): Decimal | undefined =>
  oraclePrices.find((price) => price.chainId === chainId && equalFold(price.tokenAddress, tokenAddress))
    ?.priceUsd;
