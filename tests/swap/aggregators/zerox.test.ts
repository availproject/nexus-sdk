import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZeroExAggregator } from '../../../src/swap/aggregators/zerox';
import { QuoteSeriousness, QuoteType, type QuoteRequest } from '../../../src/swap/aggregators/types';

type ExactInQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_IN }>;

const INPUT = '0x0000000000000000000000000000000000000a11' as `0x${string}`;
const OUTPUT = '0x0000000000000000000000000000000000000b22' as `0x${string}`;
const ALLOWANCE_TARGET = '0x0000000000000000000000000000000000a110ce' as `0x${string}`;
const SETTLER = '0x0000000000000000000000000000000005e771e2' as `0x${string}`;

const makeRequest = (overrides: Partial<ExactInQuoteRequest> = {}): ExactInQuoteRequest => ({
  userAddress: '0x1111111111111111111111111111111111111111',
  recipientAddress: '0x2222222222222222222222222222222222222222',
  chainId: 42161,
  inputToken: INPUT,
  outputToken: OUTPUT,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount: 1000000n,
  ...overrides,
});

// 0x allowance-holder EXACT_IN response (Response20000): NO token decimals, NO priceUsd.
const makeExactInResponse = () => ({
  liquidityAvailable: true,
  sellToken: INPUT,
  buyToken: OUTPUT,
  sellAmount: '1000000',
  buyAmount: '990000000000000000',
  minBuyAmount: '980100000000000000',
  allowanceTarget: ALLOWANCE_TARGET,
  transaction: { to: SETTLER, data: '0xabcdef', gas: '210000', gasPrice: '1000000000', value: '0x0' },
  zid: '0xzid',
});

// 0x /price (indicative) response — same amounts as /quote but NO transaction/calldata.
const makeExactInPriceResponse = () => ({
  liquidityAvailable: true,
  sellToken: INPUT,
  buyToken: OUTPUT,
  sellAmount: '1000000',
  buyAmount: '990000000000000000',
  minBuyAmount: '980100000000000000',
  allowanceTarget: ALLOWANCE_TARGET,
  zid: '0xzid',
});

// 0x allowance-holder EXACT_OUT response (Response20001): exact buyAmount, protected maxSellAmount.
const makeExactOutResponse = () => ({
  liquidityAvailable: true,
  sellToken: INPUT,
  buyToken: OUTPUT,
  buyAmount: '500000',
  maxSellAmount: '1020000',
  estimatedNetSellAmount: '1000000',
  allowanceTarget: ALLOWANCE_TARGET,
  transaction: { to: SETTLER, data: '0xfeed', gas: '210000', gasPrice: '1000000000', value: '0x0' },
  zid: '0xzid',
});

