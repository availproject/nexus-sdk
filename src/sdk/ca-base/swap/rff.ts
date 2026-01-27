import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import { Hex, PrivateKeyAccount } from 'viem';
import { Errors } from '../errors';
import { FeeStore, mulDecimals } from '../utils';
import {
  getLogger,
  Intent,
  NetworkConfig,
  BridgeAsset,
  EoaToEphemeralCallMap,
  RFFDepositCallMap,
  ChainListType,
} from '../../../commons';

const logger = getLogger();

export const createIntent = ({
  assets,
  feeStore,
  output,
  address,
}: {
  assets: BridgeAsset[];
  feeStore: FeeStore;
  address: Hex;
  output: {
    amount: Decimal;
    chainID: number;
    decimals: number;
    tokenAddress: `0x${string}`;
  };
}) => {
  const eoaToEphemeralCalls: EoaToEphemeralCallMap = {};
  const intent: Intent = {
    allSources: [],
    recipientAddress: address,
    destination: {
      amount: new Decimal(0),
      chainID: output.chainID,
      decimals: output.decimals,
      gas: 0n,
      tokenContract: '0x',
      universe: Universe.ETHEREUM,
    },
    fees: {
      caGas: '0',
      collection: '0',
      fulfilment: '0',
      gasSupplied: '0',
      protocol: '0',
      solver: '0',
    },
    isAvailableBalanceInsufficient: false,
    sources: [],
  };

  let borrow = output.amount;
  intent.destination.amount = borrow;
  intent.destination.tokenContract = output.tokenAddress;

  const protocolFee = feeStore.calculateProtocolFee(borrow);
  borrow = borrow.add(protocolFee);

  intent.fees.protocol = protocolFee.toFixed();

  const fulfilmentFee = feeStore.calculateFulfilmentFee({
    decimals: output.decimals,
    destinationChainID: output.chainID,
    destinationTokenAddress: output.tokenAddress,
  });
  borrow = borrow.add(fulfilmentFee);
  intent.fees.fulfilment = fulfilmentFee.toFixed();

  let accountedBalance = new Decimal(0);

  logger.debug('createBridgeRFF:1', {
    assets: assets.map((i) => ({
      ...i,
      eoaBalance: i.eoaBalance.toFixed(),
      ephemeralBalance: i.ephemeralBalance.toFixed(),
    })),
    borrow: borrow.toFixed(),
    fulfilmentFee: fulfilmentFee.toFixed(),
    protocolFee: protocolFee.toFixed(),
  });

  for (const asset of assets) {
    if (
      asset.chainID === output.chainID ||
      Decimal.add(asset.eoaBalance, asset.ephemeralBalance).lte(0)
    ) {
      continue;
    }

    if (accountedBalance.gte(borrow)) {
      break;
    }

    const collectionFee = feeStore.calculateCollectionFee({
      decimals: asset.decimals,
      sourceChainID: asset.chainID,
      sourceTokenAddress: asset.contractAddress,
    });

    intent.fees.collection = collectionFee.add(intent.fees.collection).toFixed();
    borrow = borrow.add(collectionFee);

    const unaccountedBalance = borrow.minus(accountedBalance);

    const estimatedBorrowFromThisChain = Decimal.add(
      asset.eoaBalance.toString(),
      asset.ephemeralBalance.toString(),
    ).lte(unaccountedBalance)
      ? Decimal.add(asset.eoaBalance.toString(), asset.ephemeralBalance.toString())
      : unaccountedBalance;

    const solverFee = feeStore.calculateSolverFee({
      borrowAmount: estimatedBorrowFromThisChain,
      decimals: asset.decimals,
      destinationChainID: output.chainID,
      destinationTokenAddress: output.tokenAddress,
      sourceChainID: asset.chainID,
      sourceTokenAddress: asset.contractAddress,
    });

    intent.fees.solver = solverFee.add(intent.fees.solver).toFixed();
    borrow = borrow.add(solverFee);

    const unaccountedBalance2 = borrow.minus(accountedBalance);

    let borrowFromThisChain = new Decimal(0);
    if (Decimal.add(asset.eoaBalance, asset.ephemeralBalance).lte(unaccountedBalance2)) {
      logger.debug('createBridgeRFF:2.1', {
        assetBalance: Decimal.add(
          asset.eoaBalance.toString(),
          asset.ephemeralBalance.toString(),
        ).toFixed(),
        unaccountedBalance: unaccountedBalance2.toFixed(),
      });
      borrowFromThisChain = Decimal.add(
        asset.eoaBalance.toString(),
        asset.ephemeralBalance.toString(),
      );

      // Create allowance and deposit tx for (asset.eoaBalance) from usdc(eoa) -> usdc(eph)
      if (!asset.eoaBalance.eq(0)) {
        eoaToEphemeralCalls[asset.chainID] = {
          amount: mulDecimals(asset.eoaBalance, asset.decimals),
          decimals: asset.decimals,
          tokenAddress: asset.contractAddress,
        };
      }
    } else {
      borrowFromThisChain = unaccountedBalance2;

      if (borrowFromThisChain.gt(asset.ephemeralBalance.toString())) {
        logger.debug('createBridgeRFF:2.2', {
          assetEphemeral: asset.ephemeralBalance,
          borrowFromThisChain: borrowFromThisChain.toFixed(),
        });
        eoaToEphemeralCalls[asset.chainID] = {
          amount: mulDecimals(
            borrowFromThisChain.minus(asset.ephemeralBalance.toString()),
            asset.decimals,
          ),
          decimals: asset.decimals,
          tokenAddress: asset.contractAddress,
        };
      }
    }

    intent.sources.push({
      amount: borrowFromThisChain,
      chainID: asset.chainID,
      tokenContract: asset.contractAddress,
      universe: Universe.ETHEREUM,
      // FIXME:
      holderAddress: '0x',
    });
    accountedBalance = accountedBalance.add(borrowFromThisChain);
  }

  if (accountedBalance < borrow) {
    intent.isAvailableBalanceInsufficient = true;
  }

  return { eoaToEphemeralCalls, intent };
};

/**
 * @deprecated V1 swap RFF creation - requires cosmos chain.
 * TODO: Migrate to V2 middleware-based swap flow.
 */
export const createBridgeRFF = async (_params: {
  config: {
    chainList: ChainListType;
    cosmos?: unknown;
    evm: {
      address: `0x${string}`;
      client: PrivateKeyAccount;
      eoaAddress: `0x${string}`;
    };
    network: Pick<NetworkConfig, 'COSMOS_URL' | 'GRPC_URL'>;
  };
  input: {
    assets: BridgeAsset[];
  };
  output: {
    amount: Decimal;
    chainID: number;
    decimals: number;
    tokenAddress: `0x${string}`;
  };
}): Promise<{
  createRFF: () => Promise<{ createDoubleCheckTx: () => Promise<void>; intentID: Long }>;
  depositCalls: RFFDepositCallMap;
  eoaToEphemeralCalls: EoaToEphemeralCallMap;
  intent: Intent;
  waitForFill: () => { filled: boolean; intentID: Long; promise: Promise<void> };
}> => {
  throw Errors.internal('createBridgeRFF: V1 swap RFF not available in V2. Use bridge() for cross-chain transfers.');
};
