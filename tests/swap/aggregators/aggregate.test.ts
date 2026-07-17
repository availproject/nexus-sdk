import { describe, expect, it, vi } from 'vitest';
import {
  AggregateMode,
  aggregateAggregators,
  createAggregators,
} from '../../../src/swap/aggregators';
import type { Aggregator, Quote, QuoteRequest } from '../../../src/swap/aggregators/types';
import { QuoteSeriousness, QuoteType } from '../../../src/swap/aggregators/types';
import { BebopAggregator } from '../../../src/swap/aggregators/bebop';
import { FibrousAggregator } from '../../../src/swap/aggregators/fibrous';
import { LiFiAggregator } from '../../../src/swap/aggregators/lifi';
import { MysticAggregator } from '../../../src/swap/aggregators/mystic';
import { RelayAggregator } from '../../../src/swap/aggregators/relay';
import { ZeroExAggregator } from '../../../src/swap/aggregators/zerox';
import { EADDRESS } from '../../../src/swap/constants';
import { ZERO_ADDRESS } from '../../../src/domain/constants/addresses';
import { logger } from '../../../src/domain/utils';

const makeQuote = (outputAmountRaw: bigint, inputAmountRaw = 1000000n): Quote => ({
  input: {
    contractAddress: '0x01' as `0x${string}`,
    amount: inputAmountRaw.toString(),
    amountRaw: inputAmountRaw,
    decimals: 6,
    value: 1,
    symbol: 'USDC',
  },
  output: {
    contractAddress: '0x02' as `0x${string}`,
    amount: outputAmountRaw.toString(),
    amountRaw: outputAmountRaw,
    decimals: 18,
    value: 1,
    symbol: 'WETH',
  },
  txData: {
    approvalAddress: '0x03' as `0x${string}`,
    tx: {
      to: '0x04' as `0x${string}`,
      data: '0x05' as `0x${string}`,
      value: '0x0' as `0x${string}`,
    },
  },
});

const makeRequest = (): QuoteRequest => ({
  userAddress: '0x1111111111111111111111111111111111111111' as `0x${string}`,
  recipientAddress: '0x2222222222222222222222222222222222222222' as `0x${string}`,
  chainId: 42161,
  inputToken: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  outputToken: '0x0000000000000000000000000000000000000002' as `0x${string}`,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount: 1000000n,
});

const makeAggregator = (quotes: (Quote | null)[]): Aggregator => ({
  getQuotes: vi.fn().mockResolvedValue(quotes),
  supportsChain: () => true,
});

describe('aggregateAggregators', () => {
  it('picks highest output in MaximizeOutput mode', async () => {
    const aggA = makeAggregator([makeQuote(900000n)]);
    const aggB = makeAggregator([makeQuote(950000n)]);

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results).toHaveLength(1);
    expect(results[0].quote).not.toBeNull();
    expect(results[0].quote!.output.amountRaw).toBe(950000n);
    expect(results[0].aggregator).toBe(aggB);
  });

  it('picks lowest input in MinimizeInput mode', async () => {
    const aggA = makeAggregator([makeQuote(990000n, 1100000n)]);
    const aggB = makeAggregator([makeQuote(990000n, 1000000n)]);

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MinimizeInput);

    expect(results).toHaveLength(1);
    expect(results[0].quote!.input.amountRaw).toBe(1000000n);
    expect(results[0].aggregator).toBe(aggB);
  });

  it('uses other aggregator quotes when one fails entirely', async () => {
    const aggA: Aggregator = {
      getQuotes: vi.fn().mockRejectedValue(new Error('network failure')),
      supportsChain: () => true,
    };
    const aggB = makeAggregator([makeQuote(950000n)]);

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results).toHaveLength(1);
    expect(results[0].quote).not.toBeNull();
    expect(results[0].quote!.output.amountRaw).toBe(950000n);
    expect(results[0].aggregator).toBe(aggB);
  });

  it('returns all nulls when both aggregators fail', async () => {
    const aggA: Aggregator = {
      getQuotes: vi.fn().mockRejectedValue(new Error('fail A')),
      supportsChain: () => true,
    };
    const aggB: Aggregator = {
      getQuotes: vi.fn().mockRejectedValue(new Error('fail B')),
      supportsChain: () => true,
    };

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results).toHaveLength(1);
    expect(results[0].quote).toBeNull();
  });

  it('picks first aggregator on tie in MaximizeOutput', async () => {
    const aggA = makeAggregator([makeQuote(950000n)]);
    const aggB = makeAggregator([makeQuote(950000n)]);

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results[0].aggregator).toBe(aggA);
  });

  it('picks valid quote when one is null and other is valid', async () => {
    const aggA = makeAggregator([null]);
    const aggB = makeAggregator([makeQuote(950000n)]);

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results[0].quote).not.toBeNull();
    expect(results[0].aggregator).toBe(aggB);
  });

  it('handles multiple requests selecting best per-request', async () => {
    const aggA = makeAggregator([makeQuote(900000n), makeQuote(1100000n)]);
    const aggB = makeAggregator([makeQuote(950000n), makeQuote(1000000n)]);

    const requests = [makeRequest(), makeRequest()];
    const results = await aggregateAggregators(requests, [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results).toHaveLength(2);
    // Request 0: aggB wins (950k > 900k)
    expect(results[0].quote!.output.amountRaw).toBe(950000n);
    expect(results[0].aggregator).toBe(aggB);
    // Request 1: aggA wins (1.1M > 1M)
    expect(results[1].quote!.output.amountRaw).toBe(1100000n);
    expect(results[1].aggregator).toBe(aggA);
  });

  it('returns null quote with first aggregator when all quotes are null', async () => {
    const aggA = makeAggregator([null]);
    const aggB = makeAggregator([null]);

    const results = await aggregateAggregators([makeRequest()], [aggA, aggB], AggregateMode.MaximizeOutput);

    expect(results[0].quote).toBeNull();
  });
});

