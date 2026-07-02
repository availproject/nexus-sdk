import { Errors } from '../domain/errors';
import { runNonBlocking } from '../services/non-blocking';
import type { ExecutePlanContext, ExecuteProgressUpdate } from './runtime';

type ExecuteApprovalPlanProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'wallet_prompted';
      step: NonNullable<ExecutePlanContext['approvalStep']>;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'submitted' | 'confirmed';
      step: NonNullable<ExecutePlanContext['approvalStep']>;
      txHash: `0x${string}`;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'failed';
      step: NonNullable<ExecutePlanContext['approvalStep']>;
      txHash?: `0x${string}`;
      explorerUrl?: string;
      error: string;
    };

type ExecuteTransactionPlanProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'wallet_prompted';
      step: ExecutePlanContext['transactionStep'];
      value: string;
      hasData: boolean;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'submitted' | 'confirmed';
      step: ExecutePlanContext['transactionStep'];
      value: string;
      hasData: boolean;
      txHash: `0x${string}`;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'failed';
      step: ExecutePlanContext['transactionStep'];
      value: string;
      hasData: boolean;
      txHash?: `0x${string}`;
      explorerUrl?: string;
      error: string;
    };

type ExecutePlanProgressEvent =
  | ExecuteApprovalPlanProgressEvent
  | ExecuteTransactionPlanProgressEvent;

type CreateExecuteProgressEmitterOptions<
  Plan,
  Status extends string,
  Event extends { type: string },
> = {
  emit?: (event: Event) => void;
  labels: {
    emitFailure: string;
    progressFailure: string;
  };
  createStatusEvent: (status: Status) => Event;
  createPlanPreviewEvent: (plan: Plan) => Event;
  createPlanConfirmedEvent: (plan: Plan) => Event;
  mapProgressEvent: (event: ExecutePlanProgressEvent) => Event;
};

export const createExecuteProgressEmitter = <
  Plan,
  Status extends string,
  Event extends { type: string },
>(
  options: CreateExecuteProgressEmitterOptions<Plan, Status, Event>
) => {
  const state: { latestPreviewPlan: Plan | null } = {
    latestPreviewPlan: null,
  };

  const emitEvent = (event: Event) => {
    runNonBlocking(
      options.labels.emitFailure,
      () => {
        options.emit?.(event);
      },
      { eventType: event.type }
    );
  };

  const emitStatus = (status: Status) => {
    emitEvent(options.createStatusEvent(status));
  };

  const emitMappedEvent = (event: ExecutePlanProgressEvent) => {
    emitEvent(options.mapProgressEvent(event));
  };

  const emitPlanPreview = (plan: Plan) => {
    state.latestPreviewPlan = plan;
    emitEvent(options.createPlanPreviewEvent(plan));
  };

  const emitPlanConfirmed = (fallbackPlan: Plan) => {
    emitEvent(options.createPlanConfirmedEvent(state.latestPreviewPlan ?? fallbackPlan));
  };

  const emitExecuteProgress = (update: ExecuteProgressUpdate, executePlan: ExecutePlanContext) => {
    runNonBlocking(
      options.labels.progressFailure,
      () => {
        if (update.stepType === 'execute_approval') {
          const step = executePlan.approvalStep;
          if (!step) {
            throw Errors.internal(
              'execute_approval progress emitted without execute approval step'
            );
          }

          if (update.state === 'wallet_prompted') {
            emitMappedEvent({
              type: 'plan_progress',
              stepType: 'execute_approval',
              state: 'wallet_prompted',
              step,
            });
            return;
          }

          if (update.state === 'submitted' || update.state === 'confirmed') {
            emitMappedEvent({
              type: 'plan_progress',
              stepType: 'execute_approval',
              state: update.state,
              step,
              txHash: update.txHash,
              explorerUrl: update.explorerUrl,
            });
            return;
          }

          emitMappedEvent({
            type: 'plan_progress',
            stepType: 'execute_approval',
            state: 'failed',
            step,
            ...(update.txHash ? { txHash: update.txHash } : {}),
            ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
            error: update.error,
          });
          return;
        }

        const step = executePlan.transactionStep;
        if (update.state === 'wallet_prompted') {
          emitMappedEvent({
            type: 'plan_progress',
            stepType: 'execute_transaction',
            state: 'wallet_prompted',
            step,
            value: update.value,
            hasData: update.hasData,
          });
          return;
        }

        if (update.state === 'submitted' || update.state === 'confirmed') {
          emitMappedEvent({
            type: 'plan_progress',
            stepType: 'execute_transaction',
            state: update.state,
            step,
            value: update.value,
            hasData: update.hasData,
            txHash: update.txHash,
            explorerUrl: update.explorerUrl,
          });
          return;
        }

        emitMappedEvent({
          type: 'plan_progress',
          stepType: 'execute_transaction',
          state: 'failed',
          step,
          value: update.value,
          hasData: update.hasData,
          ...(update.txHash ? { txHash: update.txHash } : {}),
          ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
          error: update.error,
        });
      },
      { stepType: update.stepType }
    );
  };

  return {
    emitEvent,
    emitStatus,
    emitPlanPreview,
    emitPlanConfirmed,
    emitExecuteProgress,
  };
};
