import { describe, expect, it } from 'vitest';
import { sortSourcesByPriority } from '../../../src/swap/balance/sort';
import type { FlatBalance } from '../../../src/swap/types';

const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as const;
const USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as const;
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as const;
const DAI = '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1' as const;

const makeBalance = (
  chainID: number,
  tokenAddress: string,
  symbol: string,
  value: number,
): FlatBalance => ({
  amount: '1',
  chainID,
  decimals: 18,
  symbol,
  tokenAddress: tokenAddress as `0x${string}`,
  value,
  logo: '',
  name: symbol,
});

const DST_CHAIN_ID = 8453; // Base
const DST_TOKEN = '0xOutputToken00000000000000000000000000000' as `0x${string}`;

describe('sortSourcesByPriority', () => {
  it('same token + same chain = priority 1 (first)', () => {
    const balances: FlatBalance[] = [
      makeBalance(42161, WETH, 'WETH', 100),     // other chain, other token
      makeBalance(DST_CHAIN_ID, DST_TOKEN, 'OUT', 50), // same token, same chain
    ];

    const sorted = sortSourcesByPriority(balances, DST_CHAIN_ID, DST_TOKEN);

    expect(sorted[0].tokenAddress.toLowerCase()).toBe(DST_TOKEN.toLowerCase());
    expect(sorted[0].chainID).toBe(DST_CHAIN_ID);
  });

  it('stablecoin on same chain = priority 2 (after same token)', () => {
    const balances: FlatBalance[] = [
      makeBalance(42161, WETH, 'WETH', 100),          // other chain
      makeBalance(DST_CHAIN_ID, USDC, 'USDC', 50),    // stablecoin, same chain
      makeBalance(DST_CHAIN_ID, DST_TOKEN, 'OUT', 50), // same token, same chain
    ];

    const sorted = sortSourcesByPriority(balances, DST_CHAIN_ID, DST_TOKEN);

    expect(sorted[0].tokenAddress.toLowerCase()).toBe(DST_TOKEN.toLowerCase());
    expect(sorted[1].symbol).toBe('USDC');
  });

  it('Ethereum mainnet = last group (highest priority number)', () => {
    const balances: FlatBalance[] = [
      makeBalance(1, WETH, 'WETH', 200),        // Ethereum — last group
      makeBalance(42161, WETH, 'WETH', 100),     // Arbitrum — middle group
      makeBalance(DST_CHAIN_ID, WETH, 'WETH', 50), // same chain — first group
    ];

    const sorted = sortSourcesByPriority(balances, DST_CHAIN_ID, DST_TOKEN);

    // Same chain first, then Arbitrum, then Ethereum
    expect(sorted[0].chainID).toBe(DST_CHAIN_ID);
    expect(sorted[1].chainID).toBe(42161);
    expect(sorted[2].chainID).toBe(1);
  });

  it('tiebreaker by USD value DESC', () => {
    const balances: FlatBalance[] = [
      makeBalance(42161, WETH, 'WETH', 50),
      makeBalance(42161, DAI, 'DAI', 200),
    ];

    // Both are "other token, other chain" — same priority, tiebreak by value
    const sorted = sortSourcesByPriority(balances, DST_CHAIN_ID, DST_TOKEN);

    expect(sorted[0].value).toBe(200);
    expect(sorted[1].value).toBe(50);
  });

  it('empty array returns empty', () => {
    const sorted = sortSourcesByPriority([], DST_CHAIN_ID, DST_TOKEN);
    expect(sorted).toHaveLength(0);
  });

  it('gas token on same chain ranks higher than other token on other chain', () => {
    const balances: FlatBalance[] = [
      makeBalance(42161, DAI, 'DAI', 100),             // other token, other chain
      makeBalance(DST_CHAIN_ID, ETH, 'ETH', 50),       // gas token, same chain
    ];

    const sorted = sortSourcesByPriority(balances, DST_CHAIN_ID, DST_TOKEN);

    // Gas token on same chain (priority 3) beats other token on other chain (priority 7)
    expect(sorted[0].chainID).toBe(DST_CHAIN_ID);
    expect(sorted[0].symbol).toBe('ETH');
  });
});