// A realistic 0x allowance-holder EXACT_IN response (no decimals, no priceUsd).
const zeroExResponse = (over: Record<string, unknown> = {}) => ({
  liquidityAvailable: true,
  sellToken: '0x0000000000000000000000000000000000000001',
  buyToken: '0x0000000000000000000000000000000000000002',
  sellAmount: '1000000',
  buyAmount: '2100000000000000000',
  minBuyAmount: '2000000000000000000',
  maxSellAmount: '1020000',
  allowanceTarget: '0x00000000000000000000000000000000000000aa',
  transaction: { to: '0x00000000000000000000000000000000000000bb', data: '0xabc', value: '0x0' },
  ...over,
});

// A LiFi EXACT_IN response that LOSES on output (1e18 < 0x's 2e18) but carries decimals + priceUSD.
const lifiResponse = () => ({
  estimate: { fromAmount: '1000000', fromAmountUSD: '1', toAmount: '1000000000000000000', toAmountMin: '1000000000000000000', toAmountUSD: '2', approvalAddress: '0x03', feeCosts: [], gasCosts: [] },
  action: {
    fromToken: { address: '0x01', symbol: 'USDC', decimals: 6, priceUSD: '1' },
    toToken: { address: '0x02', symbol: 'WETH', decimals: 18, priceUSD: '2' },
  },
  transactionRequest: { to: '0x04', data: '0x05', value: '0x0' },
});

