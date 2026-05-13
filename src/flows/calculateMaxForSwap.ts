import {
  type Aggregator,
  BebopAggregator,
  CurrencyID,
  FibrousAggregator,
  LiFiAggregator,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { type MaxSwapInput, type MaxSwapResult, SwapMode, type SwapParams } from '../commons';
import { mulDecimals } from '../core/utils';
import { BEBOP_API_KEY, LIFI_API_KEY } from '../swap/constants';
import { determineSwapRoute } from '../swap/route';
import { PublicClientList, validateDestinationChainForSwap } from '../swap/utils';

export const calculateMaxForSwap = async (
  input: MaxSwapInput,
  options: SwapParams,
  COT = CurrencyID.USDC
): Promise<MaxSwapResult> => {
  validateDestinationChainForSwap(options.chainList, input.toChainId);
  const publicClientList = new PublicClientList(options.chainList);

  const aggregators: Aggregator[] = [
    new LiFiAggregator(LIFI_API_KEY),
    new BebopAggregator(BEBOP_API_KEY),
    new FibrousAggregator(),
  ];
  const swapRouteParams = { ...options, publicClientList, aggregators, cotCurrencyID: COT };

  const swapRoute = await determineSwapRoute(
    {
      mode: SwapMode.EXACT_IN,
      data: {
        from:
          input.fromSources?.map((s) => ({ chainId: s.chainId, tokenAddress: s.tokenAddress })) ??
          [],
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      },
    },
    swapRouteParams
  );

  const { destination, extras, dstTokenInfo } = swapRoute;

  // Apply a haircut of min(3%, 3 USDC) to the COT input amount, then scale output proportionally.
  // This accounts for slippage and fees that could eat into the quoted max.
  const cotAmount = destination.inputAmount.max;
  const haircut = Decimal.min(cotAmount.mul(0.03), 3);
  const adjustedCOTAmount = cotAmount.minus(haircut);

  let maxAmount: string;
  let maxAmountRaw: bigint;

  if (destination.swap.tokenSwap) {
    const quote = destination.swap.tokenSwap.quote;
    const scaleFactor = adjustedCOTAmount.div(new Decimal(quote.input.amount));
    const adjustedOutput = new Decimal(quote.output.amount).mul(scaleFactor);
    maxAmount = adjustedOutput.toFixed(dstTokenInfo.decimals);
    maxAmountRaw = mulDecimals(adjustedOutput, dstTokenInfo.decimals);
  } else {
    maxAmount = adjustedCOTAmount.toFixed(dstTokenInfo.decimals);
    maxAmountRaw = mulDecimals(adjustedCOTAmount, dstTokenInfo.decimals);
  }

  return {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    maxAmount,
    maxAmountRaw,
    symbol: dstTokenInfo.symbol,
    decimals: dstTokenInfo.decimals,
    sources: extras.assetsUsed.map((a) => ({
      chainId: a.chainID,
      tokenAddress: a.contractAddress,
      symbol: a.symbol,
      decimals: a.decimals,
      amount: a.amount,
    })),
  };
};
