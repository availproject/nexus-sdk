import { Universe } from '@avail-project/ca-common';
import { INTENT_EXPIRY } from '../constants';
import type { ChainListType, Intent, IBridgeOptions } from '../../../commons';
import { convertTo32Bytes, convertTo32BytesHex, mulDecimals } from './common.utils';
import {
  bytesToBigInt,
  encodeAbiParameters,
  getAbiItem,
  hashMessage,
  type Hex,
  keccak256,
  type PrivateKeyAccount,
  toBytes,
  UserRejectedRequestError,
  type WalletClient,
  zeroAddress,
} from 'viem';
import { Errors } from '../errors';
import type Decimal from 'decimal.js';
import { PlatformUtils } from './platform.utils';
import type { MayanQuotes } from './shim-server.utils';
import {
  createSwiftRandomKey,
  getSwiftToTokenHexString,
  getWormholeChainIdByName,
} from '@mayanfinance/swap-sdk';

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
export type ShimRFF = {
  sources: {
    universe: number;
    chainID: bigint;
    contractAddress: `0x${string}`;
    value: bigint;
  }[];
  recipientAddress: `0x${string}`;
  parties: {
    universe: number;
    address_: `0x${string}`;
  }[];
  destinationCaip2namespace: `0x${string}`;
  destinationContractAddress: `0x${string}`;
  destinationCaip2chainId: bigint;
  destinationMinTokenAmount: bigint;
  nonce: bigint;
  deadline: bigint;
};
export type SerializedShimRFF = {
  sources: {
    universe: number;
    chainID: string;
    contractAddress: `0x${string}`;
    value: string;
  }[];
  recipientAddress: `0x${string}`;
  parties: {
    universe: number;
    address_: `0x${string}`;
  }[];
  destinationCaip2namespace: `0x${string}`;
  destinationContractAddress: `0x${string}`;
  destinationCaip2chainId: string;
  destinationMinTokenAmount: string;
  nonce: string;
  deadline: string;
};
export const ShimRFFSerde = {
  serialize(rff: ShimRFF): SerializedShimRFF {
    return {
      sources: rff.sources.map((s) => ({
        universe: s.universe,
        chainID: s.chainID.toString(),
        contractAddress: s.contractAddress,
        value: s.value.toString(),
      })),
      recipientAddress: rff.recipientAddress,
      parties: rff.parties.map((p) => ({
        universe: p.universe,
        address_: p.address_,
      })),
      destinationCaip2namespace: rff.destinationCaip2namespace,
      destinationContractAddress: rff.destinationContractAddress,
      destinationCaip2chainId: rff.destinationCaip2chainId.toString(),
      destinationMinTokenAmount: rff.destinationMinTokenAmount.toString(),
      nonce: rff.nonce.toString(),
      deadline: rff.deadline.toString(),
    };
  },
  deserialize(data: SerializedShimRFF): ShimRFF {
    return {
      sources: data.sources.map((s) => ({
        universe: s.universe,
        chainID: BigInt(s.chainID),
        contractAddress: s.contractAddress,
        value: BigInt(s.value),
      })),
      recipientAddress: data.recipientAddress,
      parties: data.parties.map((p) => ({
        universe: p.universe,
        address_: p.address_,
      })),
      destinationCaip2namespace: data.destinationCaip2namespace,
      destinationContractAddress: data.destinationContractAddress,
      destinationCaip2chainId: BigInt(data.destinationCaip2chainId),
      destinationMinTokenAmount: BigInt(data.destinationMinTokenAmount),
      nonce: BigInt(data.nonce),
      deadline: BigInt(data.deadline),
    };
  }
}

