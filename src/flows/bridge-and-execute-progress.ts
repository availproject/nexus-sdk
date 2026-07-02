import type { BridgeAndExecuteEvent, BridgeAndExecutePlan, OnEventParam } from '../domain';
import { createExecuteProgressEmitter } from '../execute/progress';

export const createBridgeAndExecuteProgressEmitter = (
  emit: OnEventParam<BridgeAndExecuteEvent>['onEvent']
) =>
  createExecuteProgressEmitter<
    BridgeAndExecutePlan,
    Extract<BridgeAndExecuteEvent, { type: 'status' }>['status'],
    BridgeAndExecuteEvent
  >({
    emit,
    labels: {
      emitFailure: 'BridgeAndExecuteEventEmitFailed',
      progressFailure: 'BridgeAndExecuteProgressMappingFailed',
    },
    createStatusEvent: (status) =>
      ({
        type: 'status',
        status,
      }) satisfies BridgeAndExecuteEvent,
    createPlanPreviewEvent: (plan) =>
      ({
        type: 'plan_preview',
        plan,
      }) satisfies BridgeAndExecuteEvent,
    createPlanConfirmedEvent: (plan) =>
      ({
        type: 'plan_confirmed',
        plan,
      }) satisfies BridgeAndExecuteEvent,
    mapProgressEvent: (event) => event,
  });
