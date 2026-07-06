import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, zeroAddress } from 'viem';
import { FibrousAggregator } from '../../../src/swap/aggregators/fibrous';
import { QuoteSeriousness, QuoteType, type QuoteRequest } from '../../../src/swap/aggregators/types';

type ExactInQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_IN }>;

const USER = getAddress('0x1111111111111111111111111111111111111111');
const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
const INPUT_TOKEN = getAddress('0x3333333333333333333333333333333333333333');
const OUTPUT_TOKEN = getAddress('0x4444444444444444444444444444444444444444');
const ROUTER = getAddress('0x5555555555555555555555555555555555555555');
const POOL = getAddress('0x6666666666666666666666666666666666666666');

const makeRequest = (overrides: Partial<ExactInQuoteRequest> = {}): ExactInQuoteRequest => ({
  userAddress: USER,
  recipientAddress: RECIPIENT,
  // Citrea (4114) is the only chain Fibrous serves (HyperEVM/Monad disabled — see fibrous.ts).
  chainId: 4114,
  inputToken: INPUT_TOKEN,
  outputToken: OUTPUT_TOKEN,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount: 1_000_000n,
  ...overrides,
});

const makeFibrousResponse = (overrides: { swap_type?: number; success?: boolean; swap_parameters_empty?: boolean } = {}) => {
  const swap_type = overrides.swap_type ?? 1;
  return {
    route: {
      success: overrides.success ?? true,
      routeSwapType: 1,
      inputToken: {
        name: 'USD Coin',
        symbol: 'USDC',
        address: INPUT_TOKEN,
        decimals: 6,
        price: 1,
      },
      inputAmount: '1000000',
      outputToken: {
        name: 'Hyperliquid',
        symbol: 'HYPE',
        address: OUTPUT_TOKEN,
        decimals: 18,
        price: 25,
      },
      outputAmount: '40000000000000000',
    },
    calldata: {
      route: {
        token_in: INPUT_TOKEN,
        token_out: OUTPUT_TOKEN,
        amount_in: '1000000',
        amount_out: '40000000000000000',
        min_received: '39800000000000000',
        destination: RECIPIENT,
        swap_type,
      },
      swap_parameters: overrides.swap_parameters_empty
        ? []
        : [
            {
              token_in: INPUT_TOKEN,
              token_out: OUTPUT_TOKEN,
              rate: '1000000',
              protocol_id: '1',
              pool_address: POOL,
              swap_type,
              extra_data: '0x',
            },
          ],
    },
    router_address: ROUTER,
  };
};

