import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  B2_STABLE_CURRENCY_IDS,
  DST_BUFFER_MAX_USD,
  DST_BUFFER_PCT,
  GAS_TO_COT_BUFFER,
  MAX_RETRIES,
  MAX_SWAP_HAIRCUT_MIN_USDC,
  MAX_SWAP_HAIRCUT_PCT,
  SBC_DEADLINE_MINUTES,
  SLIPPAGE_DEFAULT,
  SRC_BUFFER_MAX_USD,
  SRC_BUFFER_PCT,
} from '../../src/swap/constants';
import { CurrencyID } from '../../src/swap/cot';
import {
  MAX_CONVERGENCE_EXTRA_COT,
  MAX_CONVERGENCE_ITERATIONS,
  SAFETY_MULTIPLIER,
} from '../../src/swap/algorithms/convergence';

// Tripwire for the economically significant swap constants. Behavioural tests
// (route/autoSelect/destination/max) assert outcomes derived from these, but several worked
// examples can't distinguish, say, a 2% from a 0.5% source buffer because both clamp to the
// same $1 cap. Pinning the raw values here forces any change to a fee/buffer/haircut/drift
// budget to be a deliberate, reviewed product decision rather than something that slips through
// behind an ambiguous numeric example. Keep this in lockstep with src/swap/swap.md §12.
describe('swap economic constants', () => {
  it('destination buffer = min(10%, $2)', () => {
    expect(DST_BUFFER_PCT).toBe(0.1);
    expect(DST_BUFFER_MAX_USD).toBe(2);
  });

  it('EXACT_OUT source buffer = min(2%, $1)', () => {
    expect(SRC_BUFFER_PCT).toBe(0.02);
    expect(SRC_BUFFER_MAX_USD).toBe(1);
  });

  it('max-amount haircut = max(3%, $3)', () => {
    expect(MAX_SWAP_HAIRCUT_PCT).toBe(0.03);
    expect(MAX_SWAP_HAIRCUT_MIN_USDC).toBe(3);
  });

  it('convergence: ×1.005 safety, +0.5 COT input cap, ≤10 iterations', () => {
    expect(SAFETY_MULTIPLIER.eq(new Decimal('1.005'))).toBe(true);
    expect(MAX_CONVERGENCE_EXTRA_COT.eq(new Decimal('0.5'))).toBe(true);
    expect(MAX_CONVERGENCE_ITERATIONS).toBe(10);
  });

  it('execution thresholds: 0.5% default slippage, gas×1.02, 2 retries, 15-minute SBC deadline', () => {
    expect(SLIPPAGE_DEFAULT).toBe(0.005);
    expect(GAS_TO_COT_BUFFER).toBe(1.02);
    expect(MAX_RETRIES).toBe(2);
    expect(SBC_DEADLINE_MINUTES).toBe(15n);
  });

  it('B2 dynamic COT is stables-only (USDC + USDT) — ETH excluded', () => {
    expect([...B2_STABLE_CURRENCY_IDS].sort()).toEqual([CurrencyID.USDC, CurrencyID.USDT].sort());
    expect(B2_STABLE_CURRENCY_IDS.has(CurrencyID.ETH)).toBe(false);
  });
});
