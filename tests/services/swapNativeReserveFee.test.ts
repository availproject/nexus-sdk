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
  DEFAULT_SWAP_NATIVE_RESERVE_GAS,
  estimateRepresentativeSwapNativeReserveFee,
  SAFE_ACCOUNT_SWAP_NATIVE_RESERVE_GAS,
} from '../../src/services/swapNativeReserveFee';

describe('estimateRepresentativeSwapNativeReserveFee', () => {
  const client = {
    chain: { id: 4114 },
  } as unknown as PublicClient;
  // Pectra / 7702-capable chain (Citrea testnet) — Calibur execution path.
  const chain = {
    id: 4114,
    nativeCurrency: {
      decimals: 18,
      name: 'cBTC',
      symbol: 'cBTC',
    },
    swapSupported: true,
    pectraUpgradeSupport: true,
  } as never;
  // Non-pectra swap chain (HyperEVM) — Safe execTransaction path. Heavier per-tx gas (sig
  // verification + multiSend fan-out), bounded above by the chain's 3M small-block limit.
  const safeChain = {
    id: 999,
    nativeCurrency: {
      decimals: 18,
      name: 'HYPE',
      symbol: 'HYPE',
    },
    swapSupported: true,
    pectraUpgradeSupport: false,
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

  it('prices a representative raw source-execution tx with fixed gas and synthetic buffering', async () => {
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

  // Regression: production failure on HyperEVM where the EOA ran out of native because the
  // reserve was sized for a 2-call Calibur execute (~1.5M gas) while the actual submission
  // ran a Safe `execTransaction` with multiSend fan-out. EOA balance 529,093,107,360,245
  // vs required value+gas 849,636,684,432,245. Safe-mode chains must reserve against the
  // 3M small-block ceiling, not the Calibur default.
  it('reserves against the 3M small-block ceiling on non-pectra (Safe-mode) chains', async () => {
    await estimateRepresentativeSwapNativeReserveFee({
      chain: safeChain,
    });

    expect(finalizeFeeEstimatesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          gasEstimate: SAFE_ACCOUNT_SWAP_NATIVE_RESERVE_GAS,
          gasEstimateKind: 'raw',
        }),
      ],
      expect.anything()
    );
    expect(SAFE_ACCOUNT_SWAP_NATIVE_RESERVE_GAS).toBeGreaterThan(DEFAULT_SWAP_NATIVE_RESERVE_GAS);
  });

  it('keeps the Calibur default reserve on pectra-capable chains', async () => {
    await estimateRepresentativeSwapNativeReserveFee({
      chain, // chain.pectraUpgradeSupport: true
    });

    expect(finalizeFeeEstimatesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          gasEstimate: DEFAULT_SWAP_NATIVE_RESERVE_GAS,
          gasEstimateKind: 'raw',
        }),
      ],
      expect.anything()
    );
  });

  it('caller-supplied gasEstimate overrides the chain-mode default', async () => {
    await estimateRepresentativeSwapNativeReserveFee({
      chain: safeChain,
      gasEstimate: 42_000n,
    });

    expect(finalizeFeeEstimatesMock).toHaveBeenCalledWith(
      [expect.objectContaining({ gasEstimate: 42_000n })],
      expect.anything()
    );
  });
});
