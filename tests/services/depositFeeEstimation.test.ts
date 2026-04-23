import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estimateFeeContextMock = vi.hoisted(() => vi.fn());
const finalizeFeeEstimatesMock = vi.hoisted(() => vi.fn());
const createPublicClientWithFallbackMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/feeEstimation', () => ({
  estimateFeeContext: estimateFeeContextMock,
  finalizeFeeEstimates: finalizeFeeEstimatesMock,
}));

vi.mock('../../src/core/utils/contract.utils', () => ({
  createPublicClientWithFallback: createPublicClientWithFallbackMock,
}));

import {
  DEFAULT_REPRESENTATIVE_DEPOSIT_GAS,
  estimateRepresentativeDepositTxFee,
} from '../../src/services/depositFeeEstimation';

describe('estimateRepresentativeDepositTxFee', () => {
  const estimateGas = vi.fn();
  const client = {
    chain: { id: 8453 },
    estimateGas,
  } as unknown as PublicClient;
  const chain = {
    id: 8453,
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    createPublicClientWithFallbackMock.mockReturnValue(client);
    estimateGas.mockResolvedValue(210_000n);
    estimateFeeContextMock.mockResolvedValue({
      chainId: 8453,
      recommendation: {
        maxFeePerGas: 13n,
        maxPriorityFeePerGas: 3n,
      },
      overheads: [{ l1Fee: 25n, extraGas: 0n }],
    });
    finalizeFeeEstimatesMock.mockReturnValue([
      {
        l1Fee: 25n,
        l2Fee: 75n,
        total: 100n,
        recommended: {
          gasLimit: 240_000n,
          maxFeePerGas: 15n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 3_600_000n,
          useLegacyPricing: false,
        },
      },
    ]);
  });

  it('builds a representative deposit tx and applies both explicit and synthetic buffers', async () => {
    const result = await estimateRepresentativeDepositTxFee({
      chain,
      vaultAddress: '0x1111111111111111111111111111111111111111',
      destinationChainId: 42161,
      sourceCount: 3,
      feeMultiplier: 120n,
    });

    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        account: '0x1111111111111111111111111111111111111111',
        to: '0x1111111111111111111111111111111111111111',
        value: 1n,
        data: expect.stringMatching(/^0x/),
      })
    );
    expect(estimateFeeContextMock).toHaveBeenCalledWith(
      client,
      8453,
      [
        expect.objectContaining({
          tx: expect.objectContaining({
            to: '0x1111111111111111111111111111111111111111',
            value: 1n,
          }),
        }),
      ],
      'medium'
    );
    expect(finalizeFeeEstimatesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          gasEstimate: 210_000n,
          tx: expect.objectContaining({
            to: '0x1111111111111111111111111111111111111111',
          }),
        }),
      ],
      expect.objectContaining({
        chainId: 8453,
      })
    );
    expect(result.rawTotalFee).toBe(100n);
    expect(result.bufferedTotalFee).toBe(156n);
  });

  it('increases the synthetic calldata with the source count hint', async () => {
    await estimateRepresentativeDepositTxFee({
      chain,
      vaultAddress: '0x1111111111111111111111111111111111111111',
      sourceCount: 1,
    });
    const singleSourceData = estimateGas.mock.calls[0]?.[0]?.data as string;

    await estimateRepresentativeDepositTxFee({
      chain,
      vaultAddress: '0x1111111111111111111111111111111111111111',
      sourceCount: 4,
    });
    const multiSourceData = estimateGas.mock.calls[1]?.[0]?.data as string;

    expect(multiSourceData.length).toBeGreaterThan(singleSourceData.length);
  });

  it('falls back to the default representative gas when chain estimation fails', async () => {
    estimateGas.mockRejectedValueOnce(new Error('estimate failed'));

    await estimateRepresentativeDepositTxFee({
      chain,
      vaultAddress: '0x1111111111111111111111111111111111111111',
    });

    expect(estimateFeeContextMock).toHaveBeenCalledWith(
      client,
      8453,
      [
        expect.objectContaining({
          tx: expect.any(Object),
        }),
      ],
      'medium'
    );
    expect(finalizeFeeEstimatesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          gasEstimate: DEFAULT_REPRESENTATIVE_DEPOSIT_GAS,
        }),
      ],
      expect.objectContaining({
        chainId: 8453,
      })
    );
  });
});
