import { type Hex, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { type Chain, SUPPORTED_CHAINS } from '../../src/commons';
import type { FlatBalance } from '../../src/swap/data';
import {
  hasDestinationChainSourceSwapOutput,
  requiresSafeAccount,
  toAggregatorInputsWithSwapAddresses,
} from '../../src/swap/route';
import {
  exactInInput,
  exactOutInput,
  makeBalance,
  makeOraclePrice,
  partitionCalls,
  runDetermineSwapRoute,
  TEST_EOA,
  TEST_EPHEMERAL,
} from '../helpers/swap-route-fixtures';

const baseChain = {
  blockExplorers: { default: { name: 'Explorer', url: 'https://example.com' } },
  custom: { icon: '', knownTokens: [] },
  id: SUPPORTED_CHAINS.ETHEREUM,
  name: 'Ethereum',
  ankrName: 'eth',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  pectraUpgradeSupport: true,
  rpcUrls: { default: { http: [], webSocket: [] } },
  swapSupported: true,
  universe: 1,
} as Chain;

describe('requiresSafeAccount', () => {
  it('only requires Safe for swap-supported non-Pectra chains', () => {
    expect(
      requiresSafeAccount({ ...baseChain, swapSupported: true, pectraUpgradeSupport: false })
    ).toBe(true);
    expect(
      requiresSafeAccount({ ...baseChain, swapSupported: false, pectraUpgradeSupport: false })
    ).toBe(false);
    expect(
      requiresSafeAccount({ ...baseChain, swapSupported: true, pectraUpgradeSupport: true })
    ).toBe(false);
    expect(requiresSafeAccount(undefined)).toBe(false);
  });
});

// Per-chain Safe-vs-7702 selection is covered by tests/swap/sourceExecution.test.ts
// (which now targets the combined `resolveChainExecutions` helper). The dst-specific
// `direct_eoa` downgrade is exercised end-to-end by the integration scenarios below
// (`assertNoDestinationCalls`, the `combined` flag tests, etc.).

describe('toAggregatorInputsWithSwapAddresses', () => {
  it('populates both takerAddress and receiverAddress with the execution address per source chain', () => {
    const holdings = toAggregatorInputsWithSwapAddresses(
      [
        {
          amount: '1',
          chainID: SUPPORTED_CHAINS.ETHEREUM,
          decimals: 6,
          logo: '',
          symbol: 'USDC',
          tokenAddress: '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          universe: 1,
          value: 1,
        },
        {
          amount: '2',
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          decimals: 6,
          logo: '',
          symbol: 'USDC',
          tokenAddress: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          universe: 1,
          value: 2,
        },
      ] as FlatBalance[],
      {
        [SUPPORTED_CHAINS.ETHEREUM]: {
          address: '0x2222222222222222222222222222222222222222',
          entryPoint: null,
          mode: '7702',
        },
        [SUPPORTED_CHAINS.HYPEREVM]: {
          address: '0x3333333333333333333333333333333333333333',
          entryPoint: null,
          mode: 'safe_account',
        },
      }
    );

    expect(toHex(holdings[0].takerAddress)).toBe(
      '0x0000000000000000000000002222222222222222222222222222222222222222'
    );
    expect(toHex(holdings[0].receiverAddress)).toBe(
      '0x0000000000000000000000002222222222222222222222222222222222222222'
    );
    expect(toHex(holdings[1].takerAddress)).toBe(
      '0x0000000000000000000000003333333333333333333333333333333333333333'
    );
    expect(toHex(holdings[1].receiverAddress)).toBe(
      '0x0000000000000000000000003333333333333333333333333333333333333333'
    );
  });
});

describe('hasDestinationChainSourceSwapOutput', () => {
  it('detects when same-chain source swaps output to a non-EOA execution target', () => {
    expect(
      hasDestinationChainSourceSwapOutput(
        [{ chainID: SUPPORTED_CHAINS.HYPEREVM }],
        {
          [SUPPORTED_CHAINS.HYPEREVM]: {
            address: '0x3333333333333333333333333333333333333333',
            entryPoint: null,
            mode: 'safe_account',
          },
        },
        SUPPORTED_CHAINS.HYPEREVM,
        '0x1111111111111111111111111111111111111111'
      )
    ).toBe(true);
  });

  it('does not force destination execution when output already lands on the EOA', () => {
    expect(
      hasDestinationChainSourceSwapOutput(
        [{ chainID: SUPPORTED_CHAINS.HYPEREVM }],
        {
          [SUPPORTED_CHAINS.HYPEREVM]: {
            address: '0x1111111111111111111111111111111111111111',
            entryPoint: null,
            mode: '7702',
          },
        },
        SUPPORTED_CHAINS.HYPEREVM,
        '0x1111111111111111111111111111111111111111'
      )
    ).toBe(false);
  });
});

// USDC addresses on chains we use across scenarios. COT = USDC.
const USDC_BASE: Hex = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ARBITRUM: Hex = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const USDC_HYPEREVM: Hex = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';

// USDT addresses (bridgeable knownToken family — same canonical symbol across chains).
const USDT_ARBITRUM: Hex = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
const USDT_OPTIMISM: Hex = '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58';

// Production stores native balances under EADDRESS (see swap/sort.ts) — match the convention
// in fixtures so resolveSourceBalances finds the source.
const NATIVE: Hex = '0x0000000000000000000000000000000000000000';
const NATIVE_EADDRESS: Hex = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Non-COT placeholder ERC20 addresses (valid hex, distinct per chain).
const NONCOT_BASE: Hex = '0xeeee0000000000000000000000000000babe0001';
const NONCOT_ARBITRUM: Hex = '0xeeee00000000000000000000000000000abb0001';
const NONCOT_HYPEREVM: Hex = '0xeeee0000000000000000000000000000face0001';

const COT_PER_CHAIN: Record<number, Hex> = {
  [SUPPORTED_CHAINS.BASE]: USDC_BASE,
  [SUPPORTED_CHAINS.ARBITRUM]: USDC_ARBITRUM,
  [SUPPORTED_CHAINS.HYPEREVM]: USDC_HYPEREVM,
};

const oraclePrices = [
  makeOraclePrice(SUPPORTED_CHAINS.BASE, USDC_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.BASE, NONCOT_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM),
  makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM),
];

