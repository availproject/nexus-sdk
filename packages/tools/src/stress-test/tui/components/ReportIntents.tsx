import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Operation } from '../../types';
import useStdoutDimensions from '../hooks/useStdoutDimensions';
import { activeTuiTheme as THEME } from '../theme';
import { formatDuration, STATUS_ICON, statusColor } from '../utils';
import Table from '../vendor/InkTable';
import { CardTitle } from './report-ui';

type Props = {
  operations: Operation[];
};

type IntentRow = {
  id: string;
  s: string;
  chain: string;
  intent: string;
  time: string;
  _status: Operation['status'];
};

const FILLER: IntentRow = { id: '', s: '', chain: '', intent: '', time: '', _status: 'queued' };

// App.tsx report layout overhead (non-content rows):
//   outer padding(2) + report header box(4) + content marginTop(1) + footer marginTop+border+content(4) = 11
// This component's overhead inside the content box:
//   border top+bottom(2) + CardTitle text+marginBottom(2) + table hdr+div(2) + count row(1) = 7
const TABLE_OVERHEAD = 11 + 7; // = 18

export default function ReportIntents({ operations }: Props) {
  const [, rows = 40] = useStdoutDimensions();
  const [topIndex, setTopIndex] = useState(0);

  const tableRows = Math.max(5, rows - TABLE_OVERHEAD);
  const maxTop = Math.max(0, operations.length - tableRows);

  useInput((input, key) => {
    if (key.downArrow || input === 'j') {
      setTopIndex((v) => Math.min(v + 1, maxTop));
      return;
    }
    if (key.upArrow || input === 'k') {
      setTopIndex((v) => Math.max(0, v - 1));
      return;
    }
    if (input === 'g') {
      setTopIndex(0);
      return;
    }
    if (input === 'G') setTopIndex(maxTop);
  });

  const allRows: IntentRow[] = operations.map((op) => ({
    id: `#${String(op.id).padStart(4, '0')}`,
    s: STATUS_ICON[op.status] ?? '?',
    chain: String(op.destinationChainId),
    intent: op.intentId ?? '—',
    time: op.durationMs !== undefined ? formatDuration(op.durationMs) : '—',
    _status: op.status,
  }));

  const slice = allRows.slice(topIndex, topIndex + tableRows);
  const visibleRows = [
    ...slice,
    ...Array.from({ length: Math.max(0, tableRows - slice.length) }, () => FILLER),
  ];

  return (
    <Box borderStyle="round" borderColor={THEME.border} paddingX={1} flexDirection="column">
      <CardTitle title="Intent Log" color={THEME.accent} />

      <Table
        data={visibleRows}
        columns={['id', 's', 'chain', 'intent', 'time']}
        padding={1}
        compact
        uppercaseHeaders
        compactHeaderColor={THEME.title}
        compactCellColor={THEME.text}
        compactRuleColor={THEME.border}
        renderCompactCell={({ columnKey, text, row }) => {
          if (columnKey === 's' && row.s) {
            return (
              <Text color={statusColor(row._status as Operation['status'])} bold>
                {text}
              </Text>
            );
          }
          if (columnKey === 'chain') {
            return <Text color={row.chain ? THEME.info : THEME.muted}>{text}</Text>;
          }
          if (columnKey === 'intent') {
            const isDash = row.intent === '—';
            return (
              <Text color={isDash ? THEME.muted : THEME.text} dimColor={isDash}>
                {text}
              </Text>
            );
          }
          if (columnKey === 'id') return <Text color={THEME.muted}>{text}</Text>;
          return <Text color={row.time === '—' ? THEME.muted : THEME.text}>{text}</Text>;
        }}
      />

      <Box flexDirection="row" gap={2}>
        <Text color={THEME.muted}>{operations.length} operations</Text>
        {operations.length > tableRows && (
          <Text color={THEME.muted}>
            {topIndex + 1}–{Math.min(topIndex + tableRows, operations.length)}
          </Text>
        )}
      </Box>
    </Box>
  );
}
