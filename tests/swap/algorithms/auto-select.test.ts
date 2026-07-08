import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoSelectSources, type SourceHolding } from '../../../src/swap/algorithms/auto-select';
import type { Aggregator, Quote, QuoteRequest, QuoteResponse } from '../../../src/swap/aggregators/types';
import { QuoteSeriousness, QuoteType } from '../../../src/swap/aggregators/types';
import { SAFETY_MULTIPLIER } from '../../../src/swap/algorithms/convergence';
import { CurrencyID } from '../../../src/swap/cot';
import { ARB_CHAIN, OP_CHAIN, USDC_ARB, USDC_OP, WETH, makeSwapChainList } from '../../helpers/swap';

const tokenMeta = (tokenAddress: `0x${string}`) => {
  if (tokenAddress.toLowerCase() === USDC_ARB.toLowerCase()) return { decimals: 6, symbol: 'USDC' };
  if (tokenAddress.toLowerCase() === USDC_OP.toLowerCase()) return { decimals: 6, symbol: 'USDC' };
  if (tokenAddress.toLowerCase() === WETH.toLowerCase()) return { decimals: 18, symbol: 'WETH' };
  return { decimals: 18, symbol: 'TOKEN' };
};

const makeHolding = (
  chainID: number,
  tokenAddress: `0x${string}`,
  amountRaw: bigint,
  overrides?: Partial<SourceHolding>
): SourceHolding => ({
  chainID,
  tokenAddress,
  amountRaw,
  value: 0,
  ...tokenMeta(tokenAddress),
  ...overrides,
});

const makeQuote = (outputAmountRaw: bigint, inputAmountRaw: bigint): Quote => ({
  input: {
    contractAddress: WETH,
    amount: new Decimal(inputAmountRaw.toString()).div(new Decimal(10).pow(18)).toString(),
    amountRaw: inputAmountRaw,
    decimals: 18,
    value: 1,
    symbol: 'WETH',
  },
  output: {
    contractAddress: USDC_ARB,
    amount: new Decimal(outputAmountRaw.toString()).div(new Decimal(10).pow(6)).toString(),
    amountRaw: outputAmountRaw,
    decimals: 6,
    value: 1,
    symbol: 'USDC',
  },
  txData: {
    approvalAddress: '0x03' as `0x${string}`,
    tx: { to: '0x04' as `0x${string}`, data: '0x05' as `0x${string}`, value: '0x0' as `0x${string}` },
  },
});

// First (uncapped) convergence step = ceil(seed × SAFETY_MULTIPLIER), mirroring convergence.ts.
// Derived from the constant so the assertion tracks it instead of pinning a magic number.
const firstConvergenceStep = (seedRaw: bigint): bigint =>
  BigInt(new Decimal(seedRaw.toString()).mul(SAFETY_MULTIPLIER).toFixed(0, Decimal.ROUND_CEIL));

const makeAggregator = (quoteFn?: (reqs: QuoteRequest[]) => Promise<(Quote | null)[]>): Aggregator => ({
  supportsChain: () => true,
  getQuotes: quoteFn ?? vi.fn().mockResolvedValue([makeQuote(1000000n, 500000000000000000n)]),
});

