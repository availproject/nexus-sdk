import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { formatUnits, parseUnits, type Hex } from 'viem';

vi.mock('../../src/swap/route', () => ({
  determineSwapRoute: vi.fn(),
}));

vi.mock('../../src/swap/aggregators', () => ({
  createAggregators: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/swap/balance/swap-balances', () => ({
  selectSwapSources: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/swap/preflight', () => ({
  buildSwapPreflight: vi.fn(),
}));

import { calculateMaxForSwap } from '../../src/swap/max';
import { EADDRESS } from '../../src/swap/constants';
import { ZERO_ADDRESS } from '../../src/domain/constants/addresses';
import { determineSwapRoute } from '../../src/swap/route';
import { buildSwapPreflight } from '../../src/swap/preflight';
import { SwapMode } from '../../src/swap/types';
import type { SwapRoute, SwapMaxParams, SwapParams } from '../../src/swap/types';
import type { TokenInfo } from '../../src/domain';
import type { QuoteResponse, Aggregator } from '../../src/swap/aggregators/types';
import { CurrencyID } from '../../src/swap/cot';
import { makeMiddlewareClient } from '../helpers/middleware-client';
import {
  ARB_CHAIN,
  USDC_ARB,
  WETH,
  makeDstTokenInfo,
  makeSwapChainList,
  makeSwapPreflight,
} from '../helpers/swap';

type MaxOptions = Parameters<typeof calculateMaxForSwap>[1];

const makeQuote = (inputRaw: bigint, outputRaw: bigint): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: {
    input: {
      contractAddress: USDC_ARB,
      amount: new Decimal(inputRaw.toString()).div(new Decimal(10).pow(6)).toString(),
      amountRaw: inputRaw,
      decimals: 6,
      value: 3000,
      symbol: 'USDC',
    },
    output: {
      contractAddress: WETH,
      amount: new Decimal(outputRaw.toString()).div(new Decimal(10).pow(18)).toString(),
      amountRaw: outputRaw,
      decimals: 18,
      value: 3000,
      symbol: 'WETH',
    },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: inputRaw, decimals: 6, symbol: 'USDC' },
  aggregator: {} as Aggregator,
});

// A minimal source-swap quote whose only load-bearing field for the haircut is `output.value`
// (the USD basis) — used to exercise the quote-implied-price scaling in the tokenSwap-null branch.
const makeOutputValueQuote = (
  outputValue: number,
  outputRaw: bigint,
  outputContract: Hex = WETH,
  outputDecimals = 18
): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: {
    input: { contractAddress: USDC_ARB, amount: '0', amountRaw: 0n, decimals: 6, value: 0, symbol: 'USDC' },
    output: {
      contractAddress: outputContract,
      amount: formatUnits(outputRaw, outputDecimals),
      amountRaw: outputRaw,
      decimals: outputDecimals,
      value: outputValue,
      symbol: 'X',
    },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 0n, decimals: 6, symbol: 'USDC' },
  aggregator: {} as Aggregator,
});

const makeRoute = (overrides?: {
  destinationMax?: Decimal;
  tokenSwap?: QuoteResponse | null;
  dstTokenInfo?: TokenInfo;
  sourceSwaps?: QuoteResponse[];
  oraclePrices?: SwapRoute['extras']['oraclePrices'];
}): SwapRoute => ({
  type: SwapMode.EXACT_IN,
  source: { swaps: overrides?.sourceSwaps ?? [], creationTime: Date.now(), srcBuffer: new Decimal(0) },
  bridge: null,
  destination: {
    chainId: ARB_CHAIN,
    eoaToEphemeral: null,
    inputAmount: {
      min: new Decimal('100'), // 100 USDC
      max: overrides?.destinationMax ?? new Decimal('100'),
    },
    swap: {
      tokenSwap:
        overrides?.tokenSwap !== undefined
          ? overrides.tokenSwap
          : makeQuote(100000000n, 33333333333333333n),
      gasSwap: null,
    },
    getDstSwap: vi.fn().mockResolvedValue(null),
  },
  buffer: { amount: '0' },
  dstTokenInfo: overrides?.dstTokenInfo ?? makeDstTokenInfo(),
  extras: { aggregators: [], oraclePrices: overrides?.oraclePrices ?? [], balances: [], assetsUsed: [] },
  sourceExecutionPaths: new Map(),
});

// A delivered token that is neither the COT nor $1 — for exercising the unit-correct haircut where
// `destination.inputAmount.max` is denominated in the destination token, not USDC.
const TOKEN_X = '0x0000000000000000000000000000000000000abc' as Hex;
const makeTokenXInfo = (): TokenInfo =>
  makeDstTokenInfo({ contractAddress: TOKEN_X, decimals: 18, symbol: 'X', name: 'Token X' });

