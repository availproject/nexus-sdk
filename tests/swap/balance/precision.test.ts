import { describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
import { getBalancesForSwap } from '../../../src/swap/balance/swap-balances';
import type { FlatBalance } from '../../../src/swap/types';

describe('balance precision safety', () => {
  it('getBalancesForSwap does not lose precision filtering large balances', async () => {
    // This amount exceeds Number.MAX_SAFE_INTEGER when converted
    const largeBalance: FlatBalance = {
      amount: '999999999999999.999999',
      chainID: 1,
      decimals: 6,
      symbol: 'USDC',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      value: 999999999999999.999999,
      logo: '',
      name: 'USDC',
    };

    const result = await getBalancesForSwap({
      balances: [largeBalance],
      dstChainId: 42161,
      dstTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    });

    expect(result).toHaveLength(1);
    // The amount string must survive unchanged — no Number() truncation
    expect(result[0].amount).toBe('999999999999999.999999');
  });

  it('getBalancesForSwap filters out zero-amount strings without Number()', async () => {
    const zeroBalance: FlatBalance = {
      amount: '0',
      chainID: 1,
      decimals: 6,
      symbol: 'USDC',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      value: 0,
      logo: '',
      name: 'USDC',
    };

    const result = await getBalancesForSwap({
      balances: [zeroBalance],
      dstChainId: 42161,
      dstTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    });

    expect(result).toHaveLength(0);
  });

  it('getBalancesForSwap keeps small positive amounts', async () => {
    const tinyBalance: FlatBalance = {
      amount: '0.000001',
      chainID: 1,
      decimals: 6,
      symbol: 'USDC',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      value: 0.000001,
      logo: '',
      name: 'USDC',
    };

    const result = await getBalancesForSwap({
      balances: [tinyBalance],
      dstChainId: 42161,
      dstTokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    });

    expect(result).toHaveLength(1);
  });
});
