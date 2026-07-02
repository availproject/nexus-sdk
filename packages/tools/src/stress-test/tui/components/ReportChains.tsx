import { Box } from 'ink';
import type { StressReport } from '../../types';
import { activeTuiTheme as THEME } from '../theme';
import { CardTitle, ChainTable } from './report-ui';

type Props = {
  report: StressReport;
};

export default function ReportChains({ report }: Props) {
  return (
    <Box borderStyle="round" borderColor={THEME.border} paddingX={1} flexDirection="column">
      <CardTitle title="Chains" color={THEME.warn} />
      <ChainTable byChain={report.byChain} />
    </Box>
  );
}
