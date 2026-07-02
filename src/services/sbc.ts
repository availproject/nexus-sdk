import {
  bytesToBigInt,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  padHex,
  parseAbi,
  parseAbiParameters,
  toHex,
} from 'viem';
import { Errors } from '../domain/errors';
import { CALIBUR_ADDRESS, CALIBUR_EIP712_BASE, SBC_DEADLINE_MINUTES } from '../swap/constants';
import type { AuthorizationListItem, SBCResult, SBCTx } from '../swap/types';

export type SBCCall = {
  to: Hex;
  data: Hex;
  value: bigint;
};

type CreateSBCInput = {
  calls: SBCCall[];
  chainID: number;
  ephemeralAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'getCode' | 'getTransactionCount'>;
};

const BATCHED_CALL_TYPES = {
  SignedBatchedCall: [
    { name: 'batchedCall', type: 'BatchedCall' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyHash', type: 'bytes32' },
    { name: 'executor', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  BatchedCall: [
    { name: 'calls', type: 'Call[]' },
    { name: 'revertOnFailure', type: 'bool' },
  ],
  Call: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;
export const CALIBUR_EXECUTE_ABI = parseAbi([
  'function execute((((address to,uint256 value,bytes data)[] calls,bool revertOnFailure) batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline) signedBatchedCall,bytes wrappedSignature)',
]);

const toHex32 = (value: bigint | number): Hex => padHex(toHex(value), { size: 32 });

export const createSBCTxFromCalls = async (input: CreateSBCInput): Promise<SBCTx> => {
  const { calls, chainID, ephemeralAddress, ephemeralWallet, publicClient } = input;

  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = bytesToBigInt(randomBytes) << 64n;
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + SBC_DEADLINE_MINUTES * 60n;

  const domain = {
    ...CALIBUR_EIP712_BASE,
    chainId: chainID,
    verifyingContract: ephemeralAddress,
    salt: padHex(CALIBUR_ADDRESS, { size: 32 }),
  };

  const message = {
    batchedCall: {
      calls: calls.map((call) => ({
        to: call.to,
        value: call.value,
        data: call.data,
      })),
      revertOnFailure: true,
    },
    nonce,
    keyHash: `0x${'00'.repeat(32)}` as Hex,
    executor: `0x${'00'.repeat(20)}` as Hex,
    deadline,
  };

  const signature = await ephemeralWallet.signTypedData({
    domain,
    types: BATCHED_CALL_TYPES,
    primaryType: 'SignedBatchedCall',
    message,
  });

  const authList = await getAuthorizationList(
    publicClient,
    ephemeralAddress,
    ephemeralWallet,
    chainID
  );

  return {
    chainId: chainID,
    address: ephemeralAddress,
    authorizationList: authList.length > 0 ? authList : undefined,
    calls: calls.map((call) => ({
      to: call.to,
      data: call.data,
      value: toHex32(call.value),
    })),
    deadline: toHex32(deadline),
    keyHash: toHex32(0n),
    nonce: toHex32(nonce),
    revertOnFailure: true,
    signature: encodeAbiParameters(parseAbiParameters('bytes, bytes'), [signature, '0x']),
  };
};

export const createCaliburExecuteTxFromCalls = async (input: {
  calls: SBCCall[];
  chainID: number;
  ephemeralAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  value: bigint;
}): Promise<SBCCall> => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = bytesToBigInt(randomBytes) << 64n;
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + SBC_DEADLINE_MINUTES * 60n;

  const domain = {
    ...CALIBUR_EIP712_BASE,
    chainId: input.chainID,
    verifyingContract: input.ephemeralAddress,
    salt: padHex(CALIBUR_ADDRESS, { size: 32 }),
  };

  const message = {
    batchedCall: {
      calls: input.calls.map((call) => ({
        to: call.to,
        value: call.value,
        data: call.data,
      })),
      revertOnFailure: true,
    },
    nonce,
    keyHash: `0x${'00'.repeat(32)}` as Hex,
    executor: `0x${'00'.repeat(20)}` as Hex,
    deadline,
  };

  const signature = await input.ephemeralWallet.signTypedData({
    domain,
    types: BATCHED_CALL_TYPES,
    primaryType: 'SignedBatchedCall',
    message,
  });

  return {
    to: input.ephemeralAddress,
    value: input.value,
    data: encodeFunctionData({
      abi: CALIBUR_EXECUTE_ABI,
      functionName: 'execute',
      args: [message, encodeAbiParameters(parseAbiParameters('bytes, bytes'), [signature, '0x'])],
    }),
  };
};

export const requireSuccessfulSbcResult = (
  results: SBCResult[],
  chainId: number,
  context: string
): Hex => {
  const result = results.find((entry) => entry.chainId === chainId);
  if (!result) {
    throw Errors.internal(`${context}: missing SBC result for chain ${chainId}`);
  }
  if (result.errored) {
    throw Errors.internal(`${context}: ${(result as SBCResult<true>).message}`);
  }
  return (result as SBCResult<false>).txHash;
};

async function getAuthorizationList(
  publicClient: Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
  ephemeralAddress: Hex,
  ephemeralWallet: PrivateKeyAccount,
  chainId: number
): Promise<AuthorizationListItem[]> {
  const code = await publicClient.getCode({ address: ephemeralAddress });
  const hasCalibur = code && typeof code === 'string' && code.startsWith('0xef0100');

  if (hasCalibur) return [];

  const authNonce = await publicClient.getTransactionCount({ address: ephemeralAddress });
  const authorization = await ephemeralWallet.signAuthorization({
    contractAddress: CALIBUR_ADDRESS,
    chainId,
    nonce: Number(authNonce),
  });

  return [
    {
      chainId: toHex32(chainId),
      address: CALIBUR_ADDRESS,
      nonce: authorization.nonce ?? Number(authNonce),
      r: padHex(authorization.r as Hex, { size: 32 }),
      s: padHex(authorization.s as Hex, { size: 32 }),
      v: authorization.yParity ?? 0,
    },
  ];
}