export type ShimRouteData = {
  chainId: number;
  tokenAddress: `0x${string}`;
  trader: `0x${string}`;
  tokenOut: `0x${string}`;
  minAmountOut: bigint;
  gasDrop: bigint;
  deadline: bigint;
  destAddr: `0x${string}`;
  destChainId: number;
  referrerAddr: `0x${string}`;
  cancelFee: bigint;
  refundFee: bigint;
  referrerBps: number;
  auctionMode: number;
  random: `0x${string}`;
  swiftVersion: number;
};
export type SerializedShimRouteData = {
  chainId: number;
  tokenAddress: `0x${string}`;
  trader: `0x${string}`;
  tokenOut: `0x${string}`;
  minAmountOut: string;
  gasDrop: string;
  deadline: string;
  destAddr: `0x${string}`;
  destChainId: number;
  referrerAddr: `0x${string}`;
  cancelFee: string;
  refundFee: string;
  referrerBps: number;
  auctionMode: number;
  random: `0x${string}`;
  swiftVersion: number;
};
export const ShimRouterActionSerde =  {
  serialize(d: ShimRouteData): SerializedShimRouteData {
    return {
      chainId: d.chainId,
      tokenAddress: d.tokenAddress,
      trader: d.trader,
      tokenOut: d.tokenOut,
      minAmountOut: d.minAmountOut.toString(),
      gasDrop: d.gasDrop.toString(),
      deadline: d.deadline.toString(),
      destAddr: d.destAddr,
      destChainId: d.destChainId,
      referrerAddr: d.referrerAddr,
      cancelFee: d.cancelFee.toString(),
      refundFee: d.refundFee.toString(),
      referrerBps: d.referrerBps,
      auctionMode: d.auctionMode,
      random: d.random,
      swiftVersion: d.swiftVersion,
    };
  },
  deserialize(d: SerializedShimRouteData): ShimRouteData {
    return {
      chainId: d.chainId,
      tokenAddress: d.tokenAddress,
      trader: d.trader,
      tokenOut: d.tokenOut,
      minAmountOut: BigInt(d.minAmountOut),
      gasDrop: BigInt(d.gasDrop),
      deadline: BigInt(d.deadline),
      destAddr: d.destAddr,
      destChainId: d.destChainId,
      referrerAddr: d.referrerAddr,
      cancelFee: BigInt(d.cancelFee),
      refundFee: BigInt(d.refundFee),
      referrerBps: d.referrerBps,
      auctionMode: d.auctionMode,
      random: d.random,
      swiftVersion: d.swiftVersion,
    };
  }
}

