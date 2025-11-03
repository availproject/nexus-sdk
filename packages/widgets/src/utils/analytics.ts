// analytics.ts
// Custom OpenPanel integration for Avail Nexus SDK

import { NexusNetwork } from '@nexus/commons';
import { OpenPanel } from '@openpanel/web';
import { ActiveTransaction } from 'src/types';

const OPENPANEL_CONFIG = {
  apiURL: 'https://analytics.availproject.org/api',
  clientId: '5e2f37bc-227e-49cc-9611-637d3614231f',
};

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
        sdkVersion: '0.0.6-beta.2',
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

    op.track('nexus-widgets', body);
  } catch (error) {
    console.error('❌ Analytics tracking error:', error);
  }
}

// Track Initialized
export function trackSDKInitialized(config: { network: NexusNetwork; debug: boolean }) {
  trackEvent('nexus-widgets-initialized', config);
}

// Track DeInitialized
export function trackSdkDeInitialized(config: { network: NexusNetwork; debug: boolean }) {
  trackEvent('nexus-widgets-deInitialized', config);
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
  trackEvent(`nexus_widgets-error-${context.function}-failed`, config, {
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

export function trackTransactionDetails(
  config: { network: NexusNetwork; debug: boolean },
  params: ActiveTransaction,
) {
  trackEvent('nexus-widgets-transaction', config, params);
}

// Widget flows
export function trackWidgetInitiated(
  config: { network: NexusNetwork; debug: boolean },
  widgetType: string,
) {
  trackEvent('nexus-widgets-initiated', config, { widgetType });
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