// Helpers to assert the on-the-wire QuoteRequest carries the right addresses.
const lower = (s: Hex) => s.toLowerCase();
const containsAddrFragment = (raw: Uint8Array, addr: Hex) =>
  lower(toHex(raw)).includes(lower(addr).slice(2));

// Source-side: taker AND receiver are both populated and both equal the per-chain wrapper.
// (Output stays at the wrapper for the bridge step to consume — the two roles collapse to the
// same address today, but each is set explicitly per the wrapper API contract.)
const assertSourceCalls = (calls: ReturnType<typeof partitionCalls>['sourceCalls'], taker: Hex) => {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(containsAddrFragment(call.userAddress, taker)).toBe(true);
    expect(call.receiverAddress).toBeDefined();
    expect(containsAddrFragment(call.receiverAddress!, taker)).toBe(true);
  }
};

const assertSourceCallsByChain = (
  calls: ReturnType<typeof partitionCalls>['sourceCalls'],
  takerByChain: Record<number, Hex>
) => {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    const taker = takerByChain[Number(call.chain.chainID)];
    expect(taker, `no taker configured for chain ${call.chain.chainID}`).toBeDefined();
    expect(containsAddrFragment(call.userAddress, taker)).toBe(true);
    expect(call.receiverAddress).toBeDefined();
    expect(containsAddrFragment(call.receiverAddress!, taker)).toBe(true);
  }
};

const assertDestinationCalls = (
  calls: ReturnType<typeof partitionCalls>['destinationCalls'],
  taker: Hex,
  receiver: Hex
) => {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(containsAddrFragment(call.userAddress, taker)).toBe(true);
    expect(call.receiverAddress).toBeDefined();
    expect(containsAddrFragment(call.receiverAddress!, receiver)).toBe(true);
  }
};

const assertNoDestinationCalls = (calls: ReturnType<typeof partitionCalls>['destinationCalls']) => {
  expect(calls.length).toBe(0);
};

