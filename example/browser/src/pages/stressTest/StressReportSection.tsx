import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StressReport } from "../../../../../packages/tools/src/stress-test";
import { Dropdown } from "../../components/Dropdown";

type DropdownOption = { value: string; label: string };
import {
  chartAxisTickStyle,
  chartGridStroke,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
  chartTooltipLabelStyle,
  formatDelta,
  formatDurationCompact,
  overlay,
} from "./formatting";
import type { SpanAggregate } from "./types";
import { useChartTheme } from "./useChartTheme";

type ComparisonRow = {
  spanName: string;
  byOperation: Array<{
    operationId: number;
    value: number | null;
  }>;
  meanAcrossOps: number;
  medianAcrossOps: number;
  deltaFirstToLastPct: number | null;
};

type StressReportSectionProps = {
  report: StressReport;
  isSharedReportView: boolean;
  exitSharedReportView: () => void;
  handleCopyShareLink: () => void;
  isCopyingShareLink: boolean;
  shareButtonLabel: string;
  currentRunSpanAggregates: SpanAggregate[];
  operationHistogramLength: number;
  durationSummaryLine: string;
  histogramChartData: Array<{
    range: string;
    count: number;
  }>;
  currentRunSubrunChartData: Array<{
    spanLabel: string;
    spanName: string;
    medianMs: number;
    meanMs: number;
    p95Ms: number;
    count: number;
  }>;
  comparisonMetric: "medianMs" | "meanMs";
  comparisonMetricOptions: DropdownOption[];
  setComparisonMetric: (value: "medianMs" | "meanMs") => void;
  selectedSpanForTrend: string;
  trendSpanOptions: DropdownOption[];
  setSelectedSpanForTrend: (value: string) => void;
  selectedSpanTrendData: Array<{
    operationLabel: string;
    operationId: number;
    durationMs: number;
  }>;
  operationSpanComparison: {
    operationIds: number[];
    rows: ComparisonRow[];
  };
  subrunGridTemplate: string;
  reportConfigLines: string[];
};

