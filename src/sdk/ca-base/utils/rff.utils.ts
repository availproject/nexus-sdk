import { MsgCreateRequestForFunds, OmniversalRFF, Universe } from '@avail-project/ca-common';
import { INTENT_EXPIRY, isNativeAddress, ZERO_ADDRESS } from '../constants';
import { getLogger, ChainListType, Intent, IBridgeOptions } from '../../../commons';
import {
  convertTo32Bytes,
  convertTo32BytesHex,
  createRequestEVMSignature,
  createRequestTronSignature,
  mulDecimals,
} from './common.utils';
import { Hex, PrivateKeyAccount, toBytes, WalletClient } from 'viem';
import Long from 'long';
import { TronWeb } from 'tronweb';
import { tronHexToEvmAddress } from './tron.utils';
import { Errors } from '../errors';
import { convertToEVMAddress } from '../swap/utils';
import Decimal from 'decimal.js';
import { FeeStore } from './api.utils';
import { PlatformUtils } from './platform.utils';

type Destination = {
  tokenAddress: Hex;
  universe: Universe;
  value: bigint;
};

type Source = {
  chainID: bigint;
  tokenAddress: Hex;
  universe: Universe;
  valueRaw: bigint;
  value: Decimal;
};

const logger = getLogger();

const getSourcesAndDestinationsForRFF = (intent: Intent, chainList: ChainListType, _: Universe) => {
  const sources: Source[] = [];
  const universes = new Set<Universe>();

  for (const source of intent.sources) {
    if (source.chainID == intent.destination.chainID) {
      continue;
    }

    const token = chainList.getTokenByAddress(source.chainID, source.tokenContract);
    if (!token) {
      logger.error('Token not found', { source });
      throw Errors.tokenNotSupported(source.tokenContract, source.chainID);
    }

    universes.add(source.universe);

    sources.push({
      chainID: BigInt(source.chainID),
      tokenAddress: convertTo32BytesHex(source.tokenContract),
      universe: source.universe,
      valueRaw: mulDecimals(source.amount, token.decimals),
      value: source.amount,
    });
  }

  universes.add(intent.destination.universe);

  const destinations: Destination[] = [
    {
      tokenAddress: convertTo32BytesHex(intent.destination.tokenContract),
      universe: intent.destination.universe,
      value: mulDecimals(intent.destination.amount, intent.destination.decimals),
    },
  ];

  if (intent.destination.gas != 0n) {
    if (isNativeAddress(intent.destination.universe, intent.destination.tokenContract)) {
      destinations[0].value = destinations[0].value + intent.destination.gas;
    } else {
      destinations.push({
        tokenAddress: convertTo32BytesHex(ZERO_ADDRESS),
        universe: intent.destination.universe,
        value: intent.destination.gas,
      });
    }
  }

  return { destinations, sources, universes };
};

