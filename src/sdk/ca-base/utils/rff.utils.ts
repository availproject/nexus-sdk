import { MsgCreateRequestForFunds, OmniversalRFF, Universe } from '@avail-project/ca-common';
import { INTENT_EXPIRY, isNativeAddress, ZERO_ADDRESS } from '../constants';
import {
  getLogger,
  ChainListType,
  Intent,
  IBridgeOptions,
  V2Request,
  V2SourcePair,
  V2DestinationPair,
  V2Party,
  V2Universe,
} from '../../../commons';
import {
  convertTo32Bytes,
  convertTo32BytesHex,
  createRequestEVMSignature,
  createRequestTronSignature,
  mulDecimals,
} from './common.utils';
import {
  Hex,
  PrivateKeyAccount,
  toBytes,
  WalletClient,
  encodeAbiParameters,
  keccak256,
  hashMessage,
} from 'viem';
import Long from 'long';
import { TronWeb } from 'tronweb';
import { tronHexToEvmAddress } from './tron.utils';
import { Errors } from '../errors';
import { convertToEVMAddress } from '../swap/utils';
import Decimal from 'decimal.js';
import { FeeStore } from './api.utils';

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
    user: options.cosmos?.address ?? '',
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
    case 'EVM': return 0;
    case 'TRON': return 1;
    case 'FUEL': return 2;
    case 'SVM': return 3;
    default: return 0;
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
  return ('0x' + chainId.toString(16).padStart(64, '0')) as Hex;
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
const computeRequestHash = (request: V2Request): Hex => {
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

  return keccak256(encoded);
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
  destinationUniverse: Universe,
): Promise<{
  request: V2Request;
  signature: Hex;
  requestHash: Hex;
}> => {
  const { destinations, sources, universes } = getSourcesAndDestinationsForRFF(
    intent,
    options.chainList,
    destinationUniverse,
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
          tronHexToEvmAddress(TronWeb.address.toHex(options.tron.address)),
        ),
      });
    }
  }

  // Generate nonce - using Date.now() to match the working middleware test format
  // The working test uses: nonce: Date.now().toString()
  const nonce = BigInt(Date.now());

  // Calculate expiry - matches working test: (Math.floor(Date.now() / 1000) + 3600).toString()
  const expiry = BigInt(Math.floor((Date.now() + INTENT_EXPIRY) / 1000));

  console.log('[NEXUS-SDK] Nonce/Expiry generation:', {
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    INTENT_EXPIRY_ms: INTENT_EXPIRY,
  });

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

  // ============================================================================
  // DIAGNOSTIC: Print EXACT request for comparison with working middleware test
  // ============================================================================
  console.log('[NEXUS-SDK] ========== V2 REQUEST DEBUG ==========');
  console.log('[NEXUS-SDK] Full V2Request JSON:', JSON.stringify(v2Request, null, 2));
  console.log('[NEXUS-SDK] Sources[0] details:');
  if (v2Request.sources[0]) {
    const s = v2Request.sources[0];
    console.log(`  universe: "${s.universe}"`);
    console.log(`  chain_id: "${s.chain_id}" (length: ${s.chain_id.length})`);
    console.log(`  contract_address: "${s.contract_address}" (length: ${s.contract_address.length})`);
    console.log(`  value: "${s.value}"`);
    console.log(`  fee: "${s.fee}"`);
  }
  console.log('[NEXUS-SDK] Destination details:');
  console.log(`  destination_universe: "${v2Request.destination_universe}"`);
  console.log(`  destination_chain_id: "${v2Request.destination_chain_id}" (length: ${v2Request.destination_chain_id.length})`);
  console.log(`  recipient_address: "${v2Request.recipient_address}" (length: ${v2Request.recipient_address.length})`);
  console.log('[NEXUS-SDK] Nonce/Expiry:');
  console.log(`  nonce: "${v2Request.nonce}" (length: ${v2Request.nonce.length})`);
  console.log(`  expiry: "${v2Request.expiry}" (length: ${v2Request.expiry.length})`);
  console.log('[NEXUS-SDK] Parties[0] details:');
  if (v2Request.parties[0]) {
    const p = v2Request.parties[0];
    console.log(`  universe: "${p.universe}"`);
    console.log(`  address: "${p.address}" (length: ${p.address.length})`);
  }
  console.log('[NEXUS-SDK] ==========================================');

  // Compute the request hash using the SAME method as the working test
  // This must match exactly what the solver computes
  const hash = computeRequestHash(v2Request);

  console.log('[NEXUS-SDK] RFF Signing Debug:', {
    hash,
    signerAddress: options.evm.address,
    nonce: v2Request.nonce,
    expiry: v2Request.expiry,
  });

  // Sign the hash with personal_sign (EIP-191)
  const signature = await options.evm.client.signMessage({
    account: options.evm.address,
    message: { raw: hash },
  }) as Hex;

  console.log('[NEXUS-SDK] RFF Signature:', signature);

  // The request hash is the EIP-191 prefixed hash (same as what Vault contract uses)
  const requestHash = hashMessage({ raw: hash });

  console.log('[NEXUS-SDK] RFF Request Hash (EIP-191 prefixed):', requestHash);

  logger.debug('createV2RequestFromIntent:signed', {
    hash,
    requestHash,
    signature,
  });

  return {
    request: v2Request,
    signature: signature as Hex,
    requestHash: requestHash as Hex,
  };
};

export {
  createRFFromIntent,
  getSourcesAndDestinationsForRFF,
  calculateMaxBridgeFee,
  createV2RequestFromIntent,
  universeToV2,
};
