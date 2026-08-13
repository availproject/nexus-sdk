import { describe, expect, it } from 'vitest';
import {
  SLIPPAGE_BPS,
  SLIPPAGE_BPS_STRING,
  SLIPPAGE_FRACTION,
} from '../../../src/swap/aggregators/constants';

describe('aggregator slippage constants', () => {
  it('pins the shared quote slippage at 30 bps (0.3%)', () => {
    expect(SLIPPAGE_BPS).toBe(30);
    expect(SLIPPAGE_BPS_STRING).toBe('30');
    expect(SLIPPAGE_FRACTION).toBe('0.003');
  });
});
