import { MsgCreateRequestForFunds, OmniversalRFF, Universe } from '@avail-project/ca-common';
import { FUEL_BASE_ASSET_ID, INTENT_EXPIRY, isNativeAddress, ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import { ChainListType, Intent } from '@nexus/commons';
import {
  convertTo32Bytes,
  convertTo32BytesHex,
  createRequestEVMSignature,
  createRequestFuelSignature,
  mulDecimals,
} from './common.utils';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { Hex, PrivateKeyAccount, toBytes, WalletClient } from 'viem';
import { CHAIN_IDS, FuelConnector, Provider } from 'fuels';
import Long from 'long';

type Destination = {
  tokenAddress: `0x${string}`;
  universe: Universe;
  value: bigint;
};

type Source = {
  chainID: bigint;
  tokenAddress: `0x${string}`;
  universe: Universe;
  value: bigint;
};

const logger = getLogger();

const getSourcesAndDestinationsForRFF = (
  intent: Intent,
  chainList: ChainListType,
  destinationUniverse: Universe,
) => {
  const sources: Source[] = [];
  const universes = new Set<Universe>();

  for (const source of intent.sources) {
    if (source.chainID == intent.destination.chainID) {
      continue;
    }

    const token = chainList.getTokenByAddress(source.chainID, source.tokenContract);
    if (!token) {
      logger.error('Token not found', { source });
      throw new Error('token not found');
    }

    universes.add(source.universe);

    sources.push({
      chainID: BigInt(source.chainID),
      tokenAddress: convertTo32BytesHex(source.tokenContract),
      universe: source.universe,
      value: mulDecimals(source.amount, token.decimals),
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
        tokenAddress: convertTo32BytesHex(
          destinationUniverse === Universe.FUEL ? FUEL_BASE_ASSET_ID : ZERO_ADDRESS,
        ),
        universe: intent.destination.universe,
        value: intent.destination.gas,
      });
    }
  }

  return { destinations, sources, universes };
};

const createRFFromIntent = async (
  intent: Intent,
  options: {
    chainList: ChainListType;
    cosmos: { address: string; client: DirectSecp256k1Wallet };
    evm: { address: Hex; client: PrivateKeyAccount | WalletClient };
    fuel?: { address: string; connector: FuelConnector; provider: Provider };
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

    if (universe === Universe.FUEL) {
      parties.push({
        address: convertTo32BytesHex(options.fuel!.address as Hex),
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
    destinationUniverse: intent.destination.universe,
    expiry: Long.fromString((BigInt(Date.now() + INTENT_EXPIRY) / 1000n).toString()),
    nonce: window.crypto.getRandomValues(new Uint8Array(32)),
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
      value: toBytes(source.value),
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

    if (universe === Universe.FUEL) {
      if (!options.fuel?.address || !options.fuel?.provider || !options.fuel?.connector) {
        logger.error('universe has fuel but not expected input', {
          fuelInput: options.fuel,
        });
        throw new Error('universe has fuel but not expected input');
      }

      const { requestHash, signature } = await createRequestFuelSignature(
        options.chainList.getVaultContractAddress(CHAIN_IDS.fuel.mainnet),
        options.fuel.provider,
        options.fuel.connector,
        omniversalRFF.asFuelRFF(),
      );
      signatureData.push({
        address: toBytes(options.fuel.address),
        requestHash,
        signature,
        universe: Universe.FUEL,
      });
    }
  }

  const msgBasicCosmos = MsgCreateRequestForFunds.create({
    destinationChainID: omniversalRFF.protobufRFF.destinationChainID,
    destinations: omniversalRFF.protobufRFF.destinations,
    destinationUniverse: omniversalRFF.protobufRFF.destinationUniverse,
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

export { createRFFromIntent, getSourcesAndDestinationsForRFF };
