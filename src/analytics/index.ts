/**
 * Analytics module for Nexus SDK
 * Provides comprehensive tracking of SDK operations and user behavior
 */

// Main analytics manager
export { AnalyticsManager } from './AnalyticsManager';
export type { NexusAnalyticsEvent } from './events';
// Event constants
export { NexusAnalyticsEvents } from './events';
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
  ErrorProperties,
  OperationContext,
  PerformanceProperties,
  SessionProperties,
  TransactionProperties,
  WalletProperties,
} from './types';
export {
  calculateUsdValue,
  extractBreakdownStats,
  extractErrorCode,
  extractIntentProperties,
  getWalletType,
  sanitizeUrl,
} from './utils';
