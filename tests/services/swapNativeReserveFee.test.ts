import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estimateFeeContextMock = vi.hoisted(() => vi.fn());
const finalizeFeeEstimatesMock = vi.hoisted(() => vi.fn());
const createPublicClientWithFallbackMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/feeEstimation', () => ({
  estimateFeeContext: estimateFeeContextMock,
  finalizeFeeEstimates: finalizeFeeEstimatesMock,
}));

vi.mock('../../src/sdk/ca-base/utils/contract.utils', () => ({
  createPublicClientWithFallback: createPublicClientWithFallbackMock,
}));

import {
  DEFAULT_SWAP_NATIVE_RESERVE_GAS,
  estimateRepresentativeSwapNativeReserveFee,
} from '../../src/services/swapNativeReserveFee';

describe('estimateRepresentativeSwapNativeReserveFee', () => {
  const client = {
    chain: { id: 4114 },
  } as unknown as PublicClient;
  const chain = {
    id: 4114,
    nativeCurrency: {
      decimals: 18,
      name: 'cBTC',
      symbol: 'cBTC',
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    createPublicClientWithFallbackMock.mockReturnValue(client);
    estimateFeeContextMock.mockResolvedValue({
      chainId: 4114,
      recommendation: {
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 2n,
      },
      overheads: [{ l1Fee: 0n, extraGas: 123n }],
    });
    finalizeFeeEstimatesMock.mockReturnValue([
      {
        l1Fee: 25n,
        l2Fee: 75n,
        total: 100n,
        recommended: {
          gasLimit: 1_800_000n,
          maxFeePerGas: 11n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 19_800_000n,
          useLegacyPricing: true,
        },
      },
    ]);
  });

  it('prices a representative raw calibur execute tx with fixed gas and synthetic buffering', async () => {
    const result = await estimateRepresentativeSwapNativeReserveFee({
      chain,
    });

    expect(estimateFeeContextMock).toHaveBeenCalledWith(
      client,
      4114,
      [
        expect.objectContaining({
          gasEstimateKind: 'raw',
          l1DiffSizeHint: 200n,
          tx: expect.objectContaining({
            to: '0x1111111111111111111111111111111111111111',
            value: 1n,
            data: expect.stringMatching(/^0x/),
          }),
        }),
      ],
      'medium'
    );
    expect(finalizeFeeEstimatesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          gasEstimate: DEFAULT_SWAP_NATIVE_RESERVE_GAS,
          gasEstimateKind: 'raw',
        }),
      ],
      expect.objectContaining({
        chainId: 4114,
      })
    );
    const [{ tx }] = estimateFeeContextMock.mock.calls[0]?.[2] ?? [];
    expect((tx.data as string).length).toBeGreaterThan(4000);
    expect(result).toBe(120n);
  });
});
