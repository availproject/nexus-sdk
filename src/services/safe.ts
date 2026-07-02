import {
  type Address,
  encodeFunctionData,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  toHex,
  zeroAddress,
} from 'viem';
import { safeExecTransactionAbi, safeNonceAbi } from '../swap/safe/abis';
import { SAFE_MULTI_SEND_CALL_ONLY_ADDRESS, SAFE_SALT_NONCE } from '../swap/safe/constants';
import { signEnsureAuth } from '../swap/safe/ensure-auth';
import { buildMultiSendPayload } from '../swap/safe/multi-send';
import { predictSafeAccountAddress } from '../swap/safe/predict';
import { buildDefaultSafeTxFields, type SafeTxFields, signSafeTx } from '../swap/safe/safe-tx';
import type { CreateSafeExecuteTxRequest, EnsureSafeAccountResponse } from '../swap/safe/types';

export type SafeCall = {
  to: Address;
  value: bigint;
  data: Hex;
};

const HEX32_ZERO: Hex = `0x${'0'.repeat(64)}`;

// nonce() reverts when the proxy isn't deployed yet (or RPC view is stale right after deploy).
// The first execTransaction on a fresh Safe correctly uses nonce 0, so this matches contract state.
async function readSafeNonce(
  publicClient: Pick<PublicClient, 'readContract'>,
  safeAddress: Address
): Promise<bigint> {
  try {
    return await publicClient.readContract({
      address: safeAddress,
      abi: safeNonceAbi,
      functionName: 'nonce',
    });
  } catch {
    return 0n;
  }
}

function buildFieldsForCalls(calls: SafeCall[], nonce: bigint, nativeValue: bigint): SafeTxFields {
  if (calls.length === 1) {
    const [call] = calls as [SafeCall];
    return buildDefaultSafeTxFields({
      to: call.to,
      value: nativeValue,
      data: call.data,
      operation: 0,
      nonce,
    });
  }
  return buildDefaultSafeTxFields({
    to: SAFE_MULTI_SEND_CALL_ONLY_ADDRESS,
    value: 0n,
    data: buildMultiSendPayload(calls),
    operation: 1,
    nonce,
  });
}

function toExecuteRequest(
  chainId: number,
  safeAddress: Address,
  fields: SafeTxFields,
  signature: Hex
): CreateSafeExecuteTxRequest {
  return {
    chainId,
    safeAddress,
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
  };
}

// Builds a sponsor-broadcast Safe execTransaction: the ephemeral signs SafeTx, the middleware
// forwards via the sponsor wallet. Mirrors `safetx.ts:createSafeExecuteTxFromCalls` from the v1
// SDK, but yields the middleware request body directly so consumers can hand it to
// middleware.createSafeExecuteTx without further plumbing.
export async function createSafeExecuteTxFromCalls(input: {
  calls: SafeCall[];
  chainId: number;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'readContract'>;
  safeAddress: Address;
  // Outer-tx native value. Sponsor flow keeps this 0 — the sponsor won't fund native sends; for
  // native value transfers use the EOA-submitted path instead.
  nativeValue?: bigint;
}): Promise<CreateSafeExecuteTxRequest> {
  if (input.calls.length === 0) {
    throw new Error('createSafeExecuteTxFromCalls: calls must not be empty');
  }
  const nativeValue = input.nativeValue ?? 0n;
  const nonce = await readSafeNonce(input.publicClient, input.safeAddress);
  const fields = buildFieldsForCalls(input.calls, nonce, nativeValue);
  const signature = await signSafeTx({
    account: input.ephemeralWallet,
    chainId: input.chainId,
    safeAddress: input.safeAddress,
    fields,
  });
  return toExecuteRequest(input.chainId, input.safeAddress, fields, signature);
}

// Native-value invariants when the EOA submits the Safe.execTransaction. The outer eth_call
// carries `nativeValue` to the Safe; how that lands depends on the operation:
//   - operation=CALL (single): SafeTx.value forwards directly to call.to. We set SafeTx.value to
//     `nativeValue`, which means it MUST match calls[0].value or we'd execute against a different
//     value than the quote was built for.
//   - operation=DELEGATECALL (MultiSend): SafeTx.value is ignored by Safe; the outer eth_call
//     funds the Safe with `nativeValue` and each per-tuple value forwards from that balance. Sum
//     of inner values must equal the outer or funds strand / inner reverts on insufficient balance.
function assertNativeValueInvariant(calls: SafeCall[], nativeValue: bigint): void {
  if (nativeValue === 0n) return;
  if (calls.length === 1) {
    const [call] = calls as [SafeCall];
    if (call.value !== nativeValue) {
      throw new Error(
        `Single-call native value mismatch: outer=${nativeValue}, calls[0].value=${call.value}`
      );
    }
    return;
  }
  const innerSum = calls.reduce((acc, c) => acc + c.value, 0n);
  if (innerSum !== nativeValue) {
    throw new Error(
      `MultiSend native value mismatch: outer=${nativeValue}, sum(inner.value)=${innerSum}`
    );
  }
}

