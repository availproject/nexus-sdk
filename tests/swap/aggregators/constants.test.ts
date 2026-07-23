import { describe, expect, it } from 'vitest';
import {
  SLIPPAGE_BPS,
  SLIPPAGE_BPS_STRING,
  SLIPPAGE_FRACTION,
  SLIPPAGE_PERCENT,
} from '../../../src/swap/aggregators/constants';

describe('aggregator slippage constants', () => {
  it('pins the shared quote slippage at 50 bps (0.5%)', () => {
    expect(SLIPPAGE_BPS).toBe(50);
    expect(SLIPPAGE_BPS_STRING).toBe('50');
    expect(SLIPPAGE_FRACTION).toBe('0.005');
    expect(SLIPPAGE_PERCENT).toBe('0.5');
  });
});
