import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiFiAggregator } from '../../../src/swap/aggregators/lifi';
import { QuoteSeriousness, QuoteType, type QuoteRequest } from '../../../src/swap/aggregators/types';

type ExactInQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_IN }>;

const makeRequest = (overrides: Partial<ExactInQuoteRequest> = {}): ExactInQuoteRequest => ({
  userAddress: '0xUserAddress0000000000000000000000000000' as `0x${string}`,
  recipientAddress: '0xReceiverAddr0000000000000000000000000' as `0x${string}`,
  chainId: 42161,
  inputToken: '0xInputToken000000000000000000000000000000' as `0x${string}`,
  outputToken: '0xOutputToken00000000000000000000000000000' as `0x${string}`,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount: 1000000n,
  ...overrides,
});

const makeLiFiResponseData = () => ({
  estimate: {
    fromAmount: '1000000',
    fromAmountUSD: '1.00',
    toAmount: '990000',
    toAmountMin: '980100',
    toAmountUSD: '0.99',
    approvalAddress: '0xApprovalAddress0000000000000000000000000',
    feeCosts: [],
    gasCosts: [],
  },
  action: {
    fromToken: {
      address: '0xInputToken000000000000000000000000000000',
      symbol: 'USDC',
      decimals: 6,
      priceUSD: '1',
    },
    toToken: {
      address: '0xOutputToken00000000000000000000000000000',
      symbol: 'WETH',
      decimals: 18,
      priceUSD: '4000',
    },
  },
  transactionRequest: {
    to: '0xLiFiRouter000000000000000000000000000000',
    data: '0xabcdef',
    value: '0x0',
  },
});

