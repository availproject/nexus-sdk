import { BarChart, StackedBarChart } from '@pppp606/ink-chart';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Operation, OperationStatus, StressReport } from '../../types';
import useStdoutDimensions from '../hooks/useStdoutDimensions';
import { activeTuiTheme as THEME } from '../theme';
import { formatDuration, histogram, statusColor } from '../utils';
import { CardTitle } from './report-ui';

type Props = {
  report: StressReport;
  operations: Operation[];
  isNarrow: boolean;
  contentRows: number;
};

// Overhead per row pair:
//   border(2) + CardTitle text+marginBottom(2) = 4 rows per chart box.
//   Row 1 height = max(latencyBars, statusRows) + 4  ≈ max(7, ~3) + 4 = 11
//   Row 2 height = max(histBars, trendBars) + 4      ≈ 10 + 4 = 14
//     + 1 footnote row when bucketSize > 1 (many ops) → computed dynamically
//   marginTop between rows: 1 each = 2 total
//   Static content subtotal: 27 rows (+ 1 when Op Trend footnote shows)
//   Chain Volume box overhead: border(2) + CardTitle(2) = 4 rows
//   Chain Volume scroll indicator: 1 row
const STATIC_ROWS_BASE = 27;
const CHAIN_BOX_OVERHEAD = 5; // border(2) + title+margin(2) + indicator(1)