describe('aggregateAggregators — sibling backfill (price-less 0x)', () => {
  it('backfills a winning 0x quote with decimals/symbol/amount/value from a sibling', async () => {
    const lifi = new LiFiAggregator(vi.fn().mockResolvedValue(lifiResponse()) as any, vi.fn() as any);
    const zerox = new ZeroExAggregator(vi.fn() as any, vi.fn().mockResolvedValue(zeroExResponse()) as any);

    const [res] = await aggregateAggregators([makeRequest()], [lifi, zerox], AggregateMode.MaximizeOutput);

    expect(res.aggregator).toBe(zerox); // 0x won on output (2e18 > 1e18)
    expect(res.quote!.output.amountRaw).toBe(2000000000000000000n); // raw unchanged
    expect(res.quote!.output.decimals).toBe(18); // borrowed from LiFi (same token)
    expect(res.quote!.output.symbol).toBe('WETH'); // borrowed
    expect(res.quote!.output.amount).toBe('2'); // recomputed: 2e18 / 1e18
    expect(res.quote!.output.value).toBe(4); // 2 × $2 (borrowed priceUsd)
    expect(res.quote!.input.decimals).toBe(6);
    expect(res.quote!.input.amount).toBe('1');
    expect(res.quote!.input.value).toBe(1); // 1 USDC × $1
  });

  it('drops a winning 0x quote when no sibling and no LiFi provider can enrich it', async () => {
    const zerox = new ZeroExAggregator(vi.fn() as any, vi.fn().mockResolvedValue(zeroExResponse()) as any);
    const none = makeAggregator([null]);

    const [res] = await aggregateAggregators([makeRequest()], [zerox, none], AggregateMode.MaximizeOutput);

    expect(res.quote).toBeNull(); // no sibling + no LiFiAggregator in the set → can't enrich → drop
  });

  it('backfills value for a price-less but decimal-ed winner without touching decimals', async () => {
    // Bebop-style winner: decimals known, priceUsd missing, value 0. Sibling carries priceUsd.
    const winnerQ = makeQuote(2000000000000000000n);
    winnerQ.output.amount = '2';
    winnerQ.output.decimals = 18;
    winnerQ.output.value = 0;
    winnerQ.output.priceUsd = undefined;
    const siblingQ = makeQuote(1000000000000000000n);
    siblingQ.output.priceUsd = 3;

    const [res] = await aggregateAggregators(
      [makeRequest()],
      [makeAggregator([winnerQ]), makeAggregator([siblingQ])],
      AggregateMode.MaximizeOutput
    );

    expect(res.quote!.output.decimals).toBe(18); // untouched (not a 0x quote)
    expect(res.quote!.output.value).toBe(6); // 2 × $3 borrowed
  });

  it('does not overwrite value when the winner already reports priceUsd', async () => {
    const winnerQ = makeQuote(2000000000000000000n);
    winnerQ.output.priceUsd = 5;
    winnerQ.output.value = 10;
    const siblingQ = makeQuote(1000000000000000000n);
    siblingQ.output.priceUsd = 3;

    const [res] = await aggregateAggregators(
      [makeRequest()],
      [makeAggregator([winnerQ]), makeAggregator([siblingQ])],
      AggregateMode.MaximizeOutput
    );

    expect(res.quote!.output.value).toBe(10); // winner's own price wins
  });
});

describe('aggregateAggregators — native token normalization', () => {
  // Capture the requests an aggregator actually receives.
  const capture = () => {
    let received: QuoteRequest[] | undefined;
    const agg: Aggregator = {
      getQuotes: vi.fn(async (reqs: QuoteRequest[]) => {
        received = reqs;
        return reqs.map(() => makeQuote(1n));
      }),
      supportsChain: () => true,
    };
    return { agg, received: () => received };
  };

  it('rewrites a native ZERO_ADDRESS outputToken to EADDRESS (so non-LiFi aggregators recognize native)', async () => {
    const { agg, received } = capture();
    await aggregateAggregators(
      [{ ...makeRequest(), outputToken: ZERO_ADDRESS }],
      [agg],
      AggregateMode.MaximizeOutput
    );
    expect(received()![0].outputToken).toBe(EADDRESS);
  });

  it('rewrites a native ZERO_ADDRESS inputToken to EADDRESS', async () => {
    const { agg, received } = capture();
    await aggregateAggregators(
      [{ ...makeRequest(), inputToken: ZERO_ADDRESS }],
      [agg],
      AggregateMode.MaximizeOutput
    );
    expect(received()![0].inputToken).toBe(EADDRESS);
  });

  it('leaves an already-EADDRESS native token and non-native tokens untouched', async () => {
    const { agg, received } = capture();
    const req = makeRequest(); // input 0x..01, output 0x..02 (non-native)
    await aggregateAggregators(
      [req, { ...makeRequest(), inputToken: EADDRESS }],
      [agg],
      AggregateMode.MaximizeOutput
    );
    expect(received()![0].inputToken).toBe(req.inputToken);
    expect(received()![0].outputToken).toBe(req.outputToken);
    expect(received()![1].inputToken).toBe(EADDRESS);
  });
});

