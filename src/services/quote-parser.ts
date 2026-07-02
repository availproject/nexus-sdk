import { encodeFunctionData, erc20Abi } from 'viem';
import type { Quote } from '../swap/aggregators/types';
import type { ParsedQuoteCall } from '../swap/types';
import { isNativeAddress } from './addresses';

export const parseQuote = (quote: Quote): ParsedQuoteCall => {
  const isNativeInput = isNativeAddress(quote.input.contractAddress);

  return {
    quote,
    chainId: 0,
    approval: isNativeInput
      ? null
      : {
          to: quote.input.contractAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [quote.txData.approvalAddress, quote.input.amountRaw],
          }),
          value: 0n,
        },
    swap: {
      to: quote.txData.tx.to,
      data: quote.txData.tx.data,
      value: BigInt(quote.txData.tx.value),
    },
  };
};
