import type { Hex } from 'viem';
import type { AnalyticsManager } from '../../analytics/AnalyticsManager';
import {
  type NexusAnalyticsEvent,
  NexusAnalyticsEvents,
  type NexusOperationName,
  NexusOperationNames,
} from '../../analytics/events';
import { getWalletType } from '../../analytics/utils';
import type {
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
} from '../../domain';
import type { OperationName } from '../../domain/errors';
import type { IntentHistoryResult } from '../../intent/types';

type IntentTracking = {
  operation: OperationName;
  opName: NexusOperationName;
  initiated?: NexusAnalyticsEvent;
  success: NexusAnalyticsEvent;
  failed: NexusAnalyticsEvent;
};

const intentTracking = {
  bridge: {
    operation: 'bridge',
    opName: NexusOperationNames.BRIDGE,
    initiated: NexusAnalyticsEvents.BRIDGE_INITIATED,
    success: NexusAnalyticsEvents.BRIDGE_TRANSACTION_SUCCESS,
    failed: NexusAnalyticsEvents.BRIDGE_TRANSACTION_FAILED,
  },
  bridgeAndTransfer: {
    operation: 'bridgeAndTransfer',
    opName: NexusOperationNames.TRANSFER,
    initiated: NexusAnalyticsEvents.TRANSFER_INITIATED,
    success: NexusAnalyticsEvents.TRANSFER_TRANSACTION_SUCCESS,
    failed: NexusAnalyticsEvents.TRANSFER_TRANSACTION_FAILED,
  },
  simulateBridge: {
    operation: 'simulateBridge',
    opName: NexusOperationNames.BRIDGE_SIMULATION,
    initiated: NexusAnalyticsEvents.BRIDGE_SIMULATION_STARTED,
    success: NexusAnalyticsEvents.BRIDGE_SIMULATION_SUCCESS,
    failed: NexusAnalyticsEvents.BRIDGE_SIMULATION_FAILED,
  },
  simulateBridgeAndTransfer: {
    operation: 'simulateBridgeAndTransfer',
    opName: NexusOperationNames.TRANSFER_SIMULATION,
    initiated: NexusAnalyticsEvents.TRANSFER_SIMULATION_STARTED,
    success: NexusAnalyticsEvents.TRANSFER_SIMULATION_SUCCESS,
    failed: NexusAnalyticsEvents.TRANSFER_SIMULATION_FAILED,
  },
  bridgeAndExecute: {
    operation: 'bridgeAndExecute',
    opName: NexusOperationNames.BRIDGE_AND_EXECUTE,
    initiated: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_INITIATED,
    success: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_TRANSACTION_SUCCESS,
    failed: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_TRANSACTION_FAILED,
  },
  simulateBridgeAndExecute: {
    operation: 'simulateBridgeAndExecute',
    opName: NexusOperationNames.BRIDGE_AND_EXECUTE_SIMULATION,
    initiated: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_STARTED,
    success: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_SUCCESS,
    failed: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_FAILED,
  },
  swapWithExactIn: {
    operation: 'swapWithExactIn',
    opName: NexusOperationNames.SWAP,
    initiated: NexusAnalyticsEvents.SWAP_INITIATED,
    success: NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS,
    failed: NexusAnalyticsEvents.SWAP_TRANSACTION_FAILED,
  },
  swapWithExactOut: {
    operation: 'swapWithExactOut',
    opName: NexusOperationNames.SWAP,
    initiated: NexusAnalyticsEvents.SWAP_INITIATED,
    success: NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS,
    failed: NexusAnalyticsEvents.SWAP_TRANSACTION_FAILED,
  },
  swapAndExecute: {
    operation: 'swapAndExecute',
    opName: NexusOperationNames.SWAP_AND_EXECUTE,
    initiated: NexusAnalyticsEvents.SWAP_AND_EXECUTE_INITIATED,
    success: NexusAnalyticsEvents.SWAP_AND_EXECUTE_SUCCESS,
    failed: NexusAnalyticsEvents.SWAP_AND_EXECUTE_FAILED,
  },
} as const satisfies Record<string, IntentTracking>;

