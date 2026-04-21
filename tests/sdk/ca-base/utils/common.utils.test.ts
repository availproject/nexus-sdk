import { Universe } from '@avail-project/ca-common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estimateRepresentativeDepositTxFeeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/depositFeeEstimation', () => ({
  estimateRepresentativeDepositTxFee: estimateRepresentativeDepositTxFeeMock,
}));

vi.mock('../../../../src/core/chains', () => ({
  ChainList: class {},
}));

import { ZERO_ADDRESS } from '../../../../src/core/constants';
import { assetListWithDepositDeducted } from '../../../../src/core/utils/common.utils';

describe('assetListWithDepositDeducted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estimateRepresentativeDepositTxFeeMock.mockResolvedValue({
      rawTotalFee: 1_000_000_000_000_000_000n,
      bufferedTotalFee: 1_000_000_000_000_000_000n,
    });
  });

  it('deducts native deposit cost only from non-destination source balances', async () => {
    const chainList = {
      getChainByID: vi.fn((chainId: number) => ({
        id: chainId,
        nativeCurrency: {
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
        },
      })),
      getVaultContractAddress: vi.fn(
        (chainId: number) => `0x${chainId.toString(16).padStart(40, '0')}` as `0x${string}`
      ),
    } as never;

    const result = await assetListWithDepositDeducted(
      [
        {
          balance: '5',
          chainId: 10,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
        {
          balance: '4',
          chainId: 8453,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
        {
          balance: '6',
          chainId: 42161,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
        {
          balance: '7',
          chainId: 10,
          contractAddress: '0x2222222222222222222222222222222222222222',
          universe: Universe.ETHEREUM,
          decimals: 6,
        },
      ],
      chainList,
      {
        feeMultiplier: 120n,
        destinationChainId: 42161,
      }
    );

    expect(
      result
        .find((item) => item.chainID === 10 && item.tokenContract === ZERO_ADDRESS)
        ?.balance.toFixed()
    ).toBe('4');
    expect(
      result
        .find((item) => item.chainID === 8453 && item.tokenContract === ZERO_ADDRESS)
        ?.balance.toFixed()
    ).toBe('3');
    expect(
      result
        .find((item) => item.chainID === 42161 && item.tokenContract === ZERO_ADDRESS)
        ?.balance.toFixed()
    ).toBe('6');
    expect(
      result
        .find((item) => item.tokenContract === '0x2222222222222222222222222222222222222222')
        ?.balance.toFixed()
    ).toBe('7');
    expect(estimateRepresentativeDepositTxFeeMock).toHaveBeenCalledTimes(2);
    expect(estimateRepresentativeDepositTxFeeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationChainId: 42161,
        feeMultiplier: 120n,
        sourceCount: 3,
      })
    );
  });

  it('clamps the native balance to zero when the representative fee exceeds it', async () => {
    const chainList = {
      getChainByID: vi.fn((chainId: number) => ({
        id: chainId,
        nativeCurrency: {
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
        },
      })),
      getVaultContractAddress: vi.fn(() => '0x1111111111111111111111111111111111111111'),
    } as never;

    estimateRepresentativeDepositTxFeeMock.mockResolvedValueOnce({
      rawTotalFee: 0n,
      bufferedTotalFee: 2_000_000_000_000_000_000n,
    });

    const result = await assetListWithDepositDeducted(
      [
        {
          balance: '1',
          chainId: 10,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
      ],
      chainList,
      {
        feeMultiplier: 120n,
        destinationChainId: 42161,
      }
    );

    expect(result[0]?.balance.toFixed()).toBe('0');
  });
});
