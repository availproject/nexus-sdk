/**
 * Analytics module for Nexus SDK
 * Provides comprehensive tracking of SDK operations and user behavior
 */

// Main analytics manager
export { AnalyticsManager } from './AnalyticsManager';
export {
  aggregateBySpanName,
  aggregateDurations,
  computePercentile,
  type PerformanceAggregates,
} from './aggregation';
export type { NexusAnalyticsEvent } from './events';
// Event constants
export { NexusAnalyticsEvents } from './events';
export { installAxiosNetworkTiming } from './network-timing';
export { PerformanceTracker } from './performance';
export type { AnalyticsProvider as IAnalyticsProvider } from './providers/AnalyticsProvider';
export { NoOpProvider } from './providers/NoOpProvider';
// Providers (for advanced usage)
export { PostHogProvider } from './providers/PostHogProvider';

// Utilities (for advanced usage)
export { SessionManager } from './session';
// Types
export type {
  AnalyticsConfig,
  AnalyticsProvider,
  BalanceProperties,
  BaseEventProperties,
  DevTimingConfig,
  ErrorProperties,
  OperationContext,
  PerformanceProperties,
  SessionProperties,
  SpanContext,
  SpanId,
  SpanProperties,
  SpanTags,
  TransactionProperties,
  WalletProperties,
} from './types';
export {
  calculateUsdValue,
  extractBreakdownStats,
  extractBridgeProperties,
  extractIntentProperties,
  getWalletType,
  sanitizeUrl,
} from './utils';
