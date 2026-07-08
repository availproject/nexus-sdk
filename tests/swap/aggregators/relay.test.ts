import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseAbi, zeroAddress } from 'viem';
import { RelayAggregator } from '../../../src/swap/aggregators/relay';
import { QuoteSeriousness, QuoteType, type QuoteRequest } from '../../../src/swap/aggregators/types';
import { EADDRESS, ZERO_ADDRESS } from '../../../src/domain/constants/addresses';

type ExactInQuoteRequest = Extract<QuoteRequest, { type: QuoteType.EXACT_IN }>;

const INPUT = '0xaaaa000000000000000000000000000000000001' as const;
const OUTPUT = '0xbbbb000000000000000000000000000000000002' as const;
const TAKER = '0x1111111111111111111111111111111111111111' as const;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;
const ROUTER = '0xdddd000000000000000000000000000000000004' as const;
// Distinct from ROUTER so the assertion proves the approvalAddress comes from the approve step's
// calldata spender, not the swap tx `to`.
const SPENDER = '0xcccc000000000000000000000000000000000003' as const;
const APPROVE_CALLDATA = encodeFunctionData({
  abi: parseAbi(['function approve(address spender, uint256 value)']),
  functionName: 'approve',
  args: [SPENDER, 1_000_000n],
});

const makeRequest = (overrides: Partial<ExactInQuoteRequest> = {}): QuoteRequest => ({
  type: QuoteType.EXACT_IN,
  seriousness: QuoteSeriousness.SERIOUS,
  chainId: 42161,
  inputToken: INPUT,
  outputToken: OUTPUT,
  userAddress: TAKER,
  recipientAddress: RECIPIENT,
  inputAmount: 1_000_000n,
  ...overrides,
});

