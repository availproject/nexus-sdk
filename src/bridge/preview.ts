import type { BridgeIntent, BridgeIntentDraft, BridgePlan, ChainListType } from '../domain';
import { type BridgeHookState, buildHookStateFromIntent } from './hooks/state';
import { convertIntent } from './intent/readable';
import { createBridgePlan } from './steps';

export type BridgePreviewState = {
  intent: BridgeIntentDraft;
  readableIntent: BridgeIntent;
  insufficientAllowanceSources: BridgeHookState['insufficientAllowanceSources'];
  plan: BridgePlan;
};

export const createBridgePreviewState = (
  hookState: BridgeHookState,
  deps: { chainList: ChainListType }
): BridgePreviewState => {
  return {
    intent: hookState.intent,
    readableIntent: convertIntent(hookState.intent),
    insufficientAllowanceSources: hookState.insufficientAllowanceSources,
    plan: createBridgePlan(
      hookState.intent,
      deps.chainList,
      hookState.insufficientAllowanceSources
    ),
  };
};

export const buildBridgePreviewState = async (
  intent: BridgeIntentDraft,
  deps: { chainList: ChainListType }
): Promise<BridgePreviewState> => {
  const hookState = await buildHookStateFromIntent(intent, { chainList: deps.chainList });
  return createBridgePreviewState(hookState, deps);
};
