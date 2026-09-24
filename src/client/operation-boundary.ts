import type { Hex } from 'viem';
import type { AnalyticsManager } from '../analytics/AnalyticsManager';
import {
  type NexusAnalyticsEvent,
  NexusAnalyticsEvents,
  type NexusOperationName,
  NexusOperationNames,
} from '../analytics/events';
import { getWalletType } from '../analytics/utils';
import type {
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
} from '../domain';
import type { OperationName } from '../domain/errors';
import { createIntentReporting, type IntentReporting } from '../intent/telemetry';
import type { IntentBalancesResult, IntentHistoryResult } from '../intent/types';

type IntentTracking = {
  operation: OperationName;
  opName: NexusOperationName;
  initiated?: NexusAnalyticsEvent;
  success: NexusAnalyticsEvent;
  failed: NexusAnalyticsEvent;
};

const intentTracking = {
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
  run: (opId: string, reporting: IntentReporting) => Promise<R>
): Promise<R> => {
  const tracking: IntentTracking = intentTracking[kind];
  const operationId = analytics.startOperation(tracking.opName);
  const input = params as
    | {
        toChainId?: number;
        toTokenAddress?: string;
        sources?: { chainId: number; tokenAddress?: string }[];
      }
    | undefined;
  // Reporting observes inputs; validation remains responsible for rejecting them.
  const sources = Array.isArray(input?.sources)
    ? input.sources.filter((source) => source && typeof source.chainId === 'number')
    : undefined;
  const reporting = createIntentReporting(
    operationId,
    {
      'attempt.kind': kind,
      toChainId: typeof input?.toChainId === 'number' ? input.toChainId : undefined,
      toTokenAddress: typeof input?.toTokenAddress === 'string' ? input.toTokenAddress : undefined,
      sourceChainIds: [...new Set(sources?.map((source) => source.chainId))],
      sources: sources?.map((source) => ({
        chainId: source.chainId,
        tokenAddress: typeof source.tokenAddress === 'string' ? source.tokenAddress : undefined,
      })),
    },
    (event, properties) => analytics.reportEvent(event, properties)
  );
  return analytics.runOp({
    operationId,
    properties: reporting.properties,
    events: {
      initiated: tracking.initiated,
      success: tracking.success,
      failed: tracking.failed,
    },
    opName: tracking.opName,
    operation: tracking.operation,
    initiatedProps: { 'attempt.kind': kind },
    params,
    options,
    run: async (id) => {
      try {
        return await run(id, reporting);
      } catch (error) {
        reporting.failed(error);
        throw error;
      }
    },
    // Canonical outcomes handle swap failures. A later execute failure is still
    // an operation failure, while the swap's delivery outcome stays completed.
    selectFailureEvent: () =>
      kind === 'swapAndExecute' &&
      (reporting.properties()['attempt.outcome'] === 'completed' ||
        reporting.properties()['attempt.skipped'])
        ? tracking.failed
        : null,
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

export const trackBalanceFetch = <R extends IntentBalancesResult>(
  analytics: AnalyticsManager,
  run: (opId: string) => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.BALANCES_FETCH_STARTED,
      success: NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS,
      failed: NexusAnalyticsEvents.BALANCES_FETCH_FAILED,
    },
    opName: NexusOperationNames.BALANCES_FETCH_SWAP,
    operation: 'getBalancesForSwap',
    initiatedProps: { 'attempt.kind': 'swap' },
    run,
    success: (result) => ({
      'balances.partial': result.errored,
      'balances.count': result.balances.length,
    }),
    selectSuccessEvent: (result) =>
      result.errored
        ? NexusAnalyticsEvents.BALANCES_FETCH_PARTIAL
        : NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS,
  });

const catalogOperations = {
  getTokens: NexusOperationNames.CATALOG_GET_TOKENS,
  getToken: NexusOperationNames.CATALOG_GET_TOKEN,
  getTokensByChain: NexusOperationNames.CATALOG_GET_TOKENS_BY_CHAIN,
  getAvailableSourceTokens: NexusOperationNames.CATALOG_GET_AVAILABLE_SOURCE_TOKENS,
  getAvailableDestinationTokens: NexusOperationNames.CATALOG_GET_AVAILABLE_DESTINATION_TOKENS,
  confirmRouteExists: NexusOperationNames.CATALOG_CONFIRM_ROUTE_EXISTS,
  getSupportedChainsForRoute: NexusOperationNames.CATALOG_GET_SUPPORTED_CHAINS_FOR_ROUTE,
} as const satisfies Partial<Record<OperationName, NexusOperationName>>;

export const trackCatalogOperation = <R>(
  analytics: AnalyticsManager,
  operation: keyof typeof catalogOperations,
  run: () => Promise<R>
): Promise<R> =>
  analytics.runOp({
    events: {
      initiated: NexusAnalyticsEvents.CATALOG_FETCH_STARTED,
      success: NexusAnalyticsEvents.CATALOG_FETCH_SUCCESS,
      failed: NexusAnalyticsEvents.CATALOG_FETCH_FAILED,
    },
    opName: catalogOperations[operation],
    operation,
    initiatedProps: { method: operation },
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