// Raw Relay /quote/v2 response — only the fields the adapter reads. Two steps (approve + swap) and
// the details block with slippage-protected `minimumAmount` alongside the expected `amount`.
const makeResponse = () => ({
  steps: [
    {
      id: 'approve',
      kind: 'transaction',
      items: [{ status: 'incomplete', data: { to: INPUT, data: APPROVE_CALLDATA, value: '0', chainId: 42161 } }],
    },
    {
      id: 'swap',
      kind: 'transaction',
      items: [{ status: 'incomplete', data: { to: ROUTER, data: '0xswapdata', value: '0', chainId: 42161 } }],
    },
  ],
  details: {
    currencyIn: {
      currency: { chainId: 42161, address: INPUT, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      amount: '1000000',
      amountFormatted: '1',
      amountUsd: '1',
      minimumAmount: '1000000',
    },
    currencyOut: {
      currency: { chainId: 42161, address: OUTPUT, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
      amount: '400000000000000',
      amountFormatted: '0.0004',
      amountUsd: '1.2',
      minimumAmount: '399000000000000',
    },
  },
});

const asProxy = (fn: unknown) => fn as (params: Record<string, string>) => Promise<unknown>;

describe('RelayAggregator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends same-chain EXACT_INPUT params at 25 bps slippage', async () => {
    const getQuote = vi.fn().mockResolvedValue(makeResponse());
    await new RelayAggregator(asProxy(getQuote)).getQuotes([makeRequest()]);

    const [params] = getQuote.mock.calls[0];
    expect(params.user).toBe(TAKER);
    expect(params.recipient).toBe(RECIPIENT);
    expect(params.originChainId).toBe('42161');
    expect(params.destinationChainId).toBe('42161'); // same-chain swap
    expect(params.originCurrency).toBe(INPUT);
    expect(params.destinationCurrency).toBe(OUTPUT);
    expect(params.amount).toBe('1000000');
    expect(params.tradeType).toBe('EXACT_INPUT');
    expect(params.slippageTolerance).toBe('25');
  });

  it('maps EXACT_IN → slippage-protected output (currencyOut.minimumAmount), swap step tx', async () => {
    const getQuote = vi.fn().mockResolvedValue(makeResponse());
    const [quote] = await new RelayAggregator(asProxy(getQuote)).getQuotes([makeRequest()]);

    expect(quote!.input.amountRaw).toBe(1000000n);
    expect(quote!.input.decimals).toBe(6);
    expect(quote!.input.symbol).toBe('USDC');
    expect(quote!.output.amountRaw).toBe(399000000000000n); // minimumAmount, NOT the expected amount
    expect(quote!.output.decimals).toBe(18);
    expect(quote!.output.symbol).toBe('WETH');
    // tx comes from the 'swap' step, never 'approve'.
    expect(quote!.txData.tx.to).toBe(ROUTER);
    expect(quote!.txData.tx.data).toBe('0xswapdata');
    expect(quote!.txData.tx.value).toBe('0x0');
    // approvalAddress is the spender the approve step encodes, not the swap tx `to`
    // (decodeFunctionData returns it checksummed; addresses compare case-insensitively).
    expect(quote!.txData.approvalAddress.toLowerCase()).toBe(SPENDER);
  });

  it('EXACT_OUT: delivers the exact requested output (currencyOut.amount), EXACT_OUTPUT trade type', async () => {
    const getQuote = vi.fn().mockResolvedValue(makeResponse());
    const req: QuoteRequest = {
      type: QuoteType.EXACT_OUT,
      seriousness: QuoteSeriousness.SERIOUS,
      chainId: 42161,
      inputToken: INPUT,
      outputToken: OUTPUT,
      userAddress: TAKER,
      recipientAddress: RECIPIENT,
      outputAmount: 400000000000000n,
    };
    const [quote] = await new RelayAggregator(asProxy(getQuote)).getQuotes([req]);

    const [params] = getQuote.mock.calls[0];
    expect(params.tradeType).toBe('EXACT_OUTPUT');
    expect(params.amount).toBe('400000000000000');
    expect(quote!.output.amountRaw).toBe(400000000000000n); // exact requested, NOT the minimum floor
    expect(quote!.input.amountRaw).toBe(1000000n);
  });

  it('native input: originCurrency = ZERO_ADDRESS, approvalAddress = zero, quote keeps EADDRESS', async () => {
    const res = makeResponse();
    res.steps[1].items[0].data.value = '1000000000000000000'; // native rides the swap tx value
    const getQuote = vi.fn().mockResolvedValue(res);
    const [quote] = await new RelayAggregator(asProxy(getQuote)).getQuotes([
      makeRequest({ inputToken: EADDRESS }),
    ]);

    const [params] = getQuote.mock.calls[0];
    expect(params.originCurrency).toBe(ZERO_ADDRESS); // Relay's native sentinel is the zero address
    expect(quote!.input.contractAddress).toBe(EADDRESS); // SDK-canonical native preserved on the quote
    expect(quote!.txData.approvalAddress).toBe(zeroAddress); // native input needs no approval
    expect(quote!.txData.tx.value).toBe('0xde0b6b3a7640000'); // 1e18, decimal string → hex
  });

  it('returns null when the proxy throws', async () => {
    const getQuote = vi.fn().mockRejectedValue(new Error('boom'));
    const [quote] = await new RelayAggregator(asProxy(getQuote)).getQuotes([makeRequest()]);
    expect(quote).toBeNull();
  });

  it('returns null when no executable (non-approve) step is present', async () => {
    const res = makeResponse();
    res.steps = [res.steps[0]]; // only the approve step, nothing to execute
    const getQuote = vi.fn().mockResolvedValue(res);
    const [quote] = await new RelayAggregator(asProxy(getQuote)).getQuotes([makeRequest()]);
    expect(quote).toBeNull();
  });
});

describe('RelayAggregator supportsChain', () => {
  const agg = new RelayAggregator(vi.fn());

  it('reports listed chains as supported', () => {
    expect(agg.supportsChain(1)).toBe(true);
    expect(agg.supportsChain(8453)).toBe(true);
    expect(agg.supportsChain(42161)).toBe(true);
  });

  it('reports Citrea and Kaia as unsupported', () => {
    expect(agg.supportsChain(4114)).toBe(false);
    expect(agg.supportsChain(8217)).toBe(false);
  });

  it('still fires the proxy for a chain outside SUPPORTED_CHAINS (no local gate — Relay is the zero-supporter fallback probe)', async () => {
    const getQuote = vi.fn().mockResolvedValue(makeResponse());
    await new RelayAggregator(asProxy(getQuote)).getQuotes([makeRequest({ chainId: 777777 })]);
    expect(getQuote).toHaveBeenCalledTimes(1);
  });
});
