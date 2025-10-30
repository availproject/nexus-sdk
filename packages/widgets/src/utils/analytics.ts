// analytics.ts
// Custom OpenPanel integration for Avail Nexus SDK

import { useInternalNexus } from 'src/providers/InternalNexusProvider';
import { ActiveTransaction } from 'src/types';

const OPENPANEL_CONFIG = {
  apiUrl: 'https://analytics.availproject.org/api',
  clientId: '5e2f37bc-227e-49cc-9611-637d3614231f',
  clientSecret: '',
};

// Initialize OpenPanel
export function initAnalytics() {
  if (typeof window !== 'undefined') {
    console.log('✅ Analytics initialized with OpenPanel');
  }
}

// Track events (direct POST to OpenPanel API)
export async function trackEvent(name: string, properties?: Record<string, any>) {
  try {
    const internalNexus = useInternalNexus();
    const body = {
      type: 'track',
      payload: {
        event: name,
        properties: {
          ...properties,
          timestamp: new Date().toISOString(),
          sessionId: getSessionId(),
          sdkVersion: '0.5.0',
          package: 'nexus-widgets',
          appDomain: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
          appUrl: typeof window !== 'undefined' ? window.location.origin : 'unknown',
          network: internalNexus.config?.network || 'mainnet',
          debug: internalNexus.config?.debug || false,
        },
      },
    };

    const response = await fetch(`${OPENPANEL_CONFIG.apiUrl}/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'openpanel-client-id': OPENPANEL_CONFIG.clientId,
        'openpanel-client-secret': OPENPANEL_CONFIG.clientSecret,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Analytics tracking failed (${response.status}):`, errText);
    }
  } catch (error) {
    console.error('❌ Analytics tracking error:', error);
  }
}

// Track Initialized
export function trackSDKInitialized() {
  trackEvent('sdk_initialized');
}

// Track DeInitialized
export function trackSdkDeInitialized() {
  trackEvent('sdk_deInitialized');
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
  trackEvent(`sdk_error_${context.function}_failed`, {
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
export function trackIntentCreated(params: {
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
}) {
  trackEvent('intent_created', {
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

export function trackIntentFulfilled(params: {
  intentId?: string;
  txHash?: string;
  fulfillmentTime?: number;
  fees?: string;
}) {
  trackEvent('intent_fulfilled', {
    intentId: params.intentId,
    txHash: params.txHash,
    fulfillmentTime: params.fulfillmentTime,
    fees: params.fees,
  });
}

export function trackIntentFailed(params: {
  intentId?: string;
  errorMessage: string;
  errorCode?: string;
  failureType?: 'source_swap' | 'source_collection' | 'destination_swap' | 'other';
}) {
  trackEvent('intent_failed', {
    intentId: params.intentId,
    errorMessage: params.errorMessage,
    errorCode: params.errorCode,
    failureType: params.failureType || 'other',
  });
}

export function trackIntentRefunded(params: {
  intentId?: string;
  refundAmount: string;
  refundTime?: number;
}) {
  trackEvent('intent_refunded', {
    intentId: params.intentId,
    refundAmount: params.refundAmount,
    refundTime: params.refundTime,
  });
}

export function trackTransaction(params: ActiveTransaction) {
  trackEvent('active_transaction', params);
}

export function trackIntentUnfulfilled(intentId?: string) {
  trackEvent('intent_unfulfilled', { intentId });
}

// Widget flows
export function trackWidgetInitiated(widgetType: string) {
  trackEvent('widget_initiated', { widgetType });
}

export function trackWidgetSiweSigned(widgetType: string) {
  trackEvent('widget_siwe_signed', { widgetType });
}

export function trackWidgetParamsSpecified(widgetType: string, params: any) {
  trackEvent('widget_params_specified', {
    widgetType,
    params: sanitizeParams(params),
  });
}

export function trackWidgetDetailsViewed(widgetType: string) {
  trackEvent('widget_details_viewed', { widgetType });
}

export function trackWidgetApproved(widgetType: string) {
  trackEvent('widget_approved', { widgetType });
}

export function trackWidgetIntentFulfilled(widgetType: string) {
  trackEvent('widget_intent_fulfilled', { widgetType });
}

export function trackWidgetSuccess(widgetType: string, txHash?: string) {
  trackEvent('widget_success', { widgetType, txHash });
}

// SDK performance and health
export function trackSdkPerformance(params: {
  action: string;
  operationTime: number;
  rpcCallCount?: number;
  apiCallCount?: number;
  cacheHit?: boolean;
  totalSteps?: number;
}) {
  trackEvent('sdk_performance', params);
}

export function trackSdkHealth(status: {
  sdkInitialized: boolean;
  providerConnected: boolean;
  chainsAvailable?: string[];
  apiEndpointsReachable?: boolean;
}) {
  trackEvent('sdk_health_check', status);
}

export function trackApiLatency(params: {
  endpoint: string;
  latency: number;
  statusCode: number;
  status: 'success' | 'failed' | 'timeout';
  retryCount?: number;
}) {
  trackEvent('sdk_api_latency', params);
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
