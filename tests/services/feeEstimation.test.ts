import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getGasPriceRecommendationsMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/gasFeeHistory', () => ({
  getGasPriceRecommendations: getGasPriceRecommendationsMock,
}));

import {
  estimateFeeContext,
  estimateTotalFees,
  type TxWithGas,
} from '../../src/services/feeEstimation';

const readContract = vi.fn();
const request = vi.fn();

const makeClient = (chainId: number) =>
  ({
    chain: { id: chainId },
    readContract,
    request,
    getChainId: vi
      .fn()
      .mockRejectedValue(new Error('estimateTotalFees should not call getChainId')),
  }) as unknown as PublicClient & {
    getChainId: ReturnType<typeof vi.fn>;
  };

describe('estimateTotalFees', () => {
  beforeEach(() => {
    readContract.mockReset();
    request.mockReset();
    getGasPriceRecommendationsMock.mockReset();
    getGasPriceRecommendationsMock.mockResolvedValue({
      low: { maxFeePerGas: 11n, maxPriorityFeePerGas: 2n },
      medium: { maxFeePerGas: 13n, maxPriorityFeePerGas: 3n },
      high: { maxFeePerGas: 17n, maxPriorityFeePerGas: 5n },
    });
  });

  it('adds Arbitrum L1 gas units for raw estimates before buffering the gas limit', async () => {
    readContract.mockResolvedValue([20n, 1n, 0n]);
    const client = makeClient(42161);

    const [fee] = await estimateTotalFees(
      client,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
            value: 0n,
          },
          gasEstimate: 100n,
          gasEstimateKind: 'raw',
        } as TxWithGas,
      ],
      42161,
      'medium'
    );

    expect(client.getChainId).not.toHaveBeenCalled();
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
    const client = makeClient(42161);

    const [fee] = await estimateTotalFees(
      client,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          gasEstimate: 100n,
          gasEstimateKind: 'final',
        } as TxWithGas,
      ],
      42161,
      'medium'
    );

    expect(client.getChainId).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
    expect(fee.l1Fee).toBe(0n);
    expect(fee.recommended.gasLimit).toBe(120n);
    expect(fee.recommended.totalMaxCost).toBe(2160n);
  });

  it('returns a separate L1 fee for OP Stack estimates', async () => {
    readContract.mockResolvedValue(25n);
    const client = makeClient(8453);

    const [fee] = await estimateTotalFees(
      client,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          gasEstimate: 100n,
        },
      ],
      8453,
      'medium'
    );

    expect(client.getChainId).not.toHaveBeenCalled();
    expect(fee.l1Fee).toBe(25n);
    expect(fee.l2Fee).toBe(1300n);
    expect(fee.recommended.gasLimit).toBe(120n);
    expect(fee.recommended.totalMaxCost).toBe(1712n);
  });

  it('returns a separate L1 fee for Citrea estimates using l1FeeRate and l1DiffSize', async () => {
    request
      .mockResolvedValueOnce({ l1FeeRate: '0x2' })
      .mockResolvedValueOnce({ gas: '0x186a0', l1DiffSize: '0x11' });
    const client = makeClient(4114);

    const [fee] = await estimateTotalFees(
      client,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          gasEstimate: 100n,
        },
      ],
      4114,
      'medium'
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'eth_getBlockByNumber',
        params: ['latest', false],
      })
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'eth_estimateDiffSize',
      })
    );
    expect(fee.l1Fee).toBe(34n);
    expect(fee.l2Fee).toBe(1300n);
    expect(fee.recommended.totalMaxCost).toBe(1840n);
  });

  it('has no separate L1 fee on default fee models', async () => {
    const client = makeClient(1);

    const [fee] = await estimateTotalFees(
      client,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          gasEstimate: 100n,
        },
      ],
      1,
      'medium'
    );

    expect(client.getChainId).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
    expect(fee.l1Fee).toBe(0n);
    expect(fee.recommended.gasLimit).toBe(120n);
    expect(fee.recommended.totalMaxCost).toBe(1800n);
  });

  it('uses the requested price tier for max fee and priority fee recommendations', async () => {
    const client = makeClient(1);

    const [fee] = await estimateTotalFees(
      client,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          gasEstimate: 100n,
        },
      ],
      1,
      'high'
    );

    expect(fee.recommended.maxFeePerGas).toBe(20n);
    expect(fee.recommended.maxPriorityFeePerGas).toBe(5n);
  });

  it('starts chain-specific fee work before gas price recommendations resolve', async () => {
    let resolveRecommendations:
      | ((value: {
          low: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
          medium: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
          high: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
        }) => void)
      | null = null;

    getGasPriceRecommendationsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecommendations = resolve;
        })
    );
    readContract.mockResolvedValue(25n);
    const client = makeClient(8453);

    const contextPromise = estimateFeeContext(
      client,
      8453,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
        },
      ],
      'medium'
    );

    await Promise.resolve();

    expect(getGasPriceRecommendationsMock).toHaveBeenCalledWith(client, 8453);
    expect(readContract).toHaveBeenCalledTimes(1);

    resolveRecommendations?.({
      low: { maxFeePerGas: 11n, maxPriorityFeePerGas: 2n },
      medium: { maxFeePerGas: 13n, maxPriorityFeePerGas: 3n },
      high: { maxFeePerGas: 17n, maxPriorityFeePerGas: 5n },
    });

    const context = await contextPromise;
    expect(context.recommendation).toEqual({
      maxFeePerGas: 13n,
      maxPriorityFeePerGas: 3n,
    });
    expect(context.overheads).toEqual([
      {
        l1Fee: 25n,
        extraGas: 0n,
      },
    ]);
  });

  it('uses a Citrea diff-size hint without calling eth_estimateDiffSize', async () => {
    request.mockResolvedValueOnce({ l1FeeRate: '0x2' });
    const client = makeClient(4114);

    const context = await estimateFeeContext(
      client,
      4114,
      [
        {
          tx: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
          },
          l1DiffSizeHint: 120n,
        },
      ],
      'medium'
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(context.overheads).toEqual([
      {
        l1Fee: 240n,
        extraGas: 0n,
      },
    ]);
  });
});
