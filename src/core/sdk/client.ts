import { AnalyticsManager } from '../../analytics/AnalyticsManager';
import type {
  AnalyticsConfig,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  BridgeParams,
  BridgeResult,
  BridgeSimulationResult,
  DevTimingConfig,
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
  ListIntentsResult,
  NexusNetwork,
  OnEventParam,
  TransferParams,
  TransferResult,
} from '../../domain';
import { getLogger } from '../../domain';
import { createChainList } from '../../services/chain-list';
import { getSupportedChainsFromChainList } from '../../services/chains';
import { getNetwork, readEnv } from '../../services/network-config';
import { setLoggerProvider } from '../../services/telemetry';
import type {
  SwapAndExecuteParams,
  SwapAndExecuteResult,
  SwapExactInParams,
  SwapExactOutParams,
  SwapMaxParams,
  SwapMaxResult,
  SwapResult,
} from '../../swap/types';
import type { MiddlewareClient } from '../../transport';
import type {
  BridgeAndExecuteOptions,
  BridgeOperationOptions,
  NexusClient,
  SwapAndExecuteOptions,
  SwapOperationOptions,
} from '../types';
import { nexusUtils } from '../utils';
import { createBase } from './base';
import {
  trackBalanceFetch,
  trackBridge,
  trackBridgeAndExecute,
  trackBridgeAndExecuteSim,
  trackBridgeSim,
  trackCalculateMaxForSwap,
  trackExecute,
  trackExecuteSim,
  trackInit,
  trackListIntents,
  trackSwapAndExecute,
  trackSwapExactIn,
  trackSwapExactOut,
  trackTransfer,
  trackTransferSim,
} from './operation-boundary';

const logger = getLogger();

