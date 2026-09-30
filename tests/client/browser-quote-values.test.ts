import { describe, expect, it, vi } from 'vitest';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import { sponsoredQuoteResponse } from '../fixtures/better-intent';
import type { IntentQuote, SwapAndExecuteIntent } from '../../src';
import { mapCompositeIntent, mapSwapQuote } from '../../example/browser/src/lib/nexus';
import { formatUsd } from '../../example/browser/src/lib/format';
import { extractProgressResult } from '../../example/browser/src/hooks/useOperationForm';

const setup = () => {
  const quote = normalizeIntentQuote(sponsoredQuoteResponse()).quote;
  quote.provider = 'relay';
  Object.assign(quote.input[0]!, {
    tokenSymbol: 'ETH', amountRaw: 2_000_000_000_000_000_000n, amountUsd: '4000',
    depositFeeRaw: 100_000_000_000_000_000n, depositFeeUsd: '200',
    totalRequiredRaw: 2_100_000_000_000_000_000n, totalRequiredUsd: '4200',
  });
  Object.assign(quote.output, {
    amountRaw: 1_990_000_000_000_000_000n, amountUsd: '3980',
    minAmountRaw: 1_980_000_000_000_000_000n, minAmountUsd: '3960',
  });
  Object.assign(quote.fees, {
    depositRaw: 100_000_000_000_000_000n, depositUsd: '200',
    fulfillmentRaw: 10_000_000_000_000_000n, fulfillmentUsd: '20',
    protocolRaw: 2_500_000_000_000_000n, protocolUsd: '5',
    solverRaw: 7_500_000_000_000_000n, solverUsd: '15',
  });
  const client = {
    getSupportedChains: () => [],
    getToken: vi.fn(async () => ({ symbol: 'ETH', decimals: 18 })),
  } as unknown as Parameters<typeof mapSwapQuote>[0];
  return { quote, client };
};

const composite = (quote: IntentQuote): SwapAndExecuteIntent => ({
  swapRequired: true, quote,
  executeRequirement: {
    chain: { id: quote.output.chainId, name: 'Ethereum' },
    to: '0x00000000000000000000000000000000000000aa',
    token: { address: quote.output.tokenAddress, symbol: 'ETH', decimals: 18,
      amountRaw: 3_000_000_000_000_000_000n, amount: '3', valueUsd: '6000' },
    gas: { address: quote.output.tokenAddress, symbol: 'ETH', decimals: 18,
      amountRaw: 1_000_000_000_000_000n, amount: '0.001', valueUsd: '2',
      estimatedGasUnits: 120_000n, approvalGasUnits: 0n, l1FeeRaw: 0n,
      feeParams: { type: 'eip1559', maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }, priceTier: 'high' },
    nativeValue: { amountRaw: 500_000_000_000_000n, amount: '0.0005', valueUsd: '1' },
    tokenApproval: null,
  },
  available: {
    token: { amountRaw: 1_010_000_000_000_000_000n, amount: '1.01', valueUsd: '2020' },
    gas: { amountRaw: 500_000_000_000_000n, amount: '0.0005', valueUsd: '1' },
  },
  shortfall: {
    token: { amountRaw: 1_990_000_000_000_000_000n, amount: '1.99', valueUsd: '3980' },
    gas: { amountRaw: 1_000_000_000_000_000n, amount: '0.001', valueUsd: '2' },
  },
});

describe('browser quote USD values', () => {
  it('pairs source totals and destination amounts with their middleware USD valuations', async () => {
    const { quote, client } = setup();
    const view = await mapSwapQuote(client, quote);
    expect(view.sources[0]).toMatchObject({ amount: '2.1', value: '4200' });
    expect(view.sourcesTotal).toBe('4200');
    expect(view.destination).toMatchObject({
      amount: '1.99', value: '3980', minAmount: '1.98', minValue: '3960',
    });
  });

  it('does not assume a stablecoin peg or round before adding source values', async () => {
    const { quote, client } = setup();
    quote.input[0]!.tokenSymbol = 'USDC';
    quote.input[0]!.totalRequiredUsd = '1.004';
    quote.input.push({ ...quote.input[0]!, totalRequiredUsd: '2.004' });
    const view = await mapSwapQuote(client, quote);
    expect(view.sources.map((source) => source.value)).toEqual(['1.004', '2.004']);
    expect(view.sourcesTotal).toBe('3.008');
  });

  it.each(['mayan', 'relay', 'nexus-v2'] as const)('totals %s fees without treating raw token units as dollars or double-counting', async (provider) => {
    const { quote, client } = setup();
    quote.provider = provider;
    if (provider === 'nexus-v2') quote.fees.solverUsd = '0';
    const view = await mapSwapQuote(client, quote);
    expect(view.fees).toMatchObject({
      deposit: '200', fulfillment: '20', protocol: '5',
      total: provider === 'nexus-v2' ? '225' : '220',
    });
    expect(extractProgressResult('swap', view, null)).toMatchObject({
      sourcesTotal: '4200', feesTotal: view.fees.total,
      sources: [expect.objectContaining({ amount: '2.1', value: '4200' })],
    });
  });

  it('shows actual execution requirements, balances, and shortfalls from the composite payload', async () => {
    const { quote, client } = setup();
    const view = await mapCompositeIntent(client, composite(quote));
    expect(view.executeRequirement.token).toEqual({ symbol: 'ETH', amount: '3', value: '6000' });
    expect(view.executeRequirement.gas).toEqual({ symbol: 'ETH', amount: '0.001', value: '2', priceTier: 'high' });
    expect(view.executeRequirement.contractAddress).toBe('0x00000000000000000000000000000000000000aa');
    expect(view.executeRequirement.nativeValue).toEqual({ amount: '0.0005', value: '1' });
    expect(view.available.token).toEqual({ amount: '1.01', value: '2020' });
    expect(view.available.gas).toEqual({ amount: '0.0005', value: '1' });
    expect(view.shortfall?.token).toEqual({ amount: '1.99', value: '3980' });
    expect(view.shortfall?.gas).toEqual({ amount: '0.001', value: '2' });
    expect(extractProgressResult('swapAndExecute', null, view)?.feesTotal).toBe('220');
  });

  it('keeps unknown USD values absent', async () => {
    const { quote, client } = setup();
    const intent = composite(quote);
    delete intent.executeRequirement.token.valueUsd;
    delete intent.executeRequirement.gas.valueUsd;
    const view = await mapCompositeIntent(client, intent);
    expect(view.executeRequirement.token.value).toBeUndefined();
    expect(view.executeRequirement.gas.value).toBeUndefined();
  });

  it('shows fully funded execution without needing a middleware quote', async () => {
    const { quote, client } = setup();
    const intent: SwapAndExecuteIntent = { ...composite(quote), swapRequired: false, quote: undefined,
      shortfall: { token: { amountRaw: 0n, amount: '0' }, gas: { amountRaw: 0n, amount: '0' } },
    };
    const view = await mapCompositeIntent(client, intent);
    expect(view.swapRequired).toBe(false);
    expect(view.swap).toBeUndefined();
    expect(view.executeRequirement.gas.amount).toBe('0.001');
    expect(client.getToken).not.toHaveBeenCalled();
  });

  it.each([
    ['0', '$0.00'], ['0.000001', '<$0.01'], ['0.0099', '<$0.01'],
    ['0.01', '$0.01'], ['12.345', '$12.35'], ['9007199254740993.25', '$9007199254740993.25'],
  ])('formats %s USD for display without losing precision', (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });
});
