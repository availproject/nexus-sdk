// analytics.ts
// Custom OpenPanel integration for Avail Nexus SDK

import { NexusNetwork } from '@nexus/commons';
import { OpenPanel } from '@openpanel/web';
import { ActiveTransaction } from 'src/types';

const OPENPANEL_CONFIG = {
  apiURL: 'https://analytics.availproject.org/api',
  clientId: '5e2f37bc-227e-49cc-9611-637d3614231f',
};

// Initialize OpenPanel
export function initAnalytics() {
  if (typeof window !== 'undefined') {
    console.log('✅ Analytics initialized with OpenPanel');
  }
}

// Track events (direct POST to OpenPanel API)
export async function trackEvent(
  name: string,
  config: { network: NexusNetwork; debug: boolean },
  properties?: Record<string, any>,
) {
  try {
    const body = {
      event: name,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
        sessionId: getSessionId(),
        sdkVersion: '0.5.0',
        package: 'nexus-widgets',
        appDomain: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
        appUrl: typeof window !== 'undefined' ? window.location.origin : 'unknown',
        network: config?.network || 'mainnet',
        debug: config?.debug || false,
      },
    };

    const op = new OpenPanel({
      clientId: OPENPANEL_CONFIG.clientId,
      apiUrl: OPENPANEL_CONFIG.apiURL,
      trackScreenViews: true,
      trackOutgoingLinks: true,
      trackAttributes: true,
    });

    op.track('track_widgets', body);

    console.log(`Analytics tracking working`);
  } catch (error) {
    console.error('❌ Analytics tracking error:', error);
  }
}

// Track Initialized
export function trackSDKInitialized(config: { network: NexusNetwork; debug: boolean }) {
  trackEvent('sdk_initialized', config);
}

// Track DeInitialized
export function trackSdkDeInitialized(config: { network: NexusNetwork; debug: boolean }) {
  trackEvent('sdk_deInitialized', config);
}

// Track errors
export function trackError(
  error: Error,
  config: { network: NexusNetwork; debug: boolean },
  context: {
    function: string;
    params?: any;
    state?: any;
    balances?: any;
    intentData?: any;
  },
) {
  trackEvent(`sdk_error_${context.function}_failed`, config, {
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
export function trackIntentCreated(
  config: { network: NexusNetwork; debug: boolean },
  params: {
    intentId?: string;
    intentType: 'bridge' | 'swap' | 'transfer' | 'bridgeAndExecute' | 'unified_balance';
    sourceChain?: string | number | number[];
    targetChain?: string | number | number[];
    token?: string;
    amount?: string | number;
    amountUSD?: number;
    gasSupplied?: boolean;
    swapType?: 'none' | 'source' | 'destination' | 'both';
    sourceCount?: number;
  },
) {
  trackEvent('intent_created', config, {
    intentId: params.intentId || generateId(),
    intentType: params.intentType,
    sourceChain: params.sourceChain,
    targetChain: params.targetChain,
    token: params.token,
    amount: params.amount,
    amountUSD: params.amountUSD,
    gasSupplied: params.gasSupplied,
    swapType: params.swapType,
    sourceCount: params.sourceCount,
  });
}

export function trackIntentFulfilled(
  config: { network: NexusNetwork; debug: boolean },
  params: {
    intentId?: string;
    txHash?: string;
    fulfillmentTime?: number;
    fees?: string;
  },
) {
  trackEvent('intent_fulfilled', config, {
    intentId: params.intentId,
    txHash: params.txHash,
    fulfillmentTime: params.fulfillmentTime,
    fees: params.fees,
  });
}

export function trackIntentFailed(
  config: { network: NexusNetwork; debug: boolean },
  params: {
    intentId?: string;
    errorMessage: string;
    errorCode?: string;
    failureType?: 'source_swap' | 'source_collection' | 'destination_swap' | 'other';
  },
) {
  trackEvent('intent_failed', config, {
    intentId: params.intentId,
    errorMessage: params.errorMessage,
    errorCode: params.errorCode,
    failureType: params.failureType || 'other',
  });
}

export function trackIntentRefunded(
  config: { network: NexusNetwork; debug: boolean },
  params: {
    intentId?: string;
    refundAmount: string;
    refundTime?: number;
  },
) {
  trackEvent('intent_refunded', config, {
    intentId: params.intentId,
    refundAmount: params.refundAmount,
    refundTime: params.refundTime,
  });
}

export function trackTransaction(
  config: { network: NexusNetwork; debug: boolean },
  params: ActiveTransaction,
) {
  trackEvent('active_transaction', config, params);
}

export function trackIntentUnfulfilled(
  config: { network: NexusNetwork; debug: boolean },
  intentId?: string,
) {
  trackEvent('intent_unfulfilled', config, { intentId });
}

// Widget flows
export function trackWidgetInitiated(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
) {
  trackEvent('widget_initiated', config, { widgetType });
}

export function trackWidgetSiweSigned(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
) {
  trackEvent('widget_siwe_signed', config, { widgetType });
}

export function trackWidgetParamsSpecified(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
  params: any,
) {
  trackEvent('widget_params_specified', config, {
    widgetType,
    params: sanitizeParams(params),
  });
}

export function trackWidgetDetailsViewed(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
) {
  trackEvent('widget_details_viewed', config, { widgetType });
}

export function trackWidgetApproved(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
) {
  trackEvent('widget_approved', config, { widgetType });
}

export function trackWidgetIntentFulfilled(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
) {
  trackEvent('widget_intent_fulfilled', config, { widgetType });
}

export function trackWidgetSuccess(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
  txHash?: string,
) {
  trackEvent('widget_success', config, { widgetType, txHash });
}

// SDK performance and health
export function trackSdkPerformance(
  config: { network: NexusNetwork; debug: boolean },
  params: {
    action: string;
    operationTime: number;
    rpcCallCount?: number;
    apiCallCount?: number;
    cacheHit?: boolean;
    totalSteps?: number;
  },
) {
  trackEvent('sdk_performance', config, params);
}

export function trackSdkHealth(
  config: { network: NexusNetwork; debug: boolean },
  status: {
    sdkInitialized: boolean;
    providerConnected: boolean;
    chainsAvailable?: string[];
    apiEndpointsReachable?: boolean;
  },
) {
  trackEvent('sdk_health_check', config, status);
}

export function trackApiLatency(
  config: { network: NexusNetwork; debug: boolean },
  params: {
    endpoint: string;
    latency: number;
    statusCode: number;
    status: 'success' | 'failed' | 'timeout';
    retryCount?: number;
  },
) {
  trackEvent('sdk_api_latency', config, params);
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

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeParams(params: any): any {
  if (!params) return {};
  const sanitized: any = {};
  for (const [key, value] of Object.entries(params)) {
    if (
      key.toLowerCase().includes('private') ||
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('key')
    )
      continue;
    if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.substring(0, 200) + '...';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
