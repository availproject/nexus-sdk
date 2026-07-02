/**
 * Typed public-op wrappers around `AnalyticsManager.runOp`.
 *
 * The analytics layer stays generic (it knows about events, op names, and the
 * `runOp` lifecycle contract) but does NOT depend on bridge / swap / execute
 * types. Those operation-specific concerns live here in `core/sdk` where
 * they're allowed to import from analytics, domain, and feature layers.
 *
 * Each `trackX` exported function takes the `AnalyticsManager` as its first
 * positional arg and delegates to `analytics.runOp(...)` with an op-specific
 * config (events, op name, initiated props, success-prop extractor, optional
 * `wrapXOptions` for the `onEvent` lifecycle wiring).
 */

import type { Hex } from 'viem';
import type { AnalyticsManager } from '../../analytics/AnalyticsManager';
import { NexusAnalyticsEvents, NexusOperationNames } from '../../analytics/events';
import {
  translateBridgeAndExecuteEvent,
  translateBridgeEvent,
  translateSwapAndExecuteEvent,
  translateSwapEvent,
  translateTransferEvent,
} from '../../analytics/lifecycle-translator';
import { buildEconomics, extractBridgeProperties, getWalletType } from '../../analytics/utils';
import type {
  BridgeAndExecuteEvent,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  BridgeEvent,
  BridgeParams,
  BridgeResult,
  BridgeSimulationResult,
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
  ListIntentsResult,
  OnEventParam,
  SwapAndExecuteEvent,
  SwapEvent,
  TransferParams,
  TransferResult,
} from '../../domain';
import type {
  SwapAndExecuteParams,
  SwapAndExecuteResult,
  SwapExactInParams,
  SwapExactOutParams,
  SwapMaxParams,
  SwapMaxResult,
  SwapResult,
} from '../../swap/types';
import type {
  BridgeAndExecuteOptions,
  BridgeOperationOptions,
  SwapAndExecuteOptions,
  SwapOperationOptions,
} from '../types';

/**
 * Flatten a `SwapResult` into the success-prop payload for SWAP_* events.
 * Lives here (not in `analytics/utils`) because it depends on `SwapResult`
 * from `src/swap/types` — and analytics must not depend on swap (the
 * generic `runOp` boundary stays in analytics, op-shape extractors stay in
 * core/sdk).
 *
 * Also emits the `economics` block from `result.intent` via `buildEconomics`.
 */
function extractSwapProperties(result?: SwapResult): Record<string, unknown> {
  if (!result) return {};

  const mapSwaps = (swaps: SwapResult['sourceSwaps'][number]['swaps']) =>
    swaps.map((s) => ({
      inputContract: s.inputContract,
      inputAmount: s.inputAmount.toString(),
      outputContract: s.outputContract,
      outputAmount: s.outputAmount.toString(),
    }));

  return {
    swap: {
      sources: result.sourceSwaps.map((source) => ({
        chainId: source.chainId,
        txHash: source.txHash,
        swaps: mapSwaps(source.swaps),
      })),
      destination: result.destinationSwap
        ? {
            chainId: result.destinationSwap.chainId,
            txHash: result.destinationSwap.txHash,
            swaps: mapSwaps(result.destinationSwap.swaps),
          }
        : null,
      intentExplorerUrl: result.intentExplorerUrl,
    },
    ...buildEconomics({
      provider: result.intent.bridgeProvider,
      valueUsd: result.intent.destination.value,
      tokenSymbol: result.intent.destination.token.symbol,
      amount: result.intent.destination.amount,
      fees: result.intent.feesAndBuffer.bridge
        ? {
            protocol: result.intent.feesAndBuffer.bridge.protocol,
            caGas: result.intent.feesAndBuffer.bridge.caGas,
            solver: result.intent.feesAndBuffer.bridge.solver,
            total: result.intent.feesAndBuffer.bridge.total,
          }
        : null,
      buffer: result.intent.feesAndBuffer.buffer,
      sources: result.intent.sources.map((source) => ({
        symbol: source.token.symbol,
        chainId: source.chain.id,
        chainName: source.chain.name,
        amount: source.amount,
        valueUsd: source.value,
      })),
    }),
  };
}

