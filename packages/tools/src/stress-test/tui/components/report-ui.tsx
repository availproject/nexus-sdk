import { Box, Text } from 'ink';
import type { StressReport } from '../../types';
import { activeTuiTheme as THEME } from '../theme';
import Table from '../vendor/InkTable';

// ── Shared primitive: styled keyboard hint ──────────────────────────────────
export const Hint = ({ k, desc }: { k: string; desc: string }) => (
  <Box marginRight={2}>
    <Text color={THEME.accent} bold>
      {k}
    </Text>
    <Text color={THEME.muted}> {desc}</Text>
  </Box>
);

// ── Primitive helpers ───────────────────────────────────────────────────────

export const LabelValue = ({
  label,
  value,
  labelWidth = 13,
}: {
  label: string;
  value: string;
  labelWidth?: number;
}) => (
  <Text>
    <Text color={THEME.muted}>{`${label.padEnd(labelWidth, ' ')}:`}</Text>{' '}
    <Text color={THEME.text}>{value}</Text>
  </Text>
);

export const CardTitle = ({ title, color }: { title: string; color?: string }) => (
  <Box marginBottom={1} flexDirection="row" gap={1}>
    <Text color={color ?? THEME.title} bold>
      ▍
    </Text>
    <Text color={color ?? THEME.title} bold>
      {title.toUpperCase()}
    </Text>
  </Box>
);

// ── Chain table (shared between Overview and Chains tabs) ───────────────────

type ChainRow = {
  chain: string;
  total: string;
  ok: string;
  fail: string;
  cancel: string;
};

const CHAIN_COLUMNS: (keyof ChainRow)[] = ['chain', 'total', 'ok', 'fail', 'cancel'];

const renderChainCell = ({
  columnKey,
  text,
}: {
  value: string | number | boolean | null | undefined;
  text: string;
  columnKey: keyof ChainRow;
  row: ChainRow;
  rowIndex: number;
  selected: boolean;
}) => {
  if (columnKey === 'ok') return <Text color={THEME.success}>{text}</Text>;
  if (columnKey === 'fail') return <Text color={THEME.error}>{text}</Text>;
  if (columnKey === 'cancel') return <Text color={THEME.warn}>{text}</Text>;
  if (columnKey === 'chain') return <Text color={THEME.text}>{text}</Text>;
  return <Text color={THEME.muted}>{text}</Text>;
};

export const ChainTable = ({ byChain }: { byChain: StressReport['byChain'] }) => {
  if (byChain.length === 0) return <Text color={THEME.muted}>No chain data</Text>;
  const rows: ChainRow[] = byChain.map((row) => ({
    chain: `${row.chainName} (${row.chainId})`,
    total: String(row.total),
    ok: String(row.fulfilled),
    fail: String(row.failed),
    cancel: String(row.cancelled),
  }));
  return (
    <Table
      data={rows}
      columns={CHAIN_COLUMNS}
      padding={1}
      compact
      uppercaseHeaders
      compactHeaderColor={THEME.title}
      compactCellColor={THEME.text}
      compactRuleColor={THEME.border}
      renderCompactCell={renderChainCell}
    />
  );
};
