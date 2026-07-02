import type { SwapEvent, SwapPlan, SwapPlanProgressEvent, SwapStatus } from '../domain';
import {
  getSwapBridgeDepositStep,
  getSwapBridgeFillStep,
  getSwapBridgeIntentSubmissionStep,
  getSwapDestinationSwapStep,
  getSwapEoaToEphemeralTransferStep,
  getSwapSourceSwapStep,
} from './swap-steps-builder';
import type { SwapExecutionProgressUpdate, SwapParams } from './types';

type SwapProgressEmitterState = {
  latestPreviewPlan: SwapPlan | null;
  confirmedPlan: SwapPlan | null;
  failedEventEmitted: boolean;
};

const getExecutionPlan = (latestPreviewPlan: SwapPlan | null, confirmedPlan: SwapPlan | null) => {
  const plan = confirmedPlan ?? latestPreviewPlan;
  if (!plan) {
    throw new Error('Swap plan not initialized before progress emission');
  }
  return plan;
};

export const createSwapProgressEmitter = (emit: SwapParams['emit']) => {
  const state: SwapProgressEmitterState = {
    latestPreviewPlan: null,
    confirmedPlan: null,
    failedEventEmitted: false,
  };

  const emitSwapEvent = (event: SwapEvent) => {
    emit?.(event);
  };

  const emitStatus = (status: SwapStatus) => {
    emitSwapEvent({
      type: 'status',
      status,
    });
  };

  const emitPlanPreview = (plan: SwapPlan) => {
    state.latestPreviewPlan = plan;
    emitSwapEvent({
      type: 'plan_preview',
      plan,
    });
  };

  const emitPlanProgress = (event: SwapPlanProgressEvent) => {
    if (event.state === 'failed') {
      if (state.failedEventEmitted) {
        return;
      }
      state.failedEventEmitted = true;
    }

    emitSwapEvent(event);
  };

  const emitPlanConfirmed = (fallbackPlan: SwapPlan) => {
    state.confirmedPlan = state.latestPreviewPlan ?? fallbackPlan;
    emitSwapEvent({
      type: 'plan_confirmed',
      plan: state.confirmedPlan,
    });
  };

  const emitExecutionProgress = (update: SwapExecutionProgressUpdate) => {
    const plan = getExecutionPlan(state.latestPreviewPlan, state.confirmedPlan);

    switch (update.stepType) {
      case 'source_swap': {
        const step = getSwapSourceSwapStep(plan, update.chainId);
        if (update.state === 'wallet_prompted' || update.state === 'started') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'source_swap',
            state: update.state,
            step,
          });
          return;
        }
        if (update.state === 'submitted' || update.state === 'confirmed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'source_swap',
            state: update.state,
            step,
            txHash: update.txHash,
            explorerUrl: update.explorerUrl,
          });
          return;
        }
        if ('error' in update) {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'source_swap',
            state: 'failed',
            step,
            ...(update.txHash ? { txHash: update.txHash } : {}),
            ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
            error: update.error,
          });
        }
        return;
      }
      case 'eoa_to_ephemeral_transfer': {
        const step = getSwapEoaToEphemeralTransferStep(plan, update.chainId);
        if (update.state === 'wallet_prompted') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'eoa_to_ephemeral_transfer',
            state: 'wallet_prompted',
            step,
          });
          return;
        }
        if (update.state === 'submitted' || update.state === 'confirmed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'eoa_to_ephemeral_transfer',
            state: update.state,
            step,
            txHash: update.txHash,
            explorerUrl: update.explorerUrl,
          });
          return;
        }
        if ('error' in update) {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'eoa_to_ephemeral_transfer',
            state: 'failed',
            step,
            ...(update.txHash ? { txHash: update.txHash } : {}),
            ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
            error: update.error,
          });
        }
        return;
      }
      case 'bridge_deposit': {
        const step = getSwapBridgeDepositStep(plan, update.chainId);
        if (update.state === 'started') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_deposit',
            state: 'started',
            step,
          });
          return;
        }
        if (update.state === 'submitted' || update.state === 'confirmed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_deposit',
            state: update.state,
            step,
            txHash: update.txHash,
            explorerUrl: update.explorerUrl,
          });
          return;
        }
        if ('error' in update) {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_deposit',
            state: 'failed',
            step,
            ...(update.txHash ? { txHash: update.txHash } : {}),
            ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
            error: update.error,
          });
        }
        return;
      }
      case 'bridge_intent_submission': {
        const step = getSwapBridgeIntentSubmissionStep(plan);
        if (update.state === 'started') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_intent_submission',
            state: 'started',
            step,
          });
          return;
        }
        if (update.state === 'completed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_intent_submission',
            state: 'completed',
            step,
            intentRequestHash: update.intentRequestHash,
          });
          return;
        }
        emitPlanProgress({
          type: 'plan_progress',
          stepType: 'bridge_intent_submission',
          state: 'failed',
          step,
          ...(update.intentRequestHash ? { intentRequestHash: update.intentRequestHash } : {}),
          error: update.error,
        });
        return;
      }
      case 'bridge_fill': {
        const step = getSwapBridgeFillStep(plan);
        if (update.state === 'waiting' || update.state === 'completed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_fill',
            state: update.state,
            step,
            intentRequestHash: update.intentRequestHash,
          });
          return;
        }
        if ('error' in update) {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'bridge_fill',
            state: 'failed',
            step,
            intentRequestHash: update.intentRequestHash,
            error: update.error,
          });
        }
        return;
      }
      case 'destination_swap': {
        const step = getSwapDestinationSwapStep(plan, update.chainId);
        if (update.state === 'wallet_prompted' || update.state === 'started') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'destination_swap',
            state: update.state,
            step,
          });
          return;
        }
        if (update.state === 'submitted' || update.state === 'confirmed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'destination_swap',
            state: update.state,
            step,
            txHash: update.txHash,
            explorerUrl: update.explorerUrl,
          });
          return;
        }
        if ('error' in update) {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'destination_swap',
            state: 'failed',
            step,
            ...(update.txHash ? { txHash: update.txHash } : {}),
            ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
            error: update.error,
          });
        }
        return;
      }
    }
  };

  return {
    emitStatus,
    emitPlanPreview,
    emitPlanConfirmed,
    emitExecutionProgress,
  };
};
