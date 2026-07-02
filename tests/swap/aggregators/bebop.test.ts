import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hex } from 'viem';
import { BebopAggregator } from '../../../src/swap/aggregators/bebop';
import { QuoteSeriousness, QuoteType, type QuoteRequest } from '../../../src/swap/aggregators/types';

// Real checksummed addresses — Bebop keys its response token maps by checksummed address and
// rejects/normalizes input addresses, so the SDK must checksum (matches ca-common's getAddress()).
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Hex; // USDC (Arbitrum)
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Hex; // WETH (Arbitrum)
const USER = getAddress('0x1111111111111111111111111111111111111111');
const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
const APPROVAL = getAddress('0x3333333333333333333333333333333333333333');
const ROUTER = getAddress('0x4444444444444444444444444444444444444444');
const APPROVAL2 = getAddress('0x5555555555555555555555555555555555555555');
const ROUTER2 = getAddress('0x6666666666666666666666666666666666666666');

// One route in the shape Bebop returns (USDC sell, WETH buy), for multi-route selection tests.
const makeRoute = (opts: {
  type: string;
  buyMinimumAmount: string;
  sellAmount: string;
  approvalTarget: Hex;
  to: Hex;
}) => ({
  type: opts.type,
  quote: {
    buyTokens: {
      [WETH]: { minimumAmount: opts.buyMinimumAmount, priceUsd: 3000, symbol: 'WETH', decimals: 18 },
    },
    sellTokens: {
      [USDC]: { amount: opts.sellAmount, priceUsd: 1, symbol: 'USDC', decimals: 6 },
    },
    approvalTarget: opts.approvalTarget,
    tx: { to: opts.to, data: '0xfedcba', value: '0x0' },
    expiry: Math.floor(Date.now() / 1000) + 60,
  },
});

type ExactInQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_IN }>;
type ExactOutQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_OUT }>;

const makeRequest = (overrides: Partial<ExactInQuoteRequest> = {}): ExactInQuoteRequest => ({
  userAddress: USER,
  recipientAddress: RECIPIENT,
  chainId: 42161,
  inputToken: USDC,
  outputToken: WETH,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount: 1000000n,
  ...overrides,
});

const makeExactOutRequest = (
  overrides: Partial<ExactOutQuoteRequest> = {}
): ExactOutQuoteRequest => ({
  userAddress: USER,
  recipientAddress: RECIPIENT,
  chainId: 42161,
  inputToken: USDC,
  outputToken: WETH,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_OUT,
  outputAmount: 980100000000000000n,
  ...overrides,
});

// Mirrors the real Bebop router response (see ca-common src/xcs/bebop-agg.ts): tx, approvalTarget
// and expiry live INSIDE route.quote alongside the token maps, which are keyed by checksummed
// address.
const makeBebopResponseData = (
  overrides?: {
    buyToken?: Partial<{ minimumAmount: string; priceUsd: number; symbol: string; decimals: number }>;
    sellToken?: Partial<{ amount: string; priceUsd: number; symbol: string; decimals: number }>;
  }
) => ({
  routes: [
    {
      type: 'PMMv3',
      quote: {
        buyTokens: {
          [WETH]: {
            minimumAmount: '980100000000000000',
            priceUsd: 3000,
            symbol: 'WETH',
            decimals: 18,
            ...overrides?.buyToken,
          },
        },
        sellTokens: {
          [USDC]: {
            amount: '1000000',
            priceUsd: 1.0,
            symbol: 'USDC',
            decimals: 6,
            ...overrides?.sellToken,
          },
        },
        approvalTarget: APPROVAL,
        tx: { to: ROUTER, data: '0xfedcba', value: '0x0' },
        expiry: Math.floor(Date.now() / 1000) + 60,
      },
    },
  ],
});

