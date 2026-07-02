import type { OnEventParam, SwapAndExecuteEvent, SwapAndExecutePlan } from '../domain';
import { createExecuteProgressEmitter } from '../execute/progress';

export const createSwapAndExecuteProgressEmitter = (
  emit: OnEventParam<SwapAndExecuteEvent>['onEvent']
) =>
  createExecuteProgressEmitter<
    SwapAndExecutePlan,
    Extract<SwapAndExecuteEvent, { type: 'status' }>['status'],
    SwapAndExecuteEvent
  >({
    emit,
    labels: {
      emitFailure: 'SwapAndExecuteEventEmitFailed',
      progressFailure: 'SwapAndExecuteProgressMappingFailed',
    },
    createStatusEvent: (status) =>
      ({
        type: 'status',
        status,
      }) satisfies SwapAndExecuteEvent,
    createPlanPreviewEvent: (plan) =>
      ({
        type: 'plan_preview',
        plan,
      }) satisfies SwapAndExecuteEvent,
    createPlanConfirmedEvent: (plan) =>
      ({
        type: 'plan_confirmed',
        plan,
      }) satisfies SwapAndExecuteEvent,
    mapProgressEvent: (event) => event,
  });
