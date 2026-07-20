import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { selectExactInQuoteOutput } from '../../src/swap/amount-basis';
import type { Quote } from '../../src/swap/aggregators/types';

const quote = {
  output: {
    contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
    amountRaw: 980_000n,
    amount: '0.98',
    decimals: 6,
    value: 0.98,
    symbol: 'USDC',
  },
  expectedOutput: {
    amountRaw: 1_000_000n,
    amount: '1',
    value: 1,
  },
} as Quote;

describe('selectExactInQuoteOutput', () => {
  it('selects the normalized expected output in expected mode', () => {
    expect(selectExactInQuoteOutput(quote, 'expected')).toBe(quote.expectedOutput);
  });

  it('selects the executable output in minimum mode', () => {
    expect(selectExactInQuoteOutput(quote, 'minimum')).toBe(quote.output);
  });

  it('falls back to the executable output when expected output is absent', () => {
    const malformedRuntimeQuote = { ...quote, expectedOutput: undefined } as unknown as Quote;
    expect(selectExactInQuoteOutput(malformedRuntimeQuote, 'expected')).toBe(quote.output);
  });
});
