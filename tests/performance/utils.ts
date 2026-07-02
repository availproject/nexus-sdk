import type { PerformanceAggregates } from '../../src/analytics/aggregation';
import { aggregateDurations } from '../../src/analytics/aggregation';

export const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
};

export const collectSamples = async (
  run: () => Promise<number>,
  config?: { warmupRuns?: number; samples?: number }
): Promise<number[]> => {
  const warmupRuns = config?.warmupRuns ?? 3;
  const samples = config?.samples ?? 10;

  for (let i = 0; i < warmupRuns; i += 1) {
    await run();
  }

  const durations: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    durations.push(await run());
  }
  return durations;
};

export const computeRegressionPercent = (current: number, baseline: number): number => {
  if (baseline === 0) return 0;
  return ((current - baseline) / baseline) * 100;
};

export const toSummary = (durations: number[]): PerformanceAggregates => {
  return aggregateDurations(durations);
};
