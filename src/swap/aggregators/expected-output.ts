import Decimal from 'decimal.js';
import { divDecimals } from '../../services/math';
import type { Quote } from './types';

/**
 * Normalize an aggregator's unprotected output estimate without weakening its executable floor.
 * Missing, malformed, non-positive, or below-floor estimates collapse to `quote.output`.
 */
export const normalizeExpectedOutput = (
  expectedAmountRaw: unknown,
  protectedOutput: Quote['output']
): Quote['expectedOutput'] => {
  let amountRaw = protectedOutput.amountRaw;
  try {
    const candidate = BigInt(expectedAmountRaw as string | number | bigint);
    if (candidate > 0n && candidate >= protectedOutput.amountRaw) {
      amountRaw = candidate;
    }
  } catch {
    // Fall back to the executable protected output.
  }

  if (amountRaw === protectedOutput.amountRaw) {
    return {
      amountRaw,
      amount: protectedOutput.amount,
      value: protectedOutput.value,
    };
  }

  const amount = divDecimals(amountRaw, protectedOutput.decimals).toFixed();
  const protectedAmount = new Decimal(protectedOutput.amount);
  const priceUsd =
    protectedOutput.priceUsd ??
    (protectedAmount.gt(0) ? new Decimal(protectedOutput.value).div(protectedAmount).toNumber() : 0);

  return {
    amountRaw,
    amount,
    value: new Decimal(amount).mul(priceUsd).toNumber(),
  };
};

/** Recalculate metadata-dependent expected human/USD values after 0x/Mystic enrichment. */
export const refreshExpectedOutput = (quote: Quote): Quote => {
  // Normalized SDK quotes require expectedOutput. This guard only tolerates malformed runtime
  // objects from untyped/custom integrations; it does not make the normalized field optional.
  if (quote.expectedOutput) {
    quote.expectedOutput = normalizeExpectedOutput(quote.expectedOutput.amountRaw, quote.output);
  }
  return quote;
};
