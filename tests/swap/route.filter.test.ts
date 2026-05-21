// Durable contract tests for the EXACT_OUT source-filter and dst-chain removal behavior,
// pinned at the determineSwapRoute boundary so they're independent of where the filter is
// physically implemented.
//
// Today the filter sits in two places: getBalancesForSwap (via ankrBalanceToAssets) for
// the non-preloaded path, and route.ts's filterAllowedSources/filterRemoveSources for the
// preloaded path. The Win 5 refactor will collapse both into the route.ts path so it can
// be re-applied per-refresh against a fresh fromSources without re-fetching balances.
// These tests describe the contract the consumer sees through `determineSwapRoute` and
// must keep passing across that move.
//
// `runDetermineSwapRoute` uses preloadedBalances, so these tests exercise the route.ts
// inline filter today and the unified route.ts filter post-refactor — same code, same
// assertions, both before and after.

import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_CHAINS } from '../../src/commons';
import {
  exactOutInput,
  makeBalance,
  makeOraclePrice,
  runDetermineSwapRoute,
} from '../helpers/swap-route-fixtures';

const USDC_BASE: Hex = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ARBITRUM: Hex = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const USDC_HYPEREVM: Hex = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';

const NONCOT_BASE: Hex = '0xeeee0000000000000000000000000000babe0001';
const NONCOT_ARBITRUM: Hex = '0xeeee00000000000000000000000000000abb0001';
const NONCOT_HYPEREVM: Hex = '0xeeee0000000000000000000000000000face0001';

const ZERO_ADDR: Hex = '0x0000000000000000000000000000000000000000';
const EADDR: Hex = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Lowercased 32-byte hex fragments for comparing FlatBalance.tokenAddress (which is
// pre-normalized to 32-byte hex with native => EADDRESS via toFlatBalance).
const expand32 = (addr: Hex): string => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;

const oraclePrices = [
  makeOraclePrice(SUPPORTED_CHAINS.BASE, USDC_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.BASE, NONCOT_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM),
  makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM),
];

// Common helper: ask whether `route.extras.balances` contains a (chainId, tokenAddress) pair.
// Token-address compare is case-insensitive and uses the 32-byte hex form FlatBalance
// stores, with the ZERO_ADDRESS ↔ EADDRESS normalization (native is stored as EADDRESS).
const balancesContain = (
  balances: { chainID: number; tokenAddress: string }[],
  chainId: number,
  tokenAddress: Hex
): boolean => {
  const lookup =
    tokenAddress.toLowerCase() === ZERO_ADDR ? expand32(EADDR) : expand32(tokenAddress);
  return balances.some(
    (b) => b.chainID === chainId && b.tokenAddress.toLowerCase() === lookup.toLowerCase()
  );
};