const createRFFromIntent = async (
  intent: Intent,
  options: Pick<IBridgeOptions, 'chainList' | 'cosmos' | 'tron'> & {
    evm: {
      address: `0x${string}`;
      client: WalletClient | PrivateKeyAccount;
    };
  },
  destinationUniverse: Universe,
) => {
  const { destinations, sources, universes } = getSourcesAndDestinationsForRFF(
    intent,
    options.chainList,
    destinationUniverse,
  );

  const parties: Array<{ address: string; universe: Universe }> = [];
  for (const universe of universes) {
    if (universe === Universe.ETHEREUM) {
      parties.push({
        address: convertTo32BytesHex(options.evm.address),
        universe: universe,
      });
    }

    if (universe === Universe.TRON) {
      console.log({ tronAddress: TronWeb.address.toHex(options.tron!.address) });
      parties.push({
        address: convertTo32BytesHex(
          tronHexToEvmAddress(TronWeb.address.toHex(options.tron!.address)),
        ),
        universe,
      });
    }
  }

  logger.debug('processRFF:1', {
    destinations,
    parties,
    sources,
    universes,
  });

  const omniversalRFF = new OmniversalRFF({
    destinationChainID: convertTo32Bytes(intent.destination.chainID),
    destinations: destinations.map((dest) => ({
      contractAddress: toBytes(dest.tokenAddress),
      value: toBytes(dest.value),
    })),
    recipientAddress: convertTo32Bytes(intent.recipientAddress),
    destinationUniverse: intent.destination.universe,
    expiry: Long.fromString((BigInt(Date.now() + INTENT_EXPIRY) / 1000n).toString()),
    nonce: await PlatformUtils.cryptoGetRandomValues(new Uint8Array(32)),
    // @ts-expect-error
    signatureData: parties.map((p) => ({
      address: toBytes(p.address),
      universe: p.universe,
    })),
    // @ts-expect-error
    sources: sources.map((source) => ({
      chainID: convertTo32Bytes(source.chainID),
      contractAddress: convertTo32Bytes(source.tokenAddress),
      universe: source.universe,
      value: toBytes(source.valueRaw),
    })),
  });

  const signatureData: {
    address: Uint8Array;
    requestHash: `0x${string}`;
    signature: Uint8Array;
    universe: Universe;
  }[] = [];

  for (const universe of universes) {
    if (universe === Universe.ETHEREUM) {
      const { requestHash, signature } = await createRequestEVMSignature(
        omniversalRFF.asEVMRFF(),
        options.evm.address,
        options.evm.client,
      );

      signatureData.push({
        address: convertTo32Bytes(options.evm.address),
        requestHash,
        signature,
        universe: Universe.ETHEREUM,
      });
    }

    if (universe === Universe.TRON) {
      if (!options.tron) {
        logger.error('universe has tron but not expected input', {
          tronInput: options.tron,
        });
        throw Errors.internal('universe has tron but not expected input');
      }
      const { requestHash, signature } = await createRequestTronSignature(
        omniversalRFF.asEVMRFF(),
        options.tron.adapter,
      );

      signatureData.push({
        address: convertTo32Bytes(tronHexToEvmAddress(TronWeb.address.toHex(options.tron.address))),
        requestHash,
        signature,
        universe,
      });
    }
  }

  const msgBasicCosmos = MsgCreateRequestForFunds.create({
    destinationChainID: omniversalRFF.protobufRFF.destinationChainID,
    destinations: omniversalRFF.protobufRFF.destinations,
    destinationUniverse: omniversalRFF.protobufRFF.destinationUniverse,
    recipientAddress: omniversalRFF.protobufRFF.recipientAddress,
    expiry: omniversalRFF.protobufRFF.expiry,
    nonce: omniversalRFF.protobufRFF.nonce,
    signatureData: signatureData.map((s) => ({
      address: s.address,
      signature: s.signature,
      universe: s.universe,
    })),
    sources: omniversalRFF.protobufRFF.sources,
    user: options.cosmos.address,
  });

  logger.debug('processRFF:2', {
    msgBasicCosmos,
    omniversalRFF,
    signatureData,
  });

  return {
    msgBasicCosmos,
    omniversalRFF,
    signatureData,
    sources,
    universes,
  };
};

const calculateMaxBridgeFee = ({
  assets,
  feeStore,
  dst,
}: {
  dst: {
    chainId: number;
    tokenAddress: Hex;
    decimals: number;
  };
  assets: {
    chainID: number;
    contractAddress: `0x${string}`;
    decimals: number;
    balance: Decimal;
  }[];
  feeStore: FeeStore;
}) => {
  const borrow = assets.reduce((accumulator, asset) => {
    return accumulator.add(asset.balance);
  }, new Decimal(0));

  const sourceChainIds: number[] = [];

  const protocolFee = feeStore.calculateProtocolFee(new Decimal(borrow));
  let borrowWithFee = borrow.add(protocolFee);

  const fulfilmentFee = feeStore.calculateFulfilmentFee({
    decimals: dst.decimals,
    destinationChainID: dst.chainId,
    destinationTokenAddress: dst.tokenAddress,
  });
  borrowWithFee = borrowWithFee.add(fulfilmentFee);

  logger.debug('calculateMaxBridgeFees:1', {
    borrow: borrow.toFixed(),
    protocolFee: protocolFee.toFixed(),
    fulfilmentFee: fulfilmentFee.toFixed(),
    borrowWithFee: borrowWithFee.toFixed(),
  });

  for (const asset of assets) {
    if (!asset.balance.gt(0)) {
      continue;
    }
    sourceChainIds.push(asset.chainID);
    const collectionFee = feeStore.calculateCollectionFee({
      decimals: asset.decimals,
      sourceChainID: asset.chainID,
      sourceTokenAddress: asset.contractAddress,
    });

    borrowWithFee = borrowWithFee.add(collectionFee);

    const solverFee = feeStore.calculateSolverFee({
      borrowAmount: asset.balance,
      decimals: asset.decimals,
      destinationChainID: dst.chainId,
      destinationTokenAddress: dst.tokenAddress,
      sourceChainID: asset.chainID,
      sourceTokenAddress: convertToEVMAddress(asset.contractAddress),
    });

    borrowWithFee = borrowWithFee.add(solverFee);
    logger.debug('calculateMaxBridgeFees:2', {
      borrow: borrow.toFixed(),
      borrowWithFee: borrowWithFee.toFixed(),
      solverFee: solverFee.toFixed(),
    });
  }

  const fee = borrowWithFee.minus(borrow);
  const maxAmount = fee.lt(borrow)
    ? borrow.minus(fee).toFixed(dst.decimals, Decimal.ROUND_FLOOR)
    : '0';

  return { fee, maxAmount, sourceChainIds };
};

export { createRFFromIntent, getSourcesAndDestinationsForRFF, calculateMaxBridgeFee };
