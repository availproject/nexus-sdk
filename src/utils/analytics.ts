// analytics.ts
// Custom OpenPanel integration for Avail Nexus SDK

import { OpenPanel } from '@openpanel/web';
import {
  AllowanceHookSources,
  BridgeAndExecuteParams,
  BridgeParams,
  ExactInSwapInput,
  ExactOutSwapInput,
  ExecuteParams,
  Network,
  NetworkConfig,
  OnEventParam,
  ReadableIntent,
  SwapIntent,
  TransferParams,
} from '../commons';
import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';

const OPENPANEL_CONFIG = {
  apiURL: 'https://analytics.availproject.org/api',
  clientId: '5e2f37bc-227e-49cc-9611-637d3614231f',
};

// Track events (direct POST to OpenPanel API)
export async function trackEvent(name: string, properties?: Record<string, any>) {
  try {
    const body = {
      event: name,
      timestamp: new Date().toISOString(),
      sessionId: getSessionId(),
      sdkVersion: '1.0.0-beta.29',
      package: 'nexus',
      appUrl: typeof window !== 'undefined' ? window.location.origin : 'unknown',
      properties: {
        ...properties,
      },
    };

    const op = new OpenPanel({
      clientId: OPENPANEL_CONFIG.clientId,
      apiUrl: OPENPANEL_CONFIG.apiURL,
      trackScreenViews: true,
      trackOutgoingLinks: true,
      trackAttributes: true,
    });

    op.track('nexus', body);
  } catch (error) {
    console.error('Analytics tracking error:', error);
  }
}

/**
 * Track SDK Initialization
 * Logs an event when the Nexus SDK is initialized
 */
export function trackSDKInitialized(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-initialized', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track SDK De-initialization
 * Logs an event when the SDK is de-initialized or reset
 */
export function trackSdkDeInitialized(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-deInitialized', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track Get Intent call
 * Used to trace when an intent request is made
 */
export function trackGetIntent(config?: { network?: Network | NetworkConfig; debug?: boolean }) {
  trackEvent('nexus-getIntent', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track Get Balance for Swap
 * Logs event when swap balance retrieval is initiated
 */
export function trackGetBalanceSwap(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-getBalancesForSwap', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track supported chains for Swap
 * Indicates which chains are supported by the SDK
 */
export function trackGetSwapSupportedChains(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-getSwapSupportedChains', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track SDK Initialization Check
 * Logs if the SDK is currently initialized
 */
export function trackIsInitialized(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-isInitialized', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track Unified Balances
 * Logs retrieval of balances across multiple chains or wallets
 */
export function trackGetUnifiedBalances(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-getUnifiedBalances', {
    network: config?.network,
    debug: config?.network,
  });
}

/**
 * Track transaction lifecycle events
 * Captures bridge, transfer, swap, and execution actions
 */
export function trackNexusTransaction(params: {
  name: string;
  config?: { network?: Network | NetworkConfig; debug?: boolean };
  calculateMaxForBridge?: Omit<BridgeParams, 'amount'> | any;
  bridgeParams?: { params: BridgeParams | any; options?: OnEventParam };
  bridgeAndTransferParams?: { params: TransferParams | any; options?: OnEventParam };
  swapWithExactInParams?: { input: ExactInSwapInput | any; options?: OnEventParam };
  swapWithExactOutParams?: { input: ExactOutSwapInput | any; options?: OnEventParam };
  simulateBridgeParams?: BridgeParams | any;
  simulateBridgeAndTransferParams?: TransferParams | any;
  executeParams?: { params: ExecuteParams | any; options?: OnEventParam };
  simulateExecuteParams?: ExecuteParams | any;
  bridgeAndExecuteParams?: { params: BridgeAndExecuteParams | any; options?: OnEventParam };
  simulateBridgeAndExecute?: BridgeAndExecuteParams | any;
}) {
  trackEvent('nexus-transaction', params);
}

/**
 * Track transaction results
 * Used to log outcomes of various Nexus actions
 */
export function trackNexusResult(params: {
  name: string;
  config?: { network?: Network | NetworkConfig; debug?: boolean };
  result?: any;
}) {
  trackEvent('nexus-result', params);
}

/**
 * Track token allowance information
 */
export function trackAllowance(allowanceData?: AllowanceHookSources) {
  trackEvent('nexus-allowance', allowanceData);
}

/**
 * Track general intent data
 */
export function trackIntent(intentData?: ReadableIntent) {
  trackEvent('nexus-intent', intentData);
}

/**
 * Track swap-related intents
 */
export function trackSwapIntent(intentData?: SwapIntent) {
  trackEvent('nexus-swap-intent', intentData);
}

/**
 * Track Tron adapter usage or configuration
 */
export function trackTron(adapter?: AdapterProps) {
  trackEvent('nexus-tron-adapter', adapter);
}

/**
 * Track token details fetch event
 */
export function trackTokenDetails(params: {
  config?: { network?: Network | NetworkConfig; debug?: boolean };
  params: any;
}) {
  trackEvent('nexus-token-details', params);
}

// Helpers
function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let sessionId = localStorage.getItem('nexus_session_id');
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('nexus_session_id', sessionId);
  }
  return sessionId;
}
