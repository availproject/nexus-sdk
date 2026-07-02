import type {
  BridgeAndExecuteEvent,
  BridgeAndExecutePlan,
  BridgeEvent,
  BridgePlan,
  BridgePlanStep,
} from '../domain';

const isBridgePlanStep = (step: BridgeAndExecutePlan['steps'][number]): step is BridgePlanStep =>
  step.type !== 'execute_approval' && step.type !== 'execute_transaction';

export const toBridgePlan = (plan: BridgeAndExecutePlan): BridgePlan => ({
  steps: plan.steps.filter(isBridgePlanStep),
});

export const adaptBridgeAndExecuteEventToBridgeEvent = (
  event: BridgeAndExecuteEvent
): BridgeEvent | null => {
  switch (event.type) {
    case 'status':
      if (event.status === 'preparing') {
        return null;
      }
      return {
        type: 'status',
        status: event.status,
      };
    case 'plan_preview':
      return {
        type: 'plan_preview',
        plan: toBridgePlan(event.plan),
      };
    case 'plan_confirmed':
      return {
        type: 'plan_confirmed',
        plan: toBridgePlan(event.plan),
      };
    case 'plan_progress':
      if (event.stepType === 'execute_approval' || event.stepType === 'execute_transaction') {
        return null;
      }
      return event;
  }
};
