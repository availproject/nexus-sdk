import type {
  BridgeAndExecuteEvent,
  BridgeAndExecutePlan,
  BridgeAndExecutePlanStep,
  BridgeEvent,
  BridgePlan,
  BridgePlanStep,
  BridgeStatus,
  BridgeStatusEvent,
  PlanTokenAmount,
  PlanTokenMetadata,
  StatusEvent,
} from '../../src';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const assertions: [Assert<IsEqual<BridgeStatusEvent, StatusEvent<BridgeStatus>>>] = [true];
void assertions;

declare const tokenMetadata: PlanTokenMetadata;
declare const tokenAmount: PlanTokenAmount;
declare const bridgePlan: BridgePlan;
declare const bridgeAndExecutePlan: BridgeAndExecutePlan;
declare const bridgeEvent: BridgeEvent;
declare const bridgeAndExecuteEvent: BridgeAndExecuteEvent;
declare const allowanceStep: Extract<BridgePlanStep, { type: 'allowance_approval' }>;
declare const executeTxStep: Extract<BridgeAndExecutePlanStep, { type: 'execute_transaction' }>;

tokenMetadata.contractAddress satisfies `0x${string}`;
tokenMetadata.decimals satisfies number;
tokenAmount.amount satisfies string;
tokenAmount.amountRaw satisfies bigint;
bridgePlan.steps satisfies BridgePlanStep[];
bridgeAndExecutePlan.steps satisfies BridgeAndExecutePlanStep[];
bridgeAndExecutePlan.bridgeRequired satisfies boolean;
allowanceStep.requiredAmountRaw satisfies string;
executeTxStep.to satisfies `0x${string}`;

if (bridgeEvent.type === 'status') {
  bridgeEvent.status satisfies BridgeStatus;
}

if (bridgeEvent.type === 'plan_preview') {
  bridgeEvent.plan satisfies BridgePlan;
}

if (bridgeEvent.type === 'plan_progress' && bridgeEvent.stepType === 'allowance_approval') {
  bridgeEvent.step satisfies Extract<BridgePlanStep, { type: 'allowance_approval' }>;
}

if (bridgeAndExecuteEvent.type === 'plan_progress' && bridgeAndExecuteEvent.stepType === 'execute_transaction') {
  bridgeAndExecuteEvent.step satisfies Extract<BridgeAndExecutePlanStep, { type: 'execute_transaction' }>;
}
