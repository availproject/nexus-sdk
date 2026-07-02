import { describe, expect, it, vi } from 'vitest';
import {
  type Address,
  type Hex,
  type PublicClient,
  decodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSafeExecuteEOACall, type SafeCall } from '../../src/services/safe';
import { safeExecTransactionAbi } from '../../src/swap/safe/abis';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import { SAFE_MULTI_SEND_CALL_ONLY_ADDRESS } from '../../src/swap/safe/constants';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const safeAddress = predictSafeAccountAddress(ephemeralWallet.address).address as Address;
const chainId = 42161;

const makePublicClient = (nonce = 0n) =>
  ({
    readContract: vi.fn().mockResolvedValue(nonce),
  }) as unknown as Pick<PublicClient, 'readContract'>;

const target = '0xabcdef0123456789abcdef0123456789abcdef01' as Address;

describe('buildSafeExecuteEOACall', () => {
  it('single CALL: to=safe, value=nativeValue, calldata=execTransaction targeting call.to', async () => {
    const call: SafeCall = { to: target, value: 1_000n, data: '0xdeadbeef' };
    const result = await buildSafeExecuteEOACall({
      calls: [call],
      chainId,
      ephemeralWallet,
      publicClient: makePublicClient(0n),
      safeAddress,
      nativeValue: 1_000n,
    });

    expect(result.to).toBe(safeAddress);
    expect(result.value).toBe(1_000n);

    const { functionName, args } = decodeFunctionData({
      abi: safeExecTransactionAbi,
      data: result.data,
    });
    expect(functionName).toBe('execTransaction');
    // args order: to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures
    expect((args[0] as Hex).toLowerCase()).toBe(target.toLowerCase());
    expect(args[1]).toBe(1_000n);
    expect(args[2]).toBe('0xdeadbeef');
    expect(args[3]).toBe(0); // operation = CALL
  });

  it('multi-call: to=safe, calldata=execTransaction(MultiSendCallOnly, DELEGATECALL)', async () => {
    const calls: SafeCall[] = [
      { to: target, value: 100n, data: '0xaa' },
      { to: '0xfedcba9876543210fedcba9876543210fedcba98' as Address, value: 200n, data: '0xbb' },
    ];
    const result = await buildSafeExecuteEOACall({
      calls,
      chainId,
      ephemeralWallet,
      publicClient: makePublicClient(0n),
      safeAddress,
      nativeValue: 300n,
    });

    expect(result.to).toBe(safeAddress);
    expect(result.value).toBe(300n);

    const { args } = decodeFunctionData({
      abi: safeExecTransactionAbi,
      data: result.data,
    });
    expect((args[0] as Hex).toLowerCase()).toBe(SAFE_MULTI_SEND_CALL_ONLY_ADDRESS.toLowerCase());
    expect(args[3]).toBe(1); // operation = DELEGATECALL
  });

  it('throws when single-call native value disagrees with calls[0].value', async () => {
    await expect(
      buildSafeExecuteEOACall({
        calls: [{ to: target, value: 100n, data: '0x' }],
        chainId,
        ephemeralWallet,
        publicClient: makePublicClient(),
        safeAddress,
        nativeValue: 500n,
      })
    ).rejects.toThrow(/Single-call native value mismatch/);
  });

  it('throws when MultiSend inner value sum disagrees with nativeValue', async () => {
    await expect(
      buildSafeExecuteEOACall({
        calls: [
          { to: target, value: 100n, data: '0x' },
          { to: target, value: 100n, data: '0x' },
        ],
        chainId,
        ephemeralWallet,
        publicClient: makePublicClient(),
        safeAddress,
        nativeValue: 500n,
      })
    ).rejects.toThrow(/MultiSend native value mismatch/);
  });

  it('non-native (nativeValue=0n) single call: value=0', async () => {
    const result = await buildSafeExecuteEOACall({
      calls: [{ to: target, value: 0n, data: '0x' }],
      chainId,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
      nativeValue: 0n,
    });
    expect(result.value).toBe(0n);
  });
});
