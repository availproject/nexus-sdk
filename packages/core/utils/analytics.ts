// analytics.ts
// Custom OpenPanel integration for Avail Nexus SDK

import {
  AllowanceHookSources,
  BridgeAndExecuteParams,
  BridgeParams,
  ExactInSwapInput,
  ExactOutSwapInput,
  ExecuteParams,
  Network,
  NetworkConfig,
  ReadableIntent,
  SwapInputOptionalParams,
  TransferParams,
} from '@nexus/commons';
import { OpenPanel } from '@openpanel/web';

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
      sdkVersion: '1.0.0-beta.4',
      package: 'nexus-core',
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

    op.track('nexus-core', body);
  } catch (error) {
    console.error('❌ Analytics tracking error:', error);
  }
}

// Track Initialized
export function trackSDKInitialized(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-core-initialized', {
    network: config?.network,
    debug: config?.network,
  });
}

export function trackSDKBackendInitialized(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-core-backend-initialized', {
    network: config?.network,
    debug: config?.network,
  });
}

// Track DeInitialized
export function trackSdkDeInitialized(config?: {
  network?: Network | NetworkConfig;
  debug?: boolean;
}) {
  trackEvent('nexus-core-deInitialized', {
    network: config?.network,
    debug: config?.network,
  });
}

// Track errors
export function trackError(
  error: Error,
  context: {
    function: string;
    params?: any;
    state?: any;
    balances?: any;
    intentData?: any;
  },
) {
  trackEvent(`nexus-core-error-${context.function}-failed`, {
    errorMessage: error.message,
    errorStack: error.stack,
    errorCode: error.name,
    function: context.function,
    params: context.params,
    state: context.state,
    balances: context.balances,
    intentData: context.intentData,
  });
}

// Track intent lifecycle
export function trackNexusTransaction(params: {
  name: string;
  config?: { network?: Network | NetworkConfig; debug?: boolean };
  properties?: any;
  bridgeParams?: BridgeParams;
  transaferParams?: TransferParams;
  exactInParams?: { input: ExactInSwapInput; options?: SwapInputOptionalParams };
  exactOutParams?: { input: ExactOutSwapInput; options?: SwapInputOptionalParams };
  executeParams?: ExecuteParams;
  simulateExecute?: ExecuteParams;
  bridgeAndExecuteParams?: BridgeAndExecuteParams;
  simulateBridgeAndExecute?: BridgeAndExecuteParams;
  simulateBridge?: BridgeParams;
  simulateTransfer?: TransferParams;
  chainId?: number;
  tokens?: string[];
  amount?: bigint;
}) {
  trackEvent('nexus-core-transaction', params);
}

export function trackAllowance(allowanceData?: AllowanceHookSources) {
  trackEvent('nexus-core-allowance', allowanceData);
}

export function trackIntent(intentData?: ReadableIntent) {
  trackEvent('nexus-core-intent', intentData);
}

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