describe('aggregateAggregators — per-chain tiered selection', () => {
  const proxies = () => ({
    lifi: vi.fn().mockResolvedValue({}),
    bebop: vi.fn().mockResolvedValue({}),
    fibrous: vi.fn().mockResolvedValue({}),
    zerox: vi.fn().mockResolvedValue({}),
    relay: vi.fn().mockResolvedValue({}),
    // LiFi /v1/token used to enrich a lone 0x quote (decimals/symbol/priceUSD).
    lifiToken: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'WETH', priceUSD: '2' }),
  });
  // Real adapters in createAggregators order (minus Mystic — see the Mystic tier-1 describe below).
  const realAggregators = (p: ReturnType<typeof proxies>): Aggregator[] => [
    new LiFiAggregator(p.lifi as any, p.lifiToken as any),
    new BebopAggregator(p.bebop as any),
    new FibrousAggregator(p.fibrous as any, vi.fn() as any),
    new ZeroExAggregator(p.zerox as any, p.zerox as any),
    new RelayAggregator(p.relay as any),
  ];
  const chainRequest = (chainId: number): QuoteRequest => ({ ...makeRequest(), chainId });

  // Real adapter instance with supportsChain + getQuotes stubbed, so a test can drive the primary /
  // fallback rounds without mocking each adapter's proxy response shape or real chain lists.
  const stubAgg = (agg: Aggregator, result: (Quote | null)[] | Error) => {
    vi.spyOn(agg, 'supportsChain').mockReturnValue(true);
    const spy = vi.spyOn(agg, 'getQuotes');
    if (result instanceof Error) spy.mockRejectedValue(result);
    else spy.mockResolvedValue(result);
    return spy;
  };

  it('quotes tier-1 (Relay+Bebop) first, then falls back to the remaining 0x+LiFi when tier-1 is dry (Base)', async () => {
    const p = proxies();
    await aggregateAggregators([chainRequest(8453)], realAggregators(p), AggregateMode.MaximizeOutput);

    // primary = [Relay, Bebop] (both null) → fallback quotes the remaining supporters [0x, LiFi].
    expect(p.relay).toHaveBeenCalledTimes(1);
    expect(p.bebop).toHaveBeenCalledTimes(2);
    expect(p.zerox).toHaveBeenCalledTimes(1);
    expect(p.lifi).toHaveBeenCalledTimes(1);
    expect(p.fibrous).not.toHaveBeenCalled(); // doesn't serve Base
  });

  it('quotes only Fibrous on Citrea (single supporter, no top-up)', async () => {
    const p = proxies();
    await aggregateAggregators([chainRequest(4114)], realAggregators(p), AggregateMode.MaximizeOutput);

    expect(p.fibrous).toHaveBeenCalledTimes(1);
    expect(p.relay).not.toHaveBeenCalled();
    expect(p.bebop).not.toHaveBeenCalled();
    expect(p.lifi).not.toHaveBeenCalled();
    expect(p.zerox).not.toHaveBeenCalled();
  });

  it('primary tops up a lone tier-1 with 0x (higher tier-2 priority); LiFi is the fallback', async () => {
    const p = proxies();
    const aggs = [
      new RelayAggregator(p.relay as any),
      new ZeroExAggregator(p.zerox as any, p.zerox as any),
      new LiFiAggregator(p.lifi as any, p.lifiToken as any),
    ];
    await aggregateAggregators([chainRequest(8453)], aggs, AggregateMode.MaximizeOutput);

    // primary = [Relay, 0x] (0x tops up over LiFi); all null → fallback quotes the remainder [LiFi].
    expect(p.relay).toHaveBeenCalledTimes(1);
    expect(p.zerox).toHaveBeenCalledTimes(1);
    expect(p.lifi).toHaveBeenCalledTimes(1);
  });

  it('runs a lone tier-2 supporter alone (Kaia → LiFi only)', async () => {
    const p = proxies();
    const aggs = [new LiFiAggregator(p.lifi as any, p.lifiToken as any), new BebopAggregator(p.bebop as any)];
    await aggregateAggregators([chainRequest(8217)], aggs, AggregateMode.MaximizeOutput);

    expect(p.lifi).toHaveBeenCalledTimes(1);
    expect(p.bebop).not.toHaveBeenCalled();
  });

  it('enriches a lone 0x quote on a 0x-only chain (Mantle) from LiFi token info instead of dropping', async () => {
    const zerox = new ZeroExAggregator(vi.fn() as any, vi.fn().mockResolvedValue(zeroExResponse()) as any);
    const lifiToken = vi.fn().mockResolvedValue({ decimals: 6, symbol: 'USDC', priceUSD: '1' });
    // LiFi does not serve Mantle (not selected) but its token endpoint covers it → used for enrichment.
    const lifi = new LiFiAggregator(vi.fn() as any, lifiToken as any);

    const [res] = await aggregateAggregators([chainRequest(5000)], [zerox, lifi], AggregateMode.MaximizeOutput);

    expect(res.aggregator).toBe(zerox);
    expect(res.quote).not.toBeNull();
    expect(res.quote!.output.decimals).toBe(6); // from LiFi /v1/token
    expect(lifiToken).toHaveBeenCalledWith(5000, expect.any(String));
  });

  it('falls back to full fan-out on a chain no adapter claims (only ungated Relay actually fires)', async () => {
    const p = proxies();
    await aggregateAggregators([chainRequest(777777)], realAggregators(p), AggregateMode.MaximizeOutput);

    expect(p.relay).toHaveBeenCalledTimes(1);
    expect(p.lifi).not.toHaveBeenCalled();
    expect(p.bebop).not.toHaveBeenCalled();
    expect(p.fibrous).not.toHaveBeenCalled();
    expect(p.zerox).not.toHaveBeenCalled();
  });

  it('caps unknown implementations (universal support) at two, keeping original order', async () => {
    const mocks = [makeQuote(1n), makeQuote(2n), makeQuote(3n)].map((q) => ({
      getQuotes: vi.fn(async (reqs: QuoteRequest[]) => reqs.map(() => q)),
      supportsChain: () => true,
    }));
    await aggregateAggregators([makeRequest()], mocks, AggregateMode.MaximizeOutput);

    expect(mocks[0].getQuotes).toHaveBeenCalledTimes(1);
    expect(mocks[1].getQuotes).toHaveBeenCalledTimes(1);
    expect(mocks[2].getQuotes).not.toHaveBeenCalled();
  });

  it('hands each aggregator only its selected requests and scatters results back to original indexes', async () => {
    const quoteFor = (chainId: number, out: bigint) => makeQuote(out);
    const receives: Record<string, QuoteRequest[][]> = { a: [], b: [], c: [] };
    const mockFor = (key: 'a' | 'b' | 'c', chains: number[], outByChain: Record<number, bigint>) => ({
      getQuotes: vi.fn(async (reqs: QuoteRequest[]) => {
        receives[key].push(reqs);
        return reqs.map((r) => quoteFor(r.chainId, outByChain[r.chainId]));
      }),
      supportsChain: (chainId: number) => chains.includes(chainId),
    });
    const a = mockFor('a', [8453], { 8453: 900_000n });
    const b = mockFor('b', [4114], { 4114: 800_000n });
    const c = mockFor('c', [8453, 4114], { 8453: 1_000_000n, 4114: 700_000n });

    const results = await aggregateAggregators(
      [chainRequest(8453), chainRequest(4114)],
      [a, b, c],
      AggregateMode.MaximizeOutput
    );

    // Subsets: a saw only the Base request, b only the Citrea one, c both.
    expect(receives.a).toEqual([[expect.objectContaining({ chainId: 8453 })]]);
    expect(receives.b).toEqual([[expect.objectContaining({ chainId: 4114 })]]);
    expect(receives.c).toEqual([
      [expect.objectContaining({ chainId: 8453 }), expect.objectContaining({ chainId: 4114 })],
    ]);
    // Scatter-back: per-request winners land at their original indexes.
    expect(results[0].quote!.output.amountRaw).toBe(1_000_000n); // c wins Base
    expect(results[0].aggregator).toBe(c);
    expect(results[1].quote!.output.amountRaw).toBe(800_000n); // b wins Citrea
    expect(results[1].aggregator).toBe(b);
  });

  it('does NOT quote the remaining supporters when the primary selection returns a quote', async () => {
    const relay = new RelayAggregator(vi.fn() as any);
    const bebop = new BebopAggregator(vi.fn() as any);
    const zerox = new ZeroExAggregator(vi.fn() as any, vi.fn() as any);
    const lifi = new LiFiAggregator(vi.fn() as any, vi.fn() as any);
    const relaySpy = stubAgg(relay, [makeQuote(1_000_000n)]); // tier-1 quotes
    const bebopSpy = stubAgg(bebop, [null]); // tier-1
    const zeroxSpy = stubAgg(zerox, [makeQuote(9_000_000n)]); // remainder — higher output, but not tried
    const lifiSpy = stubAgg(lifi, [makeQuote(9_000_000n)]); // remainder

    const [res] = await aggregateAggregators(
      [makeRequest()],
      [relay, bebop, zerox, lifi],
      AggregateMode.MaximizeOutput
    );

    // primary = [Relay, Bebop]; Relay produced a quote, so the remaining tier-2 pool is never tried.
    expect(relaySpy).toHaveBeenCalledTimes(1);
    expect(bebopSpy).toHaveBeenCalledTimes(1);
    expect(zeroxSpy).not.toHaveBeenCalled();
    expect(lifiSpy).not.toHaveBeenCalled();
    expect(res.aggregator).toBe(relay); // primary winner, even though 0x/LiFi output is higher
  });

  it('falls back to the remaining supporters when every primary adapter returns null', async () => {
    const relay = new RelayAggregator(vi.fn() as any);
    const bebop = new BebopAggregator(vi.fn() as any);
    const zerox = new ZeroExAggregator(vi.fn() as any, vi.fn() as any);
    const lifi = new LiFiAggregator(vi.fn() as any, vi.fn() as any);
    const relaySpy = stubAgg(relay, [null]);
    const bebopSpy = stubAgg(bebop, [null]);
    const zeroxSpy = stubAgg(zerox, [makeQuote(9_000_000n)]);
    const lifiSpy = stubAgg(lifi, [makeQuote(8_000_000n)]);

    const [res] = await aggregateAggregators(
      [makeRequest()],
      [relay, bebop, zerox, lifi],
      AggregateMode.MaximizeOutput
    );

    expect(relaySpy).toHaveBeenCalledTimes(1);
    expect(bebopSpy).toHaveBeenCalledTimes(1);
    expect(zeroxSpy).toHaveBeenCalledTimes(1); // fallback fired — primary was all null
    expect(lifiSpy).toHaveBeenCalledTimes(1);
    expect(res.aggregator).toBe(zerox); // 0x wins the fallback (9M > 8M), backfilling decimals from LiFi
  });

  it('treats a thrown primary adapter as null and falls back', async () => {
    const relay = new RelayAggregator(vi.fn() as any);
    const bebop = new BebopAggregator(vi.fn() as any);
    const lifi = new LiFiAggregator(vi.fn() as any, vi.fn() as any);
    stubAgg(relay, new Error('relay down'));
    stubAgg(bebop, new Error('bebop down'));
    const lifiSpy = stubAgg(lifi, [makeQuote(5_000_000n)]);

    const [res] = await aggregateAggregators(
      [makeRequest()],
      [relay, bebop, lifi],
      AggregateMode.MaximizeOutput
    );

    expect(lifiSpy).toHaveBeenCalledTimes(1); // both tier-1 threw → fallback to the remainder
    expect(res.aggregator).toBe(lifi);
  });

  it('logs per-aggregator quote-round entries with duration and request count', async () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    const p = proxies();
    await aggregateAggregators([chainRequest(8453)], realAggregators(p), AggregateMode.MaximizeOutput);

    const perAggregator = debugSpy.mock.calls
      .filter(([msg]) => msg === 'swap.route.aggregator.quote_round.completed')
      .map(([, payload]) => payload as { aggregator?: string; requestCount?: number; durationMs?: number });
    expect(perAggregator.map((t) => t.aggregator).sort()).toEqual(['bebop', 'lifi', 'relay', 'zerox']);
    for (const entry of perAggregator) {
      expect(entry.requestCount).toBe(1);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    }
    debugSpy.mockRestore();
  });

  it('logs only the selected candidates in the aggregator selection event', async () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    const p = proxies();
    await aggregateAggregators([chainRequest(8453)], realAggregators(p), AggregateMode.MaximizeOutput);

    const entry = debugSpy.mock.calls.find(
      ([msg]) => msg === 'swap.route.aggregator.selection.completed'
    );
    expect(entry).toBeDefined();
    const payload = entry![1] as { candidates: { aggregator: string }[] };
    expect(payload.candidates.map((c) => c.aggregator).sort()).toEqual(['lifi', 'zerox']);
    debugSpy.mockRestore();
  });
});

