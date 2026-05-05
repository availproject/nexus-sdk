import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchChainMock = vi.hoisted(() => vi.fn());
const estimateFeeContextMock = vi.hoisted(() => vi.fn());
const finalizeFeeEstimatesMock = vi.hoisted(() => vi.fn());

vi.mock('../core/utils', async () => {
  const actual = await vi.importActual<typeof import('../core/utils')>('../core/utils');
  return { ...actual, switchChain: switchChainMock };
});

vi.mock('../services/feeEstimation', async () => {
  const actual = await vi.importActual<typeof import('../services/feeEstimation')>(
    '../services/feeEstimation'
  );
  return {
    ...actual,
    estimateFeeContext: estimateFeeContextMock,
    finalizeFeeEstimates: finalizeFeeEstimatesMock,
  };
});

import { buildMultiSendPayload, createSafeExecuteEOASubmittedTx } from './safetx';

const EPHEMERAL_PRIVATE_KEY = ('0x' + '11'.repeat(32)) as Hex;
const SAFE_ADDRESS = '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9' as const;
const EOA_ADDRESS = '0x2222222222222222222222222222222222222222' as const;

const baseFeeEstimate = {
  recommended: {
    gasLimit: 1_000_000n,
    maxFeePerGas: 10n,
    maxPriorityFeePerGas: 1n,
    useLegacyPricing: false,
  },
};

const makeChain = () => ({ id: 999 }) as never;

const buildEphemeralWallet = () => privateKeyToAccount(EPHEMERAL_PRIVATE_KEY);

describe('buildMultiSendPayload', () => {
  it('throws when a call has odd-length hex data', () => {
    expect(() =>
      buildMultiSendPayload([
        {
          data: '0x123' as Hex,
          to: '0x2222222222222222222222222222222222222222',
          value: 0n,
        },
      ])
    ).toThrow(/odd hex length/);
  });
});

