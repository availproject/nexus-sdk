import { describe, expect, it, vi } from 'vitest';
import type { TimingSpanHooks } from '../../src/domain';
import { withTimingSpan } from '../../src/services/timing';

const makeTiming = (): TimingSpanHooks => ({
  startSpan: vi.fn((name: string) => name),
  endSpan: vi.fn(() => null),
  withSpan: vi.fn(),
});

describe('withTimingSpan', () => {
  it('closes a failed block as failed and preserves the original error', async () => {
    const timing = makeTiming();
    const error = new Error('boom');

    await expect(
      withTimingSpan(timing, 'test.failed', async () => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(timing.endSpan).toHaveBeenCalledWith('test.failed', {
      success: false,
      error,
    });
  });

  it('does not let throwing timing hooks affect the wrapped result', async () => {
    const timing: TimingSpanHooks = {
      startSpan: vi.fn(() => {
        throw new Error('timing unavailable');
      }),
      endSpan: vi.fn(() => {
        throw new Error('timing unavailable');
      }),
      withSpan: vi.fn(),
    };

    await expect(withTimingSpan(timing, 'test.safe', async () => 42)).resolves.toBe(42);
  });

  it('runs unchanged when timing is disabled', async () => {
    const operation = vi.fn().mockResolvedValue('result');

    await expect(withTimingSpan(undefined, 'test.disabled', operation)).resolves.toBe('result');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not serialize parallel work inside a timed block', async () => {
    const timing = makeTiming();
    const started: string[] = [];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const result = withTimingSpan(timing, 'test.parallel', async () =>
      Promise.all([
        (async () => {
          started.push('first');
          await firstGate;
          return 1;
        })(),
        (async () => {
          started.push('second');
          await secondGate;
          return 2;
        })(),
      ])
    );

    expect(started).toEqual(['first', 'second']);
    releaseFirst();
    releaseSecond();
    await expect(result).resolves.toEqual([1, 2]);
  });
});
