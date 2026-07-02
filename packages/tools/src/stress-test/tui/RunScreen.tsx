import { Badge, Spinner } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { Operation } from '../types';
import { Hint } from './components/report-ui';
import useStdoutDimensions from './hooks/useStdoutDimensions';
import { computeRunLayout } from './run-layout';
import { activeTuiTheme as THEME } from './theme';
import type { TuiController, TuiRunState } from './types';
import { fit, formatDuration, STATUS_ICON, statusColor } from './utils';
import Divider from './vendor/InkDivider';
import Table from './vendor/InkTable';

type PaneKey = 'ops' | 'details' | 'events';

type Props = {
  state: TuiRunState;
  controller: TuiController;
  onOpenReport: () => void;
  onQuit: () => void;
};

const countsFromOps = (operations: Operation[]) => {
  const counts = {
    queued: 0,
    running: 0,
    approved: 0,
    signed: 0,
    deposited: 0,
    fulfilled: 0,
    failed: 0,
  } as Record<Operation['status'], number>;
  for (const op of operations) counts[op.status] += 1;
  return counts;
};

const opLiveDuration = (op: Operation, now: number) => {
  if (op.durationMs !== undefined) return op.durationMs;
  if (op.startedAt === undefined) return undefined;
  if (
    op.status === 'running' ||
    op.status === 'approved' ||
    op.status === 'signed' ||
    op.status === 'deposited'
  ) {
    return Math.max(0, now - op.startedAt);
  }
  return undefined;
};

const padRows = <T,>(rows: T[], count: number, filler: T) =>
  [...rows, ...Array.from({ length: Math.max(0, count - rows.length) }, () => filler)].slice(
    0,
    count
  );

const viewportSlice = <T,>(items: T[], selectedIndex: number, rows: number) => {
  const start = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(rows / 2), Math.max(0, items.length - rows))
  );
  return { start, items: items.slice(start, start + rows) };
};

const FilledBar = ({ value, width }: { value: number; width: number }) => {
  const filled = Math.round((Math.min(100, Math.max(0, value)) / 100) * width);
  return (
    <Text>
      <Text color={value >= 100 ? THEME.success : THEME.accent}>{'█'.repeat(filled)}</Text>
      <Text color={THEME.border}>{'░'.repeat(width - filled)}</Text>
    </Text>
  );
};

