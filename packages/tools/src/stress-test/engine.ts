import type { Operation, StressReport, StressRunConfig } from './types';

export type OperationExecutor = (operation: Operation) => Promise<void>;

export type RunHooks = {
  onOperationStart?: (operation: Operation) => void;
  onOperationFinish?: (operation: Operation) => void;
  onOperationError?: (operation: Operation, error: unknown) => void;
};

export type RunOptions<TConfig extends StressRunConfig = StressRunConfig> = RunHooks & {
  operations: Operation[];
  config: TConfig;
  execute: OperationExecutor;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type BatchRunConfig = Extract<StressRunConfig, { loadModel: 'batch' }>;
type FixedRunConfig = Extract<StressRunConfig, { loadModel: 'fixed' }>;
type RampRunConfig = Extract<StressRunConfig, { loadModel: 'ramp' }>;
type SoakRunConfig = Extract<StressRunConfig, { loadModel: 'soak' }>;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const createInFlightTracker = (maxInFlight?: number) => {
  const limit = maxInFlight && maxInFlight > 0 ? maxInFlight : undefined;
  const inFlight = new Set<Promise<unknown>>();

  const track = (promise: Promise<void>) => {
    inFlight.add(promise);
    promise.finally(() => {
      inFlight.delete(promise);
    });
  };

  const waitForSlot = async (
    shouldStop?: () => boolean,
    sleep: (ms: number) => Promise<void> = defaultSleep
  ) => {
    if (!limit) return true;
    while (inFlight.size >= limit) {
      if (shouldStop?.()) {
        return false;
      }
      const waiters: Promise<unknown>[] = Array.from(inFlight);
      // Promise.race() alone can stall forever if every in-flight promise hangs;
      // heartbeat wakeups keep stop checks responsive.
      // Heartbeat wake-up allows stop checks even if in-flight promises are hung.
      waiters.push(sleep(50));
      await Promise.race(waiters);
    }
    return true;
  };

  const awaitAll = async () => {
    await Promise.allSettled(Array.from(inFlight));
  };

  return { track, waitForSlot, awaitAll };
};

const wrapExecution = (operation: Operation, execute: OperationExecutor, hooks: RunHooks) => {
  const { onOperationStart, onOperationFinish, onOperationError } = hooks;
  onOperationStart?.(operation);
  return execute(operation)
    .then(() => {
      onOperationFinish?.(operation);
    })
    .catch((error) => {
      onOperationError?.(operation, error);
    });
};

const normalizeTotalRequests = (totalRequests: number) => {
  if (!Number.isFinite(totalRequests) || totalRequests < 0) {
    throw new Error('Total requests must be a non-negative finite number.');
  }
  return Math.floor(totalRequests);
};

const sanitizeTotal = (operations: Operation[], totalRequests: number) =>
  operations.slice(0, normalizeTotalRequests(totalRequests));

const requirePositive = (label: string, value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
};

/**
 * Batch model: fires operations in fixed-size groups, waits for each group to
 * fully settle before moving on, then optionally pauses before the next group.
 * Concurrency within a batch equals the batch size.
 */
const runBatch = async (options: RunOptions<BatchRunConfig>, operations: Operation[]) => {
  const { config, execute, shouldStop, sleep } = options;
  const { batchSize, delayMs } = config;
  const delay = Math.max(0, Math.floor(delayMs));
  const batch = Math.max(1, Math.floor(batchSize));
  const stop = shouldStop ?? (() => false);
  const pause = sleep ?? defaultSleep;

  for (let i = 0; i < operations.length; i += batch) {
    if (stop()) break;
    const slice = operations.slice(i, i + batch);
    // Run the batch concurrently; allSettled ensures one failure doesn't abort the rest.
    await Promise.allSettled(slice.map((op) => wrapExecution(op, execute, options)));
    // Apply inter-batch delay only between batches, not after the final one.
    if (delay > 0 && i + batch < operations.length && !stop()) {
      await pause(delay);
    }
  }
};

/**
 * Fixed-rate model: dispatches operations at a steady `ratePerSecond`.
 * Target dispatch times are computed from a single start timestamp
 * (startAt + i * intervalMs) to prevent drift accumulation over time.
 * `maxInFlight` optionally caps how many operations can be outstanding at once.
 */
const runFixedRate = async (options: RunOptions<FixedRunConfig>, operations: Operation[]) => {
  const { config, execute, shouldStop, sleep, now } = options;
  const { ratePerSecond, maxInFlight } = config;
  requirePositive('Rate per second', ratePerSecond);
  const intervalMs = 1000 / ratePerSecond;
  const stop = shouldStop ?? (() => false);
  const pause = sleep ?? defaultSleep;
  const clock = now ?? Date.now;
  const { track, waitForSlot, awaitAll } = createInFlightTracker(maxInFlight);

  const startAt = clock();
  for (let i = 0; i < operations.length; i += 1) {
    if (stop()) break;
    // Absolute target time avoids cumulative scheduling drift.
    const target = startAt + i * intervalMs;
    const delay = target - clock();
    if (delay > 0) {
      await pause(delay);
    }
    // Block until a concurrency slot is available (no-op if maxInFlight is unset).
    const hasSlot = await waitForSlot(stop, pause);
    if (!hasSlot) break;
    if (stop()) break;
    const operation = operations[i];
    if (!operation) break;
    const promise = wrapExecution(operation, execute, options);
    track(promise);
  }

  // Wait for all in-flight operations to settle before returning.
  await awaitAll();
};

/**
 * Ramp model: increases the dispatch rate in discrete steps.
 * Each step runs at a fixed rate for `stepDurationSec` seconds, then the rate
 * is incremented by `stepRate` up to `maxRate`. This simulates a gradual
 * load increase to find the system's breaking point.
 */
const runRamp = async (options: RunOptions<RampRunConfig>, operations: Operation[]) => {
  const { config, execute, shouldStop, sleep, now } = options;
  const { startRate, stepRate, stepDurationSec, maxRate, maxInFlight } = config;
  requirePositive('Start rate', startRate);
  requirePositive('Step rate', stepRate);
  requirePositive('Step duration', stepDurationSec);
  requirePositive('Max rate', maxRate);
  const stop = shouldStop ?? (() => false);
  const pause = sleep ?? defaultSleep;
  const clock = now ?? Date.now;
  const { track, waitForSlot, awaitAll } = createInFlightTracker(maxInFlight);

  let rate = startRate;
  let index = 0;
  const stepDurationMs = stepDurationSec * 1000;

  // Outer loop: each iteration represents one rate step.
  while (index < operations.length && !stop()) {
    const stepStart = clock();
    const stepEnd = stepStart + stepDurationMs;
    // intervalMs is recalculated per step as rate changes.
    const intervalMs = 1000 / Math.max(rate, 1e-6);
    // nextAt is relative to this step's start, not the overall run start.
    let nextAt = stepStart;

    // Inner loop: dispatch operations at the current rate until the step window ends.
    // Step windows are wall-clock bounded, so slot waits/backpressure can reduce
    // the number of operations actually dispatched in that step.
    while (index < operations.length && !stop() && clock() < stepEnd) {
      const delay = nextAt - clock();
      if (delay > 0) {
        await pause(delay);
      }
      const hasSlot = await waitForSlot(stop, pause);
      if (!hasSlot) break;
      if (stop()) break;
      const operation = operations[index];
      if (!operation) break;
      const promise = wrapExecution(operation, execute, options);
      track(promise);
      index += 1;
      nextAt += intervalMs;
    }

    // Advance to the next rate tier at the end of each step.
    rate = Math.min(maxRate, rate + stepRate);
  }

  // Wait for all in-flight operations to settle before returning.
  await awaitAll();
};

/**
 * Soak model: sustains a constant rate for a wall-clock duration.
 * Unlike the fixed-rate model which is bounded by operation count alone,
 * soak also enforces a time ceiling (`durationMinutes`). Use this to test
 * system stability under prolonged steady load (e.g. memory leaks, degradation).
 */
const runSoak = async (options: RunOptions<SoakRunConfig>, operations: Operation[]) => {
  const { config, execute, shouldStop, sleep, now } = options;
  const { ratePerSecond, durationMinutes, maxInFlight } = config;
  requirePositive('Rate per second', ratePerSecond);
  requirePositive('Duration minutes', durationMinutes);
  const intervalMs = 1000 / ratePerSecond;
  const stop = shouldStop ?? (() => false);
  const pause = sleep ?? defaultSleep;
  const clock = now ?? Date.now;
  const { track, waitForSlot, awaitAll } = createInFlightTracker(maxInFlight);

  const startAt = clock();
  const endAt = startAt + durationMinutes * 60 * 1000;
  let index = 0;
  let nextAt = startAt;

  // Loop exits when operations are exhausted, time is up, or a stop is requested.
  while (index < operations.length && !stop() && clock() < endAt) {
    const delay = nextAt - clock();
    if (delay > 0) {
      await pause(delay);
    }
    const hasSlot = await waitForSlot(stop, pause);
    if (!hasSlot) break;
    // Re-check deadline after potentially waiting for a slot.
    if (stop() || clock() >= endAt) break;
    const operation = operations[index];
    if (!operation) break;
    const promise = wrapExecution(operation, execute, options);
    track(promise);
    index += 1;
    nextAt += intervalMs;
  }

  // Wait for all in-flight operations to settle before returning.
  await awaitAll();
};

export const runStressTest = async (options: RunOptions): Promise<void> => {
  const { config } = options;
  const operations = sanitizeTotal(options.operations, config.totalRequests);

  if (operations.length === 0) return;

  switch (config.loadModel) {
    case 'batch':
      await runBatch({ ...options, config }, operations);
      return;
    case 'fixed':
      await runFixedRate({ ...options, config }, operations);
      return;
    case 'ramp':
      await runRamp({ ...options, config }, operations);
      return;
    case 'soak':
      await runSoak({ ...options, config }, operations);
      return;
    default:
      throw new Error('Unknown load model.');
  }
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid];
  if (midValue === undefined) return 0;
  if (sorted.length % 2 === 0) {
    const lower = sorted[mid - 1];
    return lower === undefined ? midValue : (lower + midValue) / 2;
  }
  return midValue;
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0] ?? 0;
  if (p >= 100) return sorted[sorted.length - 1] ?? 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const w = rank - lo;
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * w;
};

