import { afterEach, describe, expect, it, vi } from 'vitest';
import { minutesFromNow } from '../../src/services/time';

describe('minutesFromNow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a Unix timestamp the requested minutes from now', () => {
    const now = new Date('2026-08-04T00:00:00.500Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(minutesFromNow(15)).toBe(
      BigInt(Math.floor((now.getTime() + 15 * 60 * 1000) / 1000))
    );
  });
});
