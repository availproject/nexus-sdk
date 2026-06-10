import { Universe } from '@avail-project/ca-common';
import {
  bytesToBigInt,
  type Chain,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  type SignAuthorizationReturnType,
  toBytes,
  toHex,
  type WalletClient,
} from 'viem';
import CaliburABI from '../abi/calibur.abi';
import { CaliburSBCTypes, type ChainListType, getLogger, type SBCTx, type Tx } from '../commons';
import { Errors } from '../core/errors';
import { createDeadlineFromNow, waitForTxReceipt } from '../core/utils';
import { PlatformUtils } from '../core/utils/platform.utils';

import { CALIBUR_ADDRESS, CALIBUR_EIP712, ZERO_BYTES_20, ZERO_BYTES_32 } from './constants';
import {
  type Cache,
  convertTo32Bytes,
  isAuthorizationCodeSet,
  type PublicClientList,
} from './utils';

const logger = getLogger();

const buildCaliburExecuteRequest = (input: {
  calls: Tx[];
  deadline: bigint;
  keyHash: Hex;
  nonce: bigint;
  signature: Hex;
  targetAddress: Hex;
  value: bigint;
}) => {
  const args = [
    {
      batchedCall: {
        calls: input.calls,
        revertOnFailure: true,
      },
      deadline: input.deadline,
      executor: toHex(ZERO_BYTES_20),
      keyHash: input.keyHash,
      nonce: input.nonce,
    },
    packSignatureAndHookData(input.signature),
  ] as const;

  return {
    abi: CaliburABI,
    address: input.targetAddress,
    args,
    functionName: 'execute' as const,
    value: input.value,
  };
};

export const createBatchedCallSignature = (
  batchedCalls: Tx[],
  nonce: bigint,
  chain: bigint,
  address: `0x${string}`,
  account: PrivateKeyAccount,
  deadline: bigint,
  keyHash: Hex = toHex(ZERO_BYTES_32)
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
      keyHash,
      nonce,
    },
    primaryType: 'SignedBatchedCall',
    types: CaliburSBCTypes,
  });
};

export const waitForSBCTxReceipt = (
  ops: [bigint, Hex][],
  chainList: ChainListType,
  publicClientList: PublicClientList
) => {
  return Promise.all(
    ops.map((op) => {
      const chain = chainList.getChainByID(Number(op[0]));
      if (!chain) {
        throw Errors.chainNotFound(Number(op[0]));
      }

      const explorerURL = new URL(`/tx/${op[1]}`, chain.blockExplorers.default.url);
      logger.debug('waitForSBCTxReceipt', { explorerURL: explorerURL.toString() });
      return waitForTxReceipt(op[1], publicClientList.get(chain!.id), 1);
    })
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
    deadline
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
  signerWallet,
  targetAddress,
  value,
}: {
  actualAddress: Hex;
  actualWallet: WalletClient;
  calls: Tx[];
  chain: Chain;
  signerWallet: PrivateKeyAccount;
  targetAddress: Hex;
  value: bigint;
}) => {
  const nonce = bytesToBigInt(await PlatformUtils.cryptoGetRandomValues(new Uint8Array(24))) << 64n;
  const deadline = createDeadlineFromNow(3n);
  const keyHash = toHex(ZERO_BYTES_32);
  const signature = await createBatchedCallSignature(
    calls,
    nonce,
    BigInt(chain.id),
    targetAddress,
    signerWallet,
    deadline,
    keyHash
  );

  const request = buildCaliburExecuteRequest({
    calls,
    deadline,
    keyHash,
    nonce,
    signature,
    targetAddress,
    value,
  });

  try {
    // No gas/fee params: the user's wallet estimates against the signed payload at
    // submit time and applies its own buffer, which is more accurate than our
    // pre-flight `eth_estimateGas` for Calibur-wrapped aggregator calls (the inner
    // script's gas can swing with cold/warm storage and route specifics, and our
    // 1.2x buffer was producing under-budgeted txs that reverted with "out of gas").
    return await actualWallet.writeContract({
      ...request,
      account: actualAddress,
      chain,
    });
  } catch (error) {
    logger.error('[TX_FAIL] calibur_execute_eoa_error', error, {
      chainId: chain.id,
      from: actualAddress,
      targetAddress,
    });
    // Detail at debug level: calldata embeds the user's signature, must not leave the console.
    logger.debug('[TX_FAIL] calibur_execute_eoa_error:detail', {
      chainId: chain.id,
      from: actualAddress,
      calls,
      executeData: {
        to: targetAddress,
        value,
        data: encodeFunctionData({
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        }),
      },
    });
    throw error;
  }
};

const packSignatureAndHookData = (signature: Hex, hookData: Hex = '0x') => {
  return encodeAbiParameters(
    [
      { name: 'signature', type: 'bytes' },
      { name: 'hookData', type: 'bytes' },
    ],
    [signature, hookData]
  );
};
