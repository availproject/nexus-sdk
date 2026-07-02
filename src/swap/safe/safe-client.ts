import {
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  toHex,
  zeroAddress,
} from 'viem';
import { safeNonceAbi } from './abis';
import type { SafeMiddlewareClient } from './client';
import { SAFE_MULTI_SEND_CALL_ONLY_ADDRESS, SAFE_SALT_NONCE } from './constants';
import { signEnsureAuth } from './ensure-auth';
import { buildMultiSendPayload, type MultiSendCall } from './multi-send';
import { predictSafeAccountAddress } from './predict';
import { buildDefaultSafeTxFields, signSafeTx } from './safe-tx';
import type {
  CreateSafeExecuteTxResponse,
  EnsureSafeAccountResponse,
  GetSafeAccountAddressResponse,
} from './types';

export type SafeClientOptions = {
  chainId: number;
  owner: LocalAccount;
  publicClient: PublicClient;
  middleware: SafeMiddlewareClient;
};

export type SafeExecuteCall = {
  to: Address;
  value: bigint;
  data: Hex;
};

export type SafeClient = {
  getAddress: () => Promise<{
    address: Address;
    exists: boolean;
  }>;
  ensure: (opts?: { deadlineSeconds?: number }) => Promise<EnsureSafeAccountResponse>;
  execute: (call: SafeExecuteCall) => Promise<CreateSafeExecuteTxResponse>;
  executeBatch: (calls: SafeExecuteCall[]) => Promise<CreateSafeExecuteTxResponse>;
};

const HEX32_ZERO: Hex = `0x${'0'.repeat(64)}`;

function isDeployed(code: Hex | undefined): boolean {
  return code !== undefined && code !== '0x';
}

async function readSafeNonce(publicClient: PublicClient, safe: Address): Promise<bigint> {
  try {
    return await publicClient.readContract({
      address: safe,
      abi: safeNonceAbi,
      functionName: 'nonce',
    });
  } catch {
    // Right after deploy the RPC may not see the new bytecode yet — nonce() reverts. Treat as 0.
    return 0n;
  }
}

export function createSafeClient(opts: SafeClientOptions): SafeClient {
  const { chainId, owner, publicClient, middleware } = opts;
  const { address: safe } = predictSafeAccountAddress(owner.address);

  const getAddress = async () => {
    const code = await publicClient.getCode({ address: safe });
    return { address: safe, exists: isDeployed(code) };
  };

  const ensure: SafeClient['ensure'] = async (params) => {
    const { exists } = await getAddress();
    if (exists) {
      return {
        chainId,
        owner: owner.address,
        address: safe,
        // Without a middleware call we don't have the canonical factory address; surface the
        // one we predicted against (same constant the middleware would return).
        factoryAddress: predictSafeAccountAddress(owner.address).factoryAddress,
        exists: true,
      };
    }
    const deadlineSeconds = params?.deadlineSeconds ?? 600;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
    const signature = await signEnsureAuth(owner, {
      chainId: BigInt(chainId),
      owner: owner.address,
      safe,
      saltNonce: SAFE_SALT_NONCE,
      deadline,
    });
    return middleware.ensureSafeAccount({
      chainId,
      owner: owner.address,
      safeAddress: safe,
      saltNonce: toHex(SAFE_SALT_NONCE, { size: 32 }),
      deadline: toHex(deadline, { size: 32 }),
      signature,
    });
  };

  const execute: SafeClient['execute'] = async (call) => {
    const nonce = await readSafeNonce(publicClient, safe);
    const fields = buildDefaultSafeTxFields({
      to: call.to,
      value: call.value,
      data: call.data,
      operation: 0,
      nonce,
    });
    const signature = await signSafeTx({
      account: owner,
      chainId,
      safeAddress: safe,
      fields,
    });
    return middleware.createSafeExecuteTx({
      chainId,
      safeAddress: safe,
      to: fields.to,
      value: toHex(fields.value, { size: 32 }),
      data: fields.data,
      operation: fields.operation,
      safeTxGas: HEX32_ZERO,
      baseGas: HEX32_ZERO,
      gasPrice: HEX32_ZERO,
      gasToken: fields.gasToken,
      refundReceiver: fields.refundReceiver,
      signature,
    });
  };

  const executeBatch: SafeClient['executeBatch'] = async (calls) => {
    const nonce = await readSafeNonce(publicClient, safe);
    const multiSendCalls: MultiSendCall[] = calls.map((c) => ({
      to: c.to,
      value: c.value,
      data: c.data,
    }));
    const fields = buildDefaultSafeTxFields({
      to: SAFE_MULTI_SEND_CALL_ONLY_ADDRESS,
      value: 0n,
      data: buildMultiSendPayload(multiSendCalls),
      operation: 1, // DELEGATECALL — so multiSend runs in the Safe's context
      nonce,
    });
    const signature = await signSafeTx({
      account: owner,
      chainId,
      safeAddress: safe,
      fields,
    });
    return middleware.createSafeExecuteTx({
      chainId,
      safeAddress: safe,
      to: fields.to,
      value: HEX32_ZERO,
      data: fields.data,
      operation: fields.operation,
      safeTxGas: HEX32_ZERO,
      baseGas: HEX32_ZERO,
      gasPrice: HEX32_ZERO,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      signature,
    });
  };

  return { getAddress, ensure, execute, executeBatch };
}

export type { GetSafeAccountAddressResponse };
