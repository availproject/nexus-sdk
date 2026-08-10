import type { Address, Hex, LocalAccount, PublicClient } from 'viem';
import { safeNonceAbi } from './abis';
import type { SafeMiddlewareClientV2 } from './client';
import { SAFE_MULTI_SEND_CALL_ONLY_ADDRESS } from './constants';
import { signEnsureAuthV2 } from './ensure-auth';
import { buildMultiSendPayload } from './multi-send';
import { predictSafeAccountAddressV2 } from './predict';
import { buildDefaultSafeTxFields, normalizeSafeSignature, signSafeTx } from './safe-tx';
import type {
  CreateSafeExecuteTxV2Request,
  CreateSafeExecuteTxV2Response,
  EnsureSafeAccountV2Response,
} from './types';

export type SafeClientV2Options = {
  chainId: number;
  eoaAddress: Address;
  ephemeralOwner: LocalAccount;
  publicClient: PublicClient;
  middleware: SafeMiddlewareClientV2;
};

export type SafeExecuteCallV2 = {
  to: Address;
  value: bigint;
  data: Hex;
};

export type SafeClientV2 = {
  getAddress: () => Promise<{ address: Address; exists: boolean }>;
  ensure: (options?: { deadlineSeconds?: number }) => Promise<EnsureSafeAccountV2Response>;
  execute: (call: SafeExecuteCallV2) => Promise<CreateSafeExecuteTxV2Response>;
  executeBatch: (calls: SafeExecuteCallV2[]) => Promise<CreateSafeExecuteTxV2Response>;
};

const isDeployed = (code: Hex | undefined) => code !== undefined && code !== '0x';

const readSafeNonce = async (publicClient: PublicClient, safeAddress: Address): Promise<bigint> => {
  try {
    return await publicClient.readContract({
      address: safeAddress,
      abi: safeNonceAbi,
      functionName: 'nonce',
    });
  } catch {
    return 0n;
  }
};

export function createSafeClientV2(options: SafeClientV2Options): SafeClientV2 {
  const { chainId, eoaAddress, ephemeralOwner, publicClient, middleware } = options;
  const prediction = predictSafeAccountAddressV2(eoaAddress, ephemeralOwner.address);
  const safeAddress = prediction.address;

  const getAddress: SafeClientV2['getAddress'] = async () => ({
    address: safeAddress,
    exists: isDeployed(await publicClient.getCode({ address: safeAddress })),
  });

  const ensure: SafeClientV2['ensure'] = async (params) => {
    if ((await getAddress()).exists) {
      return {
        chainId,
        eoaAddress,
        ephemeralAddress: ephemeralOwner.address,
        address: safeAddress,
        factoryAddress: prediction.factoryAddress,
        exists: true,
      };
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (params?.deadlineSeconds ?? 600));
    const signature = await signEnsureAuthV2(ephemeralOwner, {
      chainId: BigInt(chainId),
      eoaAddress,
      ephemeralAddress: ephemeralOwner.address,
      safeAddress,
      deadline,
    });
    return middleware.ensureSafeAccount({
      chainId,
      eoaAddress,
      ephemeralAddress: ephemeralOwner.address,
      safeAddress,
      deadline: deadline.toString(),
      signature,
    });
  };

  const executeFields = async (
    to: Address,
    value: bigint,
    data: Hex,
    operation: 0 | 1
  ): Promise<CreateSafeExecuteTxV2Response> => {
    const nonce = await readSafeNonce(publicClient, safeAddress);
    const fields = buildDefaultSafeTxFields({ to, value, data, operation, nonce });
    const signature = normalizeSafeSignature(
      await signSafeTx({
        account: ephemeralOwner,
        chainId,
        safeAddress,
        fields,
      })
    );
    const request: CreateSafeExecuteTxV2Request = {
      chainId,
      eoaAddress,
      ephemeralAddress: ephemeralOwner.address,
      safeAddress,
      to: fields.to,
      value: fields.value.toString(),
      data: fields.data,
      operation: fields.operation,
      safeTxGas: fields.safeTxGas.toString(),
      baseGas: fields.baseGas.toString(),
      gasPrice: fields.gasPrice.toString(),
      gasToken: fields.gasToken,
      refundReceiver: fields.refundReceiver,
      nonce: fields.nonce.toString(),
      signature,
    };
    return middleware.createSafeExecuteTx(request);
  };

  const execute: SafeClientV2['execute'] = (call) =>
    executeFields(call.to, call.value, call.data, 0);

  const executeBatch: SafeClientV2['executeBatch'] = async (calls) => {
    if (calls.length === 0) {
      throw new Error('Safe V2 batch calls must not be empty');
    }
    return executeFields(SAFE_MULTI_SEND_CALL_ONLY_ADDRESS, 0n, buildMultiSendPayload(calls), 1);
  };

  return { getAddress, ensure, execute, executeBatch };
}
