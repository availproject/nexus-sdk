import { describe, expect, it } from 'vitest';
import { PerformanceTracker } from '../../src/analytics/performance';

describe('PerformanceTracker spans', () => {
  it('tracks parent-child span relationships and cleanup', () => {
    const tracker = new PerformanceTracker();
    const rootId = tracker.startSpan('root');
    const childId = tracker.startSpan('child', { parentSpanId: rootId, tags: { phase: 'prepare' } });

    const child = tracker.endSpan(childId, { success: true });
    const root = tracker.endSpan(rootId, { success: true });

    expect(child).not.toBeNull();
    expect(root).not.toBeNull();
    expect(child?.parentSpanId).toBe(rootId);
    expect(child?.rootSpanId).toBe(rootId);
    expect(root?.parentSpanId).toBeUndefined();
    expect(tracker.getActiveOperationCount()).toBe(0);
  });

  it('wraps async work with withSpan and tracks failures', async () => {
    const tracker = new PerformanceTracker();

    await expect(
      tracker.withSpan('failing', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(tracker.getActiveOperationCount()).toBe(0);
  });
});