// Taker + receiver are required, deliberately-passed per-chain maps.
const requestAddresses = {
  userAddressByChain: new Map<number, `0x${string}`>([
    [ARB_CHAIN, '0xUser000000000000000000000000000000000001'],
    [OP_CHAIN, '0xUser000000000000000000000000000000000001'],
  ]),
  recipientAddressByChain: new Map<number, `0x${string}`>([
    [ARB_CHAIN, '0xRecv000000000000000000000000000000000002'],
    [OP_CHAIN, '0xRecv000000000000000000000000000000000002'],
  ]),
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoSelectSources', () => {
  it('early-exits when all COT holdings cover requirement', async () => {
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 5000000n),
      makeHolding(OP_CHAIN, USDC_OP, 3000000n),
    ];
    const aggregators = [makeAggregator()];

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(7),
      aggregators,
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    // Should use COTs directly, no quoting needed
    expect(result.quoteResponses).toHaveLength(0);
    expect(result.usedCOTs.length).toBeGreaterThanOrEqual(1);
    // Total used COT should cover 7 USDC
    const totalCOT = result.usedCOTs.reduce((sum, c) => sum.plus(c.amountUsed), new Decimal(0));
    expect(totalCOT.gte(7)).toBe(true);
    // Aggregator should NOT have been called
    expect(aggregators[0].getQuotes).not.toHaveBeenCalled();
  });

  it('uses COT directly and quotes non-COT for mixed holdings', async () => {
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 3000000n),
      makeHolding(ARB_CHAIN, WETH, 500000000000000000n),
    ];
    const agg = makeAggregator(vi.fn().mockResolvedValue([makeQuote(5000000n, 500000000000000000n)]));

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(7),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    // Should use the COT directly (3 USDC) and quote the WETH
    expect(result.usedCOTs.length).toBeGreaterThanOrEqual(1);
    expect(result.quoteResponses.length).toBeGreaterThanOrEqual(1);
  });

  it('handles single non-COT holding that exactly covers requirement', async () => {
    const holdings = [
      makeHolding(ARB_CHAIN, WETH, 500000000000000000n),
    ];
    const agg = makeAggregator(vi.fn().mockResolvedValue([makeQuote(10000000n, 500000000000000000n)]));

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(5),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result.quoteResponses.length).toBeGreaterThanOrEqual(1);
  });

  it('handles first holding is COT but not enough — falls through to queue', async () => {
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 2000000n),
      makeHolding(ARB_CHAIN, WETH, 500000000000000000n),
    ];
    const agg = makeAggregator(vi.fn().mockResolvedValue([makeQuote(5000000n, 500000000000000000n)]));

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(6),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    // Should use COT (2 USDC) + non-COT quote output to cover 6 USDC
    const totalCOT = result.usedCOTs.reduce((sum, c) => sum.plus(c.amountUsed), new Decimal(0));
    const totalQuoted = result.quoteResponses.reduce(
      (sum, qr) => sum.plus(new Decimal(qr.quote.output.amount)),
      new Decimal(0),
    );
    expect(totalCOT.plus(totalQuoted).gte(6)).toBe(true);
    expect(totalCOT.eq(2)).toBe(true);
    expect(result.quoteResponses).toHaveLength(1);
  });

  it('returns empty when requirement is zero', async () => {
    const holdings = [makeHolding(ARB_CHAIN, USDC_ARB, 5000000n)];
    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(0),
      aggregators: [makeAggregator()],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result.quoteResponses).toHaveLength(0);
    expect(result.usedCOTs).toHaveLength(0);
  });

  it('throws when partial source selection cannot converge', async () => {
    // Indicative says 0.5 WETH → 10 USDC; partial requirement is 5 USDC. Convergence
    // is then asked for 5-USDC-worth of WETH, but the SERIOUS quote always under-delivers
    // (returns 1 USDC) so the cap pins the input and the loop exits.
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n, { value: 10 })];
    const requestSequence = vi.fn(async (reqs: QuoteRequest[]) =>
      reqs.map((req) => {
        if (req.type === QuoteType.EXACT_OUT) return null;
        if (req.seriousness === QuoteSeriousness.PRICE_SURVEY) {
          return makeQuote(10000000n, 500000000000000000n);
        }
        // SERIOUS convergence quote always under-delivers.
        return makeQuote(1000000n, req.inputAmount);
      })
    );
    const agg = makeAggregator(requestSequence);

    await expect(
      autoSelectSources({
        holdings,
        outputRequired: new Decimal(5),
        aggregators: [agg],
        chainList: makeSwapChainList(),
        cotCurrencyId: CurrencyID.USDC,
        ...requestAddresses,
      })
    ).rejects.toThrow(/converge/i);
  });

  it('uses the EXACT_OUT direct quote when it settles first for partial source selection', async () => {
    // Holding worth 10 USDC; requirement 5 USDC → partial path → convergenceQuote races
    // EXACT_OUT direct against EXACT_IN convergence. The convergence quotes are delayed so
    // the precise EXACT_OUT input (0.247 WETH) deterministically settles first and wins.
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n, { value: 10 })];
    const agg = makeAggregator(async (reqs) =>
      Promise.all(
        reqs.map(async (req) => {
          if (req.type === QuoteType.EXACT_OUT) {
            return makeQuote(5000000n, 247000000000000000n);
          }
          if (req.seriousness === QuoteSeriousness.PRICE_SURVEY) {
            return makeQuote(10000000n, 500000000000000000n);
          }
          await delay(30);
          return makeQuote(5000000n, req.inputAmount);
        })
      )
    );

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(5),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result.quoteResponses).toHaveLength(1);
    expect(result.quoteResponses[0].quote.input.amountRaw).toBe(247000000000000000n);
    expect(result.quoteResponses[0].quote.output.amountRaw).toBe(5000000n);
  });

  it('uses the convergence quote when EXACT_OUT settles later — first success wins the race', async () => {
    // Same setup, but EXACT_OUT is slow while convergence succeeds instantly off the
    // indicative seed (0.25 WETH × SAFETY_MULTIPLIER). The race must NOT wait for the
    // more precise EXACT_OUT quote.
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n, { value: 10 })];
    const agg = makeAggregator(async (reqs) =>
      Promise.all(
        reqs.map(async (req) => {
          if (req.type === QuoteType.EXACT_OUT) {
            await delay(30);
            return makeQuote(5000000n, 247000000000000000n);
          }
          if (req.seriousness === QuoteSeriousness.PRICE_SURVEY) {
            return makeQuote(10000000n, 500000000000000000n);
          }
          return makeQuote(5000000n, req.inputAmount);
        })
      )
    );

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(5),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result.quoteResponses).toHaveLength(1);
    expect(result.quoteResponses[0].quote.input.amountRaw).toBe(firstConvergenceStep(250000000000000000n));
    expect(result.quoteResponses[0].quote.output.amountRaw).toBe(5000000n);
  });

  it('falls back to convergence when EXACT_OUT direct is unsupported for partial source selection', async () => {
    // EXACT_OUT direct returns null; convergence builds from indicative ratio + 0.1% safety.
    // Indicative: 0.5 WETH → 10 USDC. Requirement 5 USDC → initial 0.25 WETH → × SAFETY_MULTIPLIER.
    const seriousInputs: bigint[] = [];
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n, { value: 10 })];
    const agg = makeAggregator(async (reqs) =>
      reqs.map((req) => {
        if (req.type === QuoteType.EXACT_OUT) return null;
        if (req.seriousness === QuoteSeriousness.PRICE_SURVEY) {
          return makeQuote(10000000n, 500000000000000000n);
        }
        seriousInputs.push(req.inputAmount);
        return makeQuote(5000000n, req.inputAmount);
      })
    );

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(5),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result.quoteResponses).toHaveLength(1);
    expect(seriousInputs[0]).toBe(firstConvergenceStep(250000000000000000n));
    expect(result.quoteResponses[0].quote.output.amountRaw).toBe(5000000n);
  });

  it('caps source convergence input growth at the COT-extra USD cap', async () => {
    // Indicative: 0.5 WETH → 10 USDC. Cap: 0.5 USDC worth of WETH at indicative price =
    // (0.5e6 USDC_raw * 0.5e18 WETH_raw) / 10e6 USDC_raw = 2.5e16 WETH raw (0.025 WETH).
    // Initial estimate for 5 USDC: 2.5e17 WETH raw (0.25 WETH). With cap: max input
    // = 2.5e17 + 2.5e16 = 2.75e17 raw (0.275 WETH). SERIOUS quote always under-delivers
    // so the loop drives input up against the cap.
    const seriousInputs: bigint[] = [];
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n, { value: 10 })];
    const agg = makeAggregator(async (reqs) =>
      reqs.map((req) => {
        if (req.type === QuoteType.EXACT_OUT) return null;
        if (req.seriousness === QuoteSeriousness.PRICE_SURVEY) {
          return makeQuote(10000000n, 500000000000000000n);
        }
        seriousInputs.push(req.inputAmount);
        return makeQuote(4000000n, req.inputAmount);
      })
    );

    await expect(
      autoSelectSources({
        holdings,
        outputRequired: new Decimal(5),
        aggregators: [agg],
        chainList: makeSwapChainList(),
        cotCurrencyId: CurrencyID.USDC,
        ...requestAddresses,
      })
    ).rejects.toThrow(/converge/i);

    expect(seriousInputs.length).toBeGreaterThan(0);
    const maxAllowed = 275_000_000_000_000_000n;
    for (const input of seriousInputs) {
      expect(input).toBeLessThanOrEqual(maxAllowed);
    }
  });

  it('passes recipientAddressByChain through to quote requests', async () => {
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n)];
    const getQuotes = vi.fn().mockResolvedValue([makeQuote(5000000n, 500000000000000000n)]);
    const agg = makeAggregator(getQuotes);
    const recipient = '0xRecipient00000000000000000000000000000001' as `0x${string}`;

    await autoSelectSources({
      holdings,
      outputRequired: new Decimal(5),
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      userAddressByChain: new Map([
        [ARB_CHAIN, '0xUser000000000000000000000000000000000001' as `0x${string}`],
      ]),
      recipientAddressByChain: new Map([[ARB_CHAIN, recipient]]),
    });

    const [requests] = getQuotes.mock.calls[0];
    expect(requests[0]).toEqual(
      expect.objectContaining({
        recipientAddress: recipient,
      })
    );
  });

  it('uses holding decimals when a non-COT token is not in the chain list', async () => {
    const unlisted = '0x9999000000000000000000000000000000000001' as `0x${string}`;
    const holdings = [
      makeHolding(ARB_CHAIN, unlisted, 500000000000000000n, {
        decimals: 18,
        symbol: 'UNLISTED',
      }),
    ];
    const chainList = makeSwapChainList();
    chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: `0x${string}`) => {
      if (chainId === ARB_CHAIN && tokenAddress.toLowerCase() === USDC_ARB.toLowerCase()) {
        return {
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
          logo: '',
        };
      }
      return undefined;
    });
    const agg = makeAggregator(
      vi.fn().mockResolvedValue([makeQuote(5000000n, 500000000000000000n)])
    );

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(5),
      aggregators: [agg],
      chainList,
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result.quoteResponses).toHaveLength(1);
  });

  it('quotes only the value-covering prefix and skips dust holdings beyond it', async () => {
    const DUST_A = '0xdd0a000000000000000000000000000000000001' as `0x${string}`;
    const DUST_B = '0xdd0b000000000000000000000000000000000002' as `0x${string}`;
    // Priority order: one large WETH holding (USD 2000) then two dust holdings.
    // target = 1000 × 1.25 = 1250 ≤ 2000 → the prefix stops at the WETH holding;
    // the dust holdings must never be quoted.
    const holdings = [
      makeHolding(ARB_CHAIN, WETH, 1000000000000000000n, { value: 2000 }),
      makeHolding(ARB_CHAIN, DUST_A, 1000000000000000000n, { value: 50 }),
      makeHolding(ARB_CHAIN, DUST_B, 1000000000000000000n, { value: 50 }),
    ];
    // WETH survey quote outputs exactly the required 1000 USDC → full-holding branch, no convergence.
    const getQuotes = vi.fn(async (reqs: QuoteRequest[]) =>
      reqs.map(() => makeQuote(1000000000n, 1000000000000000000n))
    );

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(1000),
      aggregators: [makeAggregator(getQuotes)],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    const requestedTokens = getQuotes.mock.calls.flatMap((c) => c[0].map((r) => r.inputToken));
    expect(requestedTokens).toContain(WETH);
    expect(requestedTokens).not.toContain(DUST_A);
    expect(requestedTokens).not.toContain(DUST_B);

    const totalQuoted = result.quoteResponses.reduce(
      (s, qr) => s.plus(new Decimal(qr.quote.output.amount)),
      new Decimal(0)
    );
    expect(totalQuoted.gte(1000)).toBe(true);
  });

  it('extends to remaining non-COT holdings when the value-prefix under-delivers', async () => {
    const DUST_A = '0xdd0a000000000000000000000000000000000001' as `0x${string}`;
    // Prefix stops at the WETH holding (value 2000 ≥ 1000×1.25), but its realised quote
    // only yields 600 USDC — short of 1000 — so the selector must quote DUST_A to finish.
    const holdings = [
      makeHolding(ARB_CHAIN, WETH, 1000000000000000000n, { value: 2000 }),
      makeHolding(ARB_CHAIN, DUST_A, 1000000000000000000n, { value: 50 }),
    ];
    const getQuotes = vi.fn(async (reqs: QuoteRequest[]) =>
      reqs.map((r) =>
        r.inputToken === WETH
          ? makeQuote(600000000n, 1000000000000000000n)
          : makeQuote(400000000n, 1000000000000000000n)
      )
    );

    const result = await autoSelectSources({
      holdings,
      outputRequired: new Decimal(1000),
      aggregators: [makeAggregator(getQuotes)],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    const requestedTokens = getQuotes.mock.calls.flatMap((c) => c[0].map((r) => r.inputToken));
    expect(requestedTokens).toContain(WETH);
    expect(requestedTokens).toContain(DUST_A);

    const totalQuoted = result.quoteResponses.reduce(
      (s, qr) => s.plus(new Decimal(qr.quote.output.amount)),
      new Decimal(0)
    );
    expect(totalQuoted.gte(1000)).toBe(true);
  });
});
