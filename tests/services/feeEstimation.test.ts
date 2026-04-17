import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/gasFeeHistory', () => ({
  getGasPriceRecommendations: vi.fn().mockResolvedValue({
    low: { maxFeePerGas: 11n, maxPriorityFeePerGas: 2n },
    medium: { maxFeePerGas: 13n, maxPriorityFeePerGas: 3n },
    high: { maxFeePerGas: 17n, maxPriorityFeePerGas: 5n },
  }),
}));

import { estimateTotalFees, type TxWithGas } from '../../src/services/feeEstimation';

const readContract = vi.fn();

const makeClient = (chainId: number) =>
  ({
    chain: { id: chainId },
    readContract,
  }) as unknown as PublicClient;

describe('estimateTotalFees', () => {
  beforeEach(() => {
    readContract.mockReset();
  });

  it('adds Arbitrum L1 gas units for raw estimates before buffering the gas limit', async () => {
    readContract.mockResolvedValue([20n, 1n, 0n]);

    const [fee] = await estimateTotalFees(makeClient(42161), [
      {
        tx: {
          to: '0x1111111111111111111111111111111111111111',
          data: '0x1234',
          value: 0n,
        },
        gasEstimate: 100n,
        gasEstimateKind: 'raw',
      } as TxWithGas,
    ]);

    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x00000000000000000000000000000000000000C8',
        functionName: 'gasEstimateL1Component',
      })
    );
    const call = readContract.mock.calls[0]?.[0] as {
      abi: readonly [{ outputs: readonly unknown[] }];
    };
    expect(call.abi[0]?.outputs).toHaveLength(3);
    expect(fee.l1Fee).toBe(0n);
    expect(fee.recommended.gasLimit).toBe(144n);
    expect(fee.recommended.totalMaxCost).toBe(2592n);
  });

  it('does not double count L1 gas units for final Arbitrum estimates', async () => {
    const [fee] = await estimateTotalFees(makeClient(42161), [
      {
        tx: {
          to: '0x1111111111111111111111111111111111111111',
          data: '0x1234',
        },
        gasEstimate: 100n,
        gasEstimateKind: 'final',
      } as TxWithGas,
    ]);

    expect(readContract).not.toHaveBeenCalled();
    expect(fee.l1Fee).toBe(0n);
    expect(fee.recommended.gasLimit).toBe(120n);
    expect(fee.recommended.totalMaxCost).toBe(2160n);
  });

  it('returns a separate L1 fee for OP Stack estimates', async () => {
    readContract.mockResolvedValue(25n);

    const [fee] = await estimateTotalFees(makeClient(8453), [
      {
        tx: {
          to: '0x1111111111111111111111111111111111111111',
          data: '0x1234',
        },
        gasEstimate: 100n,
      },
    ]);

    expect(fee.l1Fee).toBe(25n);
    expect(fee.l2Fee).toBe(1300n);
    expect(fee.recommended.gasLimit).toBe(120n);
    expect(fee.recommended.totalMaxCost).toBe(1712n);
  });

  it('has no separate L1 fee on default fee models', async () => {
    const [fee] = await estimateTotalFees(makeClient(1), [
      {
        tx: {
          to: '0x1111111111111111111111111111111111111111',
          data: '0x1234',
        },
        gasEstimate: 100n,
      },
    ]);

    expect(readContract).not.toHaveBeenCalled();
    expect(fee.l1Fee).toBe(0n);
    expect(fee.recommended.gasLimit).toBe(120n);
    expect(fee.recommended.totalMaxCost).toBe(1800n);
  });

  it('uses the requested price tier for max fee and priority fee recommendations', async () => {
    const [fee] = await estimateTotalFees(
      makeClient(1),
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          gasEstimate: 100n,
        },
      ],
      'high'
    );

    expect(fee.recommended.maxFeePerGas).toBe(20n);
    expect(fee.recommended.maxPriorityFeePerGas).toBe(5n);
  });
});
