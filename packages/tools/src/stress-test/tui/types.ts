import type { Operation, StressReport } from '../types';

export type TuiEventLogItem = {
  id: number;
  ts: number;
  kind: 'status' | 'error' | 'system';
  message: string;
  operationId?: number;
};

export type TuiRunState = {
  startedAt: number;
  endedAt?: number;
  total: number;
  stopRequested: boolean;
  done: boolean;
  operations: Operation[];
  report?: StressReport;
  events: TuiEventLogItem[];
};

export type TuiController = {
  requestStop: () => void;
};