describe('FibrousAggregator', () => {
  let agg: FibrousAggregator;
  let getQuoteFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getQuoteFn = vi.fn().mockResolvedValue(makeFibrousResponse());
    agg = new FibrousAggregator(
      getQuoteFn as unknown as (params: Record<string, string>) => Promise<unknown>
    );
  });

  it('returns a Quote for EXACT_IN on a supported chain', async () => {
    const results = await agg.getQuotes([makeRequest()]);

    expect(results).toHaveLength(1);
    const quote = results[0];
    expect(quote).not.toBeNull();
    expect(quote!.input.amountRaw).toBe(1_000_000n);
    expect(quote!.input.contractAddress).toBe(INPUT_TOKEN);
    expect(quote!.input.decimals).toBe(6);
    expect(quote!.input.symbol).toBe('USDC');
    // Output amount uses min_received (slippage-protected), not raw outputAmount.
    expect(quote!.output.amountRaw).toBe(39_800_000_000_000_000n);
    expect(quote!.output.contractAddress).toBe(OUTPUT_TOKEN);
    expect(quote!.output.decimals).toBe(18);
    expect(quote!.output.symbol).toBe('HYPE');
  });

  it('passes the chain name in params so the transport can build the proxy path', async () => {
    await agg.getQuotes([makeRequest({ chainId: 4114 })]);
    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.chain).toBe('citrea');
  });

  it('uses recipientAddress as destination (G1c — receiver decoupled from taker)', async () => {
    await agg.getQuotes([makeRequest()]);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.destination).toBe(RECIPIENT);
  });

  it('sends excludeProtocols=3 by default (denylists faulty AMM, ca-common #100)', async () => {
    await agg.getQuotes([makeRequest()]);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.excludeProtocols).toBe('3');
  });

  it('sends slippage and token/amount params', async () => {
    await agg.getQuotes([makeRequest()]);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.amount).toBe('1000000');
    expect(params.tokenInAddress).toBe(INPUT_TOKEN);
    expect(params.tokenOutAddress).toBe(OUTPUT_TOKEN);
    expect(params.slippage).toBe('0.25');
  });

  it('returns null for EXACT_OUT without calling getQuote (Fibrous is EXACT_IN only)', async () => {
    const exactOutRequest: QuoteRequest = {
      userAddress: USER,
      recipientAddress: RECIPIENT,
      chainId: 999,
      inputToken: INPUT_TOKEN,
      outputToken: OUTPUT_TOKEN,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_OUT,
      outputAmount: 500_000n,
    };
    const results = await agg.getQuotes([exactOutRequest]);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeNull();
    expect(getQuoteFn).not.toHaveBeenCalled();
  });

  it('short-circuits to null on unsupported chains without firing a request', async () => {
    // Ethereum (1), Arbitrum (42161), Base (8453, disabled per #99 liquidity) are not in
    // Fibrous's chain map — return null immediately to skip the round-trip.
    const results = await agg.getQuotes([
      makeRequest({ chainId: 1 }),
      makeRequest({ chainId: 42161 }),
      makeRequest({ chainId: 8453 }),
    ]);
    expect(results).toEqual([null, null, null]);
    expect(getQuoteFn).not.toHaveBeenCalled();
  });

  it('serves Citrea (4114) only — HyperEVM (999) and Monad (143) are disabled', async () => {
    // HyperEVM/Monad were commented out of CHAIN_NAME_MAP (Fibrous over-quoted → on-chain
    // min-received reverts); only Citrea remains. Off-list chains return null without a request.
    const results = await agg.getQuotes([
      makeRequest({ chainId: 999 }),
      makeRequest({ chainId: 143 }),
      makeRequest({ chainId: 4114 }),
    ]);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).not.toBeNull();
    expect(getQuoteFn).toHaveBeenCalledTimes(1);
    expect(getQuoteFn.mock.calls[0][0].chain).toBe('citrea');
  });

  it('returns null when getQuote throws', async () => {
    getQuoteFn.mockRejectedValueOnce(new Error('upstream 404'));
    const results = await agg.getQuotes([makeRequest()]);
    expect(results).toEqual([null]);
  });

  it('returns null when Fibrous reports route.success=false', async () => {
    getQuoteFn.mockResolvedValueOnce(makeFibrousResponse({ success: false }));
    const results = await agg.getQuotes([makeRequest()]);
    expect(results).toEqual([null]);
  });

  it('returns null when swap_parameters is empty (no executable route)', async () => {
    getQuoteFn.mockResolvedValueOnce(makeFibrousResponse({ swap_parameters_empty: true }));
    const results = await agg.getQuotes([makeRequest()]);
    expect(results).toEqual([null]);
  });

  it('uses the Fibrous router as approvalAddress for ERC20 input (swap_type != 0)', async () => {
    const results = await agg.getQuotes([makeRequest()]);
    const quote = results[0]!;
    expect(quote.txData.approvalAddress).toBe(ROUTER);
    expect(quote.txData.tx.to).toBe(ROUTER);
    expect(quote.txData.tx.value).toBe('0x0');
  });

  it('uses zeroAddress approval and forwards amount_in as tx value for native input (swap_type === 0)', async () => {
    getQuoteFn.mockResolvedValueOnce(makeFibrousResponse({ swap_type: 0 }));
    const results = await agg.getQuotes([makeRequest()]);
    const quote = results[0]!;
    expect(quote.txData.approvalAddress).toBe(zeroAddress);
    expect(quote.txData.tx.to).toBe(ROUTER);
    // amount_in (1_000_000) encoded as hex
    expect(BigInt(quote.txData.tx.value)).toBe(1_000_000n);
  });

  it('handles multiple requests in parallel', async () => {
    const results = await agg.getQuotes([makeRequest(), makeRequest({ chainId: 4114 })]);
    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(getQuoteFn).toHaveBeenCalledTimes(2);
  });

  it('supports overriding excludeProtocols via constructor option', async () => {
    const custom = new FibrousAggregator(
      getQuoteFn as unknown as (params: Record<string, string>) => Promise<unknown>,
      { excludeProtocols: '3,5' }
    );
    await custom.getQuotes([makeRequest()]);
    const [params] = getQuoteFn.mock.calls[0];
    expect(params.excludeProtocols).toBe('3,5');
  });
});

describe('FibrousAggregator supportsChain', () => {
  const agg = new FibrousAggregator(vi.fn());

  it('reports Citrea as supported', () => {
    expect(agg.supportsChain(4114)).toBe(true);
  });

  it('reports an unlisted chain as unsupported', () => {
    expect(agg.supportsChain(8453)).toBe(false);
  });
});
