import { DepositVEPacket, EVMVaultABI, MsgDoubleCheckTx, Universe } from '@avail-project/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import Decimal from 'decimal.js';
import Long from 'long';
import {
  bytesToNumber,
  createPublicClient,
  encodeFunctionData,
  PrivateKeyAccount,
  toHex,
  webSocket,
} from 'viem';
import { Errors } from '../errors';
import { getLogger } from '../logger';
import { createRFFromIntent } from '../utils';
import { Intent, NetworkConfig } from '@nexus/commons';
import {
  convertAddressByUniverse,
  evmWaitForFill,
  FeeStore,
  getAllowances,
  getFeeStore,
  mulDecimals,
  removeIntentHashFromStore,
  storeIntentHashToStore,
  cosmosCreateDoubleCheckTx,
  cosmosCreateRFF,
} from '../utils';
import { packERC20Approve } from './utils';
import {
  BridgeAsset,
  EoaToEphemeralCallMap,
  RFFDepositCallMap,
  Tx,
  ChainListType,
} from '@nexus/commons';

const logger = getLogger();

const createEmptyIntent = ({
  chainID,
  decimals,
}: {
  decimals: number;
  chainID: number;
}): Intent => ({
  allSources: [],
  destination: {
    amount: new Decimal(0),
    chainID,
    decimals,
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
});

export const createIntent = ({
  assets,
  feeStore,
  output,
}: {
  assets: BridgeAsset[];
  feeStore: FeeStore;
  output: {
    amount: Decimal;
    chainID: number;
    decimals: number;
    tokenAddress: `0x${string}`;
  };
}) => {
  const eoaToEphemeralCalls: EoaToEphemeralCallMap = {};
  const intent = createEmptyIntent({ chainID: output.chainID, decimals: output.decimals });

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

export const createBridgeRFF = async ({
  config,
  input,
  output,
}: {
  config: {
    chainList: ChainListType;
    cosmos: {
      address: string;
      wallet: DirectSecp256k1Wallet;
    };
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
}) => {
  logger.debug('createBridgeRFF', { input, output });

  const feeStore = await getFeeStore(config.network.GRPC_URL);
  const depositCalls: RFFDepositCallMap = {};

  const { eoaToEphemeralCalls, intent } = createIntent({
    assets: input.assets,
    feeStore,
    output,
  });

  if (intent.isAvailableBalanceInsufficient) {
    throw Errors.insufficientBalance();
  }

  const { msgBasicCosmos, omniversalRFF, signatureData, sources } = await createRFFromIntent(
    intent,
    {
      chainList: config.chainList,
      cosmos: {
        address: config.cosmos.address,
        client: config.cosmos.wallet,
      },
      evm: {
        address: config.evm.address,
        client: config.evm.client,
      },
    },
    Universe.ETHEREUM,
  );

  logger.debug('createIntent', { intent });

  let intentID = Long.fromNumber(0);

  const createRFF = async () => {
    intentID = await cosmosCreateRFF({
      address: config.cosmos.address,
      cosmosURL: config.network.COSMOS_URL,
      msg: msgBasicCosmos,
      wallet: config.cosmos.wallet,
    });

    storeIntentHashToStore(config.evm.address, intentID.toNumber());

    const doubleCheckTxMap: Record<number, () => Promise<void>> = {};

    omniversalRFF.protobufRFF.sources.map((s) => {
      doubleCheckTxMap[bytesToNumber(s.chainID)] = createDoubleCheckTx(
        s.chainID,
        config.cosmos,
        intentID,
        config.network.COSMOS_URL,
      );
    });

    return {
      createDoubleCheckTx: async () => {
        try {
          for (const k in doubleCheckTxMap) {
            logger.debug('Starting double check tx', { chain: k });
            await doubleCheckTxMap[k]();
          }
        } catch (error) {
          logger.error('Error during double check tx', error);
        }
      },
      intentID,
    };
  };

  const allowances = await getAllowances(
    intent.sources.map((s) => ({
      chainID: s.chainID,
      tokenContract: s.tokenContract,
      holderAddress: config.evm.address,
    })),
    config.chainList,
  );

  for (const [index, source] of sources.entries()) {
    const evmSignatureData = signatureData.find((s) => s.universe === Universe.ETHEREUM);
    if (!evmSignatureData) {
      throw new Error('Unknown signature type');
    }

    const chain = config.chainList.getChainByID(Number(source.chainID));
    if (!chain) {
      throw new Error('chain not found');
    }

    const allowance = allowances[Number(source.chainID)];
    logger.debug('allowances', { allowance, chainID: Number(source.chainID) });
    if (allowance == null) {
      throw new Error('Allowance not applicable');
    }

    const tx: Tx[] = [];

    if (allowance < source.value) {
      const allowanceTx = {
        data: packERC20Approve(config.chainList.getVaultContractAddress(Number(source.chainID))),
        to: convertAddressByUniverse(source.tokenAddress, Universe.ETHEREUM),
        value: 0n,
      };
      tx.push(allowanceTx);
    }

    console.log({
      argsForRFFDeposit: [
        omniversalRFF.asEVMRFF(),
        toHex(evmSignatureData.signature),
        BigInt(index),
      ],
    });

    tx.push({
      data: encodeFunctionData({
        abi: EVMVaultABI,
        args: [omniversalRFF.asEVMRFF(), toHex(evmSignatureData.signature), BigInt(index)],
        functionName: 'deposit',
      }),
      to: config.chainList.getVaultContractAddress(Number(source.chainID)),
      value: 0n,
    });

    depositCalls[Number(source.chainID)] = {
      amount: source.value,
      tokenAddress: convertAddressByUniverse(source.tokenAddress, source.universe),
      tx: tx,
    };
  }

  const chain = config.chainList.getChainByID(Number(output.chainID));
  if (!chain) {
    throw new Error('Unknown destination chain');
  }

  const ws = webSocket(chain.rpcUrls.default.webSocket[0]);
  const pc = createPublicClient({
    transport: ws,
  });

  const waitForFill = () => {
    const s = signatureData.find((s) => s.universe === Universe.ETHEREUM);
    if (!s) {
      throw new Error('Unknown signature type');
    }
    logger.debug(`Waiting for fill: ${intentID}`);

    const r = {
      filled: false,
      intentID,
      promise: evmWaitForFill(
        config.chainList.getVaultContractAddress(chain.id),
        pc,
        s.requestHash,
        intentID,
        config.network.GRPC_URL,
        config.network.COSMOS_URL,
      ),
    };

    r.promise.then(() => {
      r.filled = true;
      removeIntentHashFromStore(config.evm.address, r.intentID);
    });

    return r;
  };
  return {
    createRFF,
    depositCalls,
    eoaToEphemeralCalls,
    intent,
    waitForFill,
  };
};

export const createDoubleCheckTx = (
  chainID: Uint8Array,
  cosmos: {
    address: string;
    wallet: DirectSecp256k1Wallet;
  },
  intentID: Long,
  cosmosURL: string,
) => {
  const msg = MsgDoubleCheckTx.create({
    creator: cosmos.address,
    packet: {
      $case: 'depositPacket',
      value: DepositVEPacket.create({
        gasRefunded: false,
        id: intentID,
      }),
    },
    txChainID: chainID,
    txUniverse: Universe.ETHEREUM,
  });

  return () => {
    return cosmosCreateDoubleCheckTx({
      address: cosmos.address,
      cosmosURL,
      msg,
      wallet: cosmos.wallet,
    });
  };
};
