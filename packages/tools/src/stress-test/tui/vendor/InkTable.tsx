import { Box, Text } from 'ink';
import React, { useMemo } from 'react';

// Vendored/adapted from `ink-table` (MIT): https://github.com/maticzav/ink-table
// Adaptations:
// - ESM/TSX module for Ink v6 runtime compatibility
// - Functional component with useMemo (was class component)
// - Stable row keys use row index (avoids object-hash runtime dependency)

type Scalar = string | number | boolean | null | undefined;
type ScalarDict = Record<string, Scalar>;

export type CellProps = React.PropsWithChildren<{
  column: number;
}>;

export type TableProps<T extends ScalarDict> = {
  data: T[];
  columns?: (keyof T)[];
  padding?: number;
  compact?: boolean;
  uppercaseHeaders?: boolean;
  compactHeaderColor?: string;
  compactCellColor?: string;
  compactRuleColor?: string;
  selectedRowIndex?: number;
  renderCompactCell?: (args: {
    value: Scalar;
    text: string;
    columnKey: keyof T;
    row: T;
    rowIndex: number;
    selected: boolean;
  }) => React.ReactNode;
  header?: (props: React.PropsWithChildren<object>) => React.ReactElement;
  cell?: (props: CellProps) => React.ReactElement;
  skeleton?: (props: React.PropsWithChildren<object>) => React.ReactElement;
};

type Column<T extends ScalarDict> = {
  key: string;
  column: keyof T;
  width: number;
};

type RowProps<T extends ScalarDict> = {
  rowKey: string;
  data: Partial<T>;
  columns: Column<T>[];
};

type RowConfig = {
  cell: (props: CellProps) => React.ReactElement;
  padding: number;
  skeleton: {
    component: (props: React.PropsWithChildren<object>) => React.ReactElement;
    line: string;
    left: string;
    right: string;
    cross: string;
  };
};

export function Header(props: React.PropsWithChildren<object>) {
  return <Text bold>{props.children}</Text>;
}

export function Cell(props: CellProps) {
  return <Text>{props.children}</Text>;
}

export function Skeleton(props: React.PropsWithChildren<object>) {
  return <Text bold>{props.children}</Text>;
}

function intersperse<T>(intersperser: (index: number) => T, elements: T[]) {
  return elements.reduce<T[]>((acc, element, index) => {
    if (index > 0) acc.push(intersperser(index));
    acc.push(element);
    return acc;
  }, []);
}

function makeRow<T extends ScalarDict>(config: RowConfig) {
  return ({ rowKey, data, columns }: RowProps<T>) => {
    const { skeleton, cell: CellComp, padding } = config;
    return (
      <Box flexDirection="row">
        <skeleton.component>{skeleton.left}</skeleton.component>
        {...intersperse(
          (i) => (
            <skeleton.component key={`${rowKey}-sep-${i}`}>{skeleton.cross}</skeleton.component>
          ),
          columns.map((column, colI) => {
            const value = data[column.column];
            const key = `${rowKey}-cell-${column.key}`;
            if (value === undefined || value === null) {
              return (
                <CellComp key={key} column={colI}>
                  {skeleton.line.repeat(column.width)}
                </CellComp>
              );
            }
            const raw = String(value);
            const ml = padding;
            const mr = Math.max(0, column.width - raw.length - padding);
            return (
              <CellComp key={key} column={colI}>
                {`${skeleton.line.repeat(ml)}${raw}${skeleton.line.repeat(mr)}`}
              </CellComp>
            );
          })
        )}
        <skeleton.component>{skeleton.right}</skeleton.component>
      </Box>
    );
  };
}

function computeColumns<T extends ScalarDict>(
  data: T[],
  keys: (keyof T)[],
  padding: number
): Column<T>[] {
  return keys.map((key) => {
    const headerWidth = String(key).length;
    const dataWidths = data.map((row) => {
      const v = row[key];
      return v === undefined || v === null ? 0 : String(v).length;
    });
    const width = Math.max(headerWidth, ...dataWidths) + padding * 2;
    return { column: key, width, key: String(key) };
  });
}

