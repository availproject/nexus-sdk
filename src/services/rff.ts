import type {
  DestinationPair,
  Universe as NexusUniverse,
  Party,
  RFFRequest,
  SourcePair,
} from '@avail-project/nexus-types';
import {
  type Account,
  encodeAbiParameters,
  type Hex,
  keccak256,
  type PrivateKeyAccount,
  toHex,
  type WalletClient,
} from 'viem';
import {
  type BridgeIntentDraft,
  type DepositRequest,
  getLogger,
  INTENT_EXPIRY,
  ZERO_ADDRESS,
} from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors, formatUnknownError } from '../domain/errors';
import { isNativeAddress } from './addresses';
import { convertTo32BytesHex } from './encoding';
import { isUserRejectedRequest } from './is-user-rejected-request';
import { mulDecimals } from './math';
import { equalFold } from './strings';

export const MESSAGE_PREFIX = 'Sign this intent to proceed \n';

const logger = getLogger();

const getSourcesAndDestinationsForRFF = (intent: BridgeIntentDraft) => {
  const sources: Array<{
    chainID: bigint;
    tokenAddress: Hex;
    universe: Universe;
    valueRaw: bigint;
    depositFeeRaw: bigint;
  }> = [];
  const mayanDestinationValues: bigint[] = [];
  const universes = new Set<Universe>();

  for (const source of intent.selectedSources) {
    if (source.chain.id === intent.destination.chain.id) {
      continue;
    }
    universes.add(source.universe);

    sources.push({
      chainID: BigInt(source.chain.id),
      tokenAddress: convertTo32BytesHex(source.token.contractAddress),
      universe: source.universe,
      valueRaw: source.amountRaw,
      depositFeeRaw: source.depositFeeRaw,
    });

    if (intent.provider === 'mayan') {
      if (!source.mayanQuote) {
        throw Errors.internal('Mayan quote missing from selected source');
      }

      mayanDestinationValues.push(
        mulDecimals(source.mayanQuote.minReceived.toString(), intent.destination.token.decimals)
      );
    }
  }

  universes.add(intent.destination.universe);

  let destinations: Array<{
    tokenAddress: Hex;
    universe: Universe;
    value: bigint;
  }>;

  if (intent.provider === 'mayan') {
    destinations = mayanDestinationValues.map((value) => ({
      tokenAddress: convertTo32BytesHex(intent.destination.token.contractAddress),
      universe: intent.destination.universe,
      value,
    }));
  } else {
    destinations = [
      {
        tokenAddress: convertTo32BytesHex(intent.destination.token.contractAddress),
        universe: intent.destination.universe,
        value: intent.destination.amountRaw,
      },
    ];
  }

  // Mayan models gas drop inside its route quote/payload, not as a second RFF destination.
  // Keep nativeAmountRaw on the intent for UX/planning, but do not serialize it into
  // destinations for Mayan requests or the route will see an unexpected extra output.
  if (intent.provider !== 'mayan' && intent.destination.nativeAmountRaw !== 0n) {
    if (isNativeAddress(intent.destination.token.contractAddress)) {
      destinations[0].value = destinations[0].value + intent.destination.nativeAmountRaw;
    } else {
      destinations.push({
        tokenAddress: convertTo32BytesHex(ZERO_ADDRESS),
        universe: intent.destination.universe,
        value: intent.destination.nativeAmountRaw,
      });
    }
  }

  return { destinations, sources, universes };
};

const toApiUniverse = (universe: Universe): NexusUniverse => {
  if (universe === Universe.ETHEREUM) {
    return 'EVM';
  }
  throw Errors.universeNotSupported();
};

