import { prepareBridgeExecution } from '../bridge/allowances/prepare';
import { retrieveAddress } from '../bridge/context';
import { executeBridgeFromIntent } from '../bridge/executor';
import {
  resolveBridgeAllowanceSelections,
  resolveBridgeIntentApproval,
} from '../bridge/hooks/approval';
import { buildHookStateFromIntent } from '../bridge/hooks/state';
import { buildBridgeIntent } from '../bridge/intent/builder';
import { createBridgeIntent } from '../bridge/intent/creator';
import { convertIntent } from '../bridge/intent/readable';
import { buildBridgePreviewState, createBridgePreviewState } from '../bridge/preview';
import { createBridgeProgressEmitter } from '../bridge/progress';
import { createBridgePlan } from '../bridge/steps';
import type { BridgeExecutionResult, BridgeFlowOptions, BridgeFlowParams } from '../bridge/types';
import type { BridgeSimulationResult } from '../domain';
import { DEFAULT_FILL_TIMEOUT_MINUTES, getLogger } from '../domain';
import { withTimingSpan } from '../services/timing';
import type { BridgeDeps } from './deps';

const logger = getLogger();

const resolveBridgeParams = (
  params: BridgeFlowParams,
  deps: BridgeDeps
): Required<BridgeFlowParams> => ({
  ...params,
  recipient: params.recipient ?? retrieveAddress(params.dstChain.universe, { evm: deps.evm }),
});

const buildBridgeFlowIntent = async (
  params: Required<BridgeFlowParams>,
  deps: BridgeDeps,
  sourceChains?: number[]
) => {
  return buildBridgeIntent({
    tokenAmount: params.tokenAmount,
    nativeAmount: params.nativeAmount,
    dstToken: params.dstToken,
    dstChainId: params.dstChain.id,
    dstChainUniverse: params.dstChain.universe,
    dstChainNativeDecimals: params.dstChain.nativeCurrency.decimals,
    sourceChains,
    forceMayan: deps.forceMayan,
    deps: {
      chainList: deps.chainList,
      middlewareClient: deps.middlewareClient,
      evm: {
        address: deps.evm.address,
      },
    },
    createIntent: (input) =>
      createBridgeIntent(
        {
          ...input,
          dstChainId: params.dstChain.id,
          dstChainUniverse: params.dstChain.universe,
          dstChainNativeDecimals: params.dstChain.nativeCurrency.decimals,
          recipient: params.recipient,
        },
        {
          chainList: deps.chainList,
          evm: {
            address: deps.evm.address,
          },
          middlewareClient: deps.middlewareClient,
        }
      ),
  });
};

export const simulateBridge = async (
  params: BridgeFlowParams,
  deps: BridgeDeps
): Promise<BridgeSimulationResult> => {
  const resolvedParams = resolveBridgeParams(params, deps);
  const intent = await buildBridgeFlowIntent(resolvedParams, deps, resolvedParams.sourceChains);

  return {
    intent: convertIntent(intent),
    token: resolvedParams.dstToken,
  };
};

export const executeBridge = async (
  params: BridgeFlowParams,
  deps: BridgeDeps,
  options: BridgeFlowOptions
): Promise<BridgeExecutionResult> => {
  const resolvedParams = resolveBridgeParams(params, deps);

  logger.debug('BridgeFlow:init', { params: resolvedParams });

  const {
    emitStatus,
    emitPlanPreview,
    emitPlanConfirmed,
    emitAllowanceProgress,
    emitExecutionProgress,
  } = createBridgeProgressEmitter(options.emit);

  try {
    emitStatus('intent_building');
    const initialIntent = await withTimingSpan(deps.timing, 'flow.bridge.build_intent', async () =>
      buildBridgeFlowIntent(resolvedParams, deps, resolvedParams.sourceChains)
    );
    emitStatus('intent_ready');

    const initialPreviewState = await withTimingSpan(
      deps.timing,
      'flow.bridge.build_hook_state',
      async () => buildBridgePreviewState(initialIntent, { chainList: deps.chainList })
    );
    emitPlanPreview(initialPreviewState.plan);
    emitStatus('awaiting_approval');

    const approvedHookState = await withTimingSpan(
      deps.timing,
      'flow.bridge.intent_hook',
      async () =>
        resolveBridgeIntentApproval(initialPreviewState, {
          hook: options.hooks.onIntent,
          refreshHookState: async (sourceChains) => {
            const nextIntent = await buildBridgeFlowIntent(resolvedParams, deps, sourceChains);
            return buildHookStateFromIntent(nextIntent, {
              chainList: deps.chainList,
            });
          },
          onHookStateUpdated: async (state) => {
            const previewState = createBridgePreviewState(state, {
              chainList: deps.chainList,
            });
            emitPlanPreview(previewState.plan);
          },
        })
    );

    emitStatus('approved');
    emitPlanConfirmed(
      createBridgePlan(
        approvedHookState.intent,
        deps.chainList,
        approvedHookState.insufficientAllowanceSources
      )
    );

    let allowanceSelections: Array<'max' | 'min' | bigint | string> = [];
    if (approvedHookState.insufficientAllowanceSources.length > 0) {
      emitStatus('awaiting_allowance_selection');
      allowanceSelections = await withTimingSpan(
        deps.timing,
        'flow.bridge.allowance_hook',
        async () =>
          resolveBridgeAllowanceSelections(
            approvedHookState.insufficientAllowanceSources,
            options.hooks.onAllowance
          )
      );
    }

    emitStatus('executing');

    await withTimingSpan(deps.timing, 'flow.bridge.prepare_execution', async () =>
      prepareBridgeExecution({
        allowanceSelections,
        insufficientAllowanceSources: approvedHookState.insufficientAllowanceSources,
        bridge: {
          chainList: deps.chainList,
          middlewareClient: deps.middlewareClient,
          evm: {
            address: deps.evm.address,
            walletClient: deps.evm.walletClient,
          },
        },
        dstChain: resolvedParams.dstChain,
        onProgress: emitAllowanceProgress,
      })
    );

    logger.debug('intent', { intent: approvedHookState.intent });

    const { intentExplorerUrl, sourceTxs } = await withTimingSpan(
      deps.timing,
      'flow.bridge.execute_from_intent',
      async () =>
        executeBridgeFromIntent(approvedHookState.intent, {
          walletClient: deps.evm.walletClient,
          address: deps.evm.address,
          chainList: deps.chainList,
          middlewareClient: deps.middlewareClient,
          intentExplorerUrl: deps.intentExplorerUrl,
          fillTimeoutMinutes: options.fillTimeoutMinutes ?? DEFAULT_FILL_TIMEOUT_MINUTES,
          onProgress: emitExecutionProgress,
          dstChain: resolvedParams.dstChain,
        })
    );

    emitStatus('completed');

    return {
      intentExplorerUrl,
      intent: convertIntent(approvedHookState.intent),
      sourceTxs,
    };
  } catch (error) {
    logger.error('bridge: execute error', error);
    throw error;
  }
};
