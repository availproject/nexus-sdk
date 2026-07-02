import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient } from 'viem';
import { recoverTypedDataAddress, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createSafeExecuteTxFromCalls,
  type SafeCall,
} from '../../src/services/safe';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import {
  SAFE_MULTI_SEND_CALL_ONLY_ADDRESS,
} from '../../src/swap/safe/constants';
import {
  safeDomain,
  safeTxTypes,
  type SafeTxFields,
} from '../../src/swap/safe/safe-tx';
import { buildMultiSendPayload } from '../../src/swap/safe/multi-send';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const safeAddress = predictSafeAccountAddress(ephemeralWallet.address).address;
const chainId = 42161;

type StubPublicClient = Pick<PublicClient, 'readContract'>;

const makePublicClient = (nonce = 0n): StubPublicClient => ({
  readContract: vi.fn().mockResolvedValue(nonce),
}) as unknown as StubPublicClient;

const sampleCall: SafeCall = {
  to: '0xabcdef0123456789abcdef0123456789abcdef01',
  value: 0n,
  data: '0xdeadbeef',
};

describe('createSafeExecuteTxFromCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('single non-native call → operation=CALL, to=call.to, signature recovers to ephemeral', async () => {
    const publicClient = makePublicClient(7n);

    const result = await createSafeExecuteTxFromCalls({
      calls: [sampleCall],
      chainId,
      ephemeralWallet,
      publicClient,
      safeAddress,
    });

    expect(result.operation).toBe(0);
    expect(result.to).toBe(sampleCall.to);
    expect(result.value).toBe(`0x${'0'.repeat(64)}`);
    expect(result.data).toBe(sampleCall.data);
    expect(result.signature.length).toBe(132);

    const fields: SafeTxFields = {
      to: result.to,
      value: BigInt(result.value),
      data: result.data,
      operation: result.operation,
      safeTxGas: BigInt(result.safeTxGas),
      baseGas: BigInt(result.baseGas),
      gasPrice: BigInt(result.gasPrice),
      gasToken: result.gasToken,
      refundReceiver: result.refundReceiver,
      nonce: 7n,
    };
    const recovered = await recoverTypedDataAddress({
      domain: safeDomain(chainId, safeAddress),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: fields,
      signature: result.signature,
    });
    expect(recovered.toLowerCase()).toBe(ephemeralWallet.address.toLowerCase());
  });

  it('multi-call → operation=DELEGATECALL via MultiSendCallOnly', async () => {
    const calls: SafeCall[] = [
      sampleCall,
      { to: '0xfedcba9876543210fedcba9876543210fedcba98' as Hex, value: 0n, data: '0xcafe' as Hex },
    ];
    const publicClient = makePublicClient(3n);

    const result = await createSafeExecuteTxFromCalls({
      calls,
      chainId,
      ephemeralWallet,
      publicClient,
      safeAddress,
    });

    expect(result.operation).toBe(1);
    expect(result.to.toLowerCase()).toBe(SAFE_MULTI_SEND_CALL_ONLY_ADDRESS.toLowerCase());
    expect(result.data).toBe(buildMultiSendPayload(calls));
    expect(result.gasToken).toBe(zeroAddress);
    expect(result.refundReceiver).toBe(zeroAddress);
  });

  it('treats reverting nonce() read as 0n (pre-deploy RPC lag)', async () => {
    const publicClient = {
      readContract: vi.fn().mockRejectedValue(new Error('execution reverted')),
    } as unknown as StubPublicClient;

    const result = await createSafeExecuteTxFromCalls({
      calls: [sampleCall],
      chainId,
      ephemeralWallet,
      publicClient,
      safeAddress,
    });

    const recovered = await recoverTypedDataAddress({
      domain: safeDomain(chainId, safeAddress),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: {
        to: result.to,
        value: BigInt(result.value),
        data: result.data,
        operation: result.operation,
        safeTxGas: BigInt(result.safeTxGas),
        baseGas: BigInt(result.baseGas),
        gasPrice: BigInt(result.gasPrice),
        gasToken: result.gasToken,
        refundReceiver: result.refundReceiver,
        nonce: 0n,
      },
      signature: result.signature,
    });
    expect(recovered.toLowerCase()).toBe(ephemeralWallet.address.toLowerCase());
  });

  it('all 32-byte hex fields are exactly 66 chars', async () => {
    const result = await createSafeExecuteTxFromCalls({
      calls: [sampleCall],
      chainId,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
    });
    expect(result.value.length).toBe(66);
    expect(result.safeTxGas.length).toBe(66);
    expect(result.baseGas.length).toBe(66);
    expect(result.gasPrice.length).toBe(66);
  });
});