describe('aggregateAggregators — Mystic tier-1 selection', () => {
  const chainRequest = (chainId: number): QuoteRequest => ({ ...makeRequest(), chainId });

  // Mystic is tier-1 and serves Citrea (4114) alongside Fibrous. Both are picked; Mystic reports no
  // token metadata, so it backfills decimals/symbol from its Fibrous sibling (backfillFromSiblings).
  it('co-selects Mystic and Fibrous as the two tier-1 Citrea supporters', async () => {
    const fibrous = vi.fn().mockResolvedValue({});
    const mystic = vi.fn().mockResolvedValue({});
    const relay = vi.fn().mockResolvedValue({});
    const aggs = [
      new FibrousAggregator(fibrous as any, vi.fn() as any),
      new MysticAggregator(mystic as any, vi.fn() as any),
      new RelayAggregator(relay as any),
    ];
    await aggregateAggregators([chainRequest(4114)], aggs, AggregateMode.MaximizeOutput);

    expect(fibrous).toHaveBeenCalledTimes(1);
    expect(mystic).toHaveBeenCalledTimes(1);
    expect(relay).not.toHaveBeenCalled(); // Relay does not serve Citrea
  });

  // Mystic is metadata-less; a lone Mystic win is enriched from its OWN /v1/tokens/resolve endpoint
  // (decimals/symbol, no USD price → value 0) rather than dropped.
  it('enriches a lone Mystic quote from its own token resolve instead of dropping it', async () => {
    const mysticToken = vi.fn().mockResolvedValue({ symbol: 'USDC', decimals: 6, name: 'USD Coin' });
    const mystic = new MysticAggregator(vi.fn() as any, mysticToken as any);
    vi.spyOn(mystic, 'getQuotes').mockResolvedValue([makeQuote(900_000n)]);

    const [res] = await aggregateAggregators(
      [chainRequest(4114)],
      [mystic],
      AggregateMode.MaximizeOutput
    );

    expect(res.aggregator).toBe(mystic);
    expect(res.quote).not.toBeNull();
    expect(res.quote!.output.decimals).toBe(6); // from Mystic /v1/tokens/resolve
    expect(res.quote!.output.value).toBe(0); // Mystic reports no USD price
    expect(mysticToken).toHaveBeenCalled();
  });
});