// ── Lifecycle-event wrappers ─────────────────────────────────────────────────
//
// Each wrapXOptions returns a copy of the caller's options whose `onEvent`
// forwards every event through the matching lifecycle translator (which emits
// per-step analytics tracks tagged with the op's flowId), and then calls the
// caller's original `onEvent` so dev integrations keep receiving events
// unchanged.

function wrapBridgeOptions<T extends OnEventParam<BridgeEvent>>(
  analytics: AnalyticsManager,
  options: T | undefined,
  flowId: string
): T {
  const userOnEvent = options?.onEvent;
  return {
    ...(options ?? ({} as T)),
    onEvent: (event: BridgeEvent) => {
      translateBridgeEvent(event, analytics, flowId);
      userOnEvent?.(event);
    },
  } as T;
}

function wrapTransferOptions<T extends OnEventParam<BridgeEvent>>(
  analytics: AnalyticsManager,
  options: T | undefined,
  flowId: string
): T {
  const userOnEvent = options?.onEvent;
  return {
    ...(options ?? ({} as T)),
    onEvent: (event: BridgeEvent) => {
      translateTransferEvent(event, analytics, flowId);
      userOnEvent?.(event);
    },
  } as T;
}

function wrapBridgeAndExecuteOptions<T extends OnEventParam<BridgeAndExecuteEvent>>(
  analytics: AnalyticsManager,
  options: T | undefined,
  flowId: string
): T {
  const userOnEvent = options?.onEvent;
  return {
    ...(options ?? ({} as T)),
    onEvent: (event: BridgeAndExecuteEvent) => {
      translateBridgeAndExecuteEvent(event, analytics, flowId);
      userOnEvent?.(event);
    },
  } as T;
}

function wrapSwapOptions<T extends OnEventParam<SwapEvent>>(
  analytics: AnalyticsManager,
  options: T | undefined,
  flowId: string
): T {
  const userOnEvent = options?.onEvent;
  return {
    ...(options ?? ({} as T)),
    onEvent: (event: SwapEvent) => {
      translateSwapEvent(event, analytics, flowId);
      userOnEvent?.(event);
    },
  } as T;
}

function wrapSwapAndExecuteOptions<T extends OnEventParam<SwapAndExecuteEvent>>(
  analytics: AnalyticsManager,
  options: T | undefined,
  flowId: string
): T {
  const userOnEvent = options?.onEvent;
  return {
    ...(options ?? ({} as T)),
    onEvent: (event: SwapAndExecuteEvent) => {
      translateSwapAndExecuteEvent(event, analytics, flowId);
      userOnEvent?.(event);
    },
  } as T;
}

// ── Public-op wrappers ───────────────────────────────────────────────────────

export function trackBridge<R extends Pick<BridgeResult, 'intentExplorerUrl' | 'intent'>>(
  analytics: AnalyticsManager,
  params: BridgeParams,
  options: BridgeOperationOptions | undefined,
  run: (wrapped: BridgeOperationOptions, opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    tokenSymbol: params.toTokenSymbol,
    sourceChains: params.sources,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.BRIDGE_INITIATED,
      success: NexusAnalyticsEvents.BRIDGE_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.BRIDGE_TRANSACTION_FAILED,
      planRejected: NexusAnalyticsEvents.BRIDGE_PLAN_REJECTED,
    },
    opName: NexusOperationNames.BRIDGE,
    operation: 'bridge',
    initiatedProps,
    failedProps: { toChainId: params.toChainId, tokenSymbol: params.toTokenSymbol },
    params,
    options,
    run: (opId) => run(wrapBridgeOptions(analytics, options, opId) as BridgeOperationOptions, opId),
    success: (r) => ({
      intentExplorerUrl: r.intentExplorerUrl,
      ...extractBridgeProperties(r.intent),
    }),
  });
}

