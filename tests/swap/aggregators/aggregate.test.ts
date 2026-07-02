import { describe, expect, it, vi } from 'vitest';
import {
  AggregateMode,
  aggregateAggregators,
  createAggregators,
} from '../../../src/swap/aggregators';
import type { Aggregator, Quote, QuoteRequest } from '../../../src/swap/aggregators/types';
import { QuoteSeriousness, QuoteType } from '../../../src/swap/aggregators/types';
import { LiFiAggregator } from '../../../src/swap/aggregators/lifi';
import { ZeroExAggregator } from '../../../src/swap/aggregators/zerox';
import { EADDRESS } from '../../../src/swap/constants';
import { ZERO_ADDRESS } from '../../../src/domain/constants/addresses';

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
    };
    const aggB: Aggregator = {
      getQuotes: vi.fn().mockRejectedValue(new Error('fail B')),
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
    const lifi = new LiFiAggregator(vi.fn().mockResolvedValue(lifiResponse()) as any);
    const zerox = new ZeroExAggregator(vi.fn().mockResolvedValue(zeroExResponse()) as any);

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

  it('drops a winning 0x quote when no sibling can supply decimals', async () => {
    const zerox = new ZeroExAggregator(vi.fn().mockResolvedValue(zeroExResponse()) as any);
    const none = makeAggregator([null]);

    const [res] = await aggregateAggregators([makeRequest()], [zerox, none], AggregateMode.MaximizeOutput);

    expect(res.quote).toBeNull(); // 0x-only leg → falls back to no-0x coverage
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

describe('createAggregators', () => {
  it('returns LiFi, Bebop, Fibrous, and 0x aggregators when given a MiddlewareClient', () => {
    const mockMiddlewareClient = {
      getLiFiQuote: vi.fn(),
      getBebopQuote: vi.fn(),
      getFibrousQuote: vi.fn(),
      getZeroExQuote: vi.fn(),
    } as any;
    const aggs = createAggregators(mockMiddlewareClient);
    expect(aggs).toHaveLength(4);
  });

  it('wires 0x aggregator to mw.getZeroExQuote', async () => {
    const getZeroExQuote = vi.fn().mockResolvedValue(zeroExResponse());
    const mw = { getLiFiQuote: vi.fn(), getBebopQuote: vi.fn(), getFibrousQuote: vi.fn(), getZeroExQuote } as any;

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
    const mw = { getLiFiQuote, getBebopQuote: vi.fn(), getFibrousQuote: vi.fn() } as any;

    const [lifi] = createAggregators(mw);
    await lifi.getQuotes([makeRequest()]);

    expect(getLiFiQuote).toHaveBeenCalledTimes(1);
    expect(mw.getBebopQuote).not.toHaveBeenCalled();
    expect(mw.getFibrousQuote).not.toHaveBeenCalled();
  });

  it('wires Bebop aggregator to mw.getBebopQuote', async () => {
    const bebopResponse = {
      routes: [{
        quote: {
          sellTokens: { '0x0000000000000000000000000000000000000001': { amount: '1000', symbol: 'A', decimals: 6 } },
          buyTokens: { '0x0000000000000000000000000000000000000002': { minimumAmount: '900', symbol: 'B', decimals: 18 } },
          approvalTarget: '0x0000000000000000000000000000000000000003', tx: { to: '0x0000000000000000000000000000000000000004', data: '0x05', value: '0x0' }, expiry: 9999,
        },
      }],
    };
    const getBebopQuote = vi.fn().mockResolvedValue(bebopResponse);
    const mw = { getLiFiQuote: vi.fn(), getBebopQuote, getFibrousQuote: vi.fn() } as any;

    const [, bebop] = createAggregators(mw);
    await bebop.getQuotes([makeRequest()]);

    expect(getBebopQuote).toHaveBeenCalledTimes(1);
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
    const mw = { getLiFiQuote: vi.fn(), getBebopQuote: vi.fn(), getFibrousQuote } as any;

    // Use Citrea (4114) — the only Fibrous-supported chain.
    const [, , fibrous] = createAggregators(mw);
    await fibrous.getQuotes([{ ...makeRequest(), chainId: 4114 }]);

    expect(getFibrousQuote).toHaveBeenCalledTimes(1);
    expect(mw.getLiFiQuote).not.toHaveBeenCalled();
    expect(mw.getBebopQuote).not.toHaveBeenCalled();
  });
});
