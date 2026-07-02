import type { Operation, OperationStatus } from './types';

export type BridgeStepLike = {
  type?: string;
  data?: { explorerURL?: string; intentID?: string; [key: string]: unknown };
};

type ApplyResult = {
  operation: Operation;
  statusChanged?: OperationStatus;
  note?: string;
};

const withPhaseTimings = (op: Operation): Operation => {
  const next = { ...op };
  if (next.signedAt !== undefined && next.depositedAt !== undefined) {
    next.signToDepositMs = Math.max(0, next.depositedAt - next.signedAt);
    next.depositObserved = true;
  }
  if (next.depositedAt !== undefined && next.fulfilledAt !== undefined) {
    next.depositToFillMs = Math.max(0, next.fulfilledAt - next.depositedAt);
    next.depositObserved = true;
  }
  if (
    next.fulfilledAt !== undefined &&
    next.depositedAt === undefined &&
    next.signedAt !== undefined
  ) {
    next.signToFillMs = Math.max(0, next.fulfilledAt - next.signedAt);
    next.depositObserved = false;
  }
  return next;
};

export const applyStatusUpdate = (
  op: Operation,
  status: OperationStatus,
  now = Date.now(),
  patch?: Partial<Operation>
): ApplyResult => {
  let next: Operation = { ...op, ...(patch ?? {}), status };

  if (status === 'approved' && next.approvedAt === undefined) next.approvedAt = now;
  if (status === 'signed' && next.signedAt === undefined) next.signedAt = now;
  if (status === 'deposited') {
    if (next.depositedAt === undefined) next.depositedAt = now;
    next.depositObserved = true;
  }
  if (status === 'fulfilled' && next.fulfilledAt === undefined) next.fulfilledAt = now;

  next = withPhaseTimings(next);

  return {
    operation: next,
    statusChanged: status,
    note:
      status === 'fulfilled' && next.depositObserved === false ? 'Deposit not observed' : undefined,
  };
};

export const applyBridgeStepUpdate = (
  op: Operation,
  step: BridgeStepLike,
  now = Date.now()
): ApplyResult => {
  let next = { ...op };
  let statusChanged: OperationStatus | undefined;
  let note: string | undefined;

  if (
    step.type === 'INTENT_SUBMITTED' &&
    step.data?.explorerURL &&
    step.data.explorerURL !== 'unknown'
  ) {
    next.intentExplorerUrl = step.data.explorerURL;
  }
  if (step.type === 'INTENT_SUBMITTED' && step.data?.intentID && step.data.intentID !== 'unknown') {
    next.intentId = step.data.intentID;
  }

  if (step.type === 'ALLOWANCE_ALL_DONE') {
    const res = applyStatusUpdate(next, 'approved', now);
    next = res.operation;
    statusChanged = 'approved';
  }
  if (step.type === 'INTENT_HASH_SIGNED') {
    const res = applyStatusUpdate(next, 'signed', now);
    next = res.operation;
    statusChanged = 'signed';
  }
  if (step.type === 'INTENT_COLLECTION_COMPLETE' || step.type === 'INTENT_DEPOSITS_CONFIRMED') {
    const res = applyStatusUpdate(next, 'deposited', now);
    next = res.operation;
    statusChanged = 'deposited';
  }
  if (step.type === 'INTENT_FULFILLED') {
    const res = applyStatusUpdate(next, 'fulfilled', now);
    next = res.operation;
    statusChanged = 'fulfilled';
    note = res.note;
  }

  return { operation: next, statusChanged, note };
};