const makeOraclePrice = (chainId: number, tokenAddress: Hex, priceUsd: number) => ({
  universe: 'EVM' as const,
  chainId,
  tokenAddress,
  tokenSymbol: 'X',
  tokenDecimals: 18,
  priceUsd: new Decimal(priceUsd),
  timestamp: 1,
});

const makeOptions = (): MaxOptions => ({
  chainList: makeSwapChainList(),
  eoaAddress: '0xaaaa' as Hex,
  ephemeralAddress: '0xbbbb' as Hex,
  cotCurrencyId: CurrencyID.USDC,
  middlewareClient: makeMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue([]),
    getOraclePrices: vi.fn().mockResolvedValue([]),
  }),
  // intentExplorerUrl: '',
  // emit: vi.fn(),
});

describe('calculateMaxForSwap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSwapPreflight).mockResolvedValue(makeSwapPreflight());
  });

  it('applies 3% haircut capped at 3 USDC', async () => {
    // 100 USDC available → 3% = 3 USDC → haircut = max(3, 3) = 3 USDC → adjusted = 97 USDC
    const route = makeRoute({ destinationMax: new Decimal('100') });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: WETH };
    const result = await calculateMaxForSwap(input, makeOptions());

    // 97/100 * 33333333333333333 ≈ 32333333333333333
    expect(BigInt(result.maxAmountRaw)).toBeLessThan(33333333333333333n);
    expect(BigInt(result.maxAmountRaw)).toBeGreaterThan(0n);
    expect(result.symbol).toBe('WETH');
    expect(result.decimals).toBe(18);
  });

  it('scales output by adjusted COT / quote input ratio', async () => {
    // 200 USDC, quote: 100 USDC → 0.0333 WETH
    // haircut = max(200*0.03, 3) = max(6, 3) = 6 USDC → adjusted = 194 USDC
    // scale = 194 / 100 = 1.94, adjustedOutput = 1.94 * 0.0333... = ~0.0646... WETH
    const route = makeRoute({
      destinationMax: new Decimal('200'),
      tokenSwap: makeQuote(100000000n, 33333333333333333n),
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: WETH };
    const result = await calculateMaxForSwap(input, makeOptions());

    // scaleFactor = 194_000_000 / 100_000_000 = 1.94
    // adjustedOutput = 33333333333333333 * 1.94 = 64666666666666666
    expect(BigInt(result.maxAmountRaw)).toBeGreaterThan(60000000000000000n);
    expect(BigInt(result.maxAmountRaw)).toBeLessThan(70000000000000000n);
  });

  it('destination IS COT → maxAmount = adjusted COT directly', async () => {
    // When destination token IS USDC (COT), no token swap needed
    const route = makeRoute({
      destinationMax: new Decimal('100'),
      tokenSwap: null, // no swap needed
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB };
    const result = await calculateMaxForSwap(input, makeOptions());

    // 100 USDC - 3 USDC haircut = 97 USDC = 97_000_000 raw
    expect(BigInt(result.maxAmountRaw)).toBe(97000000n);
    expect(result.symbol).toBe('USDC');
    expect(result.decimals).toBe(6);
  });

  it('maxAmountRaw is denominated at the resolved destination decimals, consistent with maxAmount', async () => {
    // Invariant for ANY result: maxAmountRaw === parseUnits(maxAmount, decimals). Here we exercise the
    // COT-direct branch and deliberately make the resolved dst-token decimals (8) differ from the route
    // COT decimals (USDC = 6) to prove maxAmountRaw and maxAmount share one decimal basis (the dst token).
    // On the old code maxAmountRaw used the COT decimals while maxAmount used the dst decimals → mismatch.
    const route = makeRoute({
      destinationMax: new Decimal('100'),
      tokenSwap: null,
      dstTokenInfo: makeDstTokenInfo({
        contractAddress: USDC_ARB,
        decimals: 8,
        symbol: 'USDC',
        name: 'USD Coin',
      }),
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB };
    const result = await calculateMaxForSwap(input, makeOptions());

    expect(result.decimals).toBe(8);
    // 100 - max(3%, 3) = 97 → at 8 decimals = 9_700_000_000
    expect(result.maxAmountRaw).toBe(parseUnits(result.maxAmount, result.decimals));
    expect(result.maxAmountRaw).toBe(9_700_000_000n);
  });

  it('very small amount → haircut = 3 USDC minimum', async () => {
    // 50 USDC → 3% = 1.5 USDC, but min is 3 → haircut = 3 USDC → adjusted = 47
    const route = makeRoute({
      destinationMax: new Decimal('50'),
      tokenSwap: makeQuote(50000000n, 16666666666666666n),
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: WETH };
    const result = await calculateMaxForSwap(input, makeOptions());

    // scaleFactor = 47_000_000 / 50_000_000 = 0.94
    // adjustedOutput = 16666666666666666 * 0.94 = 15666666666666666
    expect(BigInt(result.maxAmountRaw)).toBeGreaterThan(15000000000000000n);
    expect(BigInt(result.maxAmountRaw)).toBeLessThan(16666666666666666n);
  });

  it('very large amount → haircut = 3% (exceeds 3 USDC)', async () => {
    // 10000 USDC → 3% = 300 USDC → haircut = 300 USDC → adjusted = 9700
    const route = makeRoute({
      destinationMax: new Decimal('10000'), // 10000 USDC
      tokenSwap: null,
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB };
    const result = await calculateMaxForSwap(input, makeOptions());

    // 10000 - 300 = 9700 USDC = 9_700_000_000 raw
    expect(BigInt(result.maxAmountRaw)).toBe(9700000000n);
  });

  it('passes preflight-resolved dstTokenInfo into route construction', async () => {
    const resolvedToken: TokenInfo = {
      contractAddress: USDC_ARB,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: 'https://example.com/usdc.png',
    };
    const opts = makeOptions();
    vi.mocked(buildSwapPreflight).mockResolvedValueOnce(
      makeSwapPreflight({ dstTokenInfo: resolvedToken })
    );

    const route = makeRoute();
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB };
    await calculateMaxForSwap(input, opts);

    // Verify determineSwapRoute received dstTokenInfo with resolved decimals
    const routeOptionsArg = vi.mocked(determineSwapRoute).mock.calls[0][1];
    expect(routeOptionsArg.dstTokenInfo.decimals).toBe(6);
    expect(routeOptionsArg.dstTokenInfo.symbol).toBe('USDC');
  });

  it('passes preflight bridgeQuoteResponse into route construction', async () => {
    const bridgeQuoteResponse = {
      fulfillmentBps: 100,
      sources: [
        {
          chainId: ARB_CHAIN,
          tokenAddress: USDC_ARB,
          depositFeeUsd: '1.00',
          depositFeeToken: '1000000',
          depositMayanFeeUsd: '1.00',
          depositMayanFeeToken: '1000000',
        },
      ],
      destination: {
        chainId: ARB_CHAIN,
        tokenAddress: USDC_ARB,
        fulfillmentFeeUsd: '1.50',
        fulfillmentFeeToken: '1500000',
      },
    };
    const opts = makeOptions();
    vi.mocked(buildSwapPreflight).mockResolvedValueOnce(
      makeSwapPreflight({ bridgeQuoteResponse })
    );
    vi.mocked(determineSwapRoute).mockResolvedValue(makeRoute());

    await calculateMaxForSwap(
      { toChainId: ARB_CHAIN, toTokenAddress: WETH },
      opts
    );

    expect(vi.mocked(determineSwapRoute).mock.calls[0][1]).toMatchObject({
      bridgeQuoteResponse,
    });
  });

  it('passes sources restrictions into the synthetic EXACT_IN max route input', async () => {
    const route = makeRoute();
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapMaxParams = {
      toChainId: ARB_CHAIN,
      toTokenAddress: WETH,
      sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
    };

    await calculateMaxForSwap(input, makeOptions());

    const swapInputArg = vi.mocked(determineSwapRoute).mock.calls[0][0];
    expect(swapInputArg).toMatchObject({
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
      },
    });
  });
});

// The `tokenSwap == null` branch delivers whatever `destination.inputAmount.max` is denominated in —
// USDC in the default COT-dst flow, but the destination token itself on the fast paths (Path A →
// toToken, same-token bridge → family token). A bare `− $3` corrupts those (3 ETH, not $3), so the
// haircut is kept in USD space and the floor converted at the delivered token's price. See swap.md §5.
describe('calculateMaxForSwap — unit-correct haircut (tokenSwap == null)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSwapPreflight).mockResolvedValue(makeSwapPreflight());
  });

  it('USDC destination stays byte-identical when source swaps are present (usdBasis ≈ delivered)', async () => {
    // delivered 100 USDC, one source swap that produced ~$100 → usdBasis 100.
    // haircut = max(3% of 100, $3) = 3 → adjusted = 100 × (100−3)/100 = 97 USDC (== old `100 − 3`).
    const route = makeRoute({
      destinationMax: new Decimal('100'),
      tokenSwap: null,
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
      sourceSwaps: [makeOutputValueQuote(100, 100_000_000n, USDC_ARB, 6)],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB }, makeOptions());
    expect(result.maxAmountRaw).toBe(97_000_000n);
  });

  it('scales the $3 floor through the quote-implied price for a non-COT delivered token', async () => {
    // delivered 1 X; source swaps produced $10 of value → usdBasis 10 (implied $10/X).
    // haircutUsd = max(10×0.03, 3) = 3 → adjusted = 1 × (10−3)/10 = 0.7 X. NOT 1 − 3 = −2.
    const route = makeRoute({
      destinationMax: new Decimal('1'),
      tokenSwap: null,
      dstTokenInfo: makeTokenXInfo(),
      sourceSwaps: [makeOutputValueQuote(10, parseUnits('1', 18), TOKEN_X, 18)],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: TOKEN_X }, makeOptions());
    expect(result.maxAmount).toBe(new Decimal('0.7').toFixed(18));
    expect(result.maxAmountRaw).toBe(parseUnits('0.7', 18));
  });

  it('same-token bridge (no source swaps) converts the $3 floor at the oracle price', async () => {
    // delivered 1 X, no quotes; oracle $10/X → floor 3/10 = 0.3 X; haircut = max(0.03, 0.3) = 0.3
    // → adjusted 0.7 X. Fixes the pre-existing same-token "subtract 3 ETH" bug.
    const route = makeRoute({
      destinationMax: new Decimal('1'),
      tokenSwap: null,
      dstTokenInfo: makeTokenXInfo(),
      sourceSwaps: [],
      oraclePrices: [makeOraclePrice(ARB_CHAIN, TOKEN_X, 10)],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: TOKEN_X }, makeOptions());
    expect(result.maxAmountRaw).toBe(parseUnits('0.7', 18));
  });

  it('same-token bridge with a NATIVE dst token hits the oracle floor (EADDRESS normalized to ZERO_ADDRESS)', async () => {
    // Regression: findOraclePriceUsd was called with EADDRESS, but oracle entries key native as
    // ZERO_ADDRESS → miss → pct-only. A SMALL amount makes the miss observable (the $3 floor exceeds
    // the 3% pct): delivered 0.02 ETH, oracle $2500/ETH → floor 3/2500 = 0.0012 > pct 0.0006 →
    // haircut 0.0012 → adjusted 0.0188 ETH. Buggy pct-only would give 0.0194.
    const route = makeRoute({
      destinationMax: new Decimal('0.02'),
      tokenSwap: null,
      dstTokenInfo: makeDstTokenInfo({ contractAddress: EADDRESS as Hex, decimals: 18, symbol: 'ETH', name: 'Ether' }),
      sourceSwaps: [],
      oraclePrices: [makeOraclePrice(ARB_CHAIN, ZERO_ADDRESS, 2500)],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: EADDRESS as Hex }, makeOptions());
    expect(result.maxAmountRaw).toBe(parseUnits('0.0188', 18));
  });

  it('falls back to a pct-only haircut when neither quote value nor oracle price is available', async () => {
    const route = makeRoute({
      destinationMax: new Decimal('1'),
      tokenSwap: null,
      dstTokenInfo: makeTokenXInfo(),
      sourceSwaps: [],
      oraclePrices: [],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: TOKEN_X }, makeOptions());
    expect(result.maxAmountRaw).toBe(parseUnits('0.97', 18));
  });

  it('uses a pct-only haircut when the source quotes carry no USD value (usdBasis ≤ 0)', async () => {
    const route = makeRoute({
      destinationMax: new Decimal('1'),
      tokenSwap: null,
      dstTokenInfo: makeTokenXInfo(),
      sourceSwaps: [makeOutputValueQuote(0, parseUnits('1', 18), TOKEN_X, 18)],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: TOKEN_X }, makeOptions());
    expect(result.maxAmountRaw).toBe(parseUnits('0.97', 18));
  });

  it('clamps the adjusted amount at zero when the haircut exceeds the delivered amount', async () => {
    // delivered 0.1 X at $1/X → floor $3 = 3 X ≫ 0.1 → adjusted clamps to 0 (never negative).
    const route = makeRoute({
      destinationMax: new Decimal('0.1'),
      tokenSwap: null,
      dstTokenInfo: makeTokenXInfo(),
      sourceSwaps: [],
      oraclePrices: [makeOraclePrice(ARB_CHAIN, TOKEN_X, 1)],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    const result = await calculateMaxForSwap({ toChainId: ARB_CHAIN, toTokenAddress: TOKEN_X }, makeOptions());
    expect(result.maxAmountRaw).toBe(0n);
  });
});
