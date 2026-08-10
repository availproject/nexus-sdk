import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type PublicClient } from 'viem';
import type { Chain } from '../../src/domain';
import { estimateTotalFee } from '../../src/services/fee-estimation';
import { estimateRepresentativeSwapNativeReserveFee } from '../../src/services/swap-native-reserve-fee';
import { safeExecTransactionAbi } from '../../src/swap/safe/abis';

vi.mock('../../src/services/fee-estimation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/fee-estimation')>()),
  estimateTotalFee: vi.fn().mockResolvedValue({ total: 100n }),
}));

describe('estimateRepresentativeSwapNativeReserveFee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prices representative Safe V2 execTransaction calldata', async () => {
    await estimateRepresentativeSwapNativeReserveFee({
      chain: { id: 42161 } as Chain,
      publicClient: {} as PublicClient,
    });

    const tx = vi.mocked(estimateTotalFee).mock.calls[0]?.[2];
    expect(tx).toBeDefined();
    expect(
      decodeFunctionData({ abi: safeExecTransactionAbi, data: tx!.data }).functionName
    ).toBe('execTransaction');
  });
});
