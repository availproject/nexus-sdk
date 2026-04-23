import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { orderBy } from 'es-toolkit';
import { type Hex, pad, toBytes, toHex } from 'viem';
import type { UserAssetDatum } from '../commons/types';
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

  const isStablecoin = (symbol: string) => STABLECOINS.some((coin) => equalFold(coin, symbol));

  // Priority groups ordered by bridging cost (lowest = preferred):
  //   1–4:  same chain         (no bridge needed)
  //   5–7:  other chains       (bridge required)
  //   8–11: Ethereum mainnet   (most expensive to bridge from)
  // Within each group: same token > stablecoin > gas > other
  const getPriority = (balance: FlatBalance): number => {
    const isSame = isSameToken(balance);
    const isSameChain = balance.chainID === destination.chainID;
    const isEthereum = balance.chainID === ETHEREUM_CHAIN_ID;
    const isStable = isStablecoin(balance.symbol);
    const isGas = isGasToken(balance.tokenAddress);

    if (isSameChain) {
      if (isSame) return 1; // Same token,  same chain
      if (isStable) return 2; // Stablecoin,  same chain
      if (isGas) return 3; // Gas token,   same chain
      return 4; // Other token, same chain
    }

    if (!isEthereum) {
      if (isSame) return 5; // Same token,  other chain
      if (isStable) return 6; // Stablecoin,  other chain
      return 7; // Other token, other chain
    }

    // Ethereum mainnet
    if (isSame) return 8; // Same token,  Ethereum
    if (isStable) return 9; // Stablecoin,  Ethereum
    if (balance.symbol === 'ETH') return 10; // ETH, Ethereum
    return 11; // Other token, Ethereum
  };

  return orderBy(balances, [getPriority, (balance) => balance.value], ['asc', 'desc']);
};
