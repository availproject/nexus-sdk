export type RunLayoutMode = 'wide' | 'stacked';

export type RunLayout = {
  mode: RunLayoutMode;
  opsRows: number;
  detailsRows: number;
  eventRows: number;
  progressBarWidth: number;
  opsPaneWidthPct: number;
  detailsValueWidth: number;
  eventMessageWidth: number;
};

const WIDE_BREAKPOINT = 118;
// Rows consumed outside the body in wide mode:
//   outer padding(2) + HeaderCard(11) + body marginTop(1) + footer marginTop+border+content(4) = 18
const WIDE_RESERVED_ROWS = 18;
// Stacked adds 1 for the right-column marginTop that sits inside the body column layout
const STACKED_RESERVED_ROWS = 19;
// Cap body height so it doesn't dominate very tall terminals
const MAX_WIDE_BODY = 24;
const MAX_STACKED_BODY = 40;

// Per-pane overhead (border top+bottom=2, title+marginBottom=2, table hdr+divider=2)
const OPS_OVERHEAD = 6;
// Right column in wide mode: details(6) + marginTop(1) + event(6) + statusbar(1 below pane border) = 14
const RIGHT_OVERHEAD = 14;
// Stacked total pane overhead: ops(6) + right_col_marginTop(1) + details(6) + event_marginTop(1) + event+statusbar(7) = 21
const STACKED_OVERHEAD = 21;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const computeRunLayout = (cols: number, rows: number): RunLayout => {
  const mode: RunLayoutMode = cols >= WIDE_BREAKPOINT ? 'wide' : 'stacked';
  const isWide = mode === 'wide';

  const reservedRows = isWide ? WIDE_RESERVED_ROWS : STACKED_RESERVED_ROWS;
  const bodyBudget = Math.max(
    0,
    Math.min(rows - reservedRows, isWide ? MAX_WIDE_BODY : MAX_STACKED_BODY)
  );

  if (isWide) {
    // Both columns must fit exactly bodyBudget rows.
    // Ops pane:   opsRows  + OPS_OVERHEAD   = bodyBudget  →  opsRows  = bodyBudget - OPS_OVERHEAD
    // Right col:  (detailsRows + eventRows) + RIGHT_OVERHEAD = bodyBudget
    //             → data rows = rightDataBudget = bodyBudget - RIGHT_OVERHEAD
    // Clamp data rows to 0 (not a positive minimum) so the sums always fit exactly.
    const opsRows = clamp(bodyBudget - OPS_OVERHEAD, 0, 20);
    const rightDataBudget = Math.max(0, bodyBudget - RIGHT_OVERHEAD);
    const detailsRows = clamp(Math.floor(rightDataBudget * 0.45), 0, 7);
    const eventRows = Math.max(0, rightDataBudget - detailsRows);
    return {
      mode,
      opsRows,
      detailsRows,
      eventRows,
      progressBarWidth: clamp(Math.floor(cols * 0.28), 18, 34),
      opsPaneWidthPct: 50,
      detailsValueWidth: 40,
      eventMessageWidth: 42,
    };
  }

  // Stacked mode: all three panes share bodyBudget rows.
  // Total pane overhead is fixed (STACKED_OVERHEAD); remaining rows are distributed as data.
  const stackedDataBudget = Math.max(0, bodyBudget - STACKED_OVERHEAD);
  const opsRows = clamp(Math.floor(stackedDataBudget * 0.45), 0, 8);
  const detailsRows = clamp(Math.floor(stackedDataBudget * 0.26), 0, 6);
  const eventRows = Math.max(0, stackedDataBudget - opsRows - detailsRows);
  return {
    mode,
    opsRows,
    detailsRows,
    eventRows,
    progressBarWidth: clamp(Math.floor(cols * 0.4), 16, 30),
    opsPaneWidthPct: 100,
    detailsValueWidth: 22,
    eventMessageWidth: 22,
  };
};
