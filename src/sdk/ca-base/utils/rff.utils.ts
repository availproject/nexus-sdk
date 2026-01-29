import { Universe } from '@avail-project/ca-common';
import type Decimal from 'decimal.js';

import { TronWeb } from 'tronweb';
import {
  encodeAbiParameters,
  type Hex,
  hashMessage,
  keccak256,
  type PrivateKeyAccount,
  toHex,
  type WalletClient,
} from 'viem';
import {
  type ChainListType,
  getLogger,
  type IBridgeOptions,
  type Intent,
  type V2DestinationPair,
  type V2Party,
  type V2Request,
  type V2SourcePair,
  type V2Universe,
} from '../../../commons';
import { INTENT_EXPIRY, isNativeAddress, ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';

import { convertTo32BytesHex, mulDecimals } from './common.utils';
import { tronHexToEvmAddress } from './tron.utils';

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
    if (source.chainID === intent.destination.chainID) {
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

  if (intent.destination.gas !== 0n) {
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

// ============================================================================
// V2 Request Creation (for Statekeeper API)
// ============================================================================

/**
 * Convert Universe enum to V2Universe string
 */
const universeToV2 = (universe: Universe): V2Universe => {
  return universe === Universe.ETHEREUM ? 'EVM' : 'TRON';
};

/**
 * Convert V2Universe string to numeric value for ABI encoding
 */
const universeToNumeric = (universe: V2Universe): number => {
  switch (universe) {
    case 'EVM':
      return 0;
    case 'TRON':
      return 1;
    case 'FUEL':
      return 2;
    case 'SVM':
      return 3;
    default:
      return 0;
  }
};

/**
 * Convert a bigint to a decimal string - used for V2Request JSON payload
 * The middleware/statekeeper expects decimal strings for values
 */
const bigintToDecimalString = (value: bigint): string => {
  return value.toString(10);
};

/**
 * Convert a chain ID to a 32-byte hex string (0x + 64 chars)
 * This matches the format expected by the statekeeper/solver
 */
const chainIdToBytes32Hex = (chainId: bigint): Hex => {
  return toHex(chainId, {
    size: 32,
  });
};

/**
 * ABI type definitions for V2 Request encoding (matches Solidity Vault.sol)
 */
const V2_REQUEST_ABI_PARAMS = [
  {
    name: 'sources',
    type: 'tuple[]',
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'chainID', type: 'uint256' },
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
  },
  { name: 'destinationUniverse', type: 'uint8' },
  { name: 'destinationChainID', type: 'uint256' },
  { name: 'recipientAddress', type: 'bytes32' },
  {
    name: 'destinations',
    type: 'tuple[]',
    components: [
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
    ],
  },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  {
    name: 'parties',
    type: 'tuple[]',
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'address_', type: 'bytes32' },
    ],
  },
] as const;

/**
 * Compute the request hash matching the solver's verification
 * This MUST match exactly what the solver computes in vault.rs
 */
const computeRequest = (request: V2Request) => {
  const sources = request.sources.map((s) => ({
    universe: universeToNumeric(s.universe),
    chainID: BigInt(s.chain_id),
    contractAddress: s.contract_address as Hex,
    value: BigInt(s.value),
    fee: BigInt(s.fee),
  }));

  const destinations = request.destinations.map((d) => ({
    contractAddress: d.contract_address as Hex,
    value: BigInt(d.value),
  }));

  const parties = request.parties.map((p) => ({
    universe: universeToNumeric(p.universe),
    address_: p.address as Hex,
  }));

  const destinationUniverse = universeToNumeric(request.destination_universe);
  const destinationChainID = BigInt(request.destination_chain_id);
  const recipientAddress = request.recipient_address as Hex;
  const nonce = BigInt(request.nonce);
  const expiry = BigInt(request.expiry);

  const encoded = encodeAbiParameters(V2_REQUEST_ABI_PARAMS, [
    sources,
    destinationUniverse,
    destinationChainID,
    recipientAddress,
    destinations,
    nonce,
    expiry,
    parties,
  ]);

  return {
    hash: keccak256(encoded),
    request: {
      sources,
      destinations,
      destinationUniverse,
      destinationChainID,
      recipientAddress,
      nonce,
      expiry,
      parties,
    },
  };
};

/**
 * Create a V2 Request from an Intent for the Statekeeper API
 */
const createV2RequestFromIntent = async (
  intent: Intent,
  options: Pick<IBridgeOptions, 'chainList' | 'tron'> & {
    evm: {
      address: `0x${string}`;
      client: WalletClient | PrivateKeyAccount;
    };
  },
  destinationUniverse: Universe
) => {
  const { destinations, sources, universes } = getSourcesAndDestinationsForRFF(
    intent,
    options.chainList,
    destinationUniverse
  );

  // Build parties array
  const parties: V2Party[] = [];
  for (const universe of universes) {
    if (universe === Universe.ETHEREUM) {
      parties.push({
        universe: universeToV2(universe),
        address: convertTo32BytesHex(options.evm.address),
      });
    }
    if (universe === Universe.TRON && options.tron) {
      parties.push({
        universe: universeToV2(universe),
        address: convertTo32BytesHex(
          tronHexToEvmAddress(TronWeb.address.toHex(options.tron.address))
        ),
      });
    }
  }

  // Generate nonce using timestamp (matches middleware test format)
  const nonce = BigInt(Date.now());

  // Calculate expiry timestamp
  const expiry = BigInt(Math.floor((Date.now() + INTENT_EXPIRY) / 1000));

  // Build V2 sources with fee field (set to 0 for now, statekeeper will calculate)
  // IMPORTANT: Use decimal strings for values, and 32-byte hex for chain_id to match solver
  const v2Sources: V2SourcePair[] = sources.map((source) => ({
    universe: universeToV2(source.universe),
    chain_id: chainIdToBytes32Hex(source.chainID),
    contract_address: source.tokenAddress,
    value: bigintToDecimalString(source.valueRaw),
    fee: '0', // Fee will be calculated by the statekeeper/protocol
  }));

  // Build V2 destinations
  const v2Destinations: V2DestinationPair[] = destinations.map((dest) => ({
    contract_address: dest.tokenAddress,
    value: bigintToDecimalString(dest.value),
  }));

  // Build the V2 Request
  // IMPORTANT: Use decimal strings for nonce/expiry, 32-byte hex for chain_id
  const v2Request: V2Request = {
    sources: v2Sources,
    destination_universe: universeToV2(intent.destination.universe),
    destination_chain_id: chainIdToBytes32Hex(BigInt(intent.destination.chainID)),
    recipient_address: convertTo32BytesHex(intent.recipientAddress),
    destinations: v2Destinations,
    nonce: bigintToDecimalString(nonce),
    expiry: bigintToDecimalString(expiry),
    parties,
  };

  logger.debug('createV2RequestFromIntent:built', { v2Request });

  // Compute the request hash (must match solver's computation)
  const { hash, request } = computeRequest(v2Request);

  // Sign the hash with personal_sign (EIP-191)
  const signature = (await options.evm.client.signMessage({
    account: options.evm.address,
    message: { raw: hash },
  })) as Hex;

  // The request hash is the EIP-191 prefixed hash (same as what Vault contract uses)
  const requestHash = hashMessage({ raw: hash });

  logger.debug('createV2RequestFromIntent:signed', {
    hash,
    requestHash,
    signature,
  });

  return {
    request,
    v2Request: v2Request,
    signature: signature as Hex,
    requestHash: requestHash as Hex,
  };
};

export { createV2RequestFromIntent, getSourcesAndDestinationsForRFF };
