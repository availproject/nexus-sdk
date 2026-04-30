import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ankrBalanceToAssetsMock = vi.hoisted(() => vi.fn());
const fetchTransferFeesMock = vi.hoisted(() => vi.fn());
const getAnkrBalancesMock = vi.hoisted(() => vi.fn());
const toFlatBalanceMock = vi.hoisted(() => vi.fn());
const vscBalancesToAssetsMock = vi.hoisted(() => vi.fn());
const createPublicClientWithFallbackMock = vi.hoisted(() => vi.fn());
const multicallMock = vi.hoisted(() => vi.fn());
const estimateFeesPerGasMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/swap/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/swap/utils')>(
    '../../../../src/swap/utils'
  );
  return {
    ...actual,
    ankrBalanceToAssets: ankrBalanceToAssetsMock,
    fetchTransferFees: fetchTransferFeesMock,
    getAnkrBalances: getAnkrBalancesMock,
    toFlatBalance: toFlatBalanceMock,
    vscBalancesToAssets: vscBalancesToAssetsMock,
  };
});

vi.mock('../../../../src/core/utils/contract.utils', () => ({
  createPublicClientWithFallback: createPublicClientWithFallbackMock,
}));

import { ZERO_ADDRESS } from '../../../../src/core/constants';
import {
  generateStateOverride,
  getBalancesForSwap,
} from '../../../../src/core/utils/balance.utils';

describe('getBalancesForSwap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPublicClientWithFallbackMock.mockReturnValue({
      multicall: multicallMock,
      estimateFeesPerGas: estimateFeesPerGasMock,
    });
    multicallMock.mockResolvedValue([
      {
        status: 'success',
        result: 3_000_000_000_000_000_000n,
      },
    ]);
    estimateFeesPerGasMock.mockResolvedValue({
      maxFeePerGas: 222_222_222_222n,
    });
    fetchTransferFeesMock.mockResolvedValue(new Map([[1, new Decimal(1)]]));
    getAnkrBalancesMock.mockResolvedValue([]);
    ankrBalanceToAssetsMock.mockReturnValue([]);
    toFlatBalanceMock.mockReturnValue([]);
    vscBalancesToAssetsMock.mockReturnValue([]);
  });

  it('deducts the swap native reserve once after merging balances', async () => {
    const chain = {
      ankrName: '',
      custom: {
        icon: '',
        knownTokens: [],
      },
      id: 1,
      name: 'Ethereum',
      nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
      },
      swapSupported: true,
      universe: Universe.ETHEREUM,
    } as never;

    const chainList = {
      chains: [chain],
    } as never;

    await getBalancesForSwap({
      evmAddress: '0x1111111111111111111111111111111111111111',
      chainList,
      filterWithSupportedTokens: false,
    });

    expect(estimateFeesPerGasMock).not.toHaveBeenCalled();
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
});

describe('generateStateOverride', () => {
  const user = '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45' as const;
  const usdcPolygon = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as const;

  it('uses account balance for any native token (zero address), not only ETH', () => {
    const amount = 1_000_000_000_000_000_000n;
    const o = generateStateOverride({
      tokenSymbol: 'POL',
      tokenAddress: ZERO_ADDRESS,
      chainId: 137,
      userAddress: user,
      amount,
    });
    expect(o).toEqual({
      [user]: {
        balance: '0x1bc16d674ec80000',
      },
    });
  });

  it('uses ERC-20 storage override for non-native tokens', () => {
    const amount = 1_000_000n;
    const o = generateStateOverride({
      tokenSymbol: 'USDC',
      tokenAddress: usdcPolygon,
      chainId: 137,
      userAddress: user,
      amount,
    });
    expect(o).toMatchObject({
      [usdcPolygon]: { storage: expect.any(Object) },
      [user]: { balance: '0x186a0' },
    });
  });
});
