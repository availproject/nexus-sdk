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
import {
  CaliburSBCTypes,
  type ChainListType,
  getLogger,
  type SBCTx,
  type Tx,
} from '../../../commons';
import type { ExecuteFeeParams } from '../../../services/executeTransactions';
import { estimateFeeContext, finalizeFeeEstimates } from '../../../services/feeEstimation';
import { Errors } from '../errors';
import { createDeadlineFromNow, waitForTxReceipt } from '../utils';
import { PlatformUtils } from '../utils/platform.utils';
import CaliburABI from './calibur.abi';
import { CALIBUR_ADDRESS, CALIBUR_EIP712, ZERO_BYTES_20, ZERO_BYTES_32 } from './constants';
import {
  type Cache,
  convertTo32Bytes,
  isAuthorizationCodeSet,
  type PublicClientList,
} from './utils';

const logger = getLogger();

const spreadFeeParams = (feeParams?: ExecuteFeeParams) => {
  if (!feeParams) {
    return {};
  }

  if (feeParams.type === 'legacy') {
    return { gasPrice: feeParams.gasPrice };
  }

  return {
    maxFeePerGas: feeParams.maxFeePerGas,
    maxPriorityFeePerGas: feeParams.maxPriorityFeePerGas,
  };
};

const buildCaliburExecuteRequest = (input: {
  calls: Tx[];
  deadline: bigint;
  ephemeralAddress: Hex;
  nonce: bigint;
  signature: Hex;
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
      keyHash: toHex(ZERO_BYTES_32),
      nonce: input.nonce,
    },
    packSignatureAndHookData(input.signature),
  ] as const;

  return {
    abi: CaliburABI,
    address: input.ephemeralAddress,
    args,
    functionName: 'execute' as const,
    value: input.value,
  };
};

const estimateCaliburExecuteFee = async (input: {
  actualAddress: Hex;
  chain: Chain;
  publicClient: PublicClient;
  request: ReturnType<typeof buildCaliburExecuteRequest>;
}) => {
  const tx = {
    to: input.request.address,
    data: encodeFunctionData({
      abi: input.request.abi,
      functionName: input.request.functionName,
      args: input.request.args,
    }),
    value: input.request.value,
  };

  const gasEstimatePromise = input.publicClient
    .estimateGas({
      account: input.actualAddress,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    })
    .catch(() => 1_500_000n);
  const feeContextPromise = estimateFeeContext(
    input.publicClient,
    input.chain.id,
    [{ tx }],
    'medium'
  );

  const [gasEstimate, feeContext] = await Promise.all([gasEstimatePromise, feeContextPromise]);
  const [feeEstimate] = finalizeFeeEstimates([{ tx, gasEstimate }], feeContext);

  return {
    gas: feeEstimate.recommended.gasLimit,
    feeParams: feeEstimate.recommended.useLegacyPricing
      ? ({
          type: 'legacy',
          gasPrice: feeEstimate.recommended.maxFeePerGas,
        } satisfies ExecuteFeeParams)
      : ({
          type: 'eip1559',
          maxFeePerGas: feeEstimate.recommended.maxFeePerGas,
          maxPriorityFeePerGas: feeEstimate.recommended.maxPriorityFeePerGas,
        } satisfies ExecuteFeeParams),
  };
};

export const createBatchedCallSignature = (
  batchedCalls: Tx[],
  nonce: bigint,
  chain: bigint,
  address: `0x${string}`,
  account: PrivateKeyAccount,
  deadline: bigint
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
  ephemeralAddress,
  ephemeralWallet,
  publicClient,
  value,
}: {
  actualAddress: Hex;
  actualWallet: WalletClient;
  calls: Tx[];
  chain: Chain;
  ephemeralAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
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
    deadline
  );

  const request = buildCaliburExecuteRequest({
    calls,
    deadline,
    ephemeralAddress,
    nonce,
    signature,
    value,
  });
  const { gas, feeParams } = await estimateCaliburExecuteFee({
    actualAddress,
    chain,
    publicClient,
    request,
  });

  return actualWallet.writeContract({
    ...request,
    account: actualAddress,
    chain,
    gas,
    ...spreadFeeParams(feeParams),
  });
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
