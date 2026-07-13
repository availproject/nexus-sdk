import { describe, expect, it } from 'vitest';
import { selectSwapSources } from '../../../src/swap/balance/swap-balances';
import type { FlatBalance } from '../../../src/swap/types';

const ETH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as const;
const WETH_ARB = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as const;
const OUTPUT_TOKEN = '0x00000000000000000000000000000000000000ff' as const;

const makeBalance = (
  chainID: number,
  tokenAddress: string,
  symbol: string,
  amount: string,
  value: number,
  decimals = 18,
): FlatBalance => ({
  amount,
  chainID,
  decimals,
  symbol,
  tokenAddress: tokenAddress as `0x${string}`,
  value,
  logo: '',
  name: symbol,
});

describe('selectSwapSources', () => {
  const defaultBalances: FlatBalance[] = [
    makeBalance(42161, USDC_ARB, 'USDC', '100', 100, 6),
    makeBalance(42161, WETH_ARB, 'WETH', '0.5', 1000),
    makeBalance(42161, ETH_ADDR, 'ETH', '1.0', 2000),
  ];

  it('returns filtered + sorted balances', () => {
    const result = selectSwapSources(defaultBalances, 8453, OUTPUT_TOKEN);

    expect(result.length).toBeGreaterThan(0);
    // All balances have positive amounts
    for (const b of result) {
      expect(Number(b.amount)).toBeGreaterThan(0);
    }
  });

  it('returns empty when all balances are zero', () => {
    const zeroBalances = [makeBalance(42161, USDC_ARB, 'USDC', '0', 0, 6)];

    const result = selectSwapSources(zeroBalances, 8453, OUTPUT_TOKEN);

    expect(result).toHaveLength(0);
  });

  it('sorts by priority (same chain first)', () => {
    const balances = [
      makeBalance(42161, WETH_ARB, 'WETH', '1', 1000),
      makeBalance(8453, USDC_ARB, 'USDC', '50', 50, 6),
    ];

    const result = selectSwapSources(balances, 8453, OUTPUT_TOKEN);

    // Same chain (8453) should come first
    expect(result[0].chainID).toBe(8453);
  });
});
