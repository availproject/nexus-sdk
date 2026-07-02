import { describe, expect, it } from 'vitest';
import {
  aggregateBySpanName,
  aggregateDurations,
  computePercentile,
} from '../../src/analytics/aggregation';
import type { SpanProperties } from '../../src/analytics/types';

describe('aggregation utilities', () => {
  it('computes percentiles with interpolation', () => {
    const sorted = [10, 20, 30, 40];
    expect(computePercentile(sorted, 50)).toBe(25);
    expect(computePercentile(sorted, 90)).toBe(37);
  });

  it('aggregates duration summary stats', () => {
    const result = aggregateDurations([10, 20, 30, 40, 50]);
    expect(result.count).toBe(5);
    expect(result.min).toBe(10);
    expect(result.max).toBe(50);
    expect(result.mean).toBe(30);
    expect(result.p50).toBe(30);
  });

  it('aggregates by span name', () => {
    const spans: SpanProperties[] = [
      {
        operation: 'flow.bridge.prepare_intent',
        duration: 10,
        success: true,
        spanId: 'a',
        rootSpanId: 'a',
        startedAtIso: '2026-01-01T00:00:00.000Z',
        endedAtIso: '2026-01-01T00:00:00.010Z',
      },
      {
        operation: 'flow.bridge.prepare_intent',
        duration: 30,
        success: true,
        spanId: 'b',
        rootSpanId: 'a',
        parentSpanId: 'a',
        startedAtIso: '2026-01-01T00:00:01.000Z',
        endedAtIso: '2026-01-01T00:00:01.030Z',
      },
      {
        operation: 'flow.bridge.submit_rff',
        duration: 50,
        success: true,
        spanId: 'c',
        rootSpanId: 'a',
        startedAtIso: '2026-01-01T00:00:02.000Z',
        endedAtIso: '2026-01-01T00:00:02.050Z',
      },
    ];

    const map = aggregateBySpanName(spans);
    expect(map.get('flow.bridge.prepare_intent')?.count).toBe(2);
    expect(map.get('flow.bridge.prepare_intent')?.p50).toBe(20);
    expect(map.get('flow.bridge.submit_rff')?.mean).toBe(50);
  });
});