export function trackTransfer<R extends TransferResult>(
  analytics: AnalyticsManager,
  params: TransferParams,
  options: BridgeOperationOptions | undefined,
  run: (wrapped: BridgeOperationOptions, opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    tokenSymbol: params.toTokenSymbol,
    recipient: params.recipient,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.TRANSFER_INITIATED,
      success: NexusAnalyticsEvents.TRANSFER_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.TRANSFER_TRANSACTION_FAILED,
      planRejected: NexusAnalyticsEvents.TRANSFER_PLAN_REJECTED,
    },
    opName: NexusOperationNames.TRANSFER,
    operation: 'bridgeAndTransfer',
    initiatedProps,
    params,
    options,
    run: (opId) =>
      run(wrapTransferOptions(analytics, options, opId) as BridgeOperationOptions, opId),
    success: (r) => ({
      txHash: r.execute.txHash,
      explorerUrl: r.execute.txExplorerUrl,
      intentExplorerUrl: r.bridgeResult?.intentExplorerUrl,
      ...extractBridgeProperties(r.bridgeResult?.intent),
    }),
  });
}

export function trackBridgeSim<R extends BridgeSimulationResult>(
  analytics: AnalyticsManager,
  params: BridgeParams,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    tokenSymbol: params.toTokenSymbol,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.BRIDGE_SIMULATION_STARTED,
      success: NexusAnalyticsEvents.BRIDGE_SIMULATION_SUCCESS,
      failed: NexusAnalyticsEvents.BRIDGE_SIMULATION_FAILED,
    },
    opName: NexusOperationNames.BRIDGE_SIMULATION,
    operation: 'simulateBridge',
    initiatedProps,
    params,
    run,
  });
}

export function trackTransferSim<R extends BridgeAndExecuteSimulationResult>(
  analytics: AnalyticsManager,
  params: TransferParams,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    tokenSymbol: params.toTokenSymbol,
    recipient: params.recipient,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.TRANSFER_SIMULATION_STARTED,
      success: NexusAnalyticsEvents.TRANSFER_SIMULATION_SUCCESS,
      failed: NexusAnalyticsEvents.TRANSFER_SIMULATION_FAILED,
    },
    opName: NexusOperationNames.TRANSFER_SIMULATION,
    operation: 'simulateBridgeAndTransfer',
    initiatedProps,
    params,
    run,
  });
}

export function trackExecute<R extends ExecuteResult>(
  analytics: AnalyticsManager,
  params: ExecuteParams,
  options: OnEventParam | undefined,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    contractAddress: params.to,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.EXECUTE_INITIATED,
      success: NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.EXECUTE_TRANSACTION_FAILED,
    },
    opName: NexusOperationNames.EXECUTE,
    operation: 'execute',
    initiatedProps,
    params,
    options,
    run,
    selectSuccessEvent: (r) =>
      r.execute.receipt
        ? NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUCCESS
        : NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUBMITTED,
    success: (r) => ({
      txHash: r.execute.txHash,
      explorerUrl: r.execute.txExplorerUrl,
      confirmed: !!r.execute.receipt,
    }),
  });
}

export function trackExecuteSim<R extends ExecuteSimulation>(
  analytics: AnalyticsManager,
  params: ExecuteParams,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    contractAddress: params.to,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.EXECUTE_SIMULATION_STARTED,
      success: NexusAnalyticsEvents.EXECUTE_SIMULATION_SUCCESS,
      failed: NexusAnalyticsEvents.EXECUTE_SIMULATION_FAILED,
    },
    opName: NexusOperationNames.EXECUTE_SIMULATION,
    operation: 'simulateExecute',
    initiatedProps,
    params,
    run,
  });
}