export default function ReportCharts({ report, operations, isNarrow, contentRows }: Props) {
  const [cols = 120] = useStdoutDimensions();
  const [chainScroll, setChainScroll] = useState(0);

  // Width calculations:
  //   Full-width: cols - root_pad(2) - box_border(2) - box_paddingX(2) = cols - 6
  //   Half-width: floor((cols-2)/2) - box_border(2) - box_paddingX(2) - marginRight(1) = floor((cols-2)/2) - 5
  const fullW = Math.max(20, cols - 6);
  const halfW = isNarrow ? fullW : Math.max(16, Math.floor((cols - 2) / 2) - 5);
  const { performance: perf, byStatus, byChain } = report;

  const durationTrend = operations
    .filter((op): op is typeof op & { durationMs: number } => typeof op.durationMs === 'number')
    .sort((a, b) => a.id - b.id)
    .map((op) => op.durationMs);

  const latencyBins = histogram(durationTrend, 10);

  const binColor = (i: number, total: number): string => {
    const ratio = total <= 1 ? 0 : i / (total - 1);
    if (ratio < 0.4) return THEME.success;
    if (ratio < 0.7) return THEME.warn;
    return THEME.error;
  };

  const trendColor = (avgMs: number): string => {
    if (avgMs <= perf.medianMs) return THEME.success;
    if (avgMs <= perf.p90Ms) return THEME.warn;
    return THEME.error;
  };

  const statusStack = byStatus
    .filter((row) => row.count > 0)
    .map((row) => ({
      label: row.status.toUpperCase(),
      value: row.count,
      color: statusColor(row.status as OperationStatus),
    }));

  // Map bins with original index for position-based coloring, then drop empty bins.
  // Zero-count bins cause label misalignment in the chart library — only render bins with data.
  const allHistBars = latencyBins.map((bin, i) => ({
    label: `${formatDuration(bin.from)}-${formatDuration(bin.to)}`,
    value: bin.count,
    color: binColor(i, latencyBins.length),
  }));
  const histBarsWithData = allHistBars.filter((b) => b.value > 0);
  const maxHistLabelLen = histBarsWithData.reduce((m, b) => Math.max(m, b.label.length), 0);
  const histogramBarData = histBarsWithData.map((b) => ({
    ...b,
    label: b.label.padEnd(maxHistLabelLen, ' '),
  }));

  // Pre-sort chains by volume desc so viewport slicing preserves rank order.
  // Palette color assigned after sort so rank 0 always gets palette[0].
  const sortedChains = [...byChain].sort((a, b) => b.total - a.total);
  const maxChainLabelLen = sortedChains.reduce((m, row) => {
    const name = row.chainName.length > 18 ? `${row.chainName.slice(0, 15)}...` : row.chainName;
    return Math.max(m, name.length);
  }, 0);
  const allChainBars = sortedChains.map((row, i) => {
    const name = row.chainName.length > 18 ? `${row.chainName.slice(0, 15)}...` : row.chainName;
    return {
      label: name.padEnd(maxChainLabelLen, ' '),
      value: row.total,
      color: THEME.chartPalette[i % THEME.chartPalette.length],
    };
  });
  const maxChainValue = allChainBars[0]?.value ?? 0;

  // Windowed operation trend: cap at 10 bars. Labels show starting op number.
  // Computed here (before chainBarRows) so bucketSize is available for the static-rows calculation.
  const MAX_TREND_BARS = 10;
  const bucketSize = Math.max(1, Math.ceil(durationTrend.length / MAX_TREND_BARS));
  const labelWidth = String(durationTrend.length).length;
  const windowedTrend = Array.from(
    { length: Math.ceil(durationTrend.length / bucketSize) },
    (_, i) => {
      const slice = durationTrend.slice(i * bucketSize, (i + 1) * bucketSize);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      return {
        label: String(i * bucketSize + 1).padStart(labelWidth, ' '),
        value: avg,
        color: trendColor(avg),
      };
    }
  );

  // How many chain bars fit in the available space below the static content.
  // Add 1 to STATIC_ROWS when the Op Trend footnote row is visible (bucketSize > 1).
  const staticRows = STATIC_ROWS_BASE + (bucketSize > 1 ? 1 : 0);
  const chainBarRows = Math.max(1, contentRows - staticRows - CHAIN_BOX_OVERHEAD);
  const maxChainScroll = Math.max(0, allChainBars.length - chainBarRows);
  const chainVolumeSlice = allChainBars.slice(chainScroll, chainScroll + chainBarRows);

  // Round to the same precision formatDuration displays so that bars with
  // identical labels always render at identical lengths.
  const chartMs = (ms: number) => (ms < 1000 ? Math.round(ms) : Math.round(ms / 100) * 100);

  const latencyProfileEntries = [
    { label: 'min', value: chartMs(perf.minMs) },
    { label: 'avg', value: chartMs(perf.avgMs) },
    { label: 'p50', value: chartMs(perf.medianMs) },
    { label: 'p90', value: chartMs(perf.p90Ms) },
    { label: 'p95', value: chartMs(perf.p95Ms) },
    { label: 'p99', value: chartMs(perf.p99Ms) },
    { label: 'max', value: chartMs(perf.maxMs) },
  ];
  const latencyProfileData = latencyProfileEntries.map((entry, i) => ({
    ...entry,
    color: binColor(i, latencyProfileEntries.length),
  }));

  useInput((input, key) => {
    if (key.downArrow || input === 'j') setChainScroll((v) => Math.min(v + 1, maxChainScroll));
    if (key.upArrow || input === 'k') setChainScroll((v) => Math.max(0, v - 1));
    if (input === 'g') setChainScroll(0);
    if (input === 'G') setChainScroll(maxChainScroll);
  });

  return (
    <Box flexDirection="column">
      {/* Row 1: Latency Profile (half) | Status Distribution (half) */}
      <Box flexDirection={isNarrow ? 'column' : 'row'}>
        <Box
          width={isNarrow ? '100%' : '50%'}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          marginRight={isNarrow ? 0 : 1}
          flexDirection="column"
        >
          <CardTitle title="Latency Profile" color={THEME.success} />
          {durationTrend.length > 0 ? (
            <BarChart
              data={latencyProfileData}
              sort="none"
              showValue="right"
              format={formatDuration}
              width={halfW}
              barChar="█"
            />
          ) : (
            <Text color={THEME.muted}>No completed operation durations available.</Text>
          )}
        </Box>

        <Box
          width={isNarrow ? '100%' : '50%'}
          marginTop={isNarrow ? 1 : 0}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          flexDirection="column"
        >
          <CardTitle title="Status Distribution" color={THEME.warn} />
          {statusStack.length > 0 ? (
            <StackedBarChart
              data={statusStack}
              width={halfW}
              mode="percentage"
              showLabels
              showValues
            />
          ) : (
            <Text color={THEME.muted}>No status data available.</Text>
          )}
        </Box>
      </Box>

      {/* Row 2: Duration Distribution | Operation Trend */}
      <Box marginTop={1} flexDirection={isNarrow ? 'column' : 'row'}>
        <Box
          width={isNarrow ? '100%' : '50%'}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          marginRight={isNarrow ? 0 : 1}
          flexDirection="column"
        >
          <CardTitle title="Duration Distribution" color={THEME.accent} />
          {histogramBarData.length > 0 ? (
            <BarChart
              data={histogramBarData}
              sort="none"
              showValue="right"
              width={halfW}
              barChar="█"
            />
          ) : (
            <Text color={THEME.muted}>No histogram data available.</Text>
          )}
        </Box>

        <Box
          width={isNarrow ? '100%' : '50%'}
          marginTop={isNarrow ? 1 : 0}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          flexDirection="column"
        >
          <CardTitle title="Operation Trend" color={THEME.info} />
          {windowedTrend.length > 0 ? (
            <Box flexDirection="column">
              <BarChart
                data={windowedTrend}
                sort="none"
                showValue="right"
                format={formatDuration}
                width={halfW}
                barChar="▓"
              />
              {bucketSize > 1 && (
                <Text color={THEME.muted} dimColor>{`each bar ≈ avg of ${bucketSize} ops`}</Text>
              )}
            </Box>
          ) : (
            <Text color={THEME.muted}>No completed operations available.</Text>
          )}
        </Box>
      </Box>

      {/* Row 3: Chain Volume — full width, viewport-scrollable */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={THEME.border}
        paddingX={1}
        flexDirection="column"
      >
        <CardTitle title="Chain Volume" color={THEME.title} />
        {chainVolumeSlice.length > 0 ? (
          <BarChart
            data={chainVolumeSlice}
            sort="none"
            showValue="right"
            width={fullW}
            barChar="▓"
            max={maxChainValue}
          />
        ) : (
          <Text color={THEME.muted}>No chain data available.</Text>
        )}
        <Box flexDirection="row" gap={2}>
          <Text color={THEME.muted}>{allChainBars.length} chains</Text>
          {allChainBars.length > chainBarRows && (
            <Text color={THEME.muted}>
              {chainScroll + 1}–{Math.min(chainScroll + chainBarRows, allChainBars.length)}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
