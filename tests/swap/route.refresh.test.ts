// Win 5 contract: determineSwapRoute returns { route, refresh }. The `refresh` function
// captures the closure's `feeStore`, `oraclePrices`, raw balances, dst-token metadata,
// and chain executions; subsequent refresh() calls re-quote aggregators but skip the
// slow refetches. These tests pin that contract by counting calls into the mocked
// dependencies before/after refresh.

import { type Aggregator, CurrencyID } from '@avail-project/ca-common';
import type { Hex } from 'viem';
import { describe, expect, it, type vi } from 'vitest';
import type {
  CosmosQueryClient,
  OraclePriceResponse,
  SwapParams,
  VSCClient,
} from '../../src/commons';
import { SUPPORTED_CHAINS, SwapMode } from '../../src/commons';
import { determineSwapRoute } from '../../src/swap/route';
import type { PublicClientList } from '../../src/swap/utils';
import {
  exactInInput,
  exactOutInput,
  FakePublicClientList,
  mainnetChainList,
  makeBalance,
  makeMockCosmosQueryClient,
  makeMockVscClient,
  makeOraclePrice,
  makeRecordingAggregator,
  TEST_EOA,
  TEST_EPHEMERAL,
} from '../helpers/swap-route-fixtures';

const USDC_BASE: Hex = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ARBITRUM: Hex = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const USDC_HYPEREVM: Hex = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';
const NONCOT_BASE: Hex = '0xeeee0000000000000000000000000000babe0001';
const NONCOT_ARBITRUM: Hex = '0xeeee00000000000000000000000000000abb0001';
const NONCOT_HYPEREVM: Hex = '0xeeee0000000000000000000000000000face0001';

const oraclePrices: OraclePriceResponse = [
  makeOraclePrice(SUPPORTED_CHAINS.BASE, USDC_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.BASE, NONCOT_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM),
  makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM),
];

// Build the same option bag runDetermineSwapRoute uses, but expose the mocks so each
// test can count call-counts before/after a refresh.
const setup = (preloadedBalances: ReturnType<typeof makeBalance>[]) => {
  const aggregator = makeRecordingAggregator();
  const vscClient = makeMockVscClient();
  const cosmosQueryClient = makeMockCosmosQueryClient(oraclePrices);
  const chainList = mainnetChainList();
  const publicClientList = new FakePublicClientList(chainList);

  const options: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  } = {
    address: { cosmos: 'avail1test', eoa: TEST_EOA, ephemeral: TEST_EPHEMERAL },
    chainList,
    cosmosQueryClient,
    intentExplorerUrl: 'https://test.example',
    onSwapIntent: ({ allow }: { allow: () => void }) => allow(),
    preloadedBalances,
    vscClient,
    wallet: { cosmos: {} as never, eoa: {} as never, ephemeral: {} as never },
    aggregators: [aggregator.aggregator],
    publicClientList,
    cotCurrencyID: CurrencyID.USDC,
  } as never;

  return { options, aggregator, vscClient, cosmosQueryClient };
};

const exactOut = (overrides: Partial<Parameters<typeof exactOutInput>[0]> = {}) =>
  exactOutInput({
    toChainId: SUPPORTED_CHAINS.HYPEREVM,
    toTokenAddress: NONCOT_HYPEREVM,
    toAmount: 10_000_000n,
    ...overrides,
  });

describe('determineSwapRoute → { route, refresh } (Win 5 closure reuse)', () => {
  it('returns both `route` and `refresh` on the initial call', async () => {
    const { options } = setup([makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')]);
    const result = await determineSwapRoute(exactOut(), options);

    expect(result.route).toBeDefined();
    expect(typeof result.refresh).toBe('function');
  });

  it('does not refetch oraclePrices when refresh() is called', async () => {
    const { options, cosmosQueryClient } = setup([
      makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100'),
    ]);
    const initial = exactOut();
    const { refresh } = await determineSwapRoute(initial, options);

    // Initial call should have fetched oraclePrices once.
    const initialOracleCalls = (cosmosQueryClient.fetchPriceOracle as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(initialOracleCalls).toBe(1);

    await refresh(initial);

    // Refresh must NOT re-fetch oraclePrices.
    const afterRefreshOracleCalls = (cosmosQueryClient.fetchPriceOracle as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    expect(afterRefreshOracleCalls).toBe(initialOracleCalls);
  });

  it('does not call vscGetSafeAccountAddress again on refresh', async () => {
    // HyperEVM source forces a Safe-account verification on initial call. Refresh must
    // not re-fire that VSC roundtrip — the chain execution is fully cached.
    const { options, vscClient } = setup([
      makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '100'),
    ]);
    const initial = exactOut({
      toChainId: SUPPORTED_CHAINS.ARBITRUM,
      toTokenAddress: NONCOT_ARBITRUM,
    });
    const { refresh } = await determineSwapRoute(initial, options);

    const initialVscCalls = (vscClient.vscGetSafeAccountAddress as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(initialVscCalls).toBeGreaterThan(0); // HyperEVM source → at least one call.

    await refresh(initial);

    const afterRefreshVscCalls = (vscClient.vscGetSafeAccountAddress as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    expect(afterRefreshVscCalls).toBe(initialVscCalls);
  });

  it('re-runs aggregator quotes on every refresh (the whole point of refresh)', async () => {
    const { options, aggregator } = setup([makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')]);
    const initial = exactOut();
    const { refresh } = await determineSwapRoute(initial, options);

    const initialQuoteCalls = aggregator.calls.length;
    expect(initialQuoteCalls).toBeGreaterThan(0);

    await refresh(initial);

    // Refresh must re-quote — the reason it exists is to pick up rate movement.
    expect(aggregator.calls.length).toBeGreaterThan(initialQuoteCalls);
  });

  it('applies a new fromSources filter on refresh against the closure-cached balance set', async () => {
    const { options } = setup([
      makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100'),
      makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '100'),
    ]);
    const initial = exactOut({
      fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
    });
    const { route: initialRoute, refresh } = await determineSwapRoute(initial, options);

    // Initial: only Base balance survives.
    expect(initialRoute.extras.balances.some((b) => b.chainID === SUPPORTED_CHAINS.BASE)).toBe(
      true
    );
    expect(initialRoute.extras.balances.some((b) => b.chainID === SUPPORTED_CHAINS.ARBITRUM)).toBe(
      false
    );

    // Refresh with a different fromSources: Arbitrum-only.
    const refreshed = await refresh({
      mode: SwapMode.EXACT_OUT,
      data: {
        ...initial.data,
        fromSources: [{ chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: NONCOT_ARBITRUM }],
      },
    });

    // Now Arbitrum survives, Base is filtered out — proving the closure cached the
    // UNFILTERED balance set and refresh re-applied the filter.
    expect(refreshed.extras.balances.some((b) => b.chainID === SUPPORTED_CHAINS.ARBITRUM)).toBe(
      true
    );
    expect(refreshed.extras.balances.some((b) => b.chainID === SUPPORTED_CHAINS.BASE)).toBe(false);
  });

  it('rejects refresh that changes swap mode', async () => {
    const { options } = setup([makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')]);
    const { refresh } = await determineSwapRoute(exactOut(), options);

    await expect(
      refresh(
        exactInInput({
          from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
          toChainId: SUPPORTED_CHAINS.ARBITRUM,
          toTokenAddress: NONCOT_ARBITRUM,
        })
      )
    ).rejects.toThrow(/cannot switch swap mode/i);
  });
});