describe('createAggregators', () => {
  it('returns LiFi, Bebop, Fibrous, 0x, Mystic, and Relay aggregators when given a MiddlewareClient', () => {
    const mockMiddlewareClient = {
      getLiFiQuote: vi.fn(),
      getBebopQuote: vi.fn(),
      getFibrousQuote: vi.fn(),
      getFibrousRoute: vi.fn(),
      getZeroExQuote: vi.fn(),
      postMystic: vi.fn(),
      getRelayQuote: vi.fn(),
    } as any;
    const aggs = createAggregators(mockMiddlewareClient);
    expect(aggs).toHaveLength(6);
  });

  it('wires Relay aggregator to mw.getRelayQuote', async () => {
    const getRelayQuote = vi.fn().mockResolvedValue({});
    const mw = {
      getLiFiQuote: vi.fn(),
      getBebopQuote: vi.fn(),
      getFibrousQuote: vi.fn(),
      getFibrousRoute: vi.fn(),
      getZeroExQuote: vi.fn(),
      postMystic: vi.fn(),
      getRelayQuote,
    } as any;

    const aggs = createAggregators(mw);
    const relay = aggs[5];
    await relay.getQuotes([makeRequest()]);

    expect(getRelayQuote).toHaveBeenCalledTimes(1);
    expect(mw.getLiFiQuote).not.toHaveBeenCalled();
    expect(mw.getZeroExQuote).not.toHaveBeenCalled();
  });

  it('wires 0x aggregator to mw.getZeroExQuote', async () => {
    const getZeroExQuote = vi.fn().mockResolvedValue(zeroExResponse());
    const mw = { getLiFiQuote: vi.fn(), getBebopQuote: vi.fn(), getFibrousQuote: vi.fn(), getFibrousRoute: vi.fn(), getZeroExQuote } as any;

    const aggs = createAggregators(mw);
    const zerox = aggs[3];
    await zerox.getQuotes([makeRequest()]);

    expect(getZeroExQuote).toHaveBeenCalledTimes(1);
    expect(mw.getLiFiQuote).not.toHaveBeenCalled();
    expect(mw.getBebopQuote).not.toHaveBeenCalled();
    expect(mw.getFibrousQuote).not.toHaveBeenCalled();
  });

  it('wires LiFi aggregator to mw.getLiFiQuote', async () => {
    const lifiResponse = {
      estimate: { fromAmount: '1000', fromAmountUSD: '1', toAmount: '900', toAmountMin: '890', toAmountUSD: '0.9', approvalAddress: '0x03', feeCosts: [], gasCosts: [] },
      action: { fromToken: { address: '0x01', symbol: 'A', decimals: 6, priceUSD: '1' }, toToken: { address: '0x02', symbol: 'B', decimals: 18, priceUSD: '1' } },
      transactionRequest: { to: '0x04', data: '0x05', value: '0x0' },
    };
    const getLiFiQuote = vi.fn().mockResolvedValue(lifiResponse);
    const mw = { getLiFiQuote, getBebopQuote: vi.fn(), getFibrousQuote: vi.fn(), getFibrousRoute: vi.fn() } as any;

    const [lifi] = createAggregators(mw);
    await lifi.getQuotes([makeRequest()]);

    expect(getLiFiQuote).toHaveBeenCalledTimes(1);
    expect(mw.getBebopQuote).not.toHaveBeenCalled();
    expect(mw.getFibrousQuote).not.toHaveBeenCalled();
  });

  it('wires Bebop aggregator to mw.getBebopQuote', async () => {
    const bebopResponse = {
      sellTokens: { '0x0000000000000000000000000000000000000001': { amount: '1000', symbol: 'A', decimals: 6 } },
      buyTokens: { '0x0000000000000000000000000000000000000002': { amount: '900', minimumAmount: '900', symbol: 'B', decimals: 18 } },
      approvalTarget: '0x0000000000000000000000000000000000000003',
      tx: { to: '0x0000000000000000000000000000000000000004', data: '0x05', value: '0x0' },
      expiry: 9999,
    };
    const getBebopQuote = vi.fn().mockResolvedValue(bebopResponse);
    const mw = { getLiFiQuote: vi.fn(), getBebopQuote, getFibrousQuote: vi.fn(), getFibrousRoute: vi.fn() } as any;

    const [, bebop] = createAggregators(mw);
    await bebop.getQuotes([makeRequest()]);

    expect(getBebopQuote).toHaveBeenCalledTimes(2);
    expect(getBebopQuote.mock.calls.map(([, api]) => api)).toEqual(['aggregation', 'rfq']);
    expect(mw.getLiFiQuote).not.toHaveBeenCalled();
    expect(mw.getFibrousQuote).not.toHaveBeenCalled();
  });

  it('wires Fibrous aggregator to mw.getFibrousQuote', async () => {
    const fibrousResponse = {
      route: {
        success: true,
        routeSwapType: 1,
        inputToken: { name: 'A', symbol: 'A', address: '0x01', decimals: 6, price: 1 },
        inputAmount: '1000',
        outputToken: { name: 'B', symbol: 'B', address: '0x02', decimals: 18, price: 1 },
        outputAmount: '900',
      },
      calldata: {
        route: {
          token_in: '0x0000000000000000000000000000000000000001',
          token_out: '0x0000000000000000000000000000000000000002',
          amount_in: '1000',
          amount_out: '900',
          min_received: '890',
          destination: '0x0000000000000000000000000000000000000003',
          swap_type: 1,
        },
        swap_parameters: [{
          token_in: '0x0000000000000000000000000000000000000001',
          token_out: '0x0000000000000000000000000000000000000002',
          rate: '1', protocol_id: '1',
          pool_address: '0x0000000000000000000000000000000000000004',
          swap_type: 1, extra_data: '0x',
        }],
      },
      router_address: '0x0000000000000000000000000000000000000005',
    };
    const getFibrousQuote = vi.fn().mockResolvedValue(fibrousResponse);
    const mw = {
      getLiFiQuote: vi.fn(),
      getBebopQuote: vi.fn(),
      getFibrousQuote,
      getFibrousRoute: vi.fn(),
    } as any;

    // Use Citrea (4114) — the only Fibrous-supported chain.
    const [, , fibrous] = createAggregators(mw);
    await fibrous.getQuotes([{ ...makeRequest(), chainId: 4114 }]);

    expect(getFibrousQuote).toHaveBeenCalledTimes(1);
    expect(mw.getLiFiQuote).not.toHaveBeenCalled();
    expect(mw.getBebopQuote).not.toHaveBeenCalled();
  });
});