describe('aggregator address routing through determineSwapRoute', () => {
  it('1. single 7702 src → Safe dst (Base → HyperEVM)', async () => {
    const { aggregator, vscClient } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: NONCOT_HYPEREVM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')],
      oraclePrices,
    });

    const safeDst = await vscClient.vscGetSafeAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      TEST_EPHEMERAL
    );
    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.HYPEREVM,
      destToken: NONCOT_HYPEREVM,
      cotPerChain: COT_PER_CHAIN,
    });
    assertSourceCalls(sourceCalls, TEST_EPHEMERAL);
    assertDestinationCalls(destinationCalls, safeDst.address, TEST_EOA);
  });

  it('2. single 7702 src → 7702 dst (Base → Arbitrum)', async () => {
    const { aggregator } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')],
      oraclePrices,
    });

    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: NONCOT_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    assertSourceCalls(sourceCalls, TEST_EPHEMERAL);
    assertDestinationCalls(destinationCalls, TEST_EPHEMERAL, TEST_EOA);
  });

  it('3. single Safe src → 7702 dst (HyperEVM → Arbitrum)', async () => {
    const { aggregator, vscClient } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: NONCOT_HYPEREVM }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '100')],
      oraclePrices,
    });

    const safeSrc = await vscClient.vscGetSafeAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      TEST_EPHEMERAL
    );
    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: NONCOT_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    assertSourceCallsByChain(sourceCalls, { [SUPPORTED_CHAINS.HYPEREVM]: safeSrc.address });
    assertDestinationCalls(destinationCalls, TEST_EPHEMERAL, TEST_EOA);
  });

  it('4. multi-source all-7702 → Safe dst (Base + Arbitrum → HyperEVM)', async () => {
    const { aggregator, vscClient } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [
          { chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE },
          { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: NONCOT_ARBITRUM },
        ],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: NONCOT_HYPEREVM,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '50'),
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '50'),
      ],
      oraclePrices,
    });

    const safeDst = await vscClient.vscGetSafeAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      TEST_EPHEMERAL
    );
    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.HYPEREVM,
      destToken: NONCOT_HYPEREVM,
      cotPerChain: COT_PER_CHAIN,
    });
    assertSourceCallsByChain(sourceCalls, {
      [SUPPORTED_CHAINS.BASE]: TEST_EPHEMERAL,
      [SUPPORTED_CHAINS.ARBITRUM]: TEST_EPHEMERAL,
    });
    assertDestinationCalls(destinationCalls, safeDst.address, TEST_EOA);
  });

  it('5. multi-source mix (7702 + Safe) → 7702 dst (Base + HyperEVM → Arbitrum)', async () => {
    const { aggregator, vscClient } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [
          { chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE },
          { chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: NONCOT_HYPEREVM },
        ],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '50'),
        makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '50'),
      ],
      oraclePrices,
    });

    const safeSrc = await vscClient.vscGetSafeAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      TEST_EPHEMERAL
    );
    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: NONCOT_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    assertSourceCallsByChain(sourceCalls, {
      [SUPPORTED_CHAINS.BASE]: TEST_EPHEMERAL,
      [SUPPORTED_CHAINS.HYPEREVM]: safeSrc.address,
    });
    assertDestinationCalls(destinationCalls, TEST_EPHEMERAL, TEST_EOA);
  });

  it('6. same-chain swap on 7702 (Arbitrum non-COT → Arbitrum non-COT-prime)', async () => {
    const altOnArb: Hex = '0xeeee0000000000000000000000000000a1a10001';
    const { aggregator } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: NONCOT_ARBITRUM }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: altOnArb,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '100')],
      oraclePrices: [...oraclePrices, makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, altOnArb)],
    });

    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: altOnArb,
      cotPerChain: COT_PER_CHAIN,
    });
    // Source quote happens on src chain. Destination quote happens on dst chain (same chain here).
    if (sourceCalls.length > 0) assertSourceCalls(sourceCalls, TEST_EPHEMERAL);
    if (destinationCalls.length > 0)
      assertDestinationCalls(destinationCalls, TEST_EPHEMERAL, TEST_EOA);
  });

  it('7. direct EOA dst (toToken == COT) issues no destination quote', async () => {
    const { aggregator } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: USDC_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')],
      oraclePrices,
    });

    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: USDC_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    assertSourceCalls(sourceCalls, TEST_EPHEMERAL);
    assertNoDestinationCalls(destinationCalls);
  });

  // ===== EXACT_OUT scenarios =====
  // determineDestinationSwaps emits TWO QuoteRequests on the destination chain:
  //   1. Preliminary price survey: input=destToken, output=COT  (sizes the input amount)
  //   2. Final buy quote(s): input=COT, output=destToken         (converges on a quote)
  // Both must carry takerAddress = destination wrapper and receiverAddress = EOA. The earlier
  // EXACT_IN-only tests would not have caught a regression in (1) because the partition heuristic
  // misclassified preliminary quotes as source.

  it('8. EXACT_OUT: single 7702 src → Safe dst (Base → HyperEVM)', async () => {
    const { aggregator, vscClient } = await runDetermineSwapRoute({
      input: exactOutInput({
        fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: NONCOT_HYPEREVM,
        toAmount: 50_000_000n, // 50 of a 6-dec token
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '500')],
      oraclePrices,
    });

    const safeDst = await vscClient.vscGetSafeAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      TEST_EPHEMERAL
    );
    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.HYPEREVM,
      destToken: NONCOT_HYPEREVM,
      cotPerChain: COT_PER_CHAIN,
    });
    // Both the preliminary survey and the buy quote must be classified as destination.
    expect(destinationCalls.length).toBeGreaterThanOrEqual(2);
    assertSourceCalls(sourceCalls, TEST_EPHEMERAL);
    assertDestinationCalls(destinationCalls, safeDst.address, TEST_EOA);
  });

  it('9. EXACT_OUT: single 7702 src → 7702 dst (Base → Arbitrum)', async () => {
    const { aggregator } = await runDetermineSwapRoute({
      input: exactOutInput({
        fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
        toAmount: 50_000_000n,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '500')],
      oraclePrices,
    });

    const { sourceCalls, destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: NONCOT_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    expect(destinationCalls.length).toBeGreaterThanOrEqual(2);
    assertSourceCalls(sourceCalls, TEST_EPHEMERAL);
    assertDestinationCalls(destinationCalls, TEST_EPHEMERAL, TEST_EOA);
  });
});