const HeaderCard = ({
  state,
  counts,
  completionPct,
  doneCount,
  inFlight,
  elapsedMs,
  throughputPerMin,
  progressBarWidth,
}: {
  state: TuiRunState;
  counts: ReturnType<typeof countsFromOps>;
  completionPct: number;
  doneCount: number;
  inFlight: number;
  elapsedMs: number;
  throughputPerMin: number;
  progressBarWidth: number;
}) => (
  <Box borderStyle="round" borderColor={THEME.border} paddingX={1} flexDirection="column">
    <Box justifyContent="space-between">
      <Text bold color={THEME.title}>
        ◈ NEXUS STRESS TEST
      </Text>
      <Box gap={1}>
        {!state.done && inFlight > 0 ? <Spinner label="" /> : null}
        {state.done ? (
          <Badge color={THEME.success}>✓ Complete</Badge>
        ) : state.stopRequested ? (
          <Badge color={THEME.warn}>◌ Stopping</Badge>
        ) : (
          <Badge color={THEME.accent}>● Running</Badge>
        )}
      </Box>
    </Box>

    <Divider dividerColor={THEME.border} boxProps={{ marginTop: 0, marginBottom: 0 }} />

    <Box flexDirection="row" gap={4}>
      <Box flexDirection="column">
        <Text>
          <Text color={THEME.muted}>{'Elapsed    '}</Text>
          <Text color={THEME.accent} bold>
            {formatDuration(elapsedMs)}
          </Text>
        </Text>
        <Text>
          <Text color={THEME.muted}>{'Throughput '}</Text>
          <Text color={THEME.accent} bold>
            {throughputPerMin.toFixed(1)}/min
          </Text>
        </Text>
        <Text>
          <Text color={THEME.muted}>{'In-Flight  '}</Text>
          <Text color={inFlight > 0 ? THEME.accent : THEME.muted} bold>
            {inFlight}
          </Text>
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text>
          <Text color={THEME.muted}>{'Total  '}</Text>
          <Text color={THEME.text} bold>
            {state.total}
          </Text>
        </Text>
        <Text>
          <Text color={THEME.muted}>{'Done   '}</Text>
          <Text color={THEME.success} bold>
            {doneCount}
          </Text>
        </Text>
        <Text>
          <Text color={THEME.muted}>{'Queued '}</Text>
          <Text color={counts.queued > 0 ? THEME.warn : THEME.muted}>{counts.queued}</Text>
        </Text>
      </Box>
    </Box>

    <Box marginTop={1} gap={1}>
      <FilledBar value={completionPct} width={progressBarWidth} />
      <Text color={THEME.accent} bold>
        {completionPct.toFixed(1)}%
      </Text>
      <Text color={THEME.muted}>
        {doneCount}/{state.total}
      </Text>
    </Box>

    <Box marginTop={1} gap={2}>
      <Text color={THEME.muted}>
        {STATUS_ICON.queued} {counts.queued} queued
      </Text>
      <Text color={THEME.accent}>
        {STATUS_ICON.running} {counts.running} running
      </Text>
      <Text color={THEME.warn}>
        {STATUS_ICON.signed} {counts.signed} signed
      </Text>
      <Text color={THEME.info}>
        {STATUS_ICON.deposited} {counts.deposited} deposited
      </Text>
      <Text color={THEME.success}>
        {STATUS_ICON.fulfilled} {counts.fulfilled} fulfilled
      </Text>
      <Text color={counts.failed > 0 ? THEME.error : THEME.muted}>
        {STATUS_ICON.failed} {counts.failed} failed
      </Text>
    </Box>
  </Box>
);

const Pane = ({
  title,
  focused,
  children,
}: {
  title: string;
  focused: boolean;
  children: React.ReactNode;
}) => (
  <Box
    borderStyle={focused ? 'bold' : 'round'}
    borderColor={focused ? THEME.borderFocus : THEME.border}
    paddingX={1}
    flexDirection="column"
    flexShrink={0}
    width="100%"
  >
    <Box marginBottom={1} flexDirection="row" gap={1}>
      <Text color={focused ? THEME.accent : THEME.muted} bold>
        ▍
      </Text>
      <Text color={focused ? THEME.title : THEME.muted} bold={focused}>
        {title.toUpperCase()}
      </Text>
    </Box>
    {children}
  </Box>
);

