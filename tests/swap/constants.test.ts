import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  STABLE_SETTLEMENT_CURRENCY_IDS,
  DST_BUFFER_MAX_USD,
  DST_BUFFER_PCT,
  MAX_SWAP_HAIRCUT_MIN_USDC,
  MAX_SWAP_HAIRCUT_PCT,
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
  it('destination buffer = min(5%, $1)', () => {
    expect(DST_BUFFER_PCT).toBe(0.05);
    expect(DST_BUFFER_MAX_USD).toBe(1);
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

  it('uses 0.5% default slippage', () => {
    expect(SLIPPAGE_DEFAULT).toBe(0.005);
  });

  it('least-swap settlement is stables-only (USDC + USDT) — ETH excluded', () => {
    expect([...STABLE_SETTLEMENT_CURRENCY_IDS].sort()).toEqual(
      [CurrencyID.USDC, CurrencyID.USDT].sort()
    );
    expect(STABLE_SETTLEMENT_CURRENCY_IDS.has(CurrencyID.ETH)).toBe(false);
  });
});