export const buildReport = (
  operations: Operation[],
  startedAt: number,
  endedAt: number,
  config: StressRunConfig,
  chainLookup: Map<number, string>
): StressReport => {
  const durations: number[] = [];
  const signToDepositDurations: number[] = [];
  const depositToFillDurations: number[] = [];
  const fallbackSignToFillDurations: number[] = [];
  let fulfilled = 0;
  let failed = 0;
  let cancelled = 0;
  const total = operations.length;

  const durationMs = Math.max(0, endedAt - startedAt);

  const statusCounts = new Map<Operation['status'], number>();
  const errorCounts = new Map<string, number>();
  for (const op of operations) {
    if (op.status === 'fulfilled') fulfilled += 1;
    if (op.status === 'failed') failed += 1;
    if (op.cancelled) cancelled += 1;
    if (op.durationMs !== undefined && op.durationMs > 0) durations.push(op.durationMs);
    if (op.signToDepositMs !== undefined) signToDepositDurations.push(op.signToDepositMs);
    if (op.depositToFillMs !== undefined) depositToFillDurations.push(op.depositToFillMs);
    if (op.signToFillMs !== undefined) fallbackSignToFillDurations.push(op.signToFillMs);
    statusCounts.set(op.status, (statusCounts.get(op.status) ?? 0) + 1);
    if (op.status === 'failed' && op.error) {
      errorCounts.set(op.error, (errorCounts.get(op.error) ?? 0) + 1);
    }
  }
  const throughputPerMin = durationMs > 0 ? (fulfilled / durationMs) * 60000 : 0;
  const phaseAggregate = (values: number[]) => ({
    avgMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    medianMs: median(values),
    count: values.length,
  });

  const byChain = new Map<
    number,
    { total: number; fulfilled: number; failed: number; cancelled: number }
  >();
  for (const op of operations) {
    const entry = byChain.get(op.destinationChainId) ?? {
      total: 0,
      fulfilled: 0,
      failed: 0,
      cancelled: 0,
    };
    entry.total += 1;
    if (op.status === 'fulfilled') entry.fulfilled += 1;
    if (op.status === 'failed') entry.failed += 1;
    if (op.cancelled) entry.cancelled += 1;
    byChain.set(op.destinationChainId, entry);
  }

  return {
    startedAt,
    endedAt,
    config,
    totals: {
      total,
      fulfilled,
      failed,
      cancelled,
    },
    performance: {
      durationMs,
      avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      medianMs: median(durations),
      p90Ms: percentile(durations, 90),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      minMs: durations.length ? Math.min(...durations) : 0,
      maxMs: durations.length ? Math.max(...durations) : 0,
      throughputPerMin,
      signToDepositMs: phaseAggregate(signToDepositDurations),
      depositToFillMs: phaseAggregate(depositToFillDurations),
      fallbackSignToFillMs: phaseAggregate(fallbackSignToFillDurations),
    },
    byStatus: Array.from(statusCounts.entries()).map(([status, count]) => ({
      status,
      count,
    })),
    byChain: Array.from(byChain.entries()).map(([chainId, counts]) => ({
      chainId,
      chainName: chainLookup.get(chainId) ?? `Chain ${chainId}`,
      ...counts,
    })),
    errors: Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([message, count]) => ({ message, count })),
  };
};