export type SafeExecuteEOACall = {
  to: Address;
  value: bigint;
  data: Hex;
};

// Builds a {to, value, data} the EOA can broadcast directly (via eoaWallet.sendTransaction) — the
// EOA pays gas and forwards `nativeValue` to the Safe. Used when the sponsor path can't carry
// native value (sponsor doesn't fund native sends). Mirrors v1 SDK
// `safetx.ts:createSafeExecuteEOASubmittedTx` but returns the raw call shape so the existing
// `eoaWallet.sendTransaction` pathway in source-swaps.ts can broadcast it the same way as Calibur.
export async function buildSafeExecuteEOACall(input: {
  calls: SafeCall[];
  chainId: number;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'readContract'>;
  safeAddress: Address;
  nativeValue: bigint;
}): Promise<SafeExecuteEOACall> {
  if (input.calls.length === 0) {
    throw new Error('buildSafeExecuteEOACall: calls must not be empty');
  }
  assertNativeValueInvariant(input.calls, input.nativeValue);

  const nonce = await readSafeNonce(input.publicClient, input.safeAddress);
  const fields = buildFieldsForCalls(input.calls, nonce, input.nativeValue);
  const signature = await signSafeTx({
    account: input.ephemeralWallet,
    chainId: input.chainId,
    safeAddress: input.safeAddress,
    fields,
  });

  const data = encodeFunctionData({
    abi: safeExecTransactionAbi,
    functionName: 'execTransaction',
    args: [
      fields.to,
      fields.value,
      fields.data,
      fields.operation,
      fields.safeTxGas,
      fields.baseGas,
      fields.gasPrice,
      fields.gasToken,
      fields.refundReceiver,
      signature,
    ],
  });

  return {
    to: input.safeAddress,
    value: input.nativeValue,
    data,
  };
}

export type EnsureSafeMiddleware = {
  ensureSafeAccount: (req: {
    chainId: number;
    owner: Hex;
    safeAddress: Hex;
    saltNonce: Hex;
    deadline: Hex;
    signature: Hex;
  }) => Promise<EnsureSafeAccountResponse>;
};

const DEFAULT_ENSURE_DEADLINE_SECONDS = 600;

// Idempotent ensure-deploy step for the Safe owned by `ephemeralWallet`. The Safe owner is the
// ephemeral (same key that signs SafeTx); the digest is signed raw with the ephemeral's
// `sign({hash})`. Skips the middleware call when the proxy already has bytecode — the existing
// Calibur path has the same pre-check shape (see source-swaps.ts auth-code bootstrap).
export async function ensureSafeForEphemeral(input: {
  chainId: number;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'getCode'>;
  middleware: EnsureSafeMiddleware;
  deadlineSeconds?: number;
}): Promise<EnsureSafeAccountResponse> {
  const { chainId, ephemeralWallet, publicClient, middleware } = input;
  const { address: safeAddress, factoryAddress } = predictSafeAccountAddress(
    ephemeralWallet.address
  );

  const code = await publicClient.getCode({ address: safeAddress });
  if (code !== undefined && code !== '0x') {
    return {
      chainId,
      owner: ephemeralWallet.address,
      address: safeAddress,
      factoryAddress,
      exists: true,
    };
  }

  const deadlineSeconds = input.deadlineSeconds ?? DEFAULT_ENSURE_DEADLINE_SECONDS;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const signature = await signEnsureAuth(ephemeralWallet, {
    chainId: BigInt(chainId),
    owner: ephemeralWallet.address,
    safe: safeAddress,
    saltNonce: SAFE_SALT_NONCE,
    deadline,
  });

  return middleware.ensureSafeAccount({
    chainId,
    owner: ephemeralWallet.address,
    safeAddress,
    saltNonce: toHex(SAFE_SALT_NONCE, { size: 32 }),
    deadline: toHex(deadline, { size: 32 }),
    signature,
  });
}

export const __testing = {
  HEX32_ZERO,
  buildFieldsForCalls,
  readSafeNonce,
  zeroAddress,
};