export default function InkTable<T extends ScalarDict>(props: TableProps<T>) {
  const {
    data,
    columns: columnKeys,
    padding = 1,
    compact = false,
    uppercaseHeaders = true,
    compactHeaderColor = 'white',
    compactCellColor = 'gray',
    compactRuleColor = 'gray',
    selectedRowIndex,
    renderCompactCell,
    header: HeaderComp = Header,
    cell: CellComp = Cell,
    skeleton: SkeletonComp = Skeleton,
  } = props;

  const allKeys = useMemo(() => {
    const keys = new Set<keyof T>();
    for (const row of data) {
      for (const key in row) keys.add(key as keyof T);
    }
    return Array.from(keys);
  }, [data]);

  const resolvedKeys = useMemo(() => (columnKeys ?? allKeys) as (keyof T)[], [columnKeys, allKeys]);

  const columns = useMemo(
    () => computeColumns(data, resolvedKeys, padding),
    [data, resolvedKeys, padding]
  );

  const headings = useMemo(
    () => resolvedKeys.reduce<Partial<T>>((acc, col) => Object.assign(acc, { [col]: col }), {}),
    [resolvedKeys]
  );

  if (compact) {
    return (
      <Box flexDirection="column">
        {/* Header row */}
        <Box flexDirection="row">
          {columns.map((column) => {
            const rawHeader = String(headings[column.column] ?? '');
            const value = uppercaseHeaders ? rawHeader.toUpperCase() : rawHeader;
            const ml = padding;
            const mr = Math.max(0, column.width - value.length - padding);
            return (
              <Text key={`heading-${column.key}`} color={compactHeaderColor} bold>
                {`${' '.repeat(ml)}${value}${' '.repeat(mr)}`}
              </Text>
            );
          })}
        </Box>
        {/* Divider */}
        <Box flexDirection="row">
          {columns.map((column) => (
            <Text key={`rule-${column.key}`} color={compactRuleColor} bold>
              {'─'.repeat(column.width)}
            </Text>
          ))}
        </Box>
        {/* Data rows */}
        {data.map((rowData, index) => (
          <Box
            flexDirection="row"
            // biome-ignore lint/suspicious/noArrayIndexKey: generic ScalarDict rows have no stable id; row index is intentional (avoids object-hash dep, see file header)
            key={`row-${index}`}
          >
            {columns.map((column) => {
              const value = rowData[column.column];
              const raw = value === undefined || value === null ? '' : String(value);
              const ml = padding;
              const mr = Math.max(0, column.width - raw.length - padding);
              const text = `${' '.repeat(ml)}${raw}${' '.repeat(mr)}`;
              return (
                <React.Fragment key={`cell-${index}-${column.key}`}>
                  {renderCompactCell ? (
                    renderCompactCell({
                      value,
                      text,
                      columnKey: column.column,
                      row: rowData,
                      rowIndex: index,
                      selected: selectedRowIndex === index,
                    })
                  ) : (
                    <Text color={compactCellColor}>{text}</Text>
                  )}
                </React.Fragment>
              );
            })}
          </Box>
        ))}
      </Box>
    );
  }

  // Full-border mode
  const HeaderRow = makeRow<T>({
    cell: SkeletonComp,
    padding,
    skeleton: { component: SkeletonComp, line: '─', left: '┌', right: '┐', cross: '┬' },
  });
  const HeadingRow = makeRow<T>({
    cell: HeaderComp,
    padding,
    skeleton: { component: SkeletonComp, line: ' ', left: '│', right: '│', cross: '│' },
  });
  const SeparatorRow = makeRow<T>({
    cell: SkeletonComp,
    padding,
    skeleton: { component: SkeletonComp, line: '─', left: '├', right: '┤', cross: '┼' },
  });
  const DataRow = makeRow<T>({
    cell: CellComp,
    padding,
    skeleton: { component: SkeletonComp, line: ' ', left: '│', right: '│', cross: '│' },
  });
  const FooterRow = makeRow<T>({
    cell: SkeletonComp,
    padding,
    skeleton: { component: SkeletonComp, line: '─', left: '└', right: '┘', cross: '┴' },
  });

  return (
    <Box flexDirection="column">
      {HeaderRow({ rowKey: 'header', columns, data: {} })}
      {HeadingRow({ rowKey: 'heading', columns, data: headings })}
      {data.map((rowData, index) => {
        const k = `row-${index}`;
        return (
          <Box flexDirection="column" key={k}>
            {SeparatorRow({ rowKey: `sep-${k}`, columns, data: {} })}
            {DataRow({ rowKey: `data-${k}`, columns, data: rowData })}
          </Box>
        );
      })}
      {FooterRow({ rowKey: 'footer', columns, data: {} })}
    </Box>
  );
}
