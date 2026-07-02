import { Box, Text } from 'ink';
import type { StressReport } from '../../types';
import { activeTuiTheme as THEME } from '../theme';
import { fit, formatDuration } from '../utils';
import { CardTitle, ChainTable, LabelValue } from './report-ui';

type Props = {
  report: StressReport;
  isNarrow: boolean;
  errMsgMaxLen: number;
};

export default function ReportOverview({ report, isNarrow, errMsgMaxLen }: Props) {
  const { totals, performance: perf, byChain, errors } = report;

  return (
    <Box flexDirection="column">
      {/* Row 1: Summary + Latency */}
      <Box flexDirection={isNarrow ? 'column' : 'row'}>
        <Box
          width={isNarrow ? '100%' : '50%'}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          marginRight={isNarrow ? 0 : 1}
          flexDirection="column"
        >
          <CardTitle title="Summary" color={THEME.title} />
          <LabelValue label="Total" value={String(totals.total)} />
          <LabelValue label="Fulfilled" value={String(totals.fulfilled)} />
          <LabelValue label="Failed" value={String(totals.failed)} />
          <LabelValue label="Cancelled" value={String(totals.cancelled)} />
          <LabelValue label="Duration" value={formatDuration(perf.durationMs)} />
          <LabelValue label="Throughput" value={`${perf.throughputPerMin.toFixed(2)}/min`} />
          <Box marginTop={1} gap={2}>
            <Text color={THEME.success} bold>
              ✓ {totals.fulfilled} fulfilled
            </Text>
            <Text color={THEME.error} bold>
              ✗ {totals.failed} failed
            </Text>
            <Text color={THEME.warn} bold>
              ⊘ {totals.cancelled} cancelled
            </Text>
          </Box>
        </Box>

        <Box
          width={isNarrow ? '100%' : '50%'}
          marginTop={isNarrow ? 1 : 0}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          flexDirection="column"
        >
          <CardTitle title="Latency" color={THEME.accent} />
          <LabelValue label="Average" value={formatDuration(perf.avgMs)} />
          <LabelValue label="Median" value={formatDuration(perf.medianMs)} />
          <LabelValue label="P90" value={formatDuration(perf.p90Ms)} />
          <LabelValue label="P95" value={formatDuration(perf.p95Ms)} />
          <LabelValue label="P99" value={formatDuration(perf.p99Ms)} />
          <LabelValue
            label="Min / Max"
            value={`${formatDuration(perf.minMs)} / ${formatDuration(perf.maxMs)}`}
          />
          <LabelValue
            label="Sign->Deposit"
            value={
              perf.signToDepositMs.count > 0 ? formatDuration(perf.signToDepositMs.medianMs) : '—'
            }
          />
          <LabelValue
            label="Deposit->Fill"
            value={
              perf.depositToFillMs.count > 0 ? formatDuration(perf.depositToFillMs.medianMs) : '—'
            }
          />
          <LabelValue
            label="Sign->Fill Fallback"
            value={
              perf.fallbackSignToFillMs.count > 0
                ? formatDuration(perf.fallbackSignToFillMs.medianMs)
                : '—'
            }
          />
        </Box>
      </Box>

      {/* Row 2: Chains + Errors */}
      <Box marginTop={1} flexDirection={isNarrow ? 'column' : 'row'}>
        <Box
          width={isNarrow ? '100%' : '50%'}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          marginRight={isNarrow ? 0 : 1}
          flexDirection="column"
        >
          <CardTitle title="Chains" color={THEME.warn} />
          <ChainTable byChain={byChain} />
        </Box>

        <Box
          width={isNarrow ? '100%' : '50%'}
          marginTop={isNarrow ? 1 : 0}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          flexDirection="column"
        >
          <CardTitle title="Errors" color={THEME.error} />
          {errors.length === 0 ? (
            <Text color={THEME.muted}>No errors</Text>
          ) : (
            errors.map((e) => (
              <Box key={e.message} flexDirection="row" marginBottom={1}>
                <Box marginRight={1}>
                  <Text color={THEME.error} inverse bold>
                    {` ×${String(e.count).padStart(2, '0')} `}
                  </Text>
                </Box>
                <Text color={THEME.text}>{fit(String(e.message), errMsgMaxLen)}</Text>
              </Box>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}