describe('ZeroExAggregator', () => {
  let agg: ZeroExAggregator;
  let getPriceFn: ReturnType<typeof vi.fn>;
  let getQuoteFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getPriceFn = vi.fn().mockResolvedValue(makeExactInPriceResponse());
    getQuoteFn = vi.fn().mockResolvedValue(makeExactInResponse());
    agg = new ZeroExAggregator(
      getPriceFn as unknown as (params: Record<string, string>) => Promise<unknown>,
      getQuoteFn as unknown as (params: Record<string, string>) => Promise<unknown>
    );
  });

  it('maps an EXACT_IN response using the slippage-protected output (minBuyAmount)', async () => {
    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).not.toBeNull();
    expect(quote!.input.amountRaw).toBe(1000000n); // sellAmount
    expect(quote!.output.amountRaw).toBe(980100000000000000n); // minBuyAmount, NOT buyAmount
    expect(quote!.expectedOutput.amountRaw).toBe(990000000000000000n);
    expect(quote!.input.contractAddress).toBe(INPUT);
    expect(quote!.output.contractAddress).toBe(OUTPUT);
    expect(quote!.txData.approvalAddress).toBe(ALLOWANCE_TARGET);
    expect(quote!.txData.tx.to).toBe(SETTLER);
    expect(quote!.txData.tx.data).toBe('0xabcdef');
    expect(quote!.txData.tx.value).toBe('0x0');
  });

  it('surveys via /price (indicative, no calldata); SERIOUS uses /quote', async () => {
    const [survey] = await agg.getQuotes([
      makeRequest({ seriousness: QuoteSeriousness.PRICE_SURVEY }),
    ]);
    expect(getPriceFn).toHaveBeenCalledTimes(1);
    expect(getQuoteFn).not.toHaveBeenCalled();
    expect(survey!.output.amountRaw).toBe(980100000000000000n); // minBuyAmount, parsed from /price
    expect(survey!.txData.tx.data).toBe('0x'); // non-executable placeholder (no calldata)

    await agg.getQuotes([makeRequest()]); // SERIOUS → /quote
    expect(getQuoteFn).toHaveBeenCalledTimes(1);
  });

  it('reports no USD price (priceUsd undefined, value 0) — enrichment fills it from a sibling', async () => {
    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote!.input.priceUsd).toBeUndefined();
    expect(quote!.output.priceUsd).toBeUndefined();
    expect(quote!.input.value).toBe(0);
    expect(quote!.output.value).toBe(0);
  });

  it('sends 0x param names (sellAmount/sellToken/buyToken/taker/recipient/slippageBps)', async () => {
    await agg.getQuotes([makeRequest()]);

    const [params] = getQuoteFn.mock.calls[0];
    expect(params.chainId).toBe('42161');
    expect(params.sellToken).toBe(INPUT);
    expect(params.buyToken).toBe(OUTPUT);
    expect(params.taker).toBe('0x1111111111111111111111111111111111111111');
    expect(params.recipient).toBe('0x2222222222222222222222222222222222222222');
    expect(params.slippageBps).toBe('25');
    expect(params.sellAmount).toBe('1000000');
    expect(params.buyAmount).toBeUndefined();
  });

  it('maps an EXACT_OUT response: exact buyAmount out, protected maxSellAmount in', async () => {
    getQuoteFn.mockResolvedValueOnce(makeExactOutResponse());
    const exactOut: QuoteRequest = {
      userAddress: '0x1111111111111111111111111111111111111111',
      recipientAddress: '0x2222222222222222222222222222222222222222',
      chainId: 42161,
      inputToken: INPUT,
      outputToken: OUTPUT,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_OUT,
      outputAmount: 500000n,
    };

    const [quote] = await agg.getQuotes([exactOut]);

    expect(quote!.output.amountRaw).toBe(500000n); // buyAmount (exact)
    expect(quote!.input.amountRaw).toBe(1020000n); // maxSellAmount (protected ceiling)
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.buyAmount).toBe('500000');
    expect(params.sellAmount).toBeUndefined();
  });

  it('returns null when liquidityAvailable is false', async () => {
    getQuoteFn.mockResolvedValueOnce({ liquidityAvailable: false });

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).toBeNull();
  });

  it('short-circuits unsupported chains without firing a request', async () => {
    const [quote] = await agg.getQuotes([makeRequest({ chainId: 4114 })]); // Citrea, not on 0x

    expect(quote).toBeNull();
    expect(getQuoteFn).not.toHaveBeenCalled();
  });

  it('returns null when getQuote throws', async () => {
    getQuoteFn.mockRejectedValueOnce(new Error('upstream 422'));

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote).toBeNull();
  });

  it('does not send API key headers (proxy handles auth)', async () => {
    await agg.getQuotes([makeRequest()]);

    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    expect(getQuoteFn.mock.calls[0]).toHaveLength(1); // (params) only
  });
});

describe('ZeroExAggregator supportsChain', () => {
  const agg = new ZeroExAggregator(vi.fn(), vi.fn());

  it('reports a listed chain as supported', () => {
    expect(agg.supportsChain(5000)).toBe(true);
  });

  it('reports an unlisted chain as unsupported', () => {
    expect(agg.supportsChain(4114)).toBe(false);
  });
});