export function trackBridgeAndExecute<R extends BridgeAndExecuteResult>(
  analytics: AnalyticsManager,
  params: BridgeAndExecuteParams,
  options: BridgeAndExecuteOptions | undefined,
  run: (wrapped: BridgeAndExecuteOptions, opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    tokenSymbol: params.toTokenSymbol,
    contractAddress: params.execute?.to,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_INITIATED,
      success: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_TRANSACTION_FAILED,
      planRejected: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_PLAN_REJECTED,
    },
    opName: NexusOperationNames.BRIDGE_AND_EXECUTE,
    operation: 'bridgeAndExecute',
    initiatedProps,
    params,
    options,
    run: (opId) =>
      run(wrapBridgeAndExecuteOptions(analytics, options, opId) as BridgeAndExecuteOptions, opId),
    success: (r) => ({
      txHash: r.execute.txHash,
      intentExplorerUrl: r.bridgeResult?.intentExplorerUrl,
      ...extractBridgeProperties(r.bridgeResult?.intent),
    }),
  });
}

export function trackBridgeAndExecuteSim<R extends BridgeAndExecuteSimulationResult>(
  analytics: AnalyticsManager,
  params: BridgeAndExecuteParams,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    tokenSymbol: params.toTokenSymbol,
    contractAddress: params.execute?.to,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_STARTED,
      success: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_SUCCESS,
      failed: NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_FAILED,
    },
    opName: NexusOperationNames.BRIDGE_AND_EXECUTE_SIMULATION,
    operation: 'simulateBridgeAndExecute',
    initiatedProps,
    params,
    run,
  });
}

export function trackSwapExactIn<R extends SwapResult>(
  analytics: AnalyticsManager,
  params: SwapExactInParams,
  options: SwapOperationOptions | undefined,
  run: (wrapped: SwapOperationOptions, opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    mode: 'exact_in' as const,
    toChainId: params.toChainId,
    toTokenAddress: params.toTokenAddress,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.SWAP_INITIATED,
      success: NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.SWAP_TRANSACTION_FAILED,
      planRejected: NexusAnalyticsEvents.SWAP_PLAN_REJECTED,
    },
    opName: NexusOperationNames.SWAP,
    operation: 'swapWithExactIn',
    initiatedProps,
    params,
    options,
    run: (opId) => run(wrapSwapOptions(analytics, options, opId) as SwapOperationOptions, opId),
    success: (r) => extractSwapProperties(r),
  });
}

export function trackSwapExactOut<R extends SwapResult>(
  analytics: AnalyticsManager,
  params: SwapExactOutParams,
  options: SwapOperationOptions | undefined,
  run: (wrapped: SwapOperationOptions, opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    mode: 'exact_out' as const,
    toChainId: params.toChainId,
    toTokenAddress: params.toTokenAddress,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.SWAP_INITIATED,
      success: NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS,
      failed: NexusAnalyticsEvents.SWAP_TRANSACTION_FAILED,
      planRejected: NexusAnalyticsEvents.SWAP_PLAN_REJECTED,
    },
    opName: NexusOperationNames.SWAP,
    operation: 'swapWithExactOut',
    initiatedProps,
    params,
    options,
    run: (opId) => run(wrapSwapOptions(analytics, options, opId) as SwapOperationOptions, opId),
    success: (r) => extractSwapProperties(r),
  });
}

export function trackSwapAndExecute<R extends SwapAndExecuteResult>(
  analytics: AnalyticsManager,
  params: SwapAndExecuteParams,
  options: SwapAndExecuteOptions | undefined,
  run: (wrapped: SwapAndExecuteOptions, opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    toTokenAddress: params.toTokenAddress,
    contractAddress: params.execute?.to,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.SWAP_AND_EXECUTE_INITIATED,
      success: NexusAnalyticsEvents.SWAP_AND_EXECUTE_SUCCESS,
      failed: NexusAnalyticsEvents.SWAP_AND_EXECUTE_FAILED,
      planRejected: NexusAnalyticsEvents.SWAP_AND_EXECUTE_PLAN_REJECTED,
    },
    opName: NexusOperationNames.SWAP_AND_EXECUTE,
    operation: 'swapAndExecute',
    initiatedProps,
    params,
    options,
    run: (opId) =>
      run(wrapSwapAndExecuteOptions(analytics, options, opId) as SwapAndExecuteOptions, opId),
    success: (r) => {
      if (r.swapSkipped) {
        analytics.track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SKIPPED, {
          toChainId: params.toChainId,
          toTokenAddress: params.toTokenAddress,
        });
      }
      return {
        swapSkipped: r.swapSkipped,
        txHash: r.execute.txHash,
        ...extractSwapProperties(r.swapResult),
      };
    },
  });
}