// Helper: pluck the destination EXACT_IN buy quote (input == COT on dst chain).
const findDstExactInBuyQuote = (calls: ReturnType<typeof partitionCalls>['destinationCalls']) =>
  calls.find((c) => c.type === 0 /* EXACT_IN */) as
    | ((typeof calls)[number] & { type: 0; inputAmount: bigint })
    | undefined;

describe('SwapRoute.combined flag', () => {
  // Alt non-COT token on each chain to use as a destination (kHYPE → USDH equivalent).
  const ALT_HYPEREVM: Hex = '0xeeee0000000000000000000000000000face0002';
  const ALT_ARBITRUM: Hex = '0xeeee00000000000000000000000000000abb0002';

  const oraclePricesWithAlts = [
    ...oraclePrices,
    makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, ALT_HYPEREVM),
    makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, ALT_ARBITRUM),
  ];

  it('flags same-chain Safe-wrapper case as combined (HyperEVM non-COT → HyperEVM alt)', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: NONCOT_HYPEREVM }],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: ALT_HYPEREVM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '100')],
      oraclePrices: oraclePricesWithAlts,
    });

    expect(route.bridge).toBeNull();
    expect(route.combined).toBe(true);
    // Source produced output to the same wrapper that the destination swap pulls from.
    const srcExec = route.source.executions[SUPPORTED_CHAINS.HYPEREVM];
    expect(srcExec).toBeDefined();
    expect(srcExec.address.toLowerCase()).toBe(route.destination.execution.address.toLowerCase());
  });

  it('flags same-chain 7702 case as combined (Arbitrum non-COT → Arbitrum alt)', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: NONCOT_ARBITRUM }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: ALT_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM, '100')],
      oraclePrices: oraclePricesWithAlts,
    });

    expect(route.bridge).toBeNull();
    expect(route.combined).toBe(true);
    expect(route.source.executions[SUPPORTED_CHAINS.ARBITRUM].address.toLowerCase()).toBe(
      route.destination.execution.address.toLowerCase()
    );
  });

  it('flags same-chain dst==COT (source swap + sweep only) as combined', async () => {
    // kHYPE → USDC on HyperEVM: source produces COT at wrapper, no dst aggregator call,
    // dst handler just sweeps. Whole flow stays on one wrapper → still combinable.
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: NONCOT_HYPEREVM }],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: USDC_HYPEREVM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '100')],
      oraclePrices: oraclePricesWithAlts,
    });

    expect(route.bridge).toBeNull();
    expect(route.combined).toBe(true);
    expect(route.destination.swap.tokenSwap).toBeNull();
  });

  it('does NOT flag bridge-required case as combined (Base → Arbitrum)', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')],
      oraclePrices,
    });

    expect(route.bridge).not.toBeNull();
    expect(route.combined).toBe(false);
  });

  it('does NOT flag pure-COT-source-on-dst-chain (no source swap) as combined', async () => {
    // USDC HyperEVM → ALT_HYPEREVM: no source swap (src token is COT). Falls outside v1 scope —
    // single dst swap is already one VSC tx; existing dst handler is sufficient.
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: USDC_HYPEREVM }],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: ALT_HYPEREVM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM, '100')],
      oraclePrices: oraclePricesWithAlts,
    });

    expect(route.bridge).toBeNull();
    expect(route.source.swaps.length).toBe(0);
    expect(route.combined).toBe(false);
  });
});