export const trackIntentOperation = <R>(
  analytics: AnalyticsManager,
  kind: keyof typeof intentTracking,
  params: unknown,
  options: unknown,
  run: (opId: string) => Promise<R>
): Promise<R> => {
  const tracking: IntentTracking = intentTracking[kind];
  return analytics.runOp({
    events: {
      initiated: tracking.initiated,
      success: tracking.success,
      failed: tracking.failed,
    },
    opName: tracking.opName,
    operation: tracking.operation,
    initiatedProps: { kind },
    params,
    options,
    run,
  });
};

export const trackExecute = <R extends ExecuteResult>(
  analytics: AnalyticsManager,
  params: ExecuteParams,
  options: unknown,
  run: (opId: string) => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.EXECUTE_INITIATED,
      success: NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.EXECUTE_TRANSACTION_FAILED,
    },
    opName: NexusOperationNames.EXECUTE,
    operation: 'execute',
    initiatedProps: { toChainId: params.toChainId, contractAddress: params.to },
    params,
    options,
    run,
    selectSuccessEvent: (result) =>
      result.execute.receipt
        ? NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUCCESS
        : NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUBMITTED,
  });

export const trackExecuteSim = <R extends ExecuteSimulation>(
  analytics: AnalyticsManager,
  params: ExecuteParams,
  run: (opId: string) => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.EXECUTE_SIMULATION_STARTED,
      success: NexusAnalyticsEvents.EXECUTE_SIMULATION_SUCCESS,
      failed: NexusAnalyticsEvents.EXECUTE_SIMULATION_FAILED,
    },
    opName: NexusOperationNames.EXECUTE_SIMULATION,
    operation: 'simulateExecute',
    initiatedProps: { toChainId: params.toChainId, contractAddress: params.to },
    params,
    run,
  });

export const trackBalanceFetch = <R>(
  analytics: AnalyticsManager,
  kind: 'bridge' | 'swap',
  run: (opId: string) => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.BALANCES_FETCH_STARTED,
      success: NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS,
      failed: NexusAnalyticsEvents.BALANCES_FETCH_FAILED,
    },
    opName:
      kind === 'swap'
        ? NexusOperationNames.BALANCES_FETCH_SWAP
        : NexusOperationNames.BALANCES_FETCH_BRIDGE,
    operation: kind === 'swap' ? 'getBalancesForSwap' : 'getBalancesForBridge',
    initiatedProps: { kind },
    run,
  });

export const trackInit = <R>(
  analytics: AnalyticsManager,
  successProps: Record<string, unknown>,
  run: (opId: string) => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      success: NexusAnalyticsEvents.SDK_INITIALIZED,
      failed: NexusAnalyticsEvents.SDK_INITIALIZATION_FAILED,
    },
    opName: NexusOperationNames.INITIALIZE,
    operation: 'initialize',
    initiatedProps: successProps,
    failedProps: {},
    run,
  });

export const trackListIntents = <R extends IntentHistoryResult>(
  analytics: AnalyticsManager,
  params: ListIntentsParams | undefined,
  run: (opId: string) => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.LIST_INTENTS_INITIATED,
      success: NexusAnalyticsEvents.LIST_INTENTS_SUCCESS,
      failed: NexusAnalyticsEvents.LIST_INTENTS_FAILED,
    },
    opName: NexusOperationNames.LIST_INTENTS,
    operation: 'listIntents',
    initiatedProps: { page: params?.page, status: params?.status },
    params,
    run,
  });

export const trackWalletConnect = <R extends { address: Hex; chainId: number }>(
  analytics: AnalyticsManager,
  provider: EthereumProvider,
  run: (opId: string) => Promise<R>
): Promise<R> => {
  const walletType = getWalletType(provider);
  return analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.WALLET_CONNECT_INITIATED,
      success: NexusAnalyticsEvents.WALLET_CONNECTED,
      failed: NexusAnalyticsEvents.WALLET_CONNECT_FAILED,
    },
    opName: NexusOperationNames.WALLET_CONNECT,
    operation: 'setEVMProvider',
    initiatedProps: { walletType },
    params: { walletType },
    run,
    success: (result) => ({ chainId: result.chainId }),
  });
};
