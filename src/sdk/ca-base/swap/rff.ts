import { DepositVEPacket, EVMVaultABI, MsgDoubleCheckTx, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import {
  bytesToNumber,
  createPublicClient,
  encodeFunctionData,
  Hex,
  PrivateKeyAccount,
  toHex,
  webSocket,
} from 'viem';
import { Errors } from '../errors';
import {
  createRFFromIntent,
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
  getLogger,
  Intent,
  BridgeAsset,
  EoaToEphemeralCallMap,
  RFFDepositCallMap,
  Tx,
  ChainListType,
  CosmosOptions,
  MAINNET_CHAIN_IDS,
  QueryClients,
} from '../../../commons';

const logger = getLogger();

export const sumCollectionFee = (
  assets: Pick<BridgeAsset, 'chainID' | 'contractAddress' | 'decimals'>[],
  feeStore: FeeStore,
) => {
  logger.debug('sumCollectionFee', {
    assets,
    feeStore,
  });
  let fee = new Decimal(0);
  for (const asset of assets) {
    const collectionFee = feeStore.calculateCollectionFee({
      decimals: asset.decimals,
      sourceChainID: asset.chainID,
      sourceTokenAddress: asset.contractAddress,
    });
    logger.debug('sumCollectionFee', {
      collectionFee: collectionFee.toFixed(),
    });
    fee = fee.add(collectionFee);
  }

  return fee;
};

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
  intent.destination.amount = new Decimal(borrow);
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

  const sortedAssets = [...assets].sort((a, b) => {
    if (a.chainID === MAINNET_CHAIN_IDS.ETHEREUM) return 1; // a goes to end
    if (b.chainID === MAINNET_CHAIN_IDS.ETHEREUM) return -1; // b goes to end

    return Decimal.sub(
      Decimal.add(a.eoaBalance, a.ephemeralBalance),
      Decimal.add(b.eoaBalance, b.ephemeralBalance),
    ).toNumber(); // sort others by balance
  });

  for (const asset of sortedAssets) {
    if (
      asset.chainID === output.chainID ||
      Decimal.add(asset.eoaBalance, asset.ephemeralBalance).lte(0)
    ) {
      continue;
    }

    if (accountedBalance.gte(borrow)) {
      break;
    }

    logger.debug('bridgeRFF:2.0', {
      asset,
    });

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

    logger.debug('bridgeRFF:2.01', {
      solverFee: solverFee.toFixed(),
      collectionFee: collectionFee.toFixed(),
    });

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
          assetEphemeral: asset.ephemeralBalance.toFixed(),
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
    throw Errors.insufficientBalance(
      `available: ${accountedBalance.toFixed()}, required: ${borrow.toFixed()}`,
    );
  }

  logger.debug('createIntentEnd', {
    accountedBalance: accountedBalance.toFixed(),
    borrowEnd: borrow.toFixed(),
    borrowStart: intent.destination.amount.toFixed(),
  });

  return { eoaToEphemeralCalls, intent };
};

export const createBridgeRFF = async ({
  config,
  input,
  output,
}: {
  config: {
    chainList: ChainListType;
    cosmos: CosmosOptions;
    evm: {
      address: `0x${string}`;
      client: PrivateKeyAccount;
      eoaAddress: `0x${string}`;
    };
  } & QueryClients;
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

  const feeStore = await getFeeStore(config.cosmosQueryClient);
  const depositCalls: RFFDepositCallMap = {};

  const { eoaToEphemeralCalls, intent } = createIntent({
    assets: input.assets,
    feeStore,
    output,
    address: config.evm.address,
  });

  const { msgBasicCosmos, omniversalRFF, signatureData, sources } = await createRFFromIntent(
    intent,
    {
      chainList: config.chainList,
      cosmos: config.cosmos,
      evm: config.evm,
    },
    Universe.ETHEREUM,
  );

  logger.debug('createIntent', { intent });

  let intentID = Long.fromNumber(0);

  const createRFF = async () => {
    intentID = await cosmosCreateRFF({
      address: config.cosmos.address,
      client: config.cosmos.client,
      msg: msgBasicCosmos,
    });

    storeIntentHashToStore(config.evm.address, intentID.toNumber());

    const doubleCheckTxMap: Record<number, () => Promise<void>> = {};

    omniversalRFF.protobufRFF.sources.forEach((s) => {
      doubleCheckTxMap[bytesToNumber(s.chainID)] = createDoubleCheckTx(
        s.chainID,
        config.cosmos,
        intentID,
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
      throw Errors.unknownSignatureType();
    }

    const chain = config.chainList.getChainByID(Number(source.chainID));
    if (!chain) {
      throw Errors.chainNotFound(source.chainID);
    }

    const allowance = allowances[Number(source.chainID)];
    logger.debug('allowances', { allowance, chainID: Number(source.chainID) });
    if (allowance == null) {
      throw Errors.internal('Allowance not applicable');
    }

    const tx: Tx[] = [];

    if (allowance < source.valueRaw) {
      const allowanceTx = {
        data: packERC20Approve(
          config.chainList.getVaultContractAddress(Number(source.chainID)),
          source.valueRaw,
        ),
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
      amount: source.valueRaw,
      tokenAddress: convertAddressByUniverse(source.tokenAddress, source.universe),
      tx: tx,
    };
  }

  const chain = config.chainList.getChainByID(Number(output.chainID));
  if (!chain) {
    throw Errors.chainNotFound(output.chainID);
  }

  const ws = webSocket(chain.rpcUrls.default.webSocket[0]);
  const pc = createPublicClient({
    transport: ws,
  });

  const waitForFill = () => {
    const s = signatureData.find((s) => s.universe === Universe.ETHEREUM);
    if (!s) {
      throw Errors.unknownSignatureType();
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
        config.cosmosQueryClient,
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

export const createDoubleCheckTx = (chainID: Uint8Array, cosmos: CosmosOptions, intentID: Long) => {
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
      msg,
      client: cosmos.client,
    });
  };
};
