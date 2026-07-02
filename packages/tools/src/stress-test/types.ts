export type OperationStatus =
  | 'queued'
  | 'running'
  | 'approved'
  | 'signed'
  | 'deposited'
  | 'fulfilled'
  | 'failed';

export type Operation = {
  id: number;
  status: OperationStatus;
  destinationChainId: number;
  token: string;
  amount: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  approvedAt?: number;
  signedAt?: number;
  depositedAt?: number;
  fulfilledAt?: number;
  signToDepositMs?: number;
  depositToFillMs?: number;
  signToFillMs?: number;
  depositObserved?: boolean;
  error?: string;
  explorerUrl?: string;
  intentExplorerUrl?: string;
  intentId?: string;
  sourceChains?: Array<{ id: number; name: string }>;
  cancelled?: boolean;
};

export type RunStatus = 'running' | 'completed' | 'stopped';

export type LoadModel = 'batch' | 'fixed' | 'ramp' | 'soak';

export type BatchConfig = {
  loadModel: 'batch';
  totalRequests: number;
  batchSize: number;
  delayMs: number;
};

export type FixedRateConfig = {
  loadModel: 'fixed';
  totalRequests: number;
  ratePerSecond: number;
  maxInFlight?: number;
};

export type RampConfig = {
  loadModel: 'ramp';
  totalRequests: number;
  startRate: number;
  stepRate: number;
  stepDurationSec: number;
  maxRate: number;
  maxInFlight?: number;
};

export type SoakConfig = {
  loadModel: 'soak';
  totalRequests: number;
  ratePerSecond: number;
  durationMinutes: number;
  maxInFlight?: number;
};

export type StressRunConfig = (BatchConfig | FixedRateConfig | RampConfig | SoakConfig) & {
  token: string;
  amount: string;
};

export type StressRun = {
  id: number;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  config: StressRunConfig;
};

export type StressReport = {
  startedAt: number;
  endedAt: number;
  config: StressRunConfig;
  totals: {
    total: number;
    fulfilled: number;
    failed: number;
    cancelled: number;
  };
  performance: {
    durationMs: number;
    avgMs: number;
    medianMs: number;
    p90Ms: number;
    p95Ms: number;
    p99Ms: number;
    minMs: number;
    maxMs: number;
    throughputPerMin: number;
    signToDepositMs: {
      avgMs: number;
      medianMs: number;
      count: number;
    };
    depositToFillMs: {
      avgMs: number;
      medianMs: number;
      count: number;
    };
    fallbackSignToFillMs: {
      avgMs: number;
      medianMs: number;
      count: number;
    };
  };
  byStatus: Array<{ status: OperationStatus; count: number }>;
  byChain: Array<{
    chainId: number;
    chainName: string;
    total: number;
    fulfilled: number;
    failed: number;
    cancelled: number;
  }>;
  errors: Array<{ message: string; count: number }>;
};
