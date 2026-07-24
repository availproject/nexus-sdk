import { describe, expect, it } from 'vitest';
import {
  SLIPPAGE_BPS,
  SLIPPAGE_BPS_STRING,
  SLIPPAGE_FRACTION,
  SLIPPAGE_PERCENT,
} from '../../../src/swap/aggregators/constants';

describe('aggregator slippage constants', () => {
  it('pins the shared quote slippage at 25 bps (0.25%)', () => {
    expect(SLIPPAGE_BPS).toBe(25);
    expect(SLIPPAGE_BPS_STRING).toBe('25');
    expect(SLIPPAGE_FRACTION).toBe('0.0025');
    expect(SLIPPAGE_PERCENT).toBe('0.25');
  });
});
