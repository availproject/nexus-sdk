import type { SharedSpanSample } from "../stressReportShare";

export type StressSpanSample = SharedSpanSample;

export type SpanAggregate = {
  spanName: string;
  count: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
};