export const createNexusClient = (config?: {
  network?: NexusNetwork;
  debug?: boolean;
  analytics?: AnalyticsConfig;
  devTiming?: DevTimingConfig;
  /**
   * Override the auto-detected domain used in the ephemeral-key sign message
   * and storage key. Required for environments without a window (e.g. mobile
   * wallets, native shells) when the default `localhost` fallback isn't suitable.
   */
  domain?: string;
  forceMayan?: boolean;
  internal?: {
    middlewareClient?: MiddlewareClient;
  };
}): NexusClient => {
  const resolvedDevTiming: DevTimingConfig | undefined =
    config?.devTiming?.enabled === undefined && readEnv('NEXUS_DEV_TIMING') === 'true'
      ? { ...config?.devTiming, enabled: true }
      : config?.devTiming;

  const base = createBase({ ...config, devTiming: resolvedDevTiming });

  logger.debug('Nexus SDK initialized with config:', config);

  const utils = nexusUtils;

  const analytics = new AnalyticsManager(
    getNetwork(config?.network || 'mainnet'),
    config?.analytics,
    resolvedDevTiming,
    base.peekChainList
  );
  base.setAnalytics(analytics);

  const initialize = async (): Promise<void> => {
    // Provision the OTel logger BEFORE any work that might fail, so the boundary catch
    // below can actually emit. This call is idempotent — if `setEVMProvider` already
    // resolved it, the inner `if (!telemetryLogger)` guard short-circuits.
    await setLoggerProvider(base.networkConfig);

    await trackInit(analytics, { debug: config?.debug || false }, async () => {
      const deployment = await base.getMiddlewareClient().getDeployment();
      // if (deployment.network !== base.networkHint) {
      //   throw Errors.invalidInput(
      //     `Deployment network mismatch: expected ${base.networkHint}, got ${deployment.network}`
      //   );
      // }
      const chainList = createChainList(deployment);
      base.setChainList(chainList);
    });
  };

  const bridge = (params: BridgeParams, options?: BridgeOperationOptions): Promise<BridgeResult> =>
    trackBridge(analytics, params, options, (wrapped, opId) =>
      base.executeBridge(params, wrapped, opId)
    );

  const bridgeAndTransfer = (
    params: TransferParams,
    options?: BridgeOperationOptions
  ): Promise<TransferResult> =>
    trackTransfer(analytics, params, options, (wrapped, opId) =>
      base.bridgeAndTransfer(params, wrapped, opId)
    );

  const simulateBridge = (params: BridgeParams): Promise<BridgeSimulationResult> =>
    trackBridgeSim(analytics, params, () => base.simulateBridge(params));

  const simulateBridgeAndTransfer = (
    params: TransferParams
  ): Promise<BridgeAndExecuteSimulationResult> =>
    trackTransferSim(analytics, params, () => base.simulateBridgeAndTransfer(params));

  const listIntents = (params?: ListIntentsParams): Promise<ListIntentsResult> =>
    trackListIntents(analytics, params, () => base.listIntents(params));

  const execute = (params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult> =>
    trackExecute(analytics, params, options, (opId) => base.execute(params, options, opId));

  const simulateExecute = (params: ExecuteParams): Promise<ExecuteSimulation> =>
    trackExecuteSim(analytics, params, () => base.simulateExecute(params));

  const bridgeAndExecute = (
    params: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions
  ): Promise<BridgeAndExecuteResult> =>
    trackBridgeAndExecute(analytics, params, options, (wrapped, opId) =>
      base.bridgeAndExecute(params, wrapped, opId)
    );

  const simulateBridgeAndExecute = (
    params: BridgeAndExecuteParams
  ): Promise<BridgeAndExecuteSimulationResult> =>
    trackBridgeAndExecuteSim(analytics, params, () => base.simulateBridgeAndExecute(params));

  const getBalancesForBridge = () =>
    trackBalanceFetch(analytics, 'bridge', () => base.getBalancesForBridge());

  const getBalancesForSwap = () =>
    trackBalanceFetch(analytics, 'swap', () => base.getBalancesForSwap());

  const swapWithExactIn = (
    input: SwapExactInParams,
    options?: SwapOperationOptions
  ): Promise<SwapResult> =>
    trackSwapExactIn(analytics, input, options, (wrapped, opId) =>
      base.swapWithExactIn(input, wrapped, opId)
    );

  const swapWithExactOut = (
    input: SwapExactOutParams,
    options?: SwapOperationOptions
  ): Promise<SwapResult> =>
    trackSwapExactOut(analytics, input, options, (wrapped, opId) =>
      base.swapWithExactOut(input, wrapped, opId)
    );

  const swapAndExecutePublic = (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions
  ): Promise<SwapAndExecuteResult> =>
    trackSwapAndExecute(analytics, input, options, (wrapped, opId) =>
      base.swapAndExecute(input, wrapped, opId)
    );

  const calculateMaxForSwapPublic = (input: SwapMaxParams): Promise<SwapMaxResult> =>
    trackCalculateMaxForSwap(analytics, input, () => base.calculateMaxForSwap(input));

  const setEVMProvider = (provider: EthereumProvider) => base.setEvmProvider(provider);

  const convertTokenReadableAmountToBigInt = (
    amount: string,
    tokenSymbol: string,
    chainId: number
  ) => base.convertTokenReadableAmountToBigInt(amount, tokenSymbol, chainId);

  const isSupportedChain = (chainId: number) => {
    try {
      base.getChainList().getChainByID(chainId);
      return true;
    } catch {
      return false;
    }
  };

  const client: NexusClient = {
    utils,
    analytics,
    initialize,
    isSupportedChain,
    bridge,
    bridgeAndTransfer,
    simulateBridge,
    simulateBridgeAndTransfer,
    listIntents,
    execute,
    simulateExecute,
    bridgeAndExecute,
    simulateBridgeAndExecute,
    getBalancesForBridge,
    getBalancesForSwap,
    swapWithExactIn,
    swapWithExactOut,
    swapAndExecute: swapAndExecutePublic,
    calculateMaxForSwap: calculateMaxForSwapPublic,
    calculateMaxForBridge: (input) => base.calculateMaxForBridge(input),
    setEVMProvider,
    convertTokenReadableAmountToBigInt,
    getSupportedChains: () => getSupportedChainsFromChainList(base.getChainList()),
    destroy() {
      analytics.trackSessionEnd();
    },
    get chainList() {
      return base.getChainList();
    },
    get hasEvmProvider() {
      return base.hasEvmProvider();
    },
  };

  return client;
};
