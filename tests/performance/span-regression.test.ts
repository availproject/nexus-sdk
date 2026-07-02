import baseline from './baselines/current.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { computeRegressionPercent, median, toSummary } from './utils';

describe('performance span regression checks', () => {
  it('compares percentiles against baseline thresholds', () => {
    // Deterministic fixture-style sample set for CI gating logic validation.
    const currentDurations = [9, 10, 10, 10, 10, 11, 12, 13, 14, 15];
    const summary = toSummary(currentDurations);
    expect(median(currentDurations)).toBe(summary.p50);

    const baselineEntry = baseline['flow.bridge.prepare_intent'];
    expect(baselineEntry).toBeDefined();

    const p50Regression = computeRegressionPercent(summary.p50, baselineEntry.p50);
    const p95Regression = computeRegressionPercent(summary.p95, baselineEntry.p95);
    const p99Regression = computeRegressionPercent(summary.p99, baselineEntry.p99);

    expect(p50Regression).toBeLessThanOrEqual(15);
    expect(p95Regression).toBeLessThanOrEqual(20);
    expect(p99Regression).toBeLessThanOrEqual(30);
  });
});
