import { isNativeAddress } from '../services/addresses';
import type { QuoteResponse } from './aggregators/types';

export const orderSourceSwaps = (swaps: QuoteResponse[]): QuoteResponse[] =>
  [...swaps].sort(
    (left, right) =>
      Number(isNativeAddress(right.quote.input.contractAddress)) -
      Number(isNativeAddress(left.quote.input.contractAddress))
  );
