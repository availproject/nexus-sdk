import { Box, Text, useApp, useInput } from 'ink';
import { useState } from 'react';
import ReportCharts from './components/ReportCharts';
import ReportIntents from './components/ReportIntents';
import ReportOverview from './components/ReportOverview';
import { Hint } from './components/report-ui';
import useStdoutDimensions from './hooks/useStdoutDimensions';
import RunScreen from './RunScreen';
import { activeTuiTheme as THEME } from './theme';
import type { TuiController, TuiRunState } from './types';

type Screen = 'run' | 'report';
type ReportTab = 'overview' | 'charts' | 'intents';

type Props = {
  state: TuiRunState;
  controller: TuiController;
};

const REPORT_TABS: Array<{ key: ReportTab; label: string; shortcut: string }> = [
  { key: 'overview', label: 'Overview', shortcut: '1' },
  { key: 'charts', label: 'Charts', shortcut: '2' },
  { key: 'intents', label: 'Intents', shortcut: '3' },
];

export default function App({ state, controller }: Props) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('run');
  const [reportTab, setReportTab] = useState<ReportTab>('overview');
  const [cols = 120, rows = 40] = useStdoutDimensions();
  const isNarrow = cols < 120;
  const errMsgMaxLen = Math.max(20, isNarrow ? cols - 19 : Math.floor(cols / 2) - 19);

  useInput((input, key) => {
    if (screen !== 'report') return;
    if (input === '1') {
      setReportTab('overview');
      return;
    }
    if (input === '2') {
      setReportTab('charts');
      return;
    }
    if (input === '3') {
      setReportTab('intents');
      return;
    }
    if (input === 'b') {
      setScreen('run');
      return;
    }
    if ((input === 'q' || key.escape) && state.done) exit();
  });

  if (screen === 'report' && state.report) {
    return (
      <Box flexDirection="column" padding={1} width={cols} height={rows}>
        {/* Header — never shrinks */}
        <Box
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          flexDirection="column"
          flexShrink={0}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={THEME.title}>
              ◈ STRESS TEST REPORT
            </Text>
            <Text color={THEME.muted}>b back q quit</Text>
          </Box>
          <Box flexDirection="row" marginTop={0} gap={2}>
            {REPORT_TABS.map((tab) => {
              const active = reportTab === tab.key;
              return (
                <Box key={tab.key} flexDirection="row" gap={1}>
                  <Text color={active ? THEME.title : THEME.muted} bold={active}>
                    {active ? '▸' : ' '}
                  </Text>
                  <Text color={active ? THEME.title : THEME.muted} bold={active}>
                    {tab.shortcut} {tab.label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Content — grows to fill, clips overflow so header/footer are never compressed */}
        {/* header(4) + marginTop(1) + marginTop+footer(4) + root_padding(2) = 11 reserved rows */}
        <Box marginTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
          {reportTab === 'overview' ? (
            <ReportOverview report={state.report} isNarrow={isNarrow} errMsgMaxLen={errMsgMaxLen} />
          ) : reportTab === 'charts' ? (
            <ReportCharts
              report={state.report}
              operations={state.operations}
              isNarrow={isNarrow}
              contentRows={rows - 11}
            />
          ) : (
            <ReportIntents operations={state.operations} />
          )}
        </Box>

        {/* Footer — never shrinks, always at bottom */}
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          flexDirection="row"
          flexShrink={0}
        >
          <Hint k="1" desc="overview" />
          <Hint k="2" desc="charts" />
          <Hint k="3" desc="intents" />
          <Hint k="b" desc="back" />
          <Hint k="q" desc="quit" />
          {(reportTab === 'intents' || reportTab === 'charts') && (
            <>
              <Hint k="↑/k ↓/j" desc="scroll" />
              <Hint k="g" desc="top" />
              <Hint k="G" desc="bottom" />
            </>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <RunScreen
      state={state}
      controller={controller}
      onOpenReport={() => setScreen('report')}
      onQuit={() => exit()}
    />
  );
}
