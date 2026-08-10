import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient } from 'viem';
import { recoverTypedDataAddress, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildSafeExecuteEOACall,
  createSafeExecuteTxFromCalls,
  type SafeCall,
} from '../../src/services/safe';
import { ValidationError } from '../../src/domain/errors';
import { predictSafeAccountAddressV2 } from '../../src/swap/safe/predict';
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
const eoaAddress = '0x1111111111111111111111111111111111111111' as const;
const safeAddress = predictSafeAccountAddressV2(eoaAddress, ephemeralWallet.address).address;
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
      eoaAddress,
      ephemeralWallet,
      publicClient,
      safeAddress,
    });

    expect(result.operation).toBe(0);
    expect(result.to).toBe(sampleCall.to);
    expect(result.value).toBe('0');
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
      eoaAddress,
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
      eoaAddress,
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

  it('serializes uint256 fields as decimal strings', async () => {
    const result = await createSafeExecuteTxFromCalls({
      calls: [sampleCall],
      chainId,
      eoaAddress,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
    });
    expect(result.value).toBe('0');
    expect(result.safeTxGas).toBe('0');
    expect(result.baseGas).toBe('0');
    expect(result.gasPrice).toBe('0');
    expect(result.nonce).toBe('0');
  });

  it('preserves a single sponsored call value in the signed Safe transaction', async () => {
    const result = await createSafeExecuteTxFromCalls({
      calls: [{ ...sampleCall, value: 5n }],
      chainId,
      eoaAddress,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
    });

    expect(result.value).toBe('5');
  });

  it('throws a ValidationError when calls is empty', async () => {
    await expect(
      createSafeExecuteTxFromCalls({
        calls: [],
        chainId,
        eoaAddress,
        ephemeralWallet,
        publicClient: makePublicClient(),
        safeAddress,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('buildSafeExecuteEOACall native-value invariants', () => {
  it('throws a ValidationError on a single-call native value mismatch', async () => {
    await expect(
      buildSafeExecuteEOACall({
        calls: [{ ...sampleCall, value: 5n }],
        chainId,
        ephemeralWallet,
        publicClient: makePublicClient(),
        safeAddress,
        nativeValue: 7n,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
