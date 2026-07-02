import { type Snapshot, verify } from './balance-check';
import type { ChainInfo, TestSpec } from './chain-select';
import type { StressOutcome } from './cron-stress';
import { NexusError } from './sdk-bridge';

export type BalanceStatus = 'ok' | 'mismatch' | 'before_failed' | 'skipped';

export type SnapshotAttempt = {
  snapshot?: Snapshot;
  error?: string;
};

export type TestResult = {
  token: string;
  amount: string;
  destChain: ChainInfo;
  status: 'passed' | 'failed';
  exitCode: number;
  bridgeStatus: string;
  durationMs?: number;
  intentUrl?: string;
  sourceChains?: Array<{ id: number; name: string }>;
  errorMsg?: string;
  balanceStatus: BalanceStatus;
  balanceError?: string;
  unifiedBefore?: string;
  unifiedAfter?: string;
  destDelta?: string;
};

export type AssembleInput = {
  destChain: ChainInfo;
  test: TestSpec;
  before: SnapshotAttempt;
  after: SnapshotAttempt;
  stress: StressOutcome;
};

const ERROR_LINE_RE = /^(Error|RangeError|TypeError|.+Error:)/;

// Turn an unknown thrown value into a human-readable string.
//
// - NexusError → "Name[code]: message" (surfaces the structured code so
//   Slack readers can grep known failure modes like "backend/rff_submit_failed").
// - Plain Error subclasses (TypeError, etc.) → "Name: message".
// - `new Error('foo')` → just "foo" (skip the redundant "Error:" prefix).
// - Anything else → String(err).
export const formatError = (err: unknown): string => {
  if (err instanceof NexusError) {
    return `${err.name}[${err.code}]: ${err.message}`;
  }
  if (err instanceof Error) {
    const msg = err.message || String(err);
    return err.name && err.name !== 'Error' ? `${err.name}: ${msg}` : msg;
  }
  return String(err);
};

// Explicit bridge status — never inferred from presence of duration/explorer.
export const deriveBridgeStatus = (exitCode: number, opStatus?: string): string => {
  if (exitCode === 0 && opStatus === 'fulfilled') return 'fulfilled';
  return opStatus ?? 'no-op';
};

// When the SDK aborts before recording an operation, the report's error field
// is empty; fall back to the last error-shaped line from the combined stress
// log so the real cause still reaches Slack.
export const extractFallbackError = (tail: string[]): string => {
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const line = tail[i];
    if (line && ERROR_LINE_RE.test(line)) return line;
  }
  return tail[tail.length - 1] ?? '';
};

export const deriveErrorMsg = (
  opError: string | undefined,
  bridgeStatus: string,
  combinedTail: string[]
): string | undefined => {
  if (opError) return opError;
  if (bridgeStatus === 'fulfilled') return undefined;
  return extractFallbackError(combinedTail) || undefined;
};

type BalanceFields = Pick<
  TestResult,
  'balanceStatus' | 'balanceError' | 'unifiedBefore' | 'unifiedAfter' | 'destDelta'
>;

// Matches the legacy bash quirk: any after-snapshot failure is reported as
// "mismatch" (not a new "after_failed" state), with the underlying error
// surfaced separately. Preserved for output compatibility.
export const deriveBalanceFields = (
  before: SnapshotAttempt,
  after: SnapshotAttempt,
  destChainId: number,
  amount: string
): BalanceFields => {
  if (before.error) {
    return { balanceStatus: 'before_failed', balanceError: before.error };
  }
  if (after.error) {
    return {
      balanceStatus: 'mismatch',
      balanceError: after.error,
      unifiedBefore: before.snapshot?.unifiedBalance,
    };
  }
  if (!before.snapshot || !after.snapshot) {
    return { balanceStatus: 'skipped' };
  }
  const v = verify(before.snapshot, after.snapshot, destChainId, amount);
  return {
    balanceStatus: v.ok ? 'ok' : 'mismatch',
    unifiedBefore: before.snapshot.unifiedBalance,
    unifiedAfter: after.snapshot.unifiedBalance,
    destDelta: v.destDelta,
  };
};

export const assembleResult = (input: AssembleInput): TestResult => {
  const { destChain, test, before, after, stress } = input;
  const op = stress.payload.operations?.[0];

  // Pass/fail is driven by the bridge result; balance issues degrade-warn
  // but don't flip a passed test to failed.
  const status: 'passed' | 'failed' = stress.exitCode === 0 ? 'passed' : 'failed';
  const bridgeStatus = deriveBridgeStatus(stress.exitCode, op?.status);
  const errorMsg = deriveErrorMsg(op?.error, bridgeStatus, stress.combinedTail);
  const balance = deriveBalanceFields(before, after, destChain.id, test.amount);

  return {
    token: test.token,
    amount: test.amount,
    destChain,
    status,
    exitCode: stress.exitCode,
    bridgeStatus,
    durationMs: op?.durationMs,
    intentUrl: op?.intentExplorerUrl,
    sourceChains: op?.sourceChains,
    errorMsg,
    ...balance,
  };
};
