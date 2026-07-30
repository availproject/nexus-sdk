import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { Universe, type UnifiedBalanceResponseData } from '../../src/domain';
import type { OraclePriceResponse } from '../../src/swap/types';
import { encodeChainIdToBytes32, parseHexToTokenBytes } from '../../src/transport/encoding';

export const makeUnifiedBalance = (input: {
  chainId: number;
  tokenAddress: Hex;
  rawBalance: string;
  value: string;
  symbol?: string;
  universe?: Universe;
}): UnifiedBalanceResponseData => ({
  chain_id: encodeChainIdToBytes32(input.chainId),
  currencies: [
    {
      balance: input.rawBalance,
      token_address: parseHexToTokenBytes(input.tokenAddress),
      value: input.value,
      ...(input.symbol ? { symbol: input.symbol } : {}),
    },
  ],
  total_usd: input.value,
  universe: input.universe ?? Universe.ETHEREUM,
  errored: false,
});

export const makeOraclePrice = (input: {
  chainId: number;
  tokenAddress: Hex;
  symbol: string;
  decimals: number;
  priceUsd: Decimal.Value;
  timestamp?: number;
}): OraclePriceResponse[number] => ({
  universe: 'EVM',
  chainId: input.chainId,
  tokenAddress: input.tokenAddress,
  tokenSymbol: input.symbol,
  tokenDecimals: input.decimals,
  priceUsd: new Decimal(input.priceUsd),
  timestamp: input.timestamp ?? 1,
});
