import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { divDecimals, mulDecimals } from '../../src/services/math';

// raw -> human (divDecimals) -> raw (mulDecimals) must be lossless. mulDecimals
// rounds with ROUND_CEIL, so any precision loss in the human step inflates the
// raw amount on the way back — which over-demands `transferFrom` and reverts
// on-chain. Default decimal.js precision is 20 significant figures, so 21+ sig-fig
// raw amounts (high-supply 18-decimal tokens: PEPE, SHIB, BONK) overshoot.
describe('divDecimals/mulDecimals round-trip is lossless for large raw amounts', () => {
  const roundTrip = (raw: bigint, decimals: number): bigint =>
    mulDecimals(divDecimals(raw, decimals), decimals);

  it('round-trips the production PEPE balance (21 sig figs, 18 decimals)', () => {
    // Real failure: this exact EOA balance was inflated to ...070 (5 wei over),
    // making the dst-swap transferFrom revert.
    const raw = 266_077_560_050_515_585_065n;
    expect(roundTrip(raw, 18)).toBe(raw);
  });

  it('round-trips assorted 21-digit raw amounts exactly', () => {
    for (const raw of [
      123_456_789_012_345_678_901n,
      999_999_999_999_999_999_999n,
      266_077_560_050_515_585_070n,
    ]) {
      expect(roundTrip(raw, 18)).toBe(raw);
    }
  });

  it('preserves a 1-wei increment on a large balance (no ROUND_CEIL inflation)', () => {
    const raw = 123_456_789_012_345_678_901n;
    expect(roundTrip(raw + 1n, 18)).toBe(raw + 1n);
  });

  it('round-trips boundary values around 100 and 1000 tokens', () => {
    for (const raw of [
      100_000_000_000_000_000_000n,
      100_000_000_000_000_000_001n,
      1_000_000_000_000_000_000_000n,
    ]) {
      expect(roundTrip(raw, 18)).toBe(raw);
    }
  });

  it('configures decimal.js to at least 50 significant figures', () => {
    expect(Decimal.precision).toBeGreaterThanOrEqual(50);
  });
});
