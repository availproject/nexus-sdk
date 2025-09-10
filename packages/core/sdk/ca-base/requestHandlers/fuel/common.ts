import Decimal from 'decimal.js';
import {
  Account,
  bn,
  CHAIN_IDS,
  hexlify,
  OutputType,
  Provider,
  TransactionRequest,
  TransactionRequestLike,
} from 'fuels';
import { Hex } from 'viem';

import { FUEL_BASE_ASSET_ID } from '../../constants';
import { getLogger } from '../../logger';
import { divDecimals } from '../../utils';
import { ChainListType } from '@nexus/commons';

const logger = getLogger();

const simulate = async (
  tx: TransactionRequestLike,
  address: string,
  provider: Provider,
  chainList: ChainListType,
) => {
  const outputs = tx.outputs?.filter((o) => o.type === OutputType.Coin) ?? [];
  const tokens = outputs
    .map((o) => {
      const token = chainList.getTokenByAddress(CHAIN_IDS.fuel.mainnet, o.assetId as Hex);
      if (!token) return null;
      return {
        from: hexlify(address).toLowerCase(),
        to: hexlify(o.to).toLowerCase(),
        token: {
          address: hexlify(o.assetId) as Hex,
          amount: divDecimals(o.amount.toString(), token.decimals),
          decimals: token.decimals,
          logo: token.logo,
          name: token.name,
          symbol: token.symbol,
        },
      };
    })
    .filter((o) => !!o)
    .reduce((acc, o) => {
      const existingCoin = acc.find(
        (a) => o.from === a.from && o.token.address === a.token.contractAddress,
      );
      if (existingCoin) {
        existingCoin.token.amount = new Decimal(existingCoin.token.amount).plus(o.token.amount);
        return acc;
      }
      acc.push({
        from: o.from,
        to: o.to,
        token: {
          amount: new Decimal(o.token.amount),
          contractAddress: o.token.address,
          decimals: o.token.decimals,
          logo: o.token.logo,
          name: o.token.name,
          symbol: o.token.symbol,
        },
      });
      return acc;
    }, [] as CoinTransfer[])
    .sort((a, b) => (new Decimal(a.token.amount).lessThan(b.token.amount) ? 1 : -1));

  const { assembledRequest } = await provider.assembleTx({
    feePayerAccount: new Account(address),
    request: tx as TransactionRequest,
  });

  logger.debug('Fuel Simulate: mappedOutputsToInputs', {
    assembledRequest,
  });

  const coin = tokens?.length ? tokens[0] : null;
  if (!coin) {
    return;
  }

  logger.debug('FuelSimulate', {
    amount: coin.token.amount.toFixed(),
    coin: coin,
  });

  const { amount, ...token } = coin.token;
  return {
    amount: amount,
    gas: BigInt(0),
    gasFee: divDecimals(BigInt(assembledRequest.maxFee.toString()) * 2n, 9),
    token: { ...token, type: 'src20' },
  };
};

const fixTx = async (address: string, tx: TransactionRequestLike, provider: Provider) => {
  delete tx.inputs;

  const outputQuantities = tx.outputs
    ?.filter((o) => o.type === OutputType.Coin)
    .map(({ amount, assetId }) => ({
      amount: bn(amount),
      assetId: String(assetId),
    }));

  const aResponse = await provider.assembleTx({
    accountCoinQuantities: outputQuantities,
    estimatePredicates: true,
    feePayerAccount: new Account(address),
    // @ts-ignore
    request: tx,
  });

  logger.debug('fixTx:sendTransaction:3', {
    assembleTxResponse: aResponse,
    request: tx,
  });

  return aResponse.assembledRequest as TransactionRequestLike;
};

type CoinTransfer = {
  from: string;
  to: string;
  token: {
    amount: Decimal;
    contractAddress: Hex;
    decimals: number;
    logo?: string;
    name: string;
    symbol: string;
  };
};

const isFuelNativeTransfer = (tx: TransactionRequestLike) => {
  return tx.outputs?.every((o) => {
    return 'assetId' in o && o.assetId === FUEL_BASE_ASSET_ID;
  });
};

export { fixTx, isFuelNativeTransfer, simulate };