describe('Combined-swap destination input buffer', () => {
  const ALT_HYPEREVM: Hex = '0xeeee0000000000000000000000000000face0003';

  const oraclePricesWithAlt = [
    ...oraclePrices,
    makeOraclePrice(SUPPORTED_CHAINS.HYPEREVM, ALT_HYPEREVM),
  ];

  it('reduces dst aggregator input by 0.5% when combined=true (EXACT_IN)', async () => {
    // Source NONCOT_HYPEREVM 100 → identity quote → 100 USDC at wrapper.
    // Combined buffer 0.5% → dst aggregator is asked to swap 99.5 USDC.
    const { aggregator } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.HYPEREVM, tokenAddress: NONCOT_HYPEREVM }],
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: ALT_HYPEREVM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.HYPEREVM, NONCOT_HYPEREVM, '100')],
      oraclePrices: oraclePricesWithAlt,
    });

    const { destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.HYPEREVM,
      destToken: ALT_HYPEREVM,
      cotPerChain: COT_PER_CHAIN,
    });
    const buyQuote = findDstExactInBuyQuote(destinationCalls);
    expect(buyQuote).toBeDefined();
    // 100 * 10^6 * (1 - 0.005) = 99_500_000
    expect(buyQuote!.inputAmount).toBe(99_500_000n);
  });

  it('applies EXACT_IN srcBuffer (0.5%, capped at $1) when combined=false (bridge case)', async () => {
    // Base NONCOT 100 → bridge → Arbitrum: source produces 100 USDC, mock bridge fee = 0,
    // srcBuffer = min(100 * 0.005, $1) = 0.5 → dst aggregator input = 99.5 USDC. The
    // under-sized dst input keeps the dst swap funded if a source leg re-quotes lower.
    const { aggregator } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '100')],
      oraclePrices,
    });

    const { destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: NONCOT_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    const buyQuote = findDstExactInBuyQuote(destinationCalls);
    expect(buyQuote).toBeDefined();
    // 100 USDC - 0.5 USDC (srcBuffer) = 99.5 USDC
    expect(buyQuote!.inputAmount).toBe(99_500_000n);
  });

  it('caps EXACT_IN srcBuffer at $1 for large source amounts', async () => {
    // Base NONCOT 500 → bridge → Arbitrum: 0.5% would be $2.50 but the cap is $1, so
    // srcBuffer = $1 → dst aggregator input = 499 USDC.
    const { aggregator } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '500')],
      oraclePrices,
    });

    const { destinationCalls } = partitionCalls(aggregator.calls, {
      destChainId: SUPPORTED_CHAINS.ARBITRUM,
      destToken: NONCOT_ARBITRUM,
      cotPerChain: COT_PER_CHAIN,
    });
    const buyQuote = findDstExactInBuyQuote(destinationCalls);
    expect(buyQuote).toBeDefined();
    // 500 USDC - $1 (srcBuffer cap) = 499 USDC
    expect(buyQuote!.inputAmount).toBe(499_000_000n);
  });
});

