import type { AllowanceHookSource, BridgeIntentDraft, ChainListType } from '../../domain';
import { Errors } from '../../domain/errors';
import { convertIntent } from '../intent/readable';
import type { BridgeFlowOptions } from '../types';
import { type BridgeHookState, buildHookStateFromIntent } from './state';

export type HookResolution = {
  intent: BridgeIntentDraft;
  insufficientAllowanceSources: AllowanceHookSource[];
  allowanceSelections: Array<'max' | 'min' | bigint | string>;
};

export const resolveBridgeIntentApproval = async (
  initialState: BridgeHookState,
  options: {
    hook: BridgeFlowOptions['hooks']['onIntent'];
    refreshHookState?: (sourceChains?: number[]) => Promise<BridgeHookState>;
    onHookStateUpdated?: (state: BridgeHookState) => void | Promise<void>;
  }
): Promise<BridgeHookState> => {
  const { hook, refreshHookState, onHookStateUpdated } = options;
  let hookState = initialState;
  let accepted = false;

  await new Promise<void>((resolve, reject) => {
    const allow = () => {
      accepted = true;
      resolve();
    };
    const deny = () => reject(Errors.userDeniedIntent());

    const refresh = async (sourceChains?: number[]) => {
      if (accepted) {
        return convertIntent(hookState.intent);
      }

      if (refreshHookState) {
        hookState = await refreshHookState(sourceChains);
        await onHookStateUpdated?.(hookState);
      }

      return convertIntent(hookState.intent);
    };

    hook({
      allow,
      deny,
      intent: convertIntent(hookState.intent),
      refresh,
    });
  });

  return hookState;
};

export const resolveBridgeAllowanceSelections = async (
  insufficientAllowanceSources: AllowanceHookSource[],
  hook: BridgeFlowOptions['hooks']['onAllowance']
): Promise<Array<'max' | 'min' | bigint | string>> => {
  if (insufficientAllowanceSources.length === 0) {
    return [];
  }

  return new Promise<Array<'max' | 'min' | bigint | string>>((resolve, reject) => {
    const allow = (selections: Array<'max' | 'min' | bigint | string>) => {
      if (insufficientAllowanceSources.length !== selections.length) {
        return reject(
          Errors.invalidAllowance(insufficientAllowanceSources.length, selections.length)
        );
      }
      resolve(selections);
    };

    const deny = () => reject(Errors.userRejectedAllowance());

    hook({
      allow,
      deny,
      sources: insufficientAllowanceSources,
    });
  });
};

export const runBridgeHooks = async (
  intent: BridgeIntentDraft,
  options: {
    hooks: {
      onIntent: BridgeFlowOptions['hooks']['onIntent'];
      onAllowance: BridgeFlowOptions['hooks']['onAllowance'];
    };
    chainList: ChainListType;
    refreshIntent?: (sourceChains?: number[]) => Promise<BridgeIntentDraft>;
    onStepsUpdated?: (intent: BridgeIntentDraft, sources: AllowanceHookSource[]) => void;
  }
): Promise<HookResolution> => {
  const { hooks, chainList, refreshIntent, onStepsUpdated } = options;

  const initialState = await buildHookStateFromIntent(intent, { chainList });
  onStepsUpdated?.(initialState.intent, initialState.insufficientAllowanceSources);

  const hookState = await resolveBridgeIntentApproval(initialState, {
    hook: hooks.onIntent,
    refreshHookState: refreshIntent
      ? async (sourceChains?: number[]) => {
          const nextIntent = await refreshIntent(sourceChains);
          return buildHookStateFromIntent(nextIntent, { chainList });
        }
      : undefined,
    onHookStateUpdated: (state) => {
      onStepsUpdated?.(state.intent, state.insufficientAllowanceSources);
    },
  });

  const allowanceSelections = await resolveBridgeAllowanceSelections(
    hookState.insufficientAllowanceSources,
    hooks.onAllowance
  );

  return {
    intent: hookState.intent,
    insufficientAllowanceSources: hookState.insufficientAllowanceSources,
    allowanceSelections,
  };
};
