import type { Address, Hex, PrivateKeyAccount, PublicClient } from 'viem';
import { Errors } from '../domain/errors';
import { safeNonceAbi } from '../swap/safe/abis';
import { SAFE_MULTI_SEND_CALL_ONLY_ADDRESS } from '../swap/safe/constants';
import { signEnsureAuthV2 } from '../swap/safe/ensure-auth';
import { buildMultiSendPayload } from '../swap/safe/multi-send';
import { predictSafeAccountAddressV2 } from '../swap/safe/predict';
import {
  buildDefaultSafeTxFields,
  encodeSafeExecTransactionV2,
  normalizeSafeSignature,
  type SafeTxFields,
  signSafeTx,
} from '../swap/safe/safe-tx';
import type { CreateSafeExecuteTxV2Request, EnsureSafeAccountV2Response } from '../swap/safe/types';

export type SafeCall = {
  to: Address;
  value: bigint;
  data: Hex;
};

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

function buildFieldsForCalls(calls: SafeCall[], nonce: bigint): SafeTxFields {
  if (calls.length === 1) {
    const [call] = calls as [SafeCall];
    return buildDefaultSafeTxFields({
      to: call.to,
      value: call.value,
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
  eoaAddress: Address,
  ephemeralAddress: Address,
  safeAddress: Address,
  fields: SafeTxFields,
  signature: Hex
): CreateSafeExecuteTxV2Request {
  return {
    chainId,
    eoaAddress,
    ephemeralAddress,
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
    signature: normalizeSafeSignature(signature),
  };
}

// Builds a sponsor-broadcast Safe execTransaction: the ephemeral signs SafeTx, the middleware
// forwards via the sponsor wallet. Mirrors `safetx.ts:createSafeExecuteTxFromCalls` from the v1
// SDK, but yields the middleware request body directly so consumers can hand it to
// middleware.createSafeExecuteTx without further plumbing.
export async function createSafeExecuteTxFromCalls(input: {
  calls: SafeCall[];
  chainId: number;
  eoaAddress: Address;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'readContract'>;
  safeAddress: Address;
}): Promise<CreateSafeExecuteTxV2Request> {
  if (input.calls.length === 0) {
    throw Errors.invalidInput('createSafeExecuteTxFromCalls: calls must not be empty');
  }
  const nonce = await readSafeNonce(input.publicClient, input.safeAddress);
  const fields = buildFieldsForCalls(input.calls, nonce);
  const signature = await signSafeTx({
    account: input.ephemeralWallet,
    chainId: input.chainId,
    safeAddress: input.safeAddress,
    fields,
  });
  return toExecuteRequest(
    input.chainId,
    input.eoaAddress,
    input.ephemeralWallet.address,
    input.safeAddress,
    fields,
    signature
  );
}

// Native-value invariants when the EOA submits the Safe.execTransaction. The outer eth_call
// carries `nativeValue` to the Safe; how that lands depends on the operation:
//   - operation=CALL (single): SafeTx.value forwards calls[0].value directly to call.to, so the
//     outer `nativeValue` MUST match or we'd execute against a different value than the quote.
//   - operation=DELEGATECALL (MultiSend): SafeTx.value is ignored by Safe; the outer eth_call
//     funds the Safe with `nativeValue` and each per-tuple value forwards from that balance. Sum
//     of inner values must equal the outer or funds strand / inner reverts on insufficient balance.
function assertNativeValueInvariant(calls: SafeCall[], nativeValue: bigint): void {
  if (nativeValue === 0n) return;
  if (calls.length === 1) {
    const [call] = calls as [SafeCall];
    if (call.value !== nativeValue) {
      throw Errors.invalidInput(
        `Single-call native value mismatch: outer=${nativeValue}, calls[0].value=${call.value}`
      );
    }
    return;
  }
  const innerSum = calls.reduce((acc, c) => acc + c.value, 0n);
  if (innerSum !== nativeValue) {
    throw Errors.invalidInput(
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
    throw Errors.invalidInput('buildSafeExecuteEOACall: calls must not be empty');
  }
  assertNativeValueInvariant(input.calls, input.nativeValue);

  const nonce = await readSafeNonce(input.publicClient, input.safeAddress);
  const fields = buildFieldsForCalls(input.calls, nonce);
  const signature = await signSafeTx({
    account: input.ephemeralWallet,
    chainId: input.chainId,
    safeAddress: input.safeAddress,
    fields,
  });

  return {
    to: input.safeAddress,
    value: input.nativeValue,
    data: encodeSafeExecTransactionV2(fields, signature),
  };
}

export type EnsureSafeMiddleware = {
  ensureSafeAccount: (req: {
    chainId: number;
    eoaAddress: Address;
    ephemeralAddress: Address;
    safeAddress: Address;
    deadline: string;
    signature: Hex;
  }) => Promise<EnsureSafeAccountV2Response>;
};

const DEFAULT_ENSURE_DEADLINE_SECONDS = 600;

// Idempotent ensure-deploy step for the Safe jointly owned by the EOA and `ephemeralWallet` at
// threshold 1. The ephemeral is the owner that signs SafeTx; the digest is signed with its
// `sign({hash})`. Skips the middleware call when the proxy already has bytecode — the existing
// Calibur path has the same pre-check shape (see source-swaps.ts auth-code bootstrap).
export async function ensureSafeForEphemeral(input: {
  chainId: number;
  eoaAddress: Address;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'getCode'>;
  middleware: EnsureSafeMiddleware;
  deploymentPromise?: Promise<EnsureSafeAccountV2Response>;
  deadlineSeconds?: number;
}): Promise<EnsureSafeAccountV2Response> {
  if (input.deploymentPromise) {
    return input.deploymentPromise;
  }

  const { chainId, eoaAddress, ephemeralWallet, publicClient, middleware } = input;
  const { address: safeAddress, factoryAddress } = predictSafeAccountAddressV2(
    eoaAddress,
    ephemeralWallet.address
  );

  const code = await publicClient.getCode({ address: safeAddress });
  if (code !== undefined && code !== '0x') {
    return {
      chainId,
      eoaAddress,
      ephemeralAddress: ephemeralWallet.address,
      address: safeAddress,
      factoryAddress,
      exists: true,
    };
  }

  const deadlineSeconds = input.deadlineSeconds ?? DEFAULT_ENSURE_DEADLINE_SECONDS;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const signature = await signEnsureAuthV2(ephemeralWallet, {
    chainId: BigInt(chainId),
    eoaAddress,
    ephemeralAddress: ephemeralWallet.address,
    safeAddress,
    deadline,
  });

  return middleware.ensureSafeAccount({
    chainId,
    eoaAddress,
    ephemeralAddress: ephemeralWallet.address,
    safeAddress,
    deadline: deadline.toString(),
    signature,
  });
}

export function startSafeDeploymentsForChains(input: {
  chainIds: readonly number[];
  eoaAddress: Address;
  ephemeralWallet: PrivateKeyAccount;
  publicClientList: { get(chainId: number): Pick<PublicClient, 'getCode'> };
  middleware: EnsureSafeMiddleware;
}): Map<number, Promise<EnsureSafeAccountV2Response>> {
  const deployments = new Map<number, Promise<EnsureSafeAccountV2Response>>();

  for (const chainId of new Set(input.chainIds)) {
    const deployment = ensureSafeForEphemeral({
      chainId,
      eoaAddress: input.eoaAddress,
      ephemeralWallet: input.ephemeralWallet,
      publicClient: input.publicClientList.get(chainId),
      middleware: input.middleware,
    });
    // Deployment starts immediately. Attach a rejection observer so a later chain cannot cause an
    // unhandled rejection while execution is still awaiting an earlier chain.
    void deployment.catch(() => undefined);
    deployments.set(chainId, deployment);
  }

  return deployments;
}
