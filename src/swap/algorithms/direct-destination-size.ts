import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { ZERO_ADDRESS } from '../../domain/constants/addresses';
import { Errors } from '../../domain/errors';
import { isNativeAddress } from '../../services/addresses';
import type { Aggregator, QuoteResponse } from '../aggregators/types';
import { divDecimals } from '../../services/math';
import { equalFold } from '../../services/strings';
import { EADDRESS } from '../constants';
import type { OraclePriceResponse } from '../types';
import { selectDirectDestinationSwaps, type SourceHolding } from './auto-select';

type DirectDestinationSizeInput = {
  holdings: SourceHolding[];
  tokenAddress: Hex;
  tokenDecimals: number;
  tokenTargetRaw: bigint;
  nativeDecimals: number;
  gasTargetRaw: bigint;
  aggregators: Aggregator[];
  userAddressByChain: Map<number, Hex>;
  recipientAddressByChain: Map<number, Hex>;
  convergenceExtraRaw: (tokenAddress: Hex, decimals: number) => Decimal | undefined;
};

const deliveredRaw = (quoteResponses: QuoteResponse[]): bigint =>
  quoteResponses.reduce((sum, quote) => sum + quote.quote.output.amountRaw, 0n);

export const makeConvergenceExtraRaw = (
  oraclePrices: OraclePriceResponse,
  chainId: number
): ((tokenAddress: Hex, decimals: number) => Decimal | undefined) =>
  (tokenAddress, decimals) => {
    const oracleAddress = isNativeAddress(tokenAddress) ? ZERO_ADDRESS : tokenAddress;
    const price = oraclePrices.find(
      (entry) =>
        entry.chainId === chainId && equalFold(entry.tokenAddress, oracleAddress)
    )?.priceUsd;
    if (!price || price.lte(0)) return undefined;
    return new Decimal('0.5').div(price).mul(Decimal.pow(10, decimals));
  };

const holdingKey = (chainId: number, tokenAddress: Hex): string =>
  `${chainId}:${tokenAddress.toLowerCase()}`;

const subtractConsumedHoldings = (
  holdings: SourceHolding[],
  quoteResponses: QuoteResponse[]
): SourceHolding[] => {
  const consumedByKey = new Map<string, bigint>();
  const addConsumed = (chainId: number, tokenAddress: Hex, amountRaw: bigint) => {
    const key = holdingKey(chainId, tokenAddress);
    consumedByKey.set(key, (consumedByKey.get(key) ?? 0n) + amountRaw);
  };

  for (const quote of quoteResponses) {
    addConsumed(quote.chainID, quote.holding.tokenAddress, quote.quote.input.amountRaw);
  }

  return holdings.flatMap((holding) => {
    const consumed = consumedByKey.get(holdingKey(holding.chainID, holding.tokenAddress)) ?? 0n;
    const remainderRaw = holding.amountRaw > consumed ? holding.amountRaw - consumed : 0n;
    if (remainderRaw === 0n) return [];

    const ratio = new Decimal(remainderRaw.toString()).div(holding.amountRaw.toString());
    return [
      {
        ...holding,
        amountRaw: remainderRaw,
        value: new Decimal(holding.value).mul(ratio).toNumber(),
      },
    ];
  });
};

export const sizeDirectDestinationExactOut = async (
  input: DirectDestinationSizeInput
): Promise<QuoteResponse[]> => {
  const tokenResult = await selectDirectDestinationSwaps({
    holdings: input.holdings,
    outputRequired: divDecimals(input.tokenTargetRaw, input.tokenDecimals),
    target: { contractAddress: input.tokenAddress, decimals: input.tokenDecimals },
    aggregators: input.aggregators,
    userAddressByChain: input.userAddressByChain,
    recipientAddressByChain: input.recipientAddressByChain,
    maxConvergenceExtraRaw: input.convergenceExtraRaw(input.tokenAddress, input.tokenDecimals),
  });

  if (tokenResult.usedCOTs.length > 0) {
    throw Errors.internal(
      'Direct destination EXACT_OUT token selection returned identity holdings'
    );
  }
  if (deliveredRaw(tokenResult.quoteResponses) < input.tokenTargetRaw) {
    if (tokenResult.quoteResponses.length > 0) {
      throw Errors.insufficientBalance(
        'Direct destination EXACT_OUT: quoted token output cannot cover toAmount'
      );
    }
    throw Errors.quoteFailed('Direct destination EXACT_OUT: token selection cannot cover toAmount');
  }
  let gasSwaps: QuoteResponse[] = [];
  if (input.gasTargetRaw > 0n) {
    const gasResult = await selectDirectDestinationSwaps({
      holdings: subtractConsumedHoldings(input.holdings, tokenResult.quoteResponses),
      outputRequired: divDecimals(input.gasTargetRaw, input.nativeDecimals),
      target: { contractAddress: EADDRESS, decimals: input.nativeDecimals },
      aggregators: input.aggregators,
      userAddressByChain: input.userAddressByChain,
      recipientAddressByChain: input.recipientAddressByChain,
      maxConvergenceExtraRaw: input.convergenceExtraRaw(ZERO_ADDRESS, input.nativeDecimals),
    });
    if (gasResult.usedCOTs.length > 0) {
      throw Errors.internal(
        'Direct destination EXACT_OUT gas selection returned identity holdings'
      );
    }
    gasSwaps = gasResult.quoteResponses;
    const gasDeliveredRaw = gasSwaps.reduce(
      (sum, quote) => sum + quote.quote.output.amountRaw,
      0n
    );
    if (gasDeliveredRaw < input.gasTargetRaw) {
      if (gasResult.quoteResponses.length > 0) {
        throw Errors.insufficientBalance(
          'Direct destination EXACT_OUT: quoted gas output cannot cover toNativeAmount'
        );
      }
      throw Errors.quoteFailed(
        'Direct destination EXACT_OUT: gas selection cannot cover toNativeAmount'
      );
    }
  }

  const swaps = [
    ...tokenResult.quoteResponses.map((quote) => ({ ...quote, outputRole: 'token' as const })),
    ...gasSwaps.map((quote) => ({ ...quote, outputRole: 'gas' as const })),
  ];
  if (swaps.length === 0) {
    throw Errors.quoteFailed('Direct destination EXACT_OUT produced no swap legs');
  }
  return swaps;
};
