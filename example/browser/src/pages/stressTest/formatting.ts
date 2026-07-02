import type { ChartPalette } from "./useChartTheme";

export const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(0)}s`;
};

export const formatDurationCompact = (ms: number) => {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

const formatDurationToken = (ms: number) => {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatDurationRange = (startMs: number, endMs: number) =>
  `${formatDurationToken(startMs)}-${formatDurationToken(endMs)}`;

export const formatDelta = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
};

export const shortSpanLabel = (spanName: string) => {
  const parts = spanName.split(".");
  if (parts.length <= 2) return spanName;
  return parts.slice(-2).join(".");
};

/**
 * Recharts style helpers that consume the active theme palette. Pass
 * the palette returned by `useChartTheme()` so charts repaint when the
 * theme changes without a remount.
 */
export const chartTooltipContentStyle = (p: ChartPalette) => ({
  backgroundColor: p.panel,
  border: `1px solid ${p.line}`,
  borderRadius: 10,
  color: p.text,
  fontSize: 12,
  padding: "7px 9px",
});

export const chartTooltipLabelStyle = (p: ChartPalette) => ({
  color: p.text,
  fontWeight: 600,
  fontSize: 12,
});

export const chartTooltipItemStyle = (p: ChartPalette) => ({
  color: p.muted,
  fontSize: 11,
});

export const chartAxisTickStyle = (p: ChartPalette) => ({
  fontSize: 11,
  fill: p.muted,
});

export const chartGridStroke = (p: ChartPalette) => p.line;

/**
 * Convert a CSS color literal to a translucent overlay. Recharts cursor
 * fills want a solid string; `color-mix` keeps the active OKLCH theme in
 * sync without us re-rolling rgba() conversions.
 */
export const overlay = (color: string, alpha: number) =>
  `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