export default function RunScreen({ state, controller, onOpenReport, onQuit }: Props) {
  const [cols = 120, rows = 40] = useStdoutDimensions();
  const layout = useMemo(() => computeRunLayout(cols, rows), [cols, rows]);
  const [selectedOpIndex, setSelectedOpIndex] = useState(0);
  const [selectedEventIndex, setSelectedEventIndex] = useState(0);
  const [focusPane, setFocusPane] = useState<PaneKey>('ops');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [eventAutoFollow, setEventAutoFollow] = useState(true);

  const counts = useMemo(() => countsFromOps(state.operations), [state.operations]);
  const elapsedMs = Math.max(0, (state.endedAt ?? nowTick) - state.startedAt);
  const doneCount = counts.fulfilled + counts.failed;
  const inFlight = counts.running + counts.approved + counts.signed + counts.deposited;
  const throughputPerMin = elapsedMs > 0 ? counts.fulfilled / (elapsedMs / 60000) : 0;
  const completionPct = state.total > 0 ? (doneCount / state.total) * 100 : 0;

  useEffect(() => {
    if (state.done || inFlight <= 0) return;
    const timer = setInterval(() => setNowTick(Date.now()), 750);
    return () => clearInterval(timer);
  }, [state.done, inFlight]);

  useEffect(() => {
    setSelectedOpIndex((prev) => Math.min(prev, Math.max(0, state.operations.length - 1)));
  }, [state.operations.length]);

  useEffect(() => {
    setSelectedEventIndex((prev) => Math.min(prev, Math.max(0, state.events.length - 1)));
  }, [state.events.length]);

  useEffect(() => {
    if (!eventAutoFollow || state.events.length === 0) return;
    setSelectedEventIndex(state.events.length - 1);
  }, [state.events.length, eventAutoFollow]);

  useInput((input, key) => {
    if ((input === 'q' || key.escape) && state.done) {
      onQuit();
      return;
    }
    if (input === 's' && !state.done) {
      controller.requestStop();
      return;
    }
    if (input === 'r' && state.done && state.report) {
      onOpenReport();
      return;
    }
    if (key.tab) {
      setFocusPane((p) => (p === 'ops' ? 'details' : p === 'details' ? 'events' : 'ops'));
      return;
    }
    if (key.downArrow || input === 'j') {
      if (focusPane === 'events') {
        const next = Math.min(selectedEventIndex + 1, Math.max(0, state.events.length - 1));
        setSelectedEventIndex(next);
        // Re-enable auto-follow when we reach the last event
        setEventAutoFollow(next >= state.events.length - 1);
      } else if (focusPane === 'ops') {
        setSelectedOpIndex((v) => Math.min(v + 1, Math.max(0, state.operations.length - 1)));
      }
      return;
    }
    if (key.upArrow || input === 'k') {
      if (focusPane === 'events') {
        setEventAutoFollow(false);
        setSelectedEventIndex((v) => Math.max(0, v - 1));
      } else if (focusPane === 'ops') {
        setSelectedOpIndex((v) => Math.max(0, v - 1));
      }
      return;
    }
    if (focusPane === 'events' && input === 'g') {
      setEventAutoFollow(false);
      setSelectedEventIndex(0);
      return;
    }
    if (focusPane === 'events' && input === 'G') {
      setEventAutoFollow(true);
      setSelectedEventIndex(Math.max(0, state.events.length - 1));
    }
  });

  // ── Data preparation ───────────────────────────────────────────────────────

  const selectedOp = state.operations[selectedOpIndex];
  const opsWindow = viewportSlice(state.operations, selectedOpIndex, layout.opsRows);
  const opsTableData = padRows(
    opsWindow.items.map((op) => {
      const dur = opLiveDuration(op, nowTick);
      const icon = STATUS_ICON[op.status] ?? '?';
      return {
        sel: op.id === selectedOp?.id ? '▸' : ' ',
        id: `#${String(op.id).padStart(4, '0')}`,
        chain: String(op.destinationChainId),
        status: fit(`${icon} ${op.status.toUpperCase()}`, 12),
        time: dur !== undefined ? formatDuration(dur) : '',
      };
    }),
    layout.opsRows,
    { sel: ' ', id: '', chain: '', status: '', time: '' }
  );

  const rawEvents =
    state.events.length > 0
      ? state.events
      : [
          {
            id: -1,
            ts: state.startedAt,
            kind: 'system' as const,
            message: 'Waiting for events...',
            operationId: undefined,
          },
        ];
  const eventWindow = viewportSlice(rawEvents, selectedEventIndex, layout.eventRows);
  const eventTableData = padRows(
    eventWindow.items.map((e) => ({
      t: formatDuration(Math.max(0, e.ts - state.startedAt)),
      type: e.kind === 'error' ? 'ERROR' : e.kind === 'system' ? 'SYSTEM' : 'STATUS',
      message: fit(e.message, layout.eventMessageWidth),
    })),
    layout.eventRows,
    { t: '', type: '', message: '' }
  );

  const detailsData = padRows(
    selectedOp
      ? [
          { field: 'Id', value: `#${selectedOp.id}` },
          { field: 'Chain', value: String(selectedOp.destinationChainId) },
          {
            field: 'Status',
            value: `${STATUS_ICON[selectedOp.status] ?? '?'} ${selectedOp.status}`,
          },
          { field: 'Token', value: selectedOp.token },
          { field: 'Amount', value: selectedOp.amount },
          ...(selectedOp.startedAt
            ? [
                {
                  field: 'Elapsed',
                  value: formatDuration(opLiveDuration(selectedOp, nowTick) ?? 0),
                },
              ]
            : []),
          ...(selectedOp.signToDepositMs !== undefined
            ? [
                {
                  field: 'Sign->Deposit',
                  value: formatDuration(selectedOp.signToDepositMs),
                },
              ]
            : []),
          ...(selectedOp.depositToFillMs !== undefined
            ? [
                {
                  field: 'Deposit->Fill',
                  value: formatDuration(selectedOp.depositToFillMs),
                },
              ]
            : []),
          ...(selectedOp.signToFillMs !== undefined
            ? [
                {
                  field: 'Sign->Fill (fallback)',
                  value: formatDuration(selectedOp.signToFillMs),
                },
              ]
            : []),
          ...(selectedOp.depositObserved === false
            ? [
                {
                  field: 'Deposit',
                  value: 'Not observed',
                },
              ]
            : []),
          ...(selectedOp.intentId
            ? [{ field: 'Intent ID', value: fit(selectedOp.intentId, layout.detailsValueWidth) }]
            : []),
          ...(selectedOp.error
            ? [{ field: 'Error', value: fit(selectedOp.error, layout.detailsValueWidth) }]
            : []),
        ]
      : [],
    layout.detailsRows,
    { field: '', value: '' }
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" padding={1} width={cols} height={rows}>
      <HeaderCard
        state={state}
        counts={counts}
        completionPct={completionPct}
        doneCount={doneCount}
        inFlight={inFlight}
        elapsedMs={elapsedMs}
        throughputPerMin={throughputPerMin}
        progressBarWidth={layout.progressBarWidth}
      />

      <Box
        marginTop={1}
        flexDirection={layout.mode === 'wide' ? 'row' : 'column'}
        flexGrow={1}
        overflow="hidden"
      >
        {/* Operations pane */}
        <Box
          flexGrow={layout.mode === 'wide' ? layout.opsPaneWidthPct : 1}
          flexBasis={layout.mode === 'wide' ? 0 : undefined}
          width={layout.mode === 'wide' ? undefined : '100%'}
        >
          <Pane title="Operations" focused={focusPane === 'ops'}>
            <Table
              data={opsTableData}
              columns={['sel', 'id', 'chain', 'status', 'time']}
              padding={1}
              compact
              uppercaseHeaders
              compactHeaderColor={THEME.title}
              compactCellColor={THEME.text}
              compactRuleColor={THEME.border}
              selectedRowIndex={Math.max(0, selectedOpIndex - opsWindow.start)}
              renderCompactCell={({ columnKey, text, row, selected }) => {
                if (selected && row.id) {
                  // Full-row highlight: vivid pink background via inverse
                  return (
                    <Text color={THEME.title} inverse bold>
                      {text}
                    </Text>
                  );
                }
                if (columnKey === 'status' && row.status?.trim()) {
                  const rawStatus = String(row.status)
                    .split(' ')[1]
                    ?.toLowerCase() as Operation['status'];
                  return (
                    <Text color={statusColor(rawStatus ?? 'queued')} bold>
                      {text}
                    </Text>
                  );
                }
                if (columnKey === 'sel' && row.sel?.trim())
                  return (
                    <Text color={THEME.accent} bold>
                      {text}
                    </Text>
                  );
                if (columnKey === 'id') return <Text color={THEME.muted}>{text}</Text>;
                if (columnKey === 'status') return <Text color={THEME.muted}>{text}</Text>;
                return <Text color={THEME.text}>{text}</Text>;
              }}
            />
          </Pane>
        </Box>

        {/* Details + Event Log column */}
        <Box
          flexGrow={layout.mode === 'wide' ? 100 - layout.opsPaneWidthPct : 1}
          flexBasis={layout.mode === 'wide' ? 0 : undefined}
          width={layout.mode === 'wide' ? undefined : '100%'}
          marginLeft={layout.mode === 'wide' ? 1 : 0}
          marginTop={layout.mode === 'wide' ? 0 : 1}
          flexDirection="column"
        >
          <Pane title="Details" focused={focusPane === 'details'}>
            <Table
              data={detailsData}
              columns={['field', 'value']}
              padding={1}
              compact
              uppercaseHeaders
              compactHeaderColor={THEME.title}
              compactCellColor={THEME.text}
              compactRuleColor={THEME.border}
              renderCompactCell={({ columnKey, row, text }) => {
                if (columnKey === 'field') return <Text color={THEME.muted}>{text}</Text>;
                if (columnKey === 'value' && row.field === 'Status' && row.value) {
                  const rawStatus = String(row.value).split(' ')[1] as Operation['status'];
                  return (
                    <Text color={statusColor(rawStatus ?? 'queued')} bold>
                      {text}
                    </Text>
                  );
                }
                if (columnKey === 'value' && row.field === 'Error' && row.value) {
                  return <Text color={THEME.error}>{text}</Text>;
                }
                if (columnKey === 'value' && row.field === 'Intent ID' && row.value) {
                  return (
                    <Text color={THEME.info} dimColor>
                      {text}
                    </Text>
                  );
                }
                if (columnKey === 'value' && row.value) {
                  return <Text color={THEME.accent}>{text}</Text>;
                }
                return <Text color={THEME.muted}>{text}</Text>;
              }}
            />
          </Pane>

          <Box marginTop={1}>
            <Pane title="Event Log" focused={focusPane === 'events'}>
              <Table
                data={eventTableData}
                columns={['t', 'type', 'message']}
                padding={1}
                compact
                uppercaseHeaders
                compactHeaderColor={THEME.title}
                compactCellColor={THEME.text}
                compactRuleColor={THEME.border}
                selectedRowIndex={
                  state.events.length === 0
                    ? undefined
                    : Math.max(0, selectedEventIndex - eventWindow.start)
                }
                renderCompactCell={({ columnKey, row, text, selected }) => {
                  if (columnKey === 'type' && row.type) {
                    const color =
                      row.type === 'ERROR'
                        ? THEME.error
                        : row.type === 'SYSTEM'
                          ? THEME.warn
                          : THEME.accent;
                    return (
                      <Text color={color} inverse={!selected}>
                        {text}
                      </Text>
                    );
                  }
                  if (columnKey === 't') {
                    return (
                      <Text color={selected ? THEME.accent : THEME.text} bold={selected}>
                        {text}
                      </Text>
                    );
                  }
                  if (columnKey === 'message' && row.type === 'ERROR') {
                    return (
                      <Text color={THEME.error} bold={selected}>
                        {text}
                      </Text>
                    );
                  }
                  return (
                    <Text color={selected ? THEME.text : THEME.muted} bold={selected}>
                      {text}
                    </Text>
                  );
                }}
              />
            </Pane>
            <Box flexDirection="row" gap={2} paddingX={2}>
              <Text color={eventAutoFollow ? THEME.success : THEME.warn}>
                {eventAutoFollow ? '↓ follow' : '● paused'}
              </Text>
              <Text color={THEME.muted}>
                {state.events.length === 0
                  ? '—'
                  : `${selectedEventIndex + 1} / ${state.events.length}`}
              </Text>
              {!eventAutoFollow && (
                <Text color={THEME.muted} dimColor>
                  G to resume
                </Text>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Footer with keyboard hints */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={THEME.border}
        paddingX={1}
        flexDirection="row"
      >
        {state.done ? (
          <>
            <Hint k="r" desc="report" />
            <Hint k="q" desc="quit" />
          </>
        ) : (
          <Hint k="s" desc="stop" />
        )}
        <Hint k="tab" desc="cycle panes" />
        {focusPane === 'events' ? (
          <>
            <Hint k="↑/k ↓/j" desc="scroll" />
            <Hint k="g" desc="top" />
            <Hint k="G" desc="follow↓" />
          </>
        ) : (
          <Hint k="↑/k ↓/j" desc="navigate" />
        )}
      </Box>
    </Box>
  );
}