describe('EXACT_OUT filter contract — fromSources / removeSources', () => {
  describe('fromSources (allowedSources)', () => {
    it('empty / undefined fromSources: all balances remain available', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '50'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices,
      });

      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.BASE, NONCOT_BASE)).toBe(true);
      expect(
        balancesContain(route.extras.balances, SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM)
      ).toBe(true);
    });

    it('single fromSources entry keeps only the matching (chainId, tokenAddress)', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '50'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices,
      });

      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.BASE, NONCOT_BASE)).toBe(true);
      expect(
        balancesContain(route.extras.balances, SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM)
      ).toBe(false);
    });

    it('fromSources excludes a chain entirely when none of its tokens are listed', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM, '50', 6, 'USDC'),
        ],
        oraclePrices,
      });

      const arbitrumEntries = route.extras.balances.filter(
        (b) => b.chainID === SUPPORTED_CHAINS.ARBITRUM
      );
      expect(arbitrumEntries).toHaveLength(0);
    });

    it('fromSources matches an uppercase token address against a lowercase balance', async () => {
      const upper = NONCOT_BASE.toUpperCase().replace('0X', '0x') as Hex;
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: upper }],
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '50')],
        oraclePrices,
      });

      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.BASE, NONCOT_BASE)).toBe(true);
    });

    it('fromSources with ZERO_ADDRESS matches the native balance on that chain', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: ZERO_ADDR }],
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [
          // FlatBalance stores native as EADDRESS (per toFlatBalance); makeBalance accepts
          // the raw hex and 32-byte-pads it. Passing EADDR here matches what real callers
          // see in their balance lists.
          makeBalance(SUPPORTED_CHAINS.BASE, EADDR, '5', 18, 'ETH'),
        ],
        oraclePrices: [...oraclePrices, makeOraclePrice(SUPPORTED_CHAINS.BASE, EADDR)],
      });

      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.BASE, EADDR)).toBe(true);
    });

    it('fromSources with EADDRESS also matches the native balance on that chain', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: EADDR }],
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, EADDR, '5', 18, 'ETH')],
        oraclePrices: [...oraclePrices, makeOraclePrice(SUPPORTED_CHAINS.BASE, EADDR)],
      });

      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.BASE, EADDR)).toBe(true);
    });
  });

  describe('removeSources (derived from toAmount / toNativeAmount sentinels)', () => {
    it('toAmount > 0n removes the dst-chain toToken from sources', async () => {
      // Provide an Arbitrum non-COT balance so the route has somewhere else to draw from
      // — otherwise the bridge build would fail for unrelated reasons and obscure the
      // intent of this test.
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '50'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices,
      });

      expect(
        balancesContain(route.extras.balances, SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM)
      ).toBe(false);
    });

    it('toAmount === -1n (exactly-enough sentinel) removes the dst-chain toToken from sources', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: -1n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '50'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices,
      });

      expect(
        balancesContain(route.extras.balances, SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM)
      ).toBe(false);
    });

    it('toAmount < -1n (surplus sentinel) keeps the dst-chain toToken but reduces its amount', async () => {
      // Reserve 10 USDC of the dst-chain token; balance was 50 USDC; expect ~40 remaining.
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: USDC_HYPEREVM,
          toAmount: -10_000_000n, // < -1n → reserve 10 USDC, surplus stays usable
        }),
        preloadedBalances: [makeBalance(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM, '50', 6, 'USDC')],
        oraclePrices,
      });

      // The dst-chain USDC must still be in the balance set (not removed)…
      const dst = route.extras.balances.find(
        (b) => b.chainID === SUPPORTED_CHAINS.HYPEREVM && b.tokenAddress === expand32(USDC_HYPEREVM)
      );
      expect(dst).toBeDefined();
      // …with the reserved amount deducted (50 - 10 = 40).
      expect(Number(dst!.amount)).toBe(40);
    });

    it('toNativeAmount > 0n removes the dst-chain native token from sources', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
          toNativeAmount: 1_000_000_000_000_000n, // 0.001 HYPE
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, EADDR, '1', 18, 'HYPE'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices: [...oraclePrices, makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, EADDR)],
      });

      // EADDRESS native on the dst chain is dropped because toNativeAmount > 0n.
      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.HYPEREVM, EADDR)).toBe(false);
    });

    it('toNativeAmount === -1n removes the dst-chain native token from sources', async () => {
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
          toNativeAmount: -1n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, EADDR, '1', 18, 'HYPE'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices: [...oraclePrices, makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, EADDR)],
      });

      expect(balancesContain(route.extras.balances, SUPPORTED_CHAINS.HYPEREVM, EADDR)).toBe(false);
    });
  });

  describe('fromSources and removeSources composition', () => {
    it('removeSources still drops the dst-chain toToken even when fromSources allows it', async () => {
      // Caller may have a stale fromSources list that includes dst-chain. The removeSources
      // (driven by toAmount > 0n) is authoritative.
      const { route } = await runDetermineSwapRoute({
        input: exactOutInput({
          fromSources: [
            { chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: NONCOT_HYPEREVM },
            { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: NONCOT_ARBITRUM },
          ],
          toChainId: SUPPORTED_CHAINS.HYPEREVM,
          toTokenAddress: NONCOT_HYPEREVM,
          toAmount: 10_000_000n,
        }),
        preloadedBalances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '50'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
        ],
        oraclePrices,
      });

      // dst-chain entry dropped (removeSources wins)…
      expect(
        balancesContain(route.extras.balances, SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM)
      ).toBe(false);
      // …Arbitrum non-dst entry preserved (fromSources allowed).
      expect(
        balancesContain(route.extras.balances, SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM)
      ).toBe(true);
    });
  });
});
