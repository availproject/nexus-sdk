import { AnalyticsManager } from '../../analytics/AnalyticsManager';
import type { AnalyticsConfig, DevTimingConfig } from '../../analytics/types';
import type {
  EthereumProvider,
  ExecuteParams,
  ListIntentsParams,
  NexusNetwork,
  OnEventParam,
} from '../../domain';
import { getLogger } from '../../domain';
import { Errors } from '../../domain/errors';
import { intentNetworkEnabled } from '../../intent/catalog';
import { createChainList } from '../../services/chain-list';
import { getNetwork, readEnv } from '../../services/network-config';
import { setLoggerProvider } from '../../services/telemetry';
import type { SwapAndExecuteParams, SwapExactInParams, SwapExactOutParams } from '../../swap/types';
import type { MiddlewareClient } from '../../transport';
import type { NexusClient, SwapAndExecuteOptions, SwapOperationOptions } from '../types';
import { createNexusUtils } from '../utils';
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

export const createNexusClient = (config: {
  clientId: string;
  network?: NexusNetwork;
  debug?: boolean;
  analytics?: AnalyticsConfig;
  devTiming?: DevTimingConfig;
  forceMayan?: boolean;
  internal?: { middlewareClient?: MiddlewareClient };
}): NexusClient => {
  if (typeof config?.clientId !== 'string' || !config.clientId.trim()) {
    throw Errors.invalidInput('clientId must be a non-empty string');
  }

  const resolvedDevTiming: DevTimingConfig | undefined =
    config?.devTiming?.enabled === undefined && readEnv('NEXUS_DEV_TIMING') === 'true'
      ? { ...config?.devTiming, enabled: true }
      : config?.devTiming;
  const base = createBase({ ...config, devTiming: resolvedDevTiming });
  const analytics = new AnalyticsManager(
    getNetwork(config?.network || 'mainnet'),
    config?.analytics,
    resolvedDevTiming,
    base.peekChainList,
    config.clientId
  );
  base.setAnalytics(analytics);
  logger.debug('Nexus SDK initialized with config:', config);

  const initialize = async () => {
    await setLoggerProvider(base.networkConfig);
    await trackInit(analytics, { debug: config?.debug || false }, async () => {
      const middleware = base.getMiddlewareClient();
      const intentEnabled = intentNetworkEnabled(base.networkConfig.NETWORK_HINT);
      const intentChains = await middleware.getIntentChains();
      base.setChainList(createChainList(intentChains));
      if (intentEnabled) {
        base.setIntentCatalog(intentChains);
      }
    });
  };

  const client: NexusClient = {
    utils: createNexusUtils(config.clientId),
    analytics,
    initialize,
    isSupportedChain: (chainId) => base.getSupportedChains().some((chain) => chain.id === chainId),
    listIntents: (params?: ListIntentsParams) =>
      trackListIntents(analytics, params, () => base.listIntents(params)),
    execute: (params: ExecuteParams, options?: OnEventParam) =>
      trackExecute(analytics, params, options, (opId) => base.execute(params, options, opId)),
    simulateExecute: (params: ExecuteParams) =>
      trackExecuteSim(analytics, params, () => base.simulateExecute(params)),
    getBalancesForSwap: () =>
      trackBalanceFetch(analytics, () => base.getBalancesForSwap()).then(
        (result) => result.balances
      ),
    swapWithExactIn: (input: SwapExactInParams, options?: SwapOperationOptions) =>
      trackIntentOperation(analytics, 'swapWithExactIn', input, options, (_id, reporting) =>
        base.swapWithExactIn(input, options, reporting)
      ),
    swapWithExactOut: (input: SwapExactOutParams, options?: SwapOperationOptions) =>
      trackIntentOperation(analytics, 'swapWithExactOut', input, options, (_id, reporting) =>
        base.swapWithExactOut(input, options, reporting)
      ),
    swapAndExecute: (input: SwapAndExecuteParams, options?: SwapAndExecuteOptions) =>
      trackIntentOperation(analytics, 'swapAndExecute', input, options, (_id, reporting) =>
        base.swapAndExecute(input, options, reporting)
      ),
    setEVMProvider: (provider: EthereumProvider) => base.setEvmProvider(provider),
    convertTokenReadableAmountToBigInt: base.convertTokenReadableAmountToBigInt,
    getSupportedChains: base.getSupportedChains,
    getSupportedChainsForRoute: base.getSupportedChainsForRoute,
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