describe('BebopAggregator', () => {
  let agg: BebopAggregator;
  let getQuoteFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getQuoteFn = vi.fn().mockResolvedValue(makeBebopResponseData());
    agg = new BebopAggregator(
      getQuoteFn as unknown as (params: Record<string, string>) => Promise<unknown>
    );
  });

  it('parses a valid Quote from the nested route.quote shape (EXACT_IN)', async () => {
    const results = await agg.getQuotes([makeRequest()]);

    expect(results).toHaveLength(1);
    const quote = results[0];
    expect(quote).not.toBeNull();
    expect(quote!.output.amountRaw).toBe(980100000000000000n);
    expect(quote!.output.symbol).toBe('WETH');
    expect(quote!.output.contractAddress).toBe(WETH);
    expect(quote!.input.amountRaw).toBe(1000000n);
    expect(quote!.input.symbol).toBe('USDC');
    expect(quote!.input.contractAddress).toBe(USDC);
    // tx / approvalTarget / expiry come from route.quote, not the route top level.
    expect(quote!.txData.approvalAddress).toBe(APPROVAL);
    expect(quote!.txData.tx.to).toBe(ROUTER);
    expect(quote!.expiry).toBeGreaterThan(0);
    expect(quote!.input.amount).toBe('1.000000');
    expect(quote!.output.amount).toBe('0.980100000000000000');
  });

  it('surfaces per-token priceUsd so price-less siblings (0x) can backfill from it', async () => {
    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote!.input.priceUsd).toBe(1); // sellTokens[USDC].priceUsd
    expect(quote!.output.priceUsd).toBe(3000); // buyTokens[WETH].priceUsd
  });

  it('sends EXACT_IN request params matching the Bebop API', async () => {
    await agg.getQuotes([makeRequest({ chainId: 42161 })]);

    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.chain).toBe('arbitrum');
    expect(params.sell_tokens).toBe(USDC);
    expect(params.buy_tokens).toBe(WETH);
    expect(params.taker_address).toBe(USER);
    expect(params.receiver_address).toBe(RECIPIENT);
    expect(params.sell_amounts).toBe('1000000');
    expect(params.approval_type).toBe('Standard');
    expect(params.skip_validation).toBe('true');
    expect(params.gasless).toBe(false);
    expect(params.source).toBe('arcana');
    // The misnamed params from the old port must be gone.
    expect(params.receiver).toBeUndefined();
    expect(params.buy_amounts).toBeUndefined();
    expect(params.buy_tokens_amounts).toBeUndefined();
  });

  it('sends EXACT_OUT with buy_amounts (not buy_tokens_amounts) and no sell_amounts', async () => {
    await agg.getQuotes([makeExactOutRequest({ outputAmount: 980100000000000000n })]);

    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.buy_amounts).toBe('980100000000000000');
    expect(params.sell_amounts).toBeUndefined();
    expect(params.buy_tokens_amounts).toBeUndefined();
  });

  it('parses a valid Quote for EXACT_OUT', async () => {
    const results = await agg.getQuotes([makeExactOutRequest()]);

    expect(results[0]).not.toBeNull();
    expect(results[0]!.output.amountRaw).toBe(980100000000000000n);
  });

  it('EXACT_IN: selects the route with the most output, not just the first', async () => {
    // Bebop returns several routes (PMMv3, JAMv2, …); the first is not always the best.
    getQuoteFn.mockResolvedValueOnce({
      routes: [
        makeRoute({ type: 'PMMv3', buyMinimumAmount: '980000000000000000', sellAmount: '1000000', approvalTarget: APPROVAL, to: ROUTER }),
        makeRoute({ type: 'JAMv2', buyMinimumAmount: '990000000000000000', sellAmount: '1000000', approvalTarget: APPROVAL2, to: ROUTER2 }),
      ],
    });

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).not.toBeNull();
    expect(quote!.output.amountRaw).toBe(990000000000000000n); // JAMv2 delivers more
    // The whole route is taken from JAMv2, not just its amount.
    expect(quote!.txData.tx.to).toBe(ROUTER2);
    expect(quote!.txData.approvalAddress).toBe(APPROVAL2);
  });

  it('EXACT_OUT: selects the route with the least input, not just the first', async () => {
    getQuoteFn.mockResolvedValueOnce({
      routes: [
        makeRoute({ type: 'PMMv3', buyMinimumAmount: '980100000000000000', sellAmount: '3100000000', approvalTarget: APPROVAL, to: ROUTER }),
        makeRoute({ type: 'JAMv2', buyMinimumAmount: '980100000000000000', sellAmount: '3000000000', approvalTarget: APPROVAL2, to: ROUTER2 }),
      ],
    });

    const [quote] = await agg.getQuotes([makeExactOutRequest()]);

    expect(quote).not.toBeNull();
    expect(quote!.input.amountRaw).toBe(3000000000n); // JAMv2 costs less
    expect(quote!.txData.tx.to).toBe(ROUTER2);
  });

  it('checksums lowercase request addresses for both params and response lookup', async () => {
    const results = await agg.getQuotes([
      makeRequest({
        inputToken: USDC.toLowerCase() as Hex,
        outputToken: WETH.toLowerCase() as Hex,
        userAddress: USER.toLowerCase() as Hex,
        recipientAddress: RECIPIENT.toLowerCase() as Hex,
      }),
    ]);

    const [params] = getQuoteFn.mock.calls[0];
    expect(params.sell_tokens).toBe(USDC);
    expect(params.buy_tokens).toBe(WETH);
    expect(params.taker_address).toBe(USER);
    expect(params.receiver_address).toBe(RECIPIENT);
    // The response token maps are keyed by checksummed address — the quote must still resolve.
    expect(results[0]).not.toBeNull();
    expect(results[0]!.output.amountRaw).toBe(980100000000000000n);
  });

  it('does not send API key headers (proxy handles auth)', async () => {
    await agg.getQuotes([makeRequest()]);

    // getQuote is called with (params) only — no headers argument; Source-Auth is the proxy's job.
    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    expect(getQuoteFn.mock.calls[0]).toHaveLength(1);
  });

  it('returns null for unsupported chain', async () => {
    const results = await agg.getQuotes([makeRequest({ chainId: 999999 })]);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeNull();
    expect(getQuoteFn).not.toHaveBeenCalled();
  });

  it('returns null on API error', async () => {
    getQuoteFn.mockRejectedValueOnce(new Error('Internal Server Error'));

    const results = await agg.getQuotes([makeRequest()]);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeNull();
  });

  it('returns null on network timeout', async () => {
    getQuoteFn.mockRejectedValueOnce(new Error('timeout'));

    const results = await agg.getQuotes([makeRequest()]);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeNull();
  });

  it('returns a quote with value 0 when token priceUsd is missing (unpriced token)', async () => {
    // Bebop omits priceUsd for unpriced long-tail tokens. The quote is still usable —
    // it must not be dropped just because USD value is unavailable.
    getQuoteFn.mockResolvedValueOnce(
      makeBebopResponseData({
        buyToken: { priceUsd: undefined as unknown as number },
        sellToken: { priceUsd: undefined as unknown as number },
      })
    );

    const results = await agg.getQuotes([makeRequest()]);

    const quote = results[0];
    expect(quote).not.toBeNull();
    expect(quote!.input.value).toBe(0);
    expect(quote!.output.value).toBe(0);
    expect(quote!.output.amountRaw).toBe(980100000000000000n);
  });

  it('returns null when response has no routes', async () => {
    getQuoteFn.mockResolvedValueOnce({ routes: [] });

    const results = await agg.getQuotes([makeRequest()]);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeNull();
  });

  it('handles multiple requests in parallel', async () => {
    const requests = [makeRequest(), makeRequest({ chainId: 10 })];

    const results = await agg.getQuotes(requests);

    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(getQuoteFn).toHaveBeenCalledTimes(2);
  });
});
