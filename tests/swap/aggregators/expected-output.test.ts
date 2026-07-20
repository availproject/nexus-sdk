import { describe, expect, it } from 'vitest';
import { normalizeExpectedOutput } from '../../../src/swap/aggregators/expected-output';
import type { Quote } from '../../../src/swap/aggregators/types';

const protectedOutput: Quote['output'] = {
  contractAddress: '0x0000000000000000000000000000000000000001',
  amount: '1',
  amountRaw: 1_000n,
  decimals: 3,
  value: 2,
  priceUsd: 2,
  symbol: 'OUT',
};

describe('normalizeExpectedOutput', () => {
  it.each([undefined, null, 'invalid', 0, -1, 999])(
    'falls back to the protected output for %s',
    (candidate) => {
      expect(normalizeExpectedOutput(candidate, protectedOutput)).toEqual({
        amountRaw: protectedOutput.amountRaw,
        amount: protectedOutput.amount,
        value: protectedOutput.value,
      });
    }
  );

  it('derives human and USD expected values from a valid above-minimum raw amount', () => {
    expect(normalizeExpectedOutput(1_200n, protectedOutput)).toEqual({
      amountRaw: 1_200n,
      amount: '1.2',
      value: 2.4,
    });
  });
});
