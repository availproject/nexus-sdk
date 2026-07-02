import Decimal from 'decimal.js';
import type { OraclePriceResponse } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import type { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';
import { isNativeAddress } from './addresses';
import { equalFold } from './strings';

export const convertGasToToken = (
  token: {
    contractAddress: `0x${string}`;
    decimals: number;
  },
  oraclePrices: OraclePriceResponse,
  destinationChainID: number,
  destinationUniverse: Universe,
  gas: Decimal
) => {
  if (gas.isZero() || isNativeAddress(token.contractAddress)) {
    return gas;
  }

  const oracleUniverse = universeToOracleUniverse(destinationUniverse);

  const gasTokenInUSD =
    oraclePrices.find(
      (rate) =>
        rate.universe === oracleUniverse &&
        rate.chainId === destinationChainID &&
        equalFold(rate.tokenAddress, ZERO_ADDRESS)
    )?.priceUsd ?? new Decimal(0);

  const transferTokenInUSD = oraclePrices.find(
    (rate) =>
      rate.universe === oracleUniverse &&
      rate.chainId === destinationChainID &&
      equalFold(rate.tokenAddress, token.contractAddress)
  )?.priceUsd;

  if (gasTokenInUSD.lte(0)) {
    throw Errors.internal('could not find native gas token in price oracle');
  }

  if (!transferTokenInUSD || transferTokenInUSD.lte(0)) {
    throw Errors.internal('could not find token in price oracle');
  }

  const usdValue = gas.mul(gasTokenInUSD.toFixed());
  const tokenEquivalent = usdValue.div(transferTokenInUSD.toFixed());

  return tokenEquivalent.toDP(token.decimals, Decimal.ROUND_CEIL);
};

const universeToOracleUniverse = (universe: Universe): OraclePriceResponse[number]['universe'] => {
  switch (universe) {
    case 0:
      return 'EVM';
    case 1:
      return 'FUEL';
    case 2:
      return 'SVM';
    case 3:
      return 'TRON';
    default:
      throw Errors.universeNotSupported();
  }
};
