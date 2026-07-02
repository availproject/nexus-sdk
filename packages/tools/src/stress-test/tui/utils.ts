import cliTruncate from 'cli-truncate';
import type { OperationStatus } from '../types';
import { activeTuiTheme } from './theme';

// ── Status helpers (shared across RunScreen + report components) ────────────

export const STATUS_ICON: Record<OperationStatus, string> = {
  fulfilled: '✓',
  failed: '✗',
  running: '●',
  approved: '◆',
  signed: '◈',
  deposited: '⬢',
  queued: '○',
};

/** Returns the theme color for a given operation status. */
export const statusColor = (status: OperationStatus): string => {
  const t = activeTuiTheme;
  switch (status) {
    case 'fulfilled':
      return t.success;
    case 'failed':
      return t.error;
    case 'running':
      return t.accent;
    case 'approved':
      return t.info; // blue  — distinct from signed
    case 'signed':
      return t.warn; // amber — close to done
    case 'deposited':
      return t.info;
    case 'queued':
      return t.muted;
  }
};

export const formatDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

export const fit = (value: string, width: number): string =>
  cliTruncate(String(value ?? ''), Math.max(0, width), { position: 'end' });

export type HistogramBin = { from: number; to: number; count: number };

export const histogram = (values: number[], buckets = 10): HistogramBin[] => {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // All values identical — single bucket rather than 10 near-empty bins
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const span = max - min;
  const size = Math.max(1, Math.ceil(span / buckets));
  const bins: HistogramBin[] = Array.from({ length: buckets }, (_, i) => ({
    from: min + i * size,
    to: min + (i + 1) * size - 1,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / size));
    bins[idx]!.count += 1;
  }
  // Trim trailing zero-count bins
  let last = bins.length - 1;
  while (last > 0 && bins[last]!.count === 0) last--;
  return bins.slice(0, last + 1);
};
