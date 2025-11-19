/**
 * Analytics module for Nexus SDK
 * Provides comprehensive tracking of SDK operations and user behavior
 */

// Main analytics manager
export { AnalyticsManager } from './AnalyticsManager';

// Event constants
export { NexusAnalyticsEvents } from './events';
export type { NexusAnalyticsEvent } from './events';

// Types
export type {
  AnalyticsConfig,
  BaseEventProperties,
  WalletProperties,
  TransactionProperties,
  ErrorProperties,
  PerformanceProperties,
  SessionProperties,
  BalanceProperties,
  AnalyticsProvider,
  OperationContext,
} from './types';

// Providers (for advanced usage)
export { PostHogProvider } from './providers/PostHogProvider';
export { NoOpProvider } from './providers/NoOpProvider';
export type { AnalyticsProvider as IAnalyticsProvider } from './providers/AnalyticsProvider';

// Utilities (for advanced usage)
export { SessionManager } from './session';
export { PerformanceTracker } from './performance';
