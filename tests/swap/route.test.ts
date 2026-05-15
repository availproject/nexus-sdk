import { type Hex, toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { type Chain, SUPPORTED_CHAINS, type VSCClient } from '../../src/commons';
import type { FlatBalance } from '../../src/swap/data';
import {
  hasDestinationChainSourceSwapOutput,
  requiresSafeAccount,
  resolveDestinationExecution,
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

describe('resolveDestinationExecution', () => {
  it('uses the deterministic Safe account on HyperEVM when a destination swap is required', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn().mockResolvedValue({
        address: '0x3333333333333333333333333333333333333333',
        factoryAddress: '0x4444444444444444444444444444444444444444',
      }),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: {
        ...baseChain,
        id: SUPPORTED_CHAINS.HYPEREVM,
        name: 'HyperEVM',
        pectraUpgradeSupport: false,
      },
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: true,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).toHaveBeenCalledWith(
      SUPPORTED_CHAINS.HYPEREVM,
      '0x2222222222222222222222222222222222222222'
    );
    expect(result).toEqual({
      address: '0x3333333333333333333333333333333333333333',
      entryPoint: null,
      factoryAddress: '0x4444444444444444444444444444444444444444',
      mode: 'safe_account',
    });
  });

  it('keeps the ephemeral executor on 7702 destination paths', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: baseChain,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: true,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      entryPoint: null,
      mode: '7702',
    });
  });

  it('keeps direct-to-eoa destination transfers off the smart-account path when no destination swap is needed', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: {
        ...baseChain,
        id: SUPPORTED_CHAINS.HYPEREVM,
        name: 'HyperEVM',
        pectraUpgradeSupport: false,
      },
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: false,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x1111111111111111111111111111111111111111',
      entryPoint: null,
      mode: 'direct_eoa',
    });
  });

  it('routes no-destination-execution transfers directly to the EOA on 7702 chains as well', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: baseChain,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: false,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x1111111111111111111111111111111111111111',
      entryPoint: null,
      mode: 'direct_eoa',
    });
  });
});

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

  it('does NOT apply combined buffer when combined=false (bridge case)', async () => {
    // Base NONCOT 100 → bridge → Arbitrum: dst input is sourceOutput minus bridge fee.
    // The combined buffer must NOT be applied here. We assert the input is not the
    // 99.5% multiple that the combined path would produce.
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
    // Whatever the bridge-fee math produces, it must not coincidentally equal the combined
    // buffer's 99_500_000n. (If feeStore mock returns zero fee the input would be 100_000_000n.)
    expect(buyQuote!.inputAmount).not.toBe(99_500_000n);
  });
});