describe('createSafeExecuteEOASubmittedTx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    estimateFeeContextMock.mockResolvedValue({});
    finalizeFeeEstimatesMock.mockReturnValue([baseFeeEstimate]);
  });

  it('throws synchronously when MultiSend native value sum != outer native value', async () => {
    await expect(
      createSafeExecuteEOASubmittedTx({
        actualAddress: EOA_ADDRESS,
        calls: [
          { data: '0x', to: '0x3333333333333333333333333333333333333333', value: 100n },
          { data: '0x', to: '0x4444444444444444444444444444444444444444', value: 200n },
        ],
        chain: makeChain(),
        ephemeralWallet: buildEphemeralWallet(),
        eoaWallet: {} as never,
        nativeValue: 500n,
        publicClient: {} as never,
        safeAddress: SAFE_ADDRESS,
      })
    ).rejects.toThrow(/MultiSend native value mismatch.*outer=500.*sum\(inner.value\)=300/);

    expect(switchChainMock).not.toHaveBeenCalled();
  });

  it('throws synchronously when the single-call value does not match outer nativeValue', async () => {
    await expect(
      createSafeExecuteEOASubmittedTx({
        actualAddress: EOA_ADDRESS,
        // calls[0].value=7n but nativeValue=1234n — guard fires before any RPC.
        calls: [{ data: '0x', to: '0x3333333333333333333333333333333333333333', value: 7n }],
        chain: makeChain(),
        ephemeralWallet: buildEphemeralWallet(),
        eoaWallet: {} as never,
        nativeValue: 1234n,
        publicClient: {} as never,
        safeAddress: SAFE_ADDRESS,
      })
    ).rejects.toThrow(/Single-call native value mismatch.*outer=1234.*calls\[0\].value=7/);

    expect(switchChainMock).not.toHaveBeenCalled();
  });

  it('forwards the matching native value through the single-call path', async () => {
    const writeContract = vi.fn().mockResolvedValue('0xaaaa');
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success' });
    const readContract = vi.fn().mockResolvedValue(0n);
    const eoaWallet = { writeContract } as never;
    const publicClient = {
      readContract,
      waitForTransactionReceipt,
      estimateGas: vi.fn().mockResolvedValue(1_000_000n),
    } as never;

    // calls[0].value === nativeValue — invariant holds, single-call path runs.
    const hash = await createSafeExecuteEOASubmittedTx({
      actualAddress: EOA_ADDRESS,
      calls: [{ data: '0x', to: '0x3333333333333333333333333333333333333333', value: 1234n }],
      chain: makeChain(),
      ephemeralWallet: buildEphemeralWallet(),
      eoaWallet,
      nativeValue: 1234n,
      publicClient,
      safeAddress: SAFE_ADDRESS,
    });

    expect(hash).toBe('0xaaaa');
    expect(writeContract).toHaveBeenCalledTimes(1);
    const callArgs = writeContract.mock.calls[0][0];
    expect(callArgs.functionName).toBe('execTransaction');
    expect(callArgs.value).toBe(1234n); // outer tx funds the Safe
    expect(callArgs.args[1]).toBe(1234n); // SafeTx fields[1] is value, forwards to recipient
    expect(callArgs.args[3]).toBe(0); // operation = CALL
  });

  it('returns the initial hash and submits exactly once when first attempt succeeds', async () => {
    const writeContract = vi.fn().mockResolvedValue('0xaaaa');
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success' });
    const readContract = vi.fn().mockResolvedValue(5n);
    const eoaWallet = { writeContract } as never;
    const publicClient = {
      readContract,
      waitForTransactionReceipt,
      estimateGas: vi.fn().mockResolvedValue(1_000_000n),
    } as never;

    const hash = await createSafeExecuteEOASubmittedTx({
      actualAddress: EOA_ADDRESS,
      calls: [{ data: '0x', to: '0x3333333333333333333333333333333333333333', value: 0n }],
      chain: makeChain(),
      ephemeralWallet: buildEphemeralWallet(),
      eoaWallet,
      nativeValue: 0n,
      publicClient,
      safeAddress: SAFE_ADDRESS,
    });

    expect(hash).toBe('0xaaaa');
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledTimes(1); // initial nonce read; no post-revert read
    expect(switchChainMock).toHaveBeenCalledTimes(1);
  });

  it('retries once with the fresh nonce when the first attempt reverts and on-chain nonce moved', async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce('0xrevert')
      .mockResolvedValueOnce('0xwinner');
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({ status: 'reverted' })
      .mockResolvedValueOnce({ status: 'success' });
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(5n) // initial nonce
      .mockResolvedValueOnce(6n); // post-revert (race lost)
    const eoaWallet = { writeContract } as never;
    const publicClient = {
      readContract,
      waitForTransactionReceipt,
      estimateGas: vi.fn().mockResolvedValue(1_000_000n),
    } as never;

    const hash = await createSafeExecuteEOASubmittedTx({
      actualAddress: EOA_ADDRESS,
      calls: [{ data: '0x', to: '0x3333333333333333333333333333333333333333', value: 0n }],
      chain: makeChain(),
      ephemeralWallet: buildEphemeralWallet(),
      eoaWallet,
      nativeValue: 0n,
      publicClient,
      safeAddress: SAFE_ADDRESS,
    });

    expect(hash).toBe('0xwinner');
    expect(writeContract).toHaveBeenCalledTimes(2);
    expect(readContract).toHaveBeenCalledTimes(2);
    // The retry must have been signed against the fresh nonce (6), not the stale one (5).
    // The signature is the last writeContract arg (args[9]); we can't assert its content
    // directly without re-deriving, but we can assert the two writeContract calls used
    // different signatures (proving re-signing happened).
    const firstSig = writeContract.mock.calls[0][0].args[9];
    const retrySig = writeContract.mock.calls[1][0].args[9];
    expect(firstSig).not.toBe(retrySig);
  });

  it('throws without retrying when the revert happens and on-chain nonce is unchanged', async () => {
    const writeContract = vi.fn().mockResolvedValue('0xrevert');
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: 'reverted' });
    const readContract = vi.fn().mockResolvedValueOnce(5n).mockResolvedValueOnce(5n); // unchanged — revert is from another cause
    const eoaWallet = { writeContract } as never;
    const publicClient = {
      readContract,
      waitForTransactionReceipt,
      estimateGas: vi.fn().mockResolvedValue(1_000_000n),
    } as never;

    await expect(
      createSafeExecuteEOASubmittedTx({
        actualAddress: EOA_ADDRESS,
        calls: [{ data: '0x', to: '0x3333333333333333333333333333333333333333', value: 0n }],
        chain: makeChain(),
        ephemeralWallet: buildEphemeralWallet(),
        eoaWallet,
        nativeValue: 0n,
        publicClient,
        safeAddress: SAFE_ADDRESS,
      })
    ).rejects.toThrow(/nonce unchanged at 5.*unrelated to nonce contention/);

    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('throws when the nonce-race retry also reverts, surfacing both tx hashes', async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce('0xrevert1')
      .mockResolvedValueOnce('0xrevert2');
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({ status: 'reverted' })
      .mockResolvedValueOnce({ status: 'reverted' });
    const readContract = vi.fn().mockResolvedValueOnce(5n).mockResolvedValueOnce(6n);
    const eoaWallet = { writeContract } as never;
    const publicClient = {
      readContract,
      waitForTransactionReceipt,
      estimateGas: vi.fn().mockResolvedValue(1_000_000n),
    } as never;

    await expect(
      createSafeExecuteEOASubmittedTx({
        actualAddress: EOA_ADDRESS,
        calls: [{ data: '0x', to: '0x3333333333333333333333333333333333333333', value: 0n }],
        chain: makeChain(),
        ephemeralWallet: buildEphemeralWallet(),
        eoaWallet,
        nativeValue: 0n,
        publicClient,
        safeAddress: SAFE_ADDRESS,
      })
    ).rejects.toThrow(/initial=0xrevert1.*retry=0xrevert2/);

    expect(writeContract).toHaveBeenCalledTimes(2);
  });
});
