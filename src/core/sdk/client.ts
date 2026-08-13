import { AnalyticsManager } from '../../analytics/AnalyticsManager';
import type { AnalyticsConfig, DevTimingConfig } from '../../analytics/types';
import type {
  BridgeAndExecuteParams,
  BridgeParams,
  EthereumProvider,
  ExecuteParams,
  ListIntentsParams,
  NexusNetwork,
  OnEventParam,
  TransferParams,
} from '../../domain';
import { getLogger } from '../../domain';
import { createTokenCatalogFromChains, intentNetworkEnabled } from '../../intent/catalog';
import { createChainList } from '../../services/chain-list';
import { getNetwork, readEnv } from '../../services/network-config';
import { setLoggerProvider } from '../../services/telemetry';
import type { SwapAndExecuteParams, SwapExactInParams, SwapExactOutParams } from '../../swap/types';
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
  trackExecute,
  trackExecuteSim,
  trackInit,
  trackIntentOperation,
  trackListIntents,
} from './operation-boundary';

const logger = getLogger();

export const createNexusClient = (config?: {
  network?: NexusNetwork;
  debug?: boolean;
  analytics?: AnalyticsConfig;
  devTiming?: DevTimingConfig;
  forceMayan?: boolean;
  internal?: { middlewareClient?: MiddlewareClient };
}): NexusClient => {
  const resolvedDevTiming: DevTimingConfig | undefined =
    config?.devTiming?.enabled === undefined && readEnv('NEXUS_DEV_TIMING') === 'true'
      ? { ...config?.devTiming, enabled: true }
      : config?.devTiming;
  const base = createBase({ ...config, devTiming: resolvedDevTiming });
  const analytics = new AnalyticsManager(
    getNetwork(config?.network || 'mainnet'),
    config?.analytics,
    resolvedDevTiming,
    base.peekChainList
  );
  base.setAnalytics(analytics);
  logger.debug('Nexus SDK initialized with config:', config);

  const initialize = async () => {
    await setLoggerProvider(base.networkConfig);
    await trackInit(analytics, { debug: config?.debug || false }, async () => {
      const middleware = base.getMiddlewareClient();
      const intentEnabled = intentNetworkEnabled(base.networkConfig.NETWORK_HINT);
      const catalogProviders = config?.forceMayan ? (['mayan'] as const) : undefined;
      const [deployment, intentChains] = await Promise.all([
        middleware.getDeployment(),
        intentEnabled
          ? middleware.getIntentChains(catalogProviders ? [...catalogProviders] : undefined)
          : Promise.resolve([]),
      ]);
      base.setChainList(createChainList(deployment));
      if (intentEnabled) {
        base.setIntentCatalog(intentChains, createTokenCatalogFromChains(intentChains));
      }
    });
  };

  const client: NexusClient = {
    utils: nexusUtils,
    analytics,
    initialize,
    isSupportedChain: (chainId) => base.getSupportedChains().some((chain) => chain.id === chainId),
    bridge: (params: BridgeParams, options?: BridgeOperationOptions) =>
      trackIntentOperation(analytics, 'bridge', params, options, () =>
        base.executeBridge(params, options)
      ),
    bridgeAndTransfer: (params: TransferParams, options?: BridgeOperationOptions) =>
      trackIntentOperation(analytics, 'bridgeAndTransfer', params, options, () =>
        base.bridgeAndTransfer(params, options)
      ),
    simulateBridge: (params: BridgeParams, options?: BridgeOperationOptions) =>
      trackIntentOperation(analytics, 'simulateBridge', params, options, () =>
        base.simulateBridge(params, options)
      ),
    simulateBridgeAndTransfer: (params: TransferParams, options?: BridgeOperationOptions) =>
      trackIntentOperation(analytics, 'simulateBridgeAndTransfer', params, options, () =>
        base.simulateBridgeAndTransfer(params, options)
      ),
    listIntents: (params?: ListIntentsParams) =>
      trackListIntents(analytics, params, () => base.listIntents(params)),
    execute: (params: ExecuteParams, options?: OnEventParam) =>
      trackExecute(analytics, params, options, (opId) => base.execute(params, options, opId)),
    simulateExecute: (params: ExecuteParams) =>
      trackExecuteSim(analytics, params, () => base.simulateExecute(params)),
    bridgeAndExecute: (params: BridgeAndExecuteParams, options?: BridgeAndExecuteOptions) =>
      trackIntentOperation(analytics, 'bridgeAndExecute', params, options, () =>
        base.bridgeAndExecute(params, options)
      ),
    simulateBridgeAndExecute: (params: BridgeAndExecuteParams, options?: BridgeAndExecuteOptions) =>
      trackIntentOperation(analytics, 'simulateBridgeAndExecute', params, options, () =>
        base.simulateBridgeAndExecute(params, options)
      ),
    getBalancesForBridge: () =>
      trackBalanceFetch(analytics, 'bridge', () => base.getBalancesForBridge()),
    getBalancesForSwap: () => trackBalanceFetch(analytics, 'swap', () => base.getBalancesForSwap()),
    swapWithExactIn: (input: SwapExactInParams, options?: SwapOperationOptions) =>
      trackIntentOperation(analytics, 'swapWithExactIn', input, options, () =>
        base.swapWithExactIn(input, options)
      ),
    swapWithExactOut: (input: SwapExactOutParams, options?: SwapOperationOptions) =>
      trackIntentOperation(analytics, 'swapWithExactOut', input, options, () =>
        base.swapWithExactOut(input, options)
      ),
    swapAndExecute: (input: SwapAndExecuteParams, options?: SwapAndExecuteOptions) =>
      trackIntentOperation(analytics, 'swapAndExecute', input, options, () =>
        base.swapAndExecute(input, options)
      ),
    setEVMProvider: (provider: EthereumProvider) => base.setEvmProvider(provider),
    convertTokenReadableAmountToBigInt: base.convertTokenReadableAmountToBigInt,
    getSupportedChains: base.getSupportedChains,
    destroy: () => {
      analytics.trackSessionEnd();
      base.getMiddlewareClient().destroy();
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