export function trackBalanceFetch<R>(
  analytics: AnalyticsManager,
  kind: 'bridge' | 'swap',
  run: (opId: string) => Promise<R>
): Promise<R> {
  const isSwap = kind === 'swap';
  const initiatedProps = { swap: isSwap, bridge: !isSwap };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.BALANCES_FETCH_STARTED,
      success: NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS,
      failed: NexusAnalyticsEvents.BALANCES_FETCH_FAILED,
    },
    opName: isSwap
      ? NexusOperationNames.BALANCES_FETCH_SWAP
      : NexusOperationNames.BALANCES_FETCH_BRIDGE,
    operation: isSwap ? 'getBalancesForSwap' : 'getBalancesForBridge',
    initiatedProps,
    run,
  });
}

export function trackInit<R>(
  analytics: AnalyticsManager,
  successProps: Record<string, unknown>,
  run: (opId: string) => Promise<R>
): Promise<R> {
  return analytics.runOp<R>({
    events: {
      // SDK_INITIALIZED doubles as the success event; no initiated event is fired.
      success: NexusAnalyticsEvents.SDK_INITIALIZED,
      failed: NexusAnalyticsEvents.SDK_INITIALIZATION_FAILED,
    },
    opName: NexusOperationNames.INITIALIZE,
    operation: 'initialize',
    initiatedProps: successProps,
    failedProps: {},
    run,
  });
}

export function trackListIntents<R extends ListIntentsResult>(
  analytics: AnalyticsManager,
  params: ListIntentsParams | undefined,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    page: params?.page,
    status: params?.status,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.LIST_INTENTS_INITIATED,
      success: NexusAnalyticsEvents.LIST_INTENTS_SUCCESS,
      failed: NexusAnalyticsEvents.LIST_INTENTS_FAILED,
    },
    opName: NexusOperationNames.LIST_INTENTS,
    operation: 'listIntents',
    initiatedProps,
    params,
    run,
  });
}

export function trackCalculateMaxForSwap<R extends SwapMaxResult>(
  analytics: AnalyticsManager,
  params: SwapMaxParams,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const initiatedProps = {
    toChainId: params.toChainId,
    toTokenAddress: params.toTokenAddress,
  };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.CALCULATE_MAX_FOR_SWAP_INITIATED,
      success: NexusAnalyticsEvents.CALCULATE_MAX_FOR_SWAP_SUCCESS,
      failed: NexusAnalyticsEvents.CALCULATE_MAX_FOR_SWAP_FAILED,
    },
    opName: NexusOperationNames.CALCULATE_MAX_FOR_SWAP,
    operation: 'calculateMaxForSwap',
    initiatedProps,
    params,
    run,
  });
}

export function trackWalletConnect<R extends { address: Hex; chainId: number }>(
  analytics: AnalyticsManager,
  provider: EthereumProvider,
  run: (opId: string) => Promise<R>
): Promise<R> {
  const walletType = getWalletType(provider);
  const initiatedProps = { walletType };
  return analytics.runOp<R>({
    events: {
      initiated: NexusAnalyticsEvents.WALLET_CONNECT_INITIATED,
      success: NexusAnalyticsEvents.WALLET_CONNECTED,
      failed: NexusAnalyticsEvents.WALLET_CONNECT_FAILED,
    },
    opName: NexusOperationNames.WALLET_CONNECT,
    operation: 'setEVMProvider',
    initiatedProps,
    params: { walletType },
    run,
    success: (r) => ({ chainId: r.chainId }),
  });
}
