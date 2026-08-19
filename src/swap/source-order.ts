import { isNativeAddress } from '../services/addresses';
import type { QuoteResponse } from './aggregators/types';

export const isNativeSourceSwap = (swap: QuoteResponse): boolean =>
  isNativeAddress(swap.quote.input.contractAddress);

export const orderSourceSwaps = (swaps: QuoteResponse[]): QuoteResponse[] =>
  [...swaps].sort(
    (left, right) => Number(isNativeSourceSwap(right)) - Number(isNativeSourceSwap(left))
  );

export const groupSourceSwapsByChain = (
  swaps: QuoteResponse[]
): Array<[number, QuoteResponse[]]> => {
  const grouped = new Map<number, QuoteResponse[]>();
  for (const swap of swaps) {
    const chainSwaps = grouped.get(swap.chainID);
    if (chainSwaps) chainSwaps.push(swap);
    else grouped.set(swap.chainID, [swap]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([chainId, chainSwaps]) => [chainId, orderSourceSwaps(chainSwaps)]);
};
