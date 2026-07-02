import type { StressReport } from "../../../../packages/tools/src/stress-test";

const SHARE_SCHEMA_VERSION = 1;
export const SHARE_REPORT_PARAM = "sr";
export const SHARE_REPORT_CHECKSUM_PARAM = "srh";
export const SOFT_URL_LIMIT = 1800;
export const HARD_URL_LIMIT = 6000;

type SharedReportPayload = {
  v: number;
  report: StressReport;
  spanSamples?: SharedSpanSample[];
};

export type SharedSpanSample = {
  runId: number;
  operationId: number;
  spanName: string;
  durationMs: number;
  success: boolean;
  timestamp: number;
};

const toBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4;
  const padded =
    padLength === 0 ? normalized : `${normalized}${"=".repeat(4 - padLength)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const checksum = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isStressReport = (value: unknown): value is StressReport => {
  if (!value || typeof value !== "object") return false;
  const report = value as StressReport;
  return (
    isFiniteNumber(report.startedAt) &&
    isFiniteNumber(report.endedAt) &&
    !!report.config &&
    typeof report.config === "object" &&
    !!report.totals &&
    typeof report.totals === "object" &&
    !!report.performance &&
    typeof report.performance === "object" &&
    Array.isArray(report.byStatus) &&
    Array.isArray(report.byChain) &&
    Array.isArray(report.errors)
  );
};

const isSharedSpanSample = (value: unknown): value is SharedSpanSample => {
  if (!value || typeof value !== "object") return false;
  const sample = value as SharedSpanSample;
  return (
    isFiniteNumber(sample.runId) &&
    isFiniteNumber(sample.operationId) &&
    typeof sample.spanName === "string" &&
    isFiniteNumber(sample.durationMs) &&
    typeof sample.success === "boolean" &&
    isFiniteNumber(sample.timestamp)
  );
};

const withPhaseMetricDefaults = (report: StressReport): StressReport => {
  const perf = report.performance as StressReport["performance"] & {
    signToDepositMs?: { avgMs?: number; medianMs?: number; count?: number };
    depositToFillMs?: { avgMs?: number; medianMs?: number; count?: number };
    fallbackSignToFillMs?: { avgMs?: number; medianMs?: number; count?: number };
  };
  const normalize = (entry?: { avgMs?: number; medianMs?: number; count?: number }) => ({
    avgMs: isFiniteNumber(entry?.avgMs) ? entry.avgMs : 0,
    medianMs: isFiniteNumber(entry?.medianMs) ? entry.medianMs : 0,
    count: isFiniteNumber(entry?.count) ? entry.count : 0,
  });
  return {
    ...report,
    performance: {
      ...report.performance,
      signToDepositMs: normalize(perf.signToDepositMs),
      depositToFillMs: normalize(perf.depositToFillMs),
      fallbackSignToFillMs: normalize(perf.fallbackSignToFillMs),
    },
  };
};

export const encodeSharedReport = (
  report: StressReport,
  spanSamples: SharedSpanSample[] = [],
) => {
  const payload: SharedReportPayload = {
    v: SHARE_SCHEMA_VERSION,
    report,
    ...(spanSamples.length > 0 ? { spanSamples } : {}),
  };
  const json = JSON.stringify(payload);
  return {
    encoded: toBase64Url(json),
    checksum: checksum(json),
  };
};

export const decodeSharedReport = (encoded: string, expectedChecksum?: string) => {
  const json = fromBase64Url(encoded);
  const actualChecksum = checksum(json);
  if (expectedChecksum && expectedChecksum !== actualChecksum) {
    throw new Error("Checksum mismatch. Link appears corrupted or truncated.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Shared report payload is invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Shared report payload is invalid.");
  }

  const payload = parsed as SharedReportPayload;
  if (payload.v !== SHARE_SCHEMA_VERSION) {
    throw new Error(`Unsupported shared report version: ${String(payload.v)}`);
  }
  if (!isStressReport(payload.report)) {
    throw new Error("Shared report is missing required fields.");
  }
  const spanSamples = Array.isArray(payload.spanSamples)
    ? payload.spanSamples.filter(isSharedSpanSample)
    : [];
  return {
    report: withPhaseMetricDefaults(payload.report),
    spanSamples,
  };
};