// Regression: in _exactOutRoute, autoSelectSources is sized against sourceSwapOutputRequired
// (= bridgeOutput + estimatedBridgeFees + srcBuffer). When the user holds dst-chain COT in the
// (bridgeOutput, sourceSwapOutputRequired) window, autoSelectSources eats the whole dst-chain
// holding (it's less than the over-budget target) and selects a tiny non-dst top-up to cover the
// fee + buffer headroom. dst-chain COT then exceeds bridgeOutput, and the calc
//   bridgeAmount = bridgeOutput - dstTotalCOTAmount
// produces a NEGATIVE bridgeAmount that propagates into the bridge intent.
//
// Numeric setup (USDC = COT, 6-dec dest token):
//   toAmount = 50_000_000  (50 USDC equivalent)
//   determineDestinationSwaps multiplies by safetyMultiplier=1.025:
//     tokenSwap.quote.input.amount = 50 * 1.025 = 51.25
//   destination.inputAmount.min = 51.25
//   destBuffer = min(51.25 * 10%, $2) = $2     → bridgeOutput = 53.25
//   estimatedBridgeFees = 0 (mock feeStore returns zero)
//   srcBuffer = min(53.25 * 2%, $1) = $1       → sourceSwapOutputRequired = 54.25
// dst-chain USDC = 53.5 sits inside (53.25, 54.25). A non-dst COT with any spare amount
// forces `isBridgeRequired` to become true after the buggy over-pull, which triggers the
// negative bridgeAmount.
describe('EXACT_OUT bridge amount sanity (negative-bridge regression)', () => {
  it('skips the bridge when dst-chain COT alone covers bridgeOutput', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactOutInput({
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: NONCOT_HYPEREVM,
        toAmount: 50_000_000n,
      }),
      preloadedBalances: [
        // dst-chain COT in the unsafe (bridgeOutput, sourceSwapOutputRequired) window
        makeBalance(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM, '53.5', 6, 'USDC'),
        // non-dst COT that should NOT end up in the route once the fix lands
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM, '50', 6, 'USDC'),
      ],
      oraclePrices,
    });

    // dst-chain alone covers bridgeOutput — no bridge step should be built.
    expect(route.bridge).toBeNull();

    // No non-dst entries should remain in assetsUsed: the tiny Arbitrum top-up was an
    // artifact of autoSelectSources over-budgeting and must be dropped.
    const nonDstAssets = route.extras.assetsUsed.filter(
      (a) => a.chainID !== SUPPORTED_CHAINS.HYPEREVM
    );
    expect(nonDstAssets).toEqual([]);
  });

  it('still bridges when dst-chain COT is below bridgeOutput', async () => {
    // Sanity: the fix must not regress the common case where dst-chain genuinely can't
    // cover bridgeOutput. Bridge should be produced with a positive amount.
    const { route } = await runDetermineSwapRoute({
      input: exactOutInput({
        toChainId: SUPPORTED_CHAINS.HYPEREVM,
        toTokenAddress: NONCOT_HYPEREVM,
        toAmount: 50_000_000n,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.HYPEREVM, USDC_HYPEREVM, '10', 6, 'USDC'),
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM, '100', 6, 'USDC'),
      ],
      oraclePrices,
    });

    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.amount.isNegative()).toBe(false);
    expect(route.bridge!.amount.gt(0)).toBe(true);
  });
});

// Regression: EXACT_IN multi-source COT where one source sits on the destination chain.
// Scenario: user holds USDC on Arbitrum (dst chain) + USDC on Base, wants ETH-like on Arbitrum.
// The dst-chain USDC lands at the destination wrapper via `eoaToDestinationAccount` and must
// NOT be included in the bridge output target. createBridgeRFF skips dst-chain assets when
// sourcing the borrow, so a bridge whose `amount` includes the dst-chain portion can never
// be fully sourced and throws "Insufficient balance to proceed" at execution time (after the
// dst permit signature is already collected — matches the reported "1 approval then fails").
describe('EXACT_IN bridge amount excludes dst-chain COT', () => {
  it('bridge.amount = non-dst COT only (not total COT) for multi-source with dst-chain COT', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [
          { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: USDC_ARBITRUM },
          { chainId: SUPPORTED_CHAINS.BASE, tokenAddress: USDC_BASE },
        ],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM, '5', 6, 'USDC'),
        makeBalance(SUPPORTED_CHAINS.BASE, USDC_BASE, '5', 6, 'USDC'),
      ],
      oraclePrices,
    });

    expect(route.bridge).not.toBeNull();
    // Mock fee store is zero. Bridge should deliver only the Base portion (5) to the dst
    // wrapper; the Arb portion (5) goes via eoaToDestinationAccount and must NOT be counted
    // in the bridge output target.
    expect(route.bridge!.amount.toFixed()).toBe('5');
    // eoaToDestinationAccount must transfer the user's dst-chain USDC to the wrapper so the
    // dst swap can consume both the EOA's dst-chain USDC and the bridged Base USDC.
    expect(route.destination.eoaToDestinationAccount).not.toBeNull();
    expect(route.destination.eoaToDestinationAccount!.amount).toBe(5_000_000n);
    // The dst swap must consume the full combined COT (Arb + Base) — verifying the
    // dst-chain COT is still surfaced for use downstream, not silently dropped by the fix.
    //   wrapper input = eoaToDestinationAccount (5 USDC_arb) + bridge output (5 USDC_base)
    //                 = 10 USDC → dst aggregator is asked to swap 10 USDC.
    expect(route.destination.swap.tokenSwap).not.toBeNull();
    expect(route.destination.swap.tokenSwap!.quote.input.amountRaw).toBe(10_000_000n);
  });
});

