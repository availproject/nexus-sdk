import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateDurations } from '../src/analytics/aggregation';

type SpanSamples = Record<string, number[]>;
type BaselineEntry = { p50: number; p95: number; p99: number };
type BaselineMap = Record<string, BaselineEntry>;

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error('Usage: tsx scripts/update-perf-baseline.ts <samples.json>');
}

const sourcePath = resolve(process.cwd(), inputPath);
const raw = readFileSync(sourcePath, 'utf-8');
const input = JSON.parse(raw) as SpanSamples;

const output: BaselineMap = {};
for (const [spanName, durations] of Object.entries(input)) {
  const summary = aggregateDurations(durations);
  output[spanName] = {
    p50: summary.p50,
    p95: summary.p95,
    p99: summary.p99,
  };
}

const baselinePath = resolve(process.cwd(), 'tests/performance/baselines/current.json');
writeFileSync(baselinePath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