export const createShimRFFromIntent = async (
  intent: Intent,
  options: Pick<IBridgeOptions, 'chainList'> & {
    evm: {
      address: `0x${string}`;
      client: WalletClient | PrivateKeyAccount;
    };
  },
  destinationUniverse: Universe,
  quotes: MayanQuotes,
) => {
  const { destination, sources, universes } = getSourcesAndDestinationsForRFF(
    intent,
    options.chainList,
    destinationUniverse,
  );

  const parties: Array<{ address: `0x${string}`; universe: Universe }> = [];
  for (const universe of universes) {
    if (universe === Universe.ETHEREUM) {
      parties.push({
        address: convertTo32BytesHex(options.evm.address),
        universe: universe,
      });
    }
  }

  const routerActions = await Promise.all(
    quotes.quotes.map(async (x) => {
      if (x.quote.type !== 'SWIFT') throw new Error('Invalid quote type');
      if (!x.quote.swiftAuctionMode) {
        throw new Error('Swift swap requires auction mode');
      }

      const deadline = x.quote.deadline64
        ? BigInt(x.quote.deadline64)
        : BigInt(Math.floor((Date.now() + INTENT_EXPIRY) / 1000));

      const routerAction: ShimRouteData = {
        chainId: x.mayanToken.chainId,
        tokenAddress: convertTo32BytesHex(x.mayanToken.contract as `0x${string}`),
        trader: convertTo32BytesHex(options.evm.address),
        tokenOut: getSwiftToTokenHexString(x.quote) as `0x${string}`,
        minAmountOut: mulDecimals(x.quote.minAmountOut, x.quote.toToken.decimals),
        gasDrop: BigInt(x.quote.gasDrop),
        deadline,
        destAddr: convertTo32BytesHex(intent.recipientAddress),
        destChainId: getWormholeChainIdByName(x.quote.toChain),
        referrerAddr: convertTo32BytesHex(zeroAddress),
        cancelFee: BigInt(x.quote.cancelRelayerFee64 ?? '0'),
        refundFee: BigInt(x.quote.refundRelayerFee64 ?? x.quote.refundRelayerFee ?? '0'),
        referrerBps: x.quote.referrerBps ?? 0,
        auctionMode: x.quote.swiftAuctionMode,
        random: convertTo32BytesHex(`0x${createSwiftRandomKey(x.quote).toString('hex')}`),
        swiftVersion: 1,
      };

      return routerAction;
    }),
  );

  const shimRFF: ShimRFF = {
    sources: sources.map((source) => ({
      chainID: source.chainID,
      contractAddress: convertTo32BytesHex(source.tokenAddress),
      universe: source.universe,
      value: source.valueRaw,
    })),
    recipientAddress: convertTo32BytesHex(intent.recipientAddress),
    parties: parties.map((x) => ({ address_: x.address, universe: x.universe })),
    destinationCaip2namespace: keccak256(toBytes('eip155')),
    destinationContractAddress: convertTo32BytesHex(destination.tokenAddress),
    destinationCaip2chainId: BigInt(intent.destination.chainID),
    destinationMinTokenAmount: destination.value,
    nonce: bytesToBigInt(await PlatformUtils.cryptoGetRandomValues(new Uint8Array(8))),
    deadline: BigInt(Math.floor((Date.now() + INTENT_EXPIRY) / 1000)),
  };

  const signatureData: {
    address: Uint8Array;
    requestHash: `0x${string}`;
    signature: Uint8Array;
    universe: Universe;
  }[] = [];

  for (const universe of universes) {
    if (universe === Universe.ETHEREUM) {
      const { requestHash, signature } = await createRequestShimSignature(
        shimRFF,
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
  }

  return {
    shimRFF,
    routerActions,
    signatureData,
    sources,
    universes,
  };
};

const getSourcesAndDestinationsForRFF = (intent: Intent, chainList: ChainListType, _: Universe) => {
  const sources: Source[] = [];
  const universes = new Set<Universe>();

  for (const source of intent.sources) {
    if (source.chainID === intent.destination.chainID) {
      continue;
    }

    const token = chainList.getTokenByAddress(source.chainID, source.tokenContract);
    if (!token) {
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

  const destination: Destination = {
    tokenAddress: convertTo32BytesHex(intent.destination.tokenContract),
    universe: intent.destination.universe,
    value: mulDecimals(intent.destination.amount, intent.destination.decimals),
  };

  //   if (intent.destination.gas != 0n) {
  //     if (isNativeAddress(intent.destination.universe, intent.destination.tokenContract)) {
  //       destinations[0].value = destinations[0].value + intent.destination.gas;
  //     } else {
  //       destinations.push({
  //         tokenAddress: convertTo32BytesHex(ZERO_ADDRESS),
  //         universe: intent.destination.universe,
  //         value: intent.destination.gas,
  //       });
  //     }
  //   }

  return { destination, sources, universes };
};

const createRequestShimSignature = async (
  shimRFF: ShimRFF,
  evmAddress: `0x${string}`,
  client: WalletClient | PrivateKeyAccount,
) => {
  const abi = getAbiItem({ abi: NewVaultAbi, name: 'depositRouter' });
  const msg = encodeAbiParameters([abi.inputs[0]], [shimRFF]);

  const hash = keccak256(msg, 'bytes');
  const signature = toBytes(
    await client
      .signMessage({
        account: evmAddress,
        message: { raw: hash },
      })
      .catch((e) => {
        if (e instanceof UserRejectedRequestError) {
          throw Errors.userRejectedIntentSignature();
        }
        throw e;
      }),
  );

  return { requestHash: hashMessage({ raw: hash }), signature };
};

export function encodeShimRouteData(d: ShimRouteData): Hex {
  const v1Payload = encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'bytes32' },
      { type: 'uint16' },
      { type: 'bytes32' },
      { type: 'uint8' },
      { type: 'uint8' },
      { type: 'bytes32' },
    ],
    [
      d.trader,
      d.tokenOut,
      d.minAmountOut,
      d.gasDrop,
      d.cancelFee,
      d.refundFee,
      d.deadline,
      d.destAddr,
      d.destChainId,
      d.referrerAddr,
      d.referrerBps,
      d.auctionMode,
      d.random,
    ],
  );

  return encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes' }], [d.swiftVersion, v1Payload]);
}

export const vaultAddressByChainId = (chainId: number) =>
  chainId === 8453
    ? '0x4152FAFe480013F2a33d1aE4d7322fCDD5393395'
    : '0x91BC4bd9Ced9cD9C35467a0797a0724A3FA7ff9b';

export const NewVaultAbi = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  { inputs: [], name: 'AccessControlBadConfirmation', type: 'error' },
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' },
      { internalType: 'bytes32', name: 'neededRole', type: 'bytes32' },
    ],
    name: 'AccessControlUnauthorizedAccount',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'target', type: 'address' }],
    name: 'AddressEmptyCode',
    type: 'error',
  },
  { inputs: [], name: 'ECDSAInvalidSignature', type: 'error' },
  {
    inputs: [{ internalType: 'uint256', name: 'length', type: 'uint256' }],
    name: 'ECDSAInvalidSignatureLength',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'bytes32', name: 's', type: 'bytes32' }],
    name: 'ECDSAInvalidSignatureS',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'implementation', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
    type: 'error',
  },
  { inputs: [], name: 'ERC1967NonPayable', type: 'error' },
  { inputs: [], name: 'FailedCall', type: 'error' },
  { inputs: [], name: 'InvalidInitialization', type: 'error' },
  { inputs: [], name: 'NotInitializing', type: 'error' },
  { inputs: [], name: 'ReentrancyGuardReentrantCall', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'SafeERC20FailedOperation',
    type: 'error',
  },
  { inputs: [], name: 'UUPSUnauthorizedCallContext', type: 'error' },
  {
    inputs: [{ internalType: 'bytes32', name: 'slot', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
      { indexed: false, internalType: 'address', name: 'from', type: 'address' },
    ],
    name: 'Deposit',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
      { indexed: false, internalType: 'address', name: 'from', type: 'address' },
      { indexed: false, internalType: 'enum Route', name: 'route', type: 'uint8' },
    ],
    name: 'DepositAndRoute',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
      { indexed: false, internalType: 'address', name: 'from', type: 'address' },
      { indexed: false, internalType: 'address', name: 'solver', type: 'address' },
    ],
    name: 'Fulfilment',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: 'uint64', name: 'version', type: 'uint64' }],
    name: 'Initialized',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'previousAdminRole', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'newAdminRole', type: 'bytes32' },
    ],
    name: 'RoleAdminChanged',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { indexed: true, internalType: 'address', name: 'account', type: 'address' },
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
    ],
    name: 'RoleGranted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { indexed: true, internalType: 'address', name: 'account', type: 'address' },
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
    ],
    name: 'RoleRevoked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'address', name: 'newRouter', type: 'address' }],
    name: 'RouterSet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'nonce', type: 'uint256' },
      { indexed: false, internalType: 'address[]', name: 'solver', type: 'address[]' },
      { indexed: false, internalType: 'address[]', name: 'token', type: 'address[]' },
      { indexed: false, internalType: 'uint256[]', name: 'amount', type: 'uint256[]' },
    ],
    name: 'Settle',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'address', name: 'implementation', type: 'address' }],
    name: 'Upgraded',
    type: 'event',
  },
  {
    inputs: [],
    name: 'DEFAULT_ADMIN_ROLE',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'uint256', name: 'chainID', type: 'uint256' },
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct SourcePair[]',
            name: 'sources',
            type: 'tuple[]',
          },
          { internalType: 'enum Universe', name: 'destinationUniverse', type: 'uint8' },
          { internalType: 'uint256', name: 'destinationChainID', type: 'uint256' },
          { internalType: 'bytes32', name: 'recipientAddress', type: 'bytes32' },
          {
            components: [
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct DestinationPair[]',
            name: 'destinations',
            type: 'tuple[]',
          },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
          { internalType: 'uint256', name: 'expiry', type: 'uint256' },
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'bytes32', name: 'address_', type: 'bytes32' },
            ],
            internalType: 'struct Party[]',
            name: 'parties',
            type: 'tuple[]',
          },
        ],
        internalType: 'struct Request',
        name: 'request',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
      { internalType: 'uint256', name: 'chainIndex', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'depositNonce',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'uint256', name: 'chainID', type: 'uint256' },
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct SourcePair[]',
            name: 'sources',
            type: 'tuple[]',
          },
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'bytes32', name: 'address_', type: 'bytes32' },
            ],
            internalType: 'struct Party[]',
            name: 'parties',
            type: 'tuple[]',
          },
          { internalType: 'bytes32', name: 'recipientAddress', type: 'bytes32' },
          { internalType: 'bytes32', name: 'destinationCaip2namespace', type: 'bytes32' },
          { internalType: 'bytes32', name: 'destinationContractAddress', type: 'bytes32' },
          { internalType: 'uint256', name: 'destinationMinTokenAmount', type: 'uint256' },
          { internalType: 'uint256', name: 'destinationCaip2chainId', type: 'uint256' },
          { internalType: 'uint64', name: 'nonce', type: 'uint64' },
          { internalType: 'uint64', name: 'deadline', type: 'uint64' },
        ],
        internalType: 'struct Action',
        name: 'action',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
      { internalType: 'uint256', name: 'chainIndex', type: 'uint256' },
      { internalType: 'enum Route', name: 'route', type: 'uint8' },
      { internalType: 'bytes', name: 'routeData', type: 'bytes' },
    ],
    name: 'depositRouter',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'fillNonce',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'uint256', name: 'chainID', type: 'uint256' },
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct SourcePair[]',
            name: 'sources',
            type: 'tuple[]',
          },
          { internalType: 'enum Universe', name: 'destinationUniverse', type: 'uint8' },
          { internalType: 'uint256', name: 'destinationChainID', type: 'uint256' },
          { internalType: 'bytes32', name: 'recipientAddress', type: 'bytes32' },
          {
            components: [
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct DestinationPair[]',
            name: 'destinations',
            type: 'tuple[]',
          },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
          { internalType: 'uint256', name: 'expiry', type: 'uint256' },
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'bytes32', name: 'address_', type: 'bytes32' },
            ],
            internalType: 'struct Party[]',
            name: 'parties',
            type: 'tuple[]',
          },
        ],
        internalType: 'struct Request',
        name: 'request',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'fulfil',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: 'role', type: 'bytes32' }],
    name: 'getRoleAdmin',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { internalType: 'address', name: 'account', type: 'address' },
    ],
    name: 'grantRole',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { internalType: 'address', name: 'account', type: 'address' },
    ],
    name: 'hasRole',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'admin', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { internalType: 'address', name: 'callerConfirmation', type: 'address' },
    ],
    name: 'renounceRole',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    name: 'requestState',
    outputs: [{ internalType: 'enum RFFState', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'role', type: 'bytes32' },
      { internalType: 'address', name: 'account', type: 'address' },
    ],
    name: 'revokeRole',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'router',
    outputs: [{ internalType: 'contract IRouter', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_router', type: 'address' }],
    name: 'setRouter',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
          { internalType: 'uint256', name: 'chainID', type: 'uint256' },
          { internalType: 'address[]', name: 'solvers', type: 'address[]' },
          { internalType: 'address[]', name: 'contractAddresses', type: 'address[]' },
          { internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
        ],
        internalType: 'struct SettleData',
        name: 'settleData',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'settle',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'settleNonce',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes4', name: 'interfaceId', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'newImplementation', type: 'address' },
      { internalType: 'bytes', name: 'data', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'uint256', name: 'chainID', type: 'uint256' },
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct SourcePair[]',
            name: 'sources',
            type: 'tuple[]',
          },
          { internalType: 'enum Universe', name: 'destinationUniverse', type: 'uint8' },
          { internalType: 'uint256', name: 'destinationChainID', type: 'uint256' },
          { internalType: 'bytes32', name: 'recipientAddress', type: 'bytes32' },
          {
            components: [
              { internalType: 'bytes32', name: 'contractAddress', type: 'bytes32' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct DestinationPair[]',
            name: 'destinations',
            type: 'tuple[]',
          },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
          { internalType: 'uint256', name: 'expiry', type: 'uint256' },
          {
            components: [
              { internalType: 'enum Universe', name: 'universe', type: 'uint8' },
              { internalType: 'bytes32', name: 'address_', type: 'bytes32' },
            ],
            internalType: 'struct Party[]',
            name: 'parties',
            type: 'tuple[]',
          },
        ],
        internalType: 'struct Request',
        name: 'request',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'verifyRequestSignature',
    outputs: [
      { internalType: 'bool', name: '', type: 'bool' },
      { internalType: 'bytes32', name: '', type: 'bytes32' },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    name: 'winningSolver',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
