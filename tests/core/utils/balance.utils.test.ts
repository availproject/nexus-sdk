import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ankrBalanceToAssetsMock = vi.hoisted(() => vi.fn());
const fetchTransferFeesMock = vi.hoisted(() => vi.fn());
const toFlatBalanceMock = vi.hoisted(() => vi.fn());
const vscBalancesToAssetsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/swap/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/swap/utils')>('../../../src/swap/utils');
  return {
    ...actual,
    ankrBalanceToAssets: ankrBalanceToAssetsMock,
    fetchTransferFees: fetchTransferFeesMock,
    toFlatBalance: toFlatBalanceMock,
    vscBalancesToAssets: vscBalancesToAssetsMock,
  };
});

import { ZERO_ADDRESS } from '../../../src/core/constants';
import { getBalancesForSwap } from '../../../src/core/utils/balance.utils';

describe('getBalancesForSwap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTransferFeesMock.mockResolvedValue(new Map([[1, new Decimal(1)]]));
    ankrBalanceToAssetsMock.mockReturnValue([]);
    toFlatBalanceMock.mockReturnValue([]);
    vscBalancesToAssetsMock.mockReturnValue([]);
  });

  it('deducts the swap native reserve once after merging balances', async () => {
    const chain = {
      ankrName: '',
      custom: { icon: '', knownTokens: [] },
      id: 1,
      name: 'Ethereum',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      swapSupported: true,
      universe: Universe.ETHEREUM,
    } as never;

    const chainList = { chains: [chain] } as never;

    // vservice returns the merged ankr+multicall result; 3 ETH native on chain 1.
    const vscClient = {
      getSwapBalances: vi.fn().mockResolvedValue([
        {
          balance: '3',
          balanceRawInteger: '3000000000000000000',
          balanceUsd: '0',
          blockchain: '1',
          contractAddress: '0x0000000000000000000000000000000000000000' as const,
          holderAddress: '0x1111111111111111111111111111111111111111' as const,
          thumbnail: '',
          tokenDecimals: 18,
          tokenName: 'Ether',
          tokenPrice: '0',
          tokenSymbol: 'ETH',
          tokenType: 'NATIVE' as const,
        },
      ]),
    } as never;

    await getBalancesForSwap({
      evmAddress: '0x1111111111111111111111111111111111111111',
      chainList,
      vscClient,
      filterWithSupportedTokens: false,
    });

    expect(vscClient.getSwapBalances).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111'
    );
    expect(fetchTransferFeesMock).toHaveBeenCalledWith([chain]);
    expect(ankrBalanceToAssetsMock).toHaveBeenCalledWith(
      chainList,
      [
        expect.objectContaining({
          chainID: 1,
          tokenAddress: ZERO_ADDRESS,
          balance: '2.000000000000000000',
        }),
      ],
      false,
      undefined,
      undefined
    );
  });

  it('skips assets whose blockchain field is not a numeric chain id', async () => {
    const chainList = { chains: [] } as never;

    const vscClient = {
      getSwapBalances: vi.fn().mockResolvedValue([
        {
          balance: '1',
          balanceRawInteger: '1',
          balanceUsd: '0',
          blockchain: 'not-a-number',
          contractAddress: '0x0000000000000000000000000000000000000000' as const,
          holderAddress: '0x1111111111111111111111111111111111111111' as const,
          thumbnail: '',
          tokenDecimals: 18,
          tokenName: 'Bogus',
          tokenPrice: '0',
          tokenSymbol: 'BOGUS',
          tokenType: 'NATIVE' as const,
        },
      ]),
    } as never;

    fetchTransferFeesMock.mockResolvedValue(new Map());

    await getBalancesForSwap({
      evmAddress: '0x1111111111111111111111111111111111111111',
      chainList,
      vscClient,
      filterWithSupportedTokens: false,
    });

    expect(ankrBalanceToAssetsMock).toHaveBeenCalledWith(
      chainList,
      [],
      false,
      undefined,
      undefined
    );
  });
});
