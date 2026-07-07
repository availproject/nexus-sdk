import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MysticAggregator } from '../../../src/swap/aggregators/mystic';
import { QuoteSeriousness, QuoteType, type QuoteRequest } from '../../../src/swap/aggregators/types';

type ExactInQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_IN }>;

const INPUT = '0x0000000000000000000000000000000000000a11' as `0x${string}`;
const OUTPUT = '0x0000000000000000000000000000000000000b22' as `0x${string}`;
const SPENDER = '0x00000000000000000000000000000000005e11de' as `0x${string}`;
const ROUTER = '0x00000000000000000000000000000000009007e2' as `0x${string}`;

const makeRequest = (overrides: Partial<ExactInQuoteRequest> = {}): ExactInQuoteRequest => ({
  userAddress: '0x1111111111111111111111111111111111111111',
  recipientAddress: '0x2222222222222222222222222222222222222222',
  chainId: 4114, // Citrea
  inputToken: INPUT,
  outputToken: OUTPUT,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount: 1000000n,
  ...overrides,
});

const quoteResponse = () => ({
  quoteSetId: 'qs_1',
  quotes: [
    { quoteId: 'uniswap-v3::qs_1', sellAmount: '1000000', buyAmount: '990000', minBuyAmount: '985000' },
  ],
});

const buildResponse = () => ({
  txRequest: { to: ROUTER, data: '0xabcdef', value: '0' }, // Mystic returns decimal wei
  approval: { token: INPUT, spender: SPENDER, amount: '1000000' },
});

describe('MysticAggregator', () => {
  let agg: MysticAggregator;
  // One proxy for every Mystic endpoint; dispatch the mock response by path.
  let postFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    postFn = vi.fn(async (path: string) =>
      path === 'v1/swap/build' ? buildResponse() : quoteResponse()
    );
    agg = new MysticAggregator(
      postFn as unknown as (path: string, body: Record<string, unknown>) => Promise<unknown>,
      vi.fn() as unknown as (chainId: number, address: string) => Promise<unknown>
    );
  });

  it('maps an EXACT_IN SERIOUS quote: sellAmount in, minBuyAmount out, tx from build', async () => {
    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).not.toBeNull();
    expect(quote!.input.amountRaw).toBe(1000000n); // sellAmount
    expect(quote!.output.amountRaw).toBe(985000n); // minBuyAmount, NOT buyAmount
    expect(quote!.txData.approvalAddress).toBe(SPENDER);
    expect(quote!.txData.tx.to).toBe(ROUTER);
    expect(quote!.txData.tx.data).toBe('0xabcdef');
    expect(quote!.txData.tx.value).toBe('0x0'); // decimal "0" -> hex
  });

  it('reports no token metadata (decimals 0, priceUsd undefined) — enrichment fills from a sibling', async () => {
    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote!.input.decimals).toBe(0);
    expect(quote!.output.priceUsd).toBeUndefined();
    expect(quote!.input.value).toBe(0);
  });

  it('sends the quote then the build with quoteSetId + quoteId', async () => {
    await agg.getQuotes([makeRequest()]);

    const [quotePath, quoteBody] = postFn.mock.calls[0];
    expect(quotePath).toBe('v1/swap/quote');
    expect(quoteBody.chainId).toBe(4114); // number, per Mystic's JSON schema
    expect(quoteBody.sellToken).toBe(INPUT);
    expect(quoteBody.buyToken).toBe(OUTPUT);
    expect(quoteBody.sellAmount).toBe('1000000');
    expect(quoteBody.taker).toBe('0x1111111111111111111111111111111111111111');

    const [buildPath, buildBody] = postFn.mock.calls[1];
    expect(buildPath).toBe('v1/swap/build');
    expect(buildBody.quoteSetId).toBe('qs_1');
    expect(buildBody.quoteId).toBe('uniswap-v3::qs_1');
  });

  it('skips the (simulating) build call on a price survey', async () => {
    const [quote] = await agg.getQuotes([makeRequest({ seriousness: QuoteSeriousness.PRICE_SURVEY })]);

    expect(quote!.output.amountRaw).toBe(985000n);
    expect(postFn).toHaveBeenCalledTimes(1); // quote only — build (which simulates) is skipped
    expect(postFn).not.toHaveBeenCalledWith('v1/swap/build', expect.anything());
  });

  it('uses zeroAddress approval for native sells (build.approval null)', async () => {
    postFn.mockImplementation(async (path: string) =>
      path === 'v1/swap/build' ? { ...buildResponse(), approval: null } : quoteResponse()
    );

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote!.txData.approvalAddress).toBe('0x0000000000000000000000000000000000000000');
  });

  it('returns null for EXACT_OUT (quote endpoint is sellAmount-only)', async () => {
    const exactOut: QuoteRequest = {
      userAddress: '0x1111111111111111111111111111111111111111',
      recipientAddress: '0x2222222222222222222222222222222222222222',
      chainId: 4114,
      inputToken: INPUT,
      outputToken: OUTPUT,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_OUT,
      outputAmount: 500000n,
    };

    const [quote] = await agg.getQuotes([exactOut]);

    expect(quote).toBeNull();
    expect(postFn).not.toHaveBeenCalled();
  });

  it('short-circuits unsupported chains without firing a request', async () => {
    const [quote] = await agg.getQuotes([makeRequest({ chainId: 1 })]); // Ethereum, not enabled yet

    expect(quote).toBeNull();
    expect(postFn).not.toHaveBeenCalled();
  });

  it('returns null when there are no quotes', async () => {
    postFn.mockResolvedValueOnce({ quoteSetId: 'qs_1', quotes: [] });

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).toBeNull();
    expect(postFn).toHaveBeenCalledTimes(1); // build not reached
  });

  it('returns null when getQuote throws', async () => {
    postFn.mockRejectedValueOnce(new Error('404 INSUFFICIENT_LIQUIDITY'));

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).toBeNull();
  });
});