// EXACT_OUT counterpart: verify the symmetric multi-source-with-dst-chain-COT scenario also
// produces a bridge amount that EXCLUDES the dst-chain USDC. `_exactOutRoute` already has the
// deduction via `bridgeOutput.minus(dstTotalCOTAmount)` and `buildExactOutSourceAssets` keeps
// dst-chain entries out of bridgeAssets; this test pins that behavior so a future refactor
// doesn't regress it back into the same bug class as EXACT_IN.
describe('EXACT_OUT bridge amount excludes dst-chain COT', () => {
  it('bridge.amount = non-dst portion only when both dst-chain and non-dst COT are sourced', async () => {
    // toAmount = 8 NONCOT (8 * 10^6). With mock identity quotes:
    //   destination.inputAmount.min = 8 * 1.025 (safetyMultiplier) = 8.2 USDC
    //   destBuffer = min(8.2 * 10%, $2) = $0.82 → bridgeOutput = 9.02 USDC
    // selectSources prefers dst-chain stablecoins (priority 2) → eats all 5 USDC_ARB, then
    // tops up the remaining ~4 USDC from USDC_BASE.
    //   bridgeAmount = bridgeOutput (9.02) − dstTotalCOTAmount (5) ≈ 4.02 USDC
    const { route } = await runDetermineSwapRoute({
      input: exactOutInput({
        fromSources: [
          { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: USDC_ARBITRUM },
          { chainId: SUPPORTED_CHAINS.BASE, tokenAddress: USDC_BASE },
        ],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
        toAmount: 8_000_000n,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM, '5', 6, 'USDC'),
        makeBalance(SUPPORTED_CHAINS.BASE, USDC_BASE, '100', 6, 'USDC'),
      ],
      oraclePrices,
    });

    expect(route.bridge).not.toBeNull();
    // The bridged amount must be strictly less than the user's USDC_BASE balance: if the
    // dst-chain USDC_ARB were (incorrectly) counted in the bridge output target the value
    // would balloon past what Base alone can supply and createBridgeRFF would throw.
    expect(route.bridge!.amount.gt(0)).toBe(true);
    expect(route.bridge!.amount.lt(5)).toBe(true);
    // eoaToDestinationAccount must carry the full USDC_ARB balance that selectSources used.
    expect(route.destination.eoaToDestinationAccount).not.toBeNull();
    expect(route.destination.eoaToDestinationAccount!.amount).toBe(5_000_000n);
    // Sanity: bridgeAssets must not include the dst-chain entry — only Base should remain.
    expect(route.bridge!.assets.every((a) => a.chainID !== SUPPORTED_CHAINS.ARBITRUM)).toBe(true);
    // Dst-chain COT must end up at the destination wrapper and feed the dst swap.
    // EXACT_OUT sizes the bridge output to `inputAmount.max` = dst aggregator input +
    // destBuffer (min 10%, capped at $2). Total COT landing at the wrapper is therefore
    //   bridgeAmount (from bridge) + eoaToDestinationAccount (from dst-chain) = inputAmount.max
    // — i.e. the dst-chain USDC_ARB IS being consumed downstream, not silently dropped.
    expect(route.destination.swap.tokenSwap).not.toBeNull();
    const wrapperTotal = route.bridge!.amount.plus(5);
    expect(wrapperTotal.toFixed()).toBe(route.destination.inputAmount.max.toFixed());
  });
});

