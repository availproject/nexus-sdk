import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { buildSwapPreflight } from '../../src/swap/preflight';
import { EADDRESS } from '../../src/swap/constants';
import { CurrencyID } from '../../src/swap/cot';
import { SwapMode, type FlatBalance } from '../../src/swap/types';
import type { MiddlewareSwapPreflightClient } from '../../src/transport';
import { ARB_CHAIN, WETH, makeDstTokenInfo, makeSwapChainList } from '../helpers/swap';

// 0.01 ETH representative reserve fee — deducted from native balances by the swap source path.
vi.mock('../../src/services/swap-native-reserve-fee', () => ({
  estimateRepresentativeSwapNativeReserveFee: vi.fn().mockResolvedValue(10_000_000_000_000_000n),
  DEFAULT_SWAP_NATIVE_RESERVE_GAS: 1_500_000n,
}));

const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const makeMiddleware = (
  balances: FlatBalance[] = []
): MiddlewareSwapPreflightClient =>
  ({
    getSwapBalances: vi.fn().mockResolvedValue(balances),
    getOraclePrices: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
  }) as unknown as MiddlewareSwapPreflightClient;

const nativeEth = (amount: string): FlatBalance => ({
  amount,
  chainID: ARB_CHAIN,
  decimals: 18,
  symbol: 'ETH',
  tokenAddress: EADDRESS,
  value: 3000,
  logo: '',
  name: 'Ether',
});

const exactInInput = {
  mode: SwapMode.EXACT_IN as const,
  data: { from: [], toChainId: ARB_CHAIN, toTokenAddress: WETH },
};

describe('buildSwapPreflight native gas reserve', () => {
  it('deducts the native reserve from preloaded balances before routing', async () => {
    const preflight = await buildSwapPreflight(exactInInput, {
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: EOA,
      middlewareClient: makeMiddleware(),
      preloadedBalances: [nativeEth('1')],
      preloadedDstTokenInfo: makeDstTokenInfo(),
    });

    const eth = preflight.balances.find((b) => b.symbol === 'ETH');
    expect(eth).toBeDefined();
    expect(Number(eth!.amount)).toBeCloseTo(0.99, 6); // 1 - 0.01 reserve
  });

  it('deducts the native reserve from freshly fetched balances (no preload)', async () => {
    const preflight = await buildSwapPreflight(exactInInput, {
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: EOA,
      middlewareClient: makeMiddleware([nativeEth('1')]),
      preloadedDstTokenInfo: makeDstTokenInfo(),
    });

    const eth = preflight.balances.find((b) => b.symbol === 'ETH');
    expect(eth).toBeDefined();
    expect(Number(eth!.amount)).toBeCloseTo(0.99, 6); // 1 - 0.01 reserve
  });
});