const universeToNumeric = (universe: NexusUniverse): number => {
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

const bigintToDecimalString = (value: bigint): string => {
  return value.toString(10);
};

const chainIdToBytes32Hex = (chainId: bigint): Hex => {
  return toHex(chainId, {
    size: 32,
  });
};

export const RFF_REQUEST_ABI_PARAMS = [
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

const computeDepositRequest = (request: RFFRequest): { hash: Hex; request: DepositRequest } => {
  const sources = request.sources.map((s) => ({
    universe: universeToNumeric(s.universe),
    chainID: BigInt(s.chain_id),
    contractAddress: s.contract_address,
    value: BigInt(s.value),
    fee: BigInt(s.fee),
  }));

  const destinations = request.destinations.map((d) => ({
    contractAddress: d.contract_address,
    value: BigInt(d.value),
  }));

  const parties = request.parties.map((p) => ({
    universe: universeToNumeric(p.universe),
    address_: p.address,
  }));

  const destinationUniverse = universeToNumeric(request.destination_universe);
  const destinationChainID = BigInt(request.destination_chain_id);
  const recipientAddress = request.recipient_address as Hex;
  const nonce = BigInt(request.nonce);
  const expiry = BigInt(request.expiry);

  const encoded = encodeAbiParameters(RFF_REQUEST_ABI_PARAMS, [
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

const buildParties = (universes: Set<Universe>, evmAddress: Hex): Party[] => {
  const parties: Party[] = [];
  for (const universe of universes) {
    if (universe === Universe.ETHEREUM) {
      parties.push({
        universe: toApiUniverse(universe),
        address: convertTo32BytesHex(evmAddress),
      });
    }
  }
  return parties;
};

const buildNonceAndExpiry = (minMayanDeadline64?: bigint) => {
  const now = Date.now();
  return {
    nonce: BigInt(now),
    expiry: minMayanDeadline64 ?? BigInt(Math.floor((now + INTENT_EXPIRY) / 1000)),
  };
};

const createRequestFromIntent = async (
  intent: BridgeIntentDraft,
  options: {
    evm: {
      address: `0x${string}`;
      client: WalletClient | PrivateKeyAccount;
    };
  }
) => {
  const { destinations, sources, universes } = getSourcesAndDestinationsForRFF(intent);
  const parties = buildParties(universes, options.evm.address);
  const mayanDeadlines = intent.selectedSources.flatMap((s) =>
    s.mayanQuote?.deadline64 ? [BigInt(s.mayanQuote.deadline64)] : []
  );
  const minMayanDeadline64 = mayanDeadlines.length
    ? mayanDeadlines.reduce((min, d) => (d < min ? d : min))
    : undefined;
  const { nonce, expiry } = buildNonceAndExpiry(minMayanDeadline64);

  const rffSources: SourcePair[] = sources.map((source) => ({
    universe: toApiUniverse(source.universe),
    chain_id: chainIdToBytes32Hex(source.chainID),
    contract_address: source.tokenAddress,
    value: bigintToDecimalString(source.valueRaw),
    fee: bigintToDecimalString(source.depositFeeRaw),
  }));

  const rffDestinations: DestinationPair[] = destinations.map((dest) => ({
    contract_address: dest.tokenAddress,
    value: bigintToDecimalString(dest.value),
  }));

  const rffRequest: RFFRequest = {
    sources: rffSources,
    destination_universe: toApiUniverse(intent.destination.universe),
    destination_chain_id: chainIdToBytes32Hex(BigInt(intent.destination.chain.id)),
    recipient_address: convertTo32BytesHex(intent.recipientAddress),
    destinations: rffDestinations,
    nonce: bigintToDecimalString(nonce),
    expiry: bigintToDecimalString(expiry),
    parties,
  };

  logger.debug('createRequestFromIntent:built', { rffRequest });

  const { hash, request: depositRequest } = computeDepositRequest(rffRequest);

  const message = MESSAGE_PREFIX + hash;
  const clientAccount = (
    'account' in options.evm.client ? options.evm.client.account : undefined
  ) as Account | undefined;
  const directClientAddress =
    'address' in options.evm.client && typeof options.evm.client.address === 'string'
      ? options.evm.client.address
      : null;
  const signerAddress = clientAccount != null ? clientAccount.address : directClientAddress;
  if (signerAddress && !equalFold(signerAddress, options.evm.address)) {
    throw Errors.internal('Signer account does not match configured EVM address', {
      signerAddress,
      configuredAddress: options.evm.address,
    });
  }

  const signerAccount: Hex | Account =
    clientAccount != null ? clientAccount : (signerAddress ?? options.evm.address);

  const signature = (await options.evm.client
    .signMessage({
      account: signerAccount,
      message,
    })
    .catch((error) => {
      if (isUserRejectedRequest(error)) {
        throw Errors.userRejectedIntentSignature();
      }
      throw Errors.execution(`Failed to sign intent hash: ${formatUnknownError(error)}`, {
        service: 'wallet',
        details: { recipient: options.evm.address },
      });
    })) as Hex;

  logger.debug('createRequestFromIntent:signed', {
    requestHash: hash,
    signature,
  });

  return {
    depositRequest,
    rffRequest,
    signature,
    requestHash: hash,
  };
};

export { createRequestFromIntent, getSourcesAndDestinationsForRFF };