const formatTime = (epochMs: number) =>
  new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export default function StressReportSection({
  report,
  isSharedReportView,
  exitSharedReportView,
  handleCopyShareLink,
  isCopyingShareLink,
  shareButtonLabel,
  currentRunSpanAggregates,
  operationHistogramLength,
  durationSummaryLine,
  histogramChartData,
  currentRunSubrunChartData,
  comparisonMetric,
  comparisonMetricOptions,
  setComparisonMetric,
  selectedSpanForTrend,
  trendSpanOptions,
  setSelectedSpanForTrend,
  selectedSpanTrendData,
  operationSpanComparison,
  subrunGridTemplate,
  reportConfigLines,
}: StressReportSectionProps) {
  const palette = useChartTheme();

  const tooltipContent = chartTooltipContentStyle(palette);
  const tooltipLabel = chartTooltipLabelStyle(palette);
  const tooltipItem = chartTooltipItemStyle(palette);
  const axisTick = chartAxisTickStyle(palette);
  const gridStroke = chartGridStroke(palette);

  const successRate =
    report.totals.total > 0
      ? (report.totals.fulfilled / report.totals.total) * 100
      : 0;

  return (
    <section className="stress-report">
      {isSharedReportView && (
        <button
          type="button"
          className="intent-button intent-button-deny stress-shared-back"
          onClick={exitSharedReportView}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Test
        </button>
      )}

      <header className="stress-report-head">
        <div className="stress-report-head-left">
          <span className="icon-badge" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </span>
          <h3 className="stress-report-title">Test Report</h3>
          <span className="stress-report-time">
            {formatTime(report.startedAt)} → {formatTime(report.endedAt)}
          </span>
          {isSharedReportView && (
            <span className="meta-pill meta-pill--inline meta-pill--queued">
              Shared
            </span>
          )}
        </div>
        <div className="stress-report-head-actions">
          <button
            type="button"
            className="intent-button intent-button-secondary"
            onClick={handleCopyShareLink}
            disabled={isCopyingShareLink}
          >
            {isCopyingShareLink ? "Generating…" : shareButtonLabel}
          </button>
        </div>
      </header>

      {/* Headline metric strip */}
      <div className="metric-strip">
        <div className="metric">
          <span className="metric-label">Total</span>
          <strong className="metric-value">{report.totals.total}</strong>
          <span className="metric-sub">
            <span className="metric-sub-good">
              ✓ {report.totals.fulfilled}
            </span>
            <span className="metric-sub-bad">✗ {report.totals.failed}</span>
            {report.totals.cancelled > 0 && (
              <span>· {report.totals.cancelled} cancelled</span>
            )}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Throughput</span>
          <strong className="metric-value">
            {report.performance.throughputPerMin.toFixed(2)}
          </strong>
          <span className="metric-sub">per minute</span>
        </div>
        <div className="metric">
          <span className="metric-label">Median</span>
          <strong className="metric-value">
            {formatDurationCompact(report.performance.medianMs)}
          </strong>
          <span className="metric-sub">
            avg {formatDurationCompact(report.performance.avgMs)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">P95</span>
          <strong className="metric-value">
            {formatDurationCompact(report.performance.p95Ms)}
          </strong>
          <span className="metric-sub">
            p99 {formatDurationCompact(report.performance.p99Ms)}
          </span>
        </div>
      </div>

      {/* All metrics, collapsible */}
      <details className="metric-extras">
        <summary>
          <span>All metrics ({successRate.toFixed(1)}% success)</span>
          <svg
            className="metric-extras-chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <div className="metric-extras-grid">
          <div className="metric">
            <span className="metric-label">P90</span>
            <strong className="metric-value">
              {formatDurationCompact(report.performance.p90Ms)}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">P99</span>
            <strong className="metric-value">
              {formatDurationCompact(report.performance.p99Ms)}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">Fastest</span>
            <strong className="metric-value">
              {formatDurationCompact(report.performance.minMs)}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">Slowest</span>
            <strong className="metric-value">
              {formatDurationCompact(report.performance.maxMs)}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">Subruns Tracked</span>
            <strong className="metric-value">
              {currentRunSpanAggregates.length}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">Sign → Deposit</span>
            <strong className="metric-value">
              {report.performance.signToDepositMs.count > 0
                ? formatDurationCompact(
                    report.performance.signToDepositMs.medianMs,
                  )
                : "—"}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">Deposit → Fill</span>
            <strong className="metric-value">
              {report.performance.depositToFillMs.count > 0
                ? formatDurationCompact(
                    report.performance.depositToFillMs.medianMs,
                  )
                : "—"}
            </strong>
          </div>
          <div className="metric">
            <span className="metric-label">Sign → Fill (fallback)</span>
            <strong className="metric-value">
              {report.performance.fallbackSignToFillMs.count > 0
                ? formatDurationCompact(
                    report.performance.fallbackSignToFillMs.medianMs,
                  )
                : "—"}
            </strong>
          </div>
        </div>
      </details>

      {/* Charts */}
      <div className="stress-report-block">
        <div className="stress-report-block-head">
          <span className="stress-report-block-head-bar" />
          Run Visuals
        </div>
        <div className="report-charts">
          <div className="report-chart">
            <div className="report-chart-title">
              Operation Duration Distribution
            </div>
            {operationHistogramLength === 0 ? (
              <p className="status">No operation durations available.</p>
            ) : (
              <>
                <div className="report-chart-summary">{durationSummaryLine}</div>
                <div className="report-chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={histogramChartData}
                      layout="vertical"
                      margin={{ top: 8, right: 12, left: 12, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient
                          id="barFillPrimary"
                          x1="0"
                          x2="1"
                          y1="0"
                          y2="0"
                        >
                          <stop offset="0%" stopColor={palette.primary} />
                          <stop offset="100%" stopColor={palette.accent} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridStroke}
                      />
                      <XAxis type="number" tick={axisTick} stroke={gridStroke} />
                      <YAxis
                        type="category"
                        dataKey="range"
                        width={120}
                        tick={axisTick}
                        stroke={gridStroke}
                      />
                      <Tooltip
                        formatter={(value: number) => [value, "Operations"]}
                        labelFormatter={(label: string | number) =>
                          `Duration: ${String(label)}`
                        }
                        contentStyle={tooltipContent}
                        labelStyle={tooltipLabel}
                        itemStyle={tooltipItem}
                        cursor={{ fill: overlay(palette.primary, 0.14) }}
                      />
                      <Bar
                        dataKey="count"
                        fill="url(#barFillPrimary)"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          <div className="report-chart">
            <div className="report-chart-title">
              Current Run Subrun Medians
            </div>
            {currentRunSpanAggregates.length === 0 ? (
              <p className="status">No span data captured for this run.</p>
            ) : (
              <div className="report-chart-canvas">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={currentRunSubrunChartData}
                    layout="vertical"
                    margin={{ top: 8, right: 12, left: 12, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient
                        id="barFillSuccess"
                        x1="0"
                        x2="1"
                        y1="0"
                        y2="0"
                      >
                        <stop offset="0%" stopColor={palette.success} />
                        <stop offset="100%" stopColor={palette.accentLight} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis
                      type="number"
                      tick={axisTick}
                      stroke={gridStroke}
                      tickFormatter={(value: number | string) =>
                        formatDurationCompact(Number(value))
                      }
                    />
                    <YAxis
                      type="category"
                      dataKey="spanLabel"
                      width={120}
                      tick={axisTick}
                      stroke={gridStroke}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === "medianMs")
                          return [formatDurationCompact(value), "Median"];
                        return [formatDurationCompact(value), name];
                      }}
                      labelFormatter={(
                        _label: string | number,
                        payload: Array<{
                          payload?: {
                            spanName: string;
                            meanMs: number;
                            medianMs: number;
                            p95Ms: number;
                            count: number;
                          };
                        }>,
                      ) => {
                        const entry = payload?.[0]?.payload;
                        if (!entry) return "";
                        return `${entry.spanName} · mean ${formatDurationCompact(entry.meanMs)} · p95 ${formatDurationCompact(entry.p95Ms)} · n=${entry.count}`;
                      }}
                      contentStyle={tooltipContent}
                      labelStyle={tooltipLabel}
                      itemStyle={tooltipItem}
                      cursor={{ fill: overlay(palette.success, 0.14) }}
                    />
                    <Bar
                      dataKey="medianMs"
                      fill="url(#barFillSuccess)"
                      radius={[0, 6, 6, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subrun comparison across operations */}
      <div className="stress-report-block">
        <div className="stress-report-block-head">
          <span className="stress-report-block-head-bar" />
          Subrun Comparison Across Runs
        </div>

        <div className="stress-comparison-controls">
          <div className="field">
            <label htmlFor="stress-comparison-metric">Metric</label>
            <Dropdown
              id="stress-comparison-metric"
              options={comparisonMetricOptions}
              value={comparisonMetric}
              onChange={(value) =>
                setComparisonMetric(value as "medianMs" | "meanMs")
              }
            />
          </div>
          <div className="field">
            <label htmlFor="stress-trend-span">Trend Span</label>
            <Dropdown
              id="stress-trend-span"
              options={trendSpanOptions}
              value={selectedSpanForTrend}
              onChange={(value) => setSelectedSpanForTrend(value)}
            />
          </div>
        </div>

        <div className="stress-comparison-meta">
          <span className="config-chip">
            Operations: <strong>{operationSpanComparison.operationIds.length}</strong>
          </span>
          <span className="config-chip">
            Metric: <strong>{comparisonMetric === "medianMs" ? "Median" : "Mean"}</strong>
          </span>
        </div>

        <div className="report-chart">
          <div className="report-chart-title">
            Trend: {selectedSpanForTrend || "No span selected"}
          </div>
          {selectedSpanTrendData.length === 0 ? (
            <p className="status">Need at least one run with this span.</p>
          ) : (
            <div className="report-chart-canvas report-chart-canvas--trend">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={selectedSpanTrendData}
                  margin={{ top: 8, right: 12, left: 12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    dataKey="operationLabel"
                    tick={axisTick}
                    stroke={gridStroke}
                  />
                  <YAxis
                    tick={axisTick}
                    stroke={gridStroke}
                    tickFormatter={(value: number | string) =>
                      formatDurationCompact(Number(value))
                    }
                    width={64}
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      formatDurationCompact(value),
                      comparisonMetric === "medianMs" ? "Median" : "Mean",
                    ]}
                    labelFormatter={(label: string | number) =>
                      `Operation ${String(label)}`
                    }
                    contentStyle={tooltipContent}
                    labelStyle={tooltipLabel}
                    itemStyle={tooltipItem}
                    cursor={{
                      stroke: palette.primaryLight,
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="durationMs"
                    stroke={palette.accent}
                    strokeWidth={3}
                    dot={{ r: 4, fill: palette.accent }}
                    activeDot={{ r: 6, fill: palette.accentLight }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="subrun-table-scroll">
          <div className="subrun-table">
            <div
              className="subrun-table-row subrun-table-row--header"
              style={{ gridTemplateColumns: subrunGridTemplate }}
            >
              <span>Span</span>
              {operationSpanComparison.operationIds.map((operationId) => (
                <span key={operationId}>#{operationId}</span>
              ))}
              <span>Mean</span>
              <span>Median</span>
              <span>Δ first→last</span>
            </div>
            {operationSpanComparison.rows.slice(0, 20).map((row) => (
              <div
                key={row.spanName}
                className="subrun-table-row"
                style={{ gridTemplateColumns: subrunGridTemplate }}
              >
                <span>{row.spanName}</span>
                {row.byOperation.map((entry) => (
                  <span key={`${row.spanName}-${entry.operationId}`}>
                    {entry.value === null
                      ? "—"
                      : formatDurationCompact(entry.value)}
                  </span>
                ))}
                <span>{formatDurationCompact(row.meanAcrossOps)}</span>
                <span>{formatDurationCompact(row.medianAcrossOps)}</span>
                <span className="subrun-delta-cell">
                  {row.deltaFirstToLastPct === null ? (
                    <span className="meta-pill meta-pill--queued meta-pill--inline">
                      —
                    </span>
                  ) : row.deltaFirstToLastPct <= 0 ? (
                    <span className="meta-pill meta-pill--fulfilled meta-pill--inline">
                      {formatDelta(row.deltaFirstToLastPct)}
                    </span>
                  ) : (
                    <span className="meta-pill meta-pill--failed meta-pill--inline">
                      {formatDelta(row.deltaFirstToLastPct)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="stress-report-block">
        <div className="stress-report-block-head">
          <span className="stress-report-block-head-bar" />
          Configuration
        </div>
        <div className="config-chips">
          {reportConfigLines.map((line) => {
            const [label, ...rest] = line.split(":");
            const value = rest.join(":").trim();
            return (
              <span key={line} className="config-chip">
                {label}
                {value && (
                  <>
                    {": "}
                    <strong>{value}</strong>
                  </>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Destination chains */}
      <div className="stress-report-block">
        <div className="stress-report-block-head">
          <span className="stress-report-block-head-bar" />
          Destination Chains
        </div>
        <div className="report-table">
          <div className="report-table-row report-table-row--chains report-table-row--header">
            <span>Chain</span>
            <span>Total</span>
            <span>Fulfilled</span>
            <span>Failed</span>
            <span>Cancelled</span>
          </div>
          {report.byChain.map((row) => (
            <div
              key={row.chainId}
              className="report-table-row report-table-row--chains"
            >
              <span>{row.chainName}</span>
              <span>{row.total}</span>
              <span>{row.fulfilled}</span>
              <span>{row.failed}</span>
              <span>{row.cancelled}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Errors */}
      <div className="stress-report-block">
        <div className="stress-report-block-head">
          <span className="stress-report-block-head-bar" />
          Errors
        </div>
        {report.errors.length === 0 ? (
          <p className="status">No errors recorded.</p>
        ) : (
          <div className="report-table">
            <div className="report-table-row report-table-row--errors report-table-row--header">
              <span>Message</span>
              <span>Count</span>
            </div>
            {report.errors.map((error) => (
              <div
                key={error.message}
                className="report-table-row report-table-row--errors"
              >
                <span>{error.message}</span>
                <span>{error.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