describe('LiFiAggregator', () => {
  let agg: LiFiAggregator;
  let getQuoteFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getQuoteFn = vi.fn().mockResolvedValue(makeLiFiResponseData());
    agg = new LiFiAggregator(
      getQuoteFn as unknown as (
        params: Record<string, string>,
        exactOut?: boolean
      ) => Promise<unknown>
    );
  });

  it('returns valid Quote for EXACT_IN request', async () => {
    const results = await agg.getQuotes([makeRequest()]);

    expect(results).toHaveLength(1);
    const quote = results[0];
    expect(quote).not.toBeNull();
    expect(quote!.output.amountRaw).toBe(980100n);
    expect(quote!.output.symbol).toBe('WETH');
    expect(quote!.input.amountRaw).toBe(1000000n);
    expect(quote!.txData.approvalAddress).toBe('0xApprovalAddress0000000000000000000000000');
    expect(quote!.txData.tx.to).toBe('0xLiFiRouter000000000000000000000000000000');
    expect(quote!.txData.tx.data).toBe('0xabcdef');
    expect(quote!.input.amount).toBe('1');
    expect(quote!.output.amount).toBe('0.0000000000009801');
  });

  it('computes input/output value from human amount × token priceUSD (ca-common parity)', async () => {
    // value must come from the token priceUSD applied to the delivered amount (toAmountMin for
    // output), NOT LiFi's reported fromAmountUSD/toAmountUSD — those are set wrong here to prove it.
    getQuoteFn.mockResolvedValueOnce({
      estimate: {
        fromAmount: '1000000', // 1 USDC (6dp)
        fromAmountUSD: '999', // must NOT be used
        toAmount: '5000000',
        toAmountMin: '4000000', // 4 DAI (6dp)
        toAmountUSD: '999', // must NOT be used
        approvalAddress: '0xApprovalAddress0000000000000000000000000',
        feeCosts: [],
        gasCosts: [],
      },
      action: {
        fromToken: { address: '0xInputToken000000000000000000000000000000', symbol: 'USDC', decimals: 6, priceUSD: '1' },
        toToken: { address: '0xOutputToken00000000000000000000000000000', symbol: 'DAI', decimals: 6, priceUSD: '1.5' },
      },
      transactionRequest: { to: '0xLiFiRouter000000000000000000000000000000', data: '0xabcdef', value: '0x0' },
    });

    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote!.input.value).toBe(1); // 1 USDC × $1
    expect(quote!.output.value).toBe(6); // 4 DAI (toAmountMin) × $1.5
  });

  it('surfaces per-token priceUsd so price-less siblings (0x) can backfill from it', async () => {
    const [quote] = await agg.getQuotes([makeRequest()]);

    expect(quote!.input.priceUsd).toBe(1); // fromToken.priceUSD
    expect(quote!.output.priceUsd).toBe(4000); // toToken.priceUSD
  });

  it('calls getQuote with correct params for EXACT_IN', async () => {
    await agg.getQuotes([makeRequest()]);

    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    const [params, exactOut] = getQuoteFn.mock.calls[0];
    expect(params.fromChain).toBe(42161);
    expect(params.toChain).toBe(42161);
    expect(params.fromToken).toBe('0xInputToken000000000000000000000000000000');
    expect(params.toToken).toBe('0xOutputToken00000000000000000000000000000');
    expect(params.fromAmount).toBe('1000000');
    expect(params.denyExchanges).toBe('openocean');
    expect(params.skipSimulation).toBe(true);
    expect(exactOut).toBe(false);
  });

  it('calls getQuote with exactOut=true for EXACT_OUT', async () => {
    const exactOutRequest: QuoteRequest = {
      userAddress: '0xUserAddress0000000000000000000000000000' as `0x${string}`,
      recipientAddress: '0xReceiverAddr0000000000000000000000000' as `0x${string}`,
      chainId: 42161,
      inputToken: '0xInputToken000000000000000000000000000000' as `0x${string}`,
      outputToken: '0xOutputToken00000000000000000000000000000' as `0x${string}`,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_OUT,
      outputAmount: 500000n,
    };
    await agg.getQuotes([exactOutRequest]);

    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    const [params, exactOut] = getQuoteFn.mock.calls[0];
    expect(params.toAmount).toBe('500000');
    expect(exactOut).toBe(true);
  });

  it('passes recipientAddress as toAddress parameter', async () => {
    const recipientAddress = '0xRecipientAddr0000000000000000000000000' as `0x${string}`;
    await agg.getQuotes([makeRequest({ recipientAddress })]);

    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.toAddress).toBe(recipientAddress);
  });

  it('does not send API key headers (proxy handles auth)', async () => {
    await agg.getQuotes([makeRequest()]);

    // getQuote is called with (params, exactOut) — no headers argument
    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    expect(getQuoteFn.mock.calls[0]).toHaveLength(2);
  });

  it('includes denyExchanges, skipSimulation, and slippage in params', async () => {
    await agg.getQuotes([makeRequest()]);

    const [params] = getQuoteFn.mock.calls[0];
    expect(params.denyExchanges).toBe('openocean');
    expect(params.skipSimulation).toBe(true);
    expect(params.slippage).toBe('0.0025'); // 25 bps as a fraction
  });

  it('denies HyperEVM-specific exchanges in addition to openocean on chain 999', async () => {
    // fly/hyperflow/liquidswap share one on-chain entry on HyperEVM and over-quote native
    // HYPE->USDC by 5-11%, causing InsufficientAmountOut (0xe52970aa) at execution.
    await agg.getQuotes([makeRequest({ chainId: 999 })]);

    const [params] = getQuoteFn.mock.calls[0];
    expect(params.denyExchanges).toBe('openocean,fly,hyperflow,liquidswap');
  });

  it('denies only openocean on chains without a per-chain denylist', async () => {
    await agg.getQuotes([makeRequest({ chainId: 8453 })]);

    const [params] = getQuoteFn.mock.calls[0];
    expect(params.denyExchanges).toBe('openocean');
  });

  it('returns null when getQuote throws (no available quotes)', async () => {
    getQuoteFn.mockRejectedValueOnce(new Error('Not found'));

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

  it('handles multiple requests in parallel', async () => {
    const requests = [makeRequest(), makeRequest({ chainId: 10 })];

    const results = await agg.getQuotes(requests);

    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(getQuoteFn).toHaveBeenCalledTimes(2);
  });

  it('handles mixed results (one success, one failure)', async () => {
    getQuoteFn
      .mockResolvedValueOnce(makeLiFiResponseData())
      .mockRejectedValueOnce(new Error('fail'));

    const results = await agg.getQuotes([makeRequest(), makeRequest({ chainId: 10 })]);

    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
  });

  it('short-circuits to null on chains LiFi does not support without firing a quote request', async () => {
    // Chain 4114 (Citrea) is not in v1's LiFiAllowedChains. Without the gate v2 would
    // fire a request and rely on the HTTP layer to return 404; with the gate we return
    // null immediately and skip the round-trip entirely.
    const results = await agg.getQuotes([makeRequest({ chainId: 4114 })]);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeNull();
    expect(getQuoteFn).not.toHaveBeenCalled();
  });

  it('returns null for the unsupported chain in a mixed batch but still quotes the supported one', async () => {
    const results = await agg.getQuotes([
      makeRequest({ chainId: 4114 }),
      makeRequest({ chainId: 42161 }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).not.toBeNull();
    expect(getQuoteFn).toHaveBeenCalledTimes(1);
  });
});

describe('LiFiAggregator supportsChain', () => {
  const agg = new LiFiAggregator(vi.fn());

  it('reports a listed chain as supported', () => {
    expect(agg.supportsChain(8453)).toBe(true);
  });

  it('reports an unlisted chain as unsupported', () => {
    expect(agg.supportsChain(4114)).toBe(false);
  });
});
