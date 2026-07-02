import {
  type BridgeEvent,
  type BridgePlan,
  type BridgePlanProgressEvent,
  type BridgeStatus,
  getLogger,
} from '../domain';
import { Errors } from '../domain/errors';
import type { AllowanceExecutionProgressUpdate } from '../services/allowances';
import { runNonBlocking } from '../services/non-blocking';
import type { BridgeExecutionProgressUpdate } from './executor';
import {
  getBridgeAllowanceApprovalStep,
  getBridgeFillStep,
  getBridgeRequestSigningStep,
  getBridgeRequestSubmissionStep,
  getBridgeVaultDepositStep,
} from './steps';

type BridgeProgressEmitterState = {
  latestPreviewPlan: BridgePlan | null;
  confirmedPlan: BridgePlan | null;
  failedEventEmitted: boolean;
};

const logger = getLogger();

const getExecutionPlan = (state: BridgeProgressEmitterState): BridgePlan => {
  const plan = state.confirmedPlan ?? state.latestPreviewPlan;
  if (!plan) {
    throw Errors.internal('Bridge plan not initialized before progress emission');
  }
  return plan;
};

export const createBridgeProgressEmitter = (emit?: (event: BridgeEvent) => void) => {
  const state: BridgeProgressEmitterState = {
    latestPreviewPlan: null,
    confirmedPlan: null,
    failedEventEmitted: false,
  };

  const emitBridgeEvent = (event: BridgeEvent) => {
    runNonBlocking(
      'BridgeEventEmitFailed',
      () => {
        emit?.(event);
      },
      { eventType: event.type }
    );
  };

  const emitStatus = (status: BridgeStatus) => {
    emitBridgeEvent({
      type: 'status',
      status,
    });
  };

  const emitPlanPreview = (plan: BridgePlan) => {
    state.latestPreviewPlan = plan;
    emitBridgeEvent({
      type: 'plan_preview',
      plan,
    });
    logger.debug('BridgePlanPreview', plan);
  };

  const emitPlanProgress = (event: BridgePlanProgressEvent) => {
    if (event.state === 'failed') {
      if (state.failedEventEmitted) {
        return;
      }
      state.failedEventEmitted = true;
    }
    emitBridgeEvent(event);
  };

  const emitPlanConfirmed = (fallbackPlan: BridgePlan) => {
    state.confirmedPlan = state.latestPreviewPlan ?? fallbackPlan;
    emitBridgeEvent({
      type: 'plan_confirmed',
      plan: state.confirmedPlan,
    });
  };

  const emitAllowanceProgress = (update: AllowanceExecutionProgressUpdate) => {
    runNonBlocking(
      'BridgeAllowanceProgressMappingFailed',
      () => {
        const step = getBridgeAllowanceApprovalStep(getExecutionPlan(state), {
          chainId: update.chainId,
          tokenAddress: update.tokenAddress,
        });

        if (update.state === 'wallet_prompted') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'allowance_approval',
            state: 'wallet_prompted',
            step,
            approvedAmount: update.approvedAmount,
            approvedAmountRaw: update.approvedAmountRaw,
          });
          return;
        }

        if (update.state === 'submitted' || update.state === 'confirmed') {
          emitPlanProgress({
            type: 'plan_progress',
            stepType: 'allowance_approval',
            state: update.state,
            step,
            approvedAmount: update.approvedAmount,
            approvedAmountRaw: update.approvedAmountRaw,
            txHash: update.txHash,
            explorerUrl: update.explorerUrl,
          });
          return;
        }

        emitPlanProgress({
          type: 'plan_progress',
          stepType: 'allowance_approval',
          state: 'failed',
          step,
          approvedAmount: update.approvedAmount,
          approvedAmountRaw: update.approvedAmountRaw,
          error: update.error,
        });
      },
      {
        chainId: update.chainId,
        stepType: 'allowance_approval',
        tokenAddress: update.tokenAddress,
      }
    );
  };

  const emitExecutionProgress = (update: BridgeExecutionProgressUpdate) => {
    runNonBlocking(
      'BridgeExecutionProgressMappingFailed',
      () => {
        const plan = getExecutionPlan(state);

        switch (update.stepType) {
          case 'request_signing': {
            const step = getBridgeRequestSigningStep(plan);
            if (update.state === 'wallet_prompted') {
              emitPlanProgress({
                type: 'plan_progress',
                stepType: 'request_signing',
                state: 'wallet_prompted',
                step,
              });
              return;
            }
            if (update.state === 'completed') {
              emitPlanProgress({
                type: 'plan_progress',
                stepType: 'request_signing',
                state: 'completed',
                step,
                intentRequestHash: update.intentRequestHash,
              });
              return;
            }
            emitPlanProgress({
              type: 'plan_progress',
              stepType: 'request_signing',
              state: 'failed',
              step,
              error: update.error,
            });
            return;
          }
          case 'request_submission': {
            const step = getBridgeRequestSubmissionStep(plan);
            if (update.state === 'started') {
              emitPlanProgress({
                type: 'plan_progress',
                stepType: 'request_submission',
                state: 'started',
                step,
                intentRequestHash: update.intentRequestHash,
              });
              return;
            }
            if (update.state === 'completed') {
              emitPlanProgress({
                type: 'plan_progress',
                stepType: 'request_submission',
                state: 'completed',
                step,
                intentRequestHash: update.intentRequestHash,
                explorerUrl: update.explorerUrl,
              });
              return;
            }
            emitPlanProgress({
              type: 'plan_progress',
              stepType: 'request_submission',
              state: 'failed',
              step,
              intentRequestHash: update.intentRequestHash,
              error: update.error,
            });
            return;
          }
          case 'vault_deposit': {
            const step = getBridgeVaultDepositStep(plan, {
              chainId: update.chainId,
              tokenAddress: update.tokenAddress,
            });

            if (
              update.state === 'started' ||
              update.state === 'wallet_prompted' ||
              update.state === 'completed'
            ) {
              emitPlanProgress({
                type: 'plan_progress',
                stepType: 'vault_deposit',
                state: update.state,
                step,
              });
              return;
            }

            if (update.state === 'submitted' || update.state === 'confirmed') {
              emitPlanProgress({
                type: 'plan_progress',
                stepType: 'vault_deposit',
                state: update.state,
                step,
                txHash: update.txHash,
                explorerUrl: update.explorerUrl,
              });
              return;
            }

            emitPlanProgress({
              type: 'plan_progress',
              stepType: 'vault_deposit',
              state: 'failed',
              step,
              ...(update.txHash ? { txHash: update.txHash } : {}),
              ...(update.explorerUrl ? { explorerUrl: update.explorerUrl } : {}),
              error: update.error,
            });
            return;
          }
          case 'bridge_fill': {
            const step = getBridgeFillStep(plan);
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
            emitPlanProgress({
              type: 'plan_progress',
              stepType: 'bridge_fill',
              state: 'failed',
              step,
              intentRequestHash: update.intentRequestHash,
              error: update.error,
            });
          }
        }
      },
      { stepType: update.stepType }
    );
  };

  return {
    emitStatus,
    emitPlanPreview,
    emitPlanConfirmed,
    emitAllowanceProgress,
    emitExecutionProgress,
  };
};
