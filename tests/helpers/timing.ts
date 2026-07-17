import { vi } from 'vitest';
import type { TimingSpanHooks } from '../../src/domain';

export const makeTimingHooks = () => {
  let nextSpanId = 0;
  const startSpan = vi.fn((name: string) => `${name}:${nextSpanId++}`);
  const endSpan = vi.fn(() => null);
  const withSpan = vi.fn(async <T>(_name: string, fn: () => Promise<T>) => fn()) as unknown as
    TimingSpanHooks['withSpan'];

  return { startSpan, endSpan, withSpan } satisfies TimingSpanHooks;
};
