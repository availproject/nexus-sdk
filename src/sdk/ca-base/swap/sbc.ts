import { Universe } from '@avail-project/ca-common';
import {
  bytesToBigInt,
  Chain,
  encodeAbiParameters,
  Hex,
  PrivateKeyAccount,
  PublicClient,
  SignAuthorizationReturnType,
  toBytes,
  toHex,
  WalletClient,
} from 'viem';

import { createDeadlineFromNow, waitForTxReceipt } from '../utils';
import CaliburABI from './calibur.abi';
import { CALIBUR_ADDRESS, CALIBUR_EIP712, ZERO_BYTES_20, ZERO_BYTES_32 } from './constants';
import { Cache, convertTo32Bytes, isAuthorizationCodeSet, PublicClientList } from './utils';
import { getLogger, ChainListType, CaliburSBCTypes, SBCTx, Tx } from '../../../commons';
import { PlatformUtils } from '../utils/platform.utils';

const logger = getLogger();

export const createBatchedCallSignature = (
  batchedCalls: Tx[],
  nonce: bigint,
  chain: bigint,
  address: `0x${string}`,
  account: PrivateKeyAccount,
  deadline: bigint,
) => {
  return account.signTypedData({
    domain: {
      chainId: chain,
      name: CALIBUR_EIP712.name,
      salt: CALIBUR_EIP712.salt,
      verifyingContract: address,
      version: CALIBUR_EIP712.version,
    },
    message: {
      batchedCall: {
        calls: batchedCalls,
        revertOnFailure: true,
      },
      deadline,
      executor: toHex(ZERO_BYTES_20),
      keyHash: toHex(ZERO_BYTES_32),
      nonce,
    },
    primaryType: 'SignedBatchedCall',
    types: CaliburSBCTypes,
  });
};

export const waitForSBCTxReceipt = (
  ops: [bigint, Hex][],
  chainList: ChainListType,
  publicClientList: PublicClientList,
) => {
  return Promise.all(
    ops.map((op) => {
      const chain = chainList.getChainByID(Number(op[0]));
      const explorerURL = new URL(`/tx/${op[1]}`, chain!.blockExplorers?.default.url);
      console.log({ explorerURL: explorerURL.toString() });
      return waitForTxReceipt(op[1], publicClientList.get(chain!.id), 1);
    }),
  );
};

export const checkAuthCodeSet = async (chainID: number, address: Hex, cache: Cache) => {
  return isAuthorizationCodeSet(chainID, address, cache);
};

export const createSBCTxFromCalls = async ({
  cache,
  calls,
  chainID,
  ephemeralAddress,
  ephemeralWallet,
  publicClient,
}: {
  cache: Cache;
  calls: Tx[];
  chainID: number;
  ephemeralAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
}) => {
  const nonce = bytesToBigInt(await PlatformUtils.cryptoGetRandomValues(new Uint8Array(24))) << 64n;
  const deadline = createDeadlineFromNow(3n);
  const signature = await createBatchedCallSignature(
    calls,
    nonce,
    BigInt(chainID),
    ephemeralAddress,
    ephemeralWallet,
    deadline,
  );

  let authorization: null | SignAuthorizationReturnType = null;
  if (!(await isAuthorizationCodeSet(chainID, ephemeralAddress, cache))) {
    const nonce = await publicClient.getTransactionCount({
      address: ephemeralAddress,
    });

    // create authorization for calibur
    authorization = await ephemeralWallet.signAuthorization({
      chainId: Number(chainID),
      contractAddress: CALIBUR_ADDRESS,
      nonce,
    });
  }

  const request: SBCTx = {
    address: convertTo32Bytes(ephemeralAddress),
    authorization_list: [],
    calls: calls.map((c) => ({
      data: toBytes(c.data),
      to_addr: toBytes(c.to),
      value: convertTo32Bytes(c.value),
    })),
    chain_id: convertTo32Bytes(chainID),
    deadline: convertTo32Bytes(deadline),
    key_hash: ZERO_BYTES_32,
    nonce: convertTo32Bytes(nonce),
    revert_on_failure: true,
    signature: toBytes(packSignatureAndHookData(signature)),
    universe: Universe.ETHEREUM,
  };

  if (authorization) {
    request.authorization_list.push({
      address: toBytes(CALIBUR_ADDRESS),
      chain_id: convertTo32Bytes(authorization.chainId),
      nonce: authorization.nonce,
      sig_r: toBytes(authorization.r),
      sig_s: toBytes(authorization.s),
      sig_v: Number(authorization.yParity),
    });
  }

  logger.debug('createSBCTxFromCalls', {
    request,
  });

  return request;
};

export const caliburExecute = async ({
  actualAddress,
  actualWallet,
  calls,
  chain,
  ephemeralAddress,
  ephemeralWallet,
  value,
}: {
  actualAddress: Hex;
  actualWallet: WalletClient;
  calls: Tx[];
  chain: Chain;
  ephemeralAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  value: bigint;
}) => {
  const nonce = bytesToBigInt(await PlatformUtils.cryptoGetRandomValues(new Uint8Array(24))) << 64n;
  const deadline = createDeadlineFromNow(3n);
  const signature = await createBatchedCallSignature(
    calls,
    nonce,
    BigInt(chain.id),
    ephemeralAddress,
    ephemeralWallet,
    deadline,
  );

  return actualWallet.writeContract({
    abi: CaliburABI,
    account: actualAddress,
    address: ephemeralAddress,
    args: [
      {
        batchedCall: {
          calls,
          revertOnFailure: true,
        },
        deadline,
        executor: toHex(ZERO_BYTES_20),
        keyHash: toHex(ZERO_BYTES_32),
        nonce,
      },
      packSignatureAndHookData(signature),
    ],
    chain,
    functionName: 'execute',
    value,
  });
};

const packSignatureAndHookData = (signature: Hex, hookData: Hex = '0x') => {
  return encodeAbiParameters(
    [
      { name: 'signature', type: 'bytes' },
      { name: 'hookData', type: 'bytes' },
    ],
    [signature, hookData],
  );
};
