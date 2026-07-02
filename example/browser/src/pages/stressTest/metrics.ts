import type { SpanAggregate, StressSpanSample } from "./types";

export const computePercentile = (values: number[], percentile: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (percentile <= 0) return sorted[0] ?? 0;
  if (percentile >= 100) return sorted[sorted.length - 1] ?? 0;
  const rank = (percentile / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const weight = rank - lo;
  const loValue = sorted[lo] ?? 0;
  const hiValue = sorted[hi] ?? 0;
  return loValue + (hiValue - loValue) * weight;
};

export const computeMedian = (values: number[]) => computePercentile(values, 50);

export const niceBucketSize = (maxValue: number, buckets: number) => {
  const rough = Math.max(1, maxValue / buckets);
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  const multiplier =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * power;
};

export const aggregateSpans = (samples: StressSpanSample[]): SpanAggregate[] => {
  const grouped = new Map<string, number[]>();
  for (const sample of samples) {
    if (
      !sample.spanName.startsWith("flow.") &&
      !sample.spanName.startsWith("network.")
    ) {
      continue;
    }
    const list = grouped.get(sample.spanName) ?? [];
    list.push(sample.durationMs);
    grouped.set(sample.spanName, list);
  }

  return Array.from(grouped.entries())
    .map(([spanName, durations]) => ({
      spanName,
      count: durations.length,
      meanMs:
        durations.reduce((acc, value) => acc + value, 0) / durations.length,
      medianMs: computeMedian(durations),
      p95Ms: computePercentile(durations, 95),
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
    }))
    .sort((a, b) => b.medianMs - a.medianMs);
};
