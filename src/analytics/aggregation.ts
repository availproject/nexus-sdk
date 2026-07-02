import { groupBy, mapValues, sum } from 'es-toolkit';
import type { SpanProperties } from './types';

export interface PerformanceAggregates {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export const computePercentile = (sorted: number[], percentile: number): number => {
  if (sorted.length === 0) return 0;
  if (percentile <= 0) return sorted[0] ?? 0;
  if (percentile >= 100) return sorted[sorted.length - 1] ?? 0;

  const rank = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? 0;
  return lowerValue + (upperValue - lowerValue) * weight;
};

export const aggregateDurations = (durations: number[]): PerformanceAggregates => {
  if (durations.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const total = sum(sorted);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: total / sorted.length,
    p50: computePercentile(sorted, 50),
    p90: computePercentile(sorted, 90),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
  };
};

export const aggregateBySpanName = (
  spans: SpanProperties[]
): Map<string, PerformanceAggregates> => {
  const groupedSpans = groupBy(spans, (span) => span.operation);
  const aggregates = mapValues(groupedSpans, (entries) =>
    aggregateDurations(entries.map((entry) => entry.duration))
  );
  return new Map(Object.entries(aggregates));
};