// EXACT_IN same-token bridge: when source(s) and destination share a canonical bridgeable
// token symbol (e.g. USDT → USDT, ETH → ETH), skip the COT round-trip entirely. The bridge
// moves the token directly via the ephemeral pipeline; no source swap, no destination swap.
describe('EXACT_IN same-token bridge (skip COT round-trip)', () => {
  it('USDT_arb → USDT_op: bridges USDT directly with no swaps', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [{ chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: USDT_ARBITRUM }],
        toChainId: SUPPORTED_CHAINS.OPTIMISM,
        toTokenAddress: USDT_OPTIMISM,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDT_ARBITRUM, '10', 6, 'USDT')],
      oraclePrices: [
        ...oraclePrices,
        makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, USDT_ARBITRUM),
        makeOraclePrice(SUPPORTED_CHAINS.OPTIMISM, USDT_OPTIMISM),
      ],
    });

    expect(route.source.swaps).toEqual([]);
    expect(route.destination.swap.tokenSwap).toBeNull();
    expect(route.destination.swap.gasSwap).toBeNull();
    expect(route.bridge).not.toBeNull();
    // Bridge moves USDT, not COT (USDC).
    expect(route.bridge!.tokenAddress.toLowerCase()).toBe(USDT_OPTIMISM.toLowerCase());
    // Bridge sources the USDT on Arbitrum.
    expect(route.bridge!.assets).toHaveLength(1);
    expect(route.bridge!.assets[0].contractAddress.toLowerCase()).toBe(USDT_ARBITRUM.toLowerCase());
    expect(route.bridge!.assets[0].eoaBalance.toFixed()).toBe('10');
    // Recipient = EOA (direct delivery, no sweep needed).
    expect(route.bridge!.recipientAddress.toLowerCase()).toBe(TEST_EOA.toLowerCase());
    expect(route.destination.execution.mode).toBe('direct_eoa');
  });

  it('native ETH multi-source (Arb + Base) → native ETH on Optimism: bridges native, no swaps', async () => {
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [
          { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: NATIVE },
          { chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NATIVE },
        ],
        toChainId: SUPPORTED_CHAINS.OPTIMISM,
        toTokenAddress: NATIVE,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, NATIVE_EADDRESS, '1', 18, 'ETH'),
        makeBalance(SUPPORTED_CHAINS.BASE, NATIVE_EADDRESS, '1', 18, 'ETH'),
      ],
      oraclePrices: [
        ...oraclePrices,
        makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, NATIVE),
        makeOraclePrice(SUPPORTED_CHAINS.BASE, NATIVE),
        makeOraclePrice(SUPPORTED_CHAINS.OPTIMISM, NATIVE),
      ],
    });

    expect(route.source.swaps).toEqual([]);
    expect(route.destination.swap.tokenSwap).toBeNull();
    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.tokenAddress.toLowerCase()).toBe(NATIVE);
    expect(route.bridge!.assets).toHaveLength(2);
    expect(route.bridge!.amount.toFixed()).toBe('2');
    expect(route.bridge!.recipientAddress.toLowerCase()).toBe(TEST_EOA.toLowerCase());
  });

  it('mixed family (USDT + USDC → USDT) falls back to COT flow with source swap', async () => {
    // Sources span two canonical symbols (USDT, USDC). The same-token fast-path requires
    // every source to share the dst symbol — so this must fall back to the COT pipeline,
    // which swaps USDC → USDT at the dst chain (or USDT → USDC at the source).
    const { route } = await runDetermineSwapRoute({
      input: exactInInput({
        from: [
          { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: USDT_ARBITRUM },
          { chainId: SUPPORTED_CHAINS.ARBITRUM, tokenAddress: USDC_ARBITRUM },
        ],
        toChainId: SUPPORTED_CHAINS.OPTIMISM,
        toTokenAddress: USDT_OPTIMISM,
      }),
      preloadedBalances: [
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDT_ARBITRUM, '5', 6, 'USDT'),
        makeBalance(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM, '5', 6, 'USDC'),
      ],
      oraclePrices: [
        ...oraclePrices,
        makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, USDT_ARBITRUM),
        makeOraclePrice(SUPPORTED_CHAINS.OPTIMISM, USDT_OPTIMISM),
      ],
    });

    // USDT source must be swapped to USDC; bridge runs in USDC; dst swap converts back to USDT.
    expect(route.source.swaps.length).toBeGreaterThan(0);
    expect(route.destination.swap.tokenSwap).not.toBeNull();
  });
});
