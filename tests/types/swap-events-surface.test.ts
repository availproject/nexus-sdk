import type {
  BridgeFillStep,
  PlanTokenAmount,
  StatusEvent,
  SwapAndExecuteEvent,
  SwapAndExecutePlan,
  SwapAndExecutePlanStep,
  SwapEvent,
  SwapPlan,
  SwapPlanStep,
  SwapSourceSwapStep,
  SwapStatus,
  SwapStatusEvent,
} from '../../src/domain';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const assertions: [Assert<IsEqual<SwapStatusEvent, StatusEvent<SwapStatus>>>] = [true];
void assertions;

declare const tokenAmount: PlanTokenAmount;
declare const swapPlan: SwapPlan;
declare const swapAndExecutePlan: SwapAndExecutePlan;
declare const swapEvent: SwapEvent;
declare const swapAndExecuteEvent: SwapAndExecuteEvent;
declare const sourceSwapStep: Extract<SwapPlanStep, { type: 'source_swap' }>;
declare const bridgeFillStep: Extract<SwapPlanStep, { type: 'bridge_fill' }>;
declare const destinationSwapStep: Extract<SwapAndExecutePlanStep, { type: 'destination_swap' }>;

tokenAmount.amount satisfies string;
tokenAmount.amountRaw satisfies bigint;
swapPlan.steps satisfies SwapPlanStep[];
swapPlan.hasBridge satisfies boolean;
swapPlan.hasDestinationSwap satisfies boolean;
swapAndExecutePlan.steps satisfies SwapAndExecutePlanStep[];
swapAndExecutePlan.swapRequired satisfies boolean;
sourceSwapStep satisfies SwapSourceSwapStep;
bridgeFillStep satisfies BridgeFillStep;
destinationSwapStep.walletPath satisfies 'ephemeral' | 'safe';

if (swapEvent.type === 'status') {
  swapEvent.status satisfies SwapStatus;
}

if (swapEvent.type === 'plan_preview') {
  swapEvent.plan satisfies SwapPlan;
}

if (swapEvent.type === 'plan_progress' && swapEvent.stepType === 'bridge_fill') {
  swapEvent.step satisfies BridgeFillStep;
}

if (swapAndExecuteEvent.type === 'plan_progress' && swapAndExecuteEvent.stepType === 'destination_swap') {
  swapAndExecuteEvent.step satisfies Extract<SwapAndExecutePlanStep, { type: 'destination_swap' }>;
}
