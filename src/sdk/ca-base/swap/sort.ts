import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { orderBy } from 'es-toolkit';
import { type Hex, pad, toBytes, toHex } from 'viem';
import type { UserAssetDatum } from '../../../commons/types';
import type { FlatBalance } from './data';

const ZERO_ADDRESS: Hex = '0x0000000000000000000000000000000000000000';
const EADDRESS: Hex = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ETHEREUM_CHAIN_ID = 1;
const STABLECOINS = ['USDC', 'USDT', 'DAI'] as const;

const equalFold = (a?: string, b?: string) => {
  if (!a || !b) {
    return false;
  }
  return a.toLowerCase() === b.toLowerCase();
};

const convertTo32BytesHex = (value: Hex): Hex => {
  return toHex(
    pad(toBytes(value), {
      dir: 'left',
      size: 32,
    })
  );
};

const toFlatBalanceForSort = (assets: UserAssetDatum[]): FlatBalance[] => {
  return assets
    .flatMap((asset) =>
      asset.breakdown.map((breakdown) => {
        const tokenAddress = equalFold(breakdown.contractAddress, ZERO_ADDRESS)
          ? EADDRESS
          : breakdown.contractAddress;

        return {
          amount: breakdown.balance,
          chainID: breakdown.chain.id,
          decimals: breakdown.decimals,
          logo: asset.icon ?? '',
          symbol: asset.symbol,
          tokenAddress: convertTo32BytesHex(tokenAddress),
          universe: breakdown.universe,
          value: breakdown.balanceInFiat,
        };
      })
    )
    .filter(
      (balance) =>
        balance.universe === Universe.ETHEREUM &&
        new Decimal(balance.amount).gt(0) &&
        new Decimal(balance.value).gt(0)
    );
};

export const sortSourcesByPriorityWithAsset = (
  assets: UserAssetDatum[],
  destination: { tokenAddress: Hex; chainID: number; symbol: string }
) => {
  return sortSourcesByPriority(toFlatBalanceForSort(assets), destination);
};

export const sortSourcesByPriority = (
  balances: FlatBalance[],
  destination: { tokenAddress: Hex; chainID: number; symbol: string }
) => {
  const isGasToken = (tokenAddress: Hex): boolean => {
    const normalized = convertTo32BytesHex(tokenAddress);
    return (
      equalFold(normalized, convertTo32BytesHex(ZERO_ADDRESS)) ||
      equalFold(normalized, convertTo32BytesHex(EADDRESS))
    );
  };

  const normalizedDestAddress = equalFold(destination.tokenAddress, ZERO_ADDRESS)
    ? EADDRESS
    : destination.tokenAddress;

  const isSameToken = (balance: FlatBalance): boolean => {
    return (
      equalFold(
        convertTo32BytesHex(balance.tokenAddress),
        convertTo32BytesHex(normalizedDestAddress)
      ) ||
      (balance.symbol === destination.symbol &&
        balance.symbol !== 'ETH' &&
        balance.symbol !== 'WETH')
    );
  };

  const getPriority = (balance: FlatBalance): number => {
    const isSame = isSameToken(balance);
    const isSameChain = balance.chainID === destination.chainID;
    const isEthereum = balance.chainID === ETHEREUM_CHAIN_ID;
    const isGas = isGasToken(balance.tokenAddress);

    if (isSameChain) {
      if (isSame) return 1;
      if (STABLECOINS.some((coin) => equalFold(coin, balance.symbol))) return 2;
      if (isGas) return 3;
      return 4;
    }

    if (isEthereum) {
      if (isSame) return 8;
      if (STABLECOINS.some((coin) => equalFold(coin, balance.symbol))) return 9;
      if (balance.symbol === 'ETH') return 10;
      return 11;
    }

    if (isSame) return 5;
    if (STABLECOINS.some((coin) => equalFold(coin, balance.symbol))) return 6;
    return 7;
  };

  return orderBy(balances, [getPriority, (balance) => balance.value], ['asc', 'desc']);
};
