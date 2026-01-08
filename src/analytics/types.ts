/**
 * Analytics type definitions for Nexus SDK
 */

import type { AnalyticsNetwork } from './AnalyticsManager';

/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /** Enable or disable analytics tracking (default: true) */
  enabled?: boolean;

  /**
   * PostHog API key (optional - uses Avail's default key if not provided)
   * By default, all SDK telemetry goes to Avail's PostHog instance
   * You can override this with your own key for custom analytics
   */
  posthogApiKey?: string;

  /**
   * PostHog API host (optional - uses Avail's PostHog instance by default)
   */
  posthogApiHost?: string;

  /** Application metadata */
  appMetadata?: {
    appName?: string;
    appVersion?: string;
    appUrl?: string;
  };

  /** Privacy options */
  privacy?: {
    /** Anonymize wallet addresses by hashing */
    anonymizeWallets?: boolean;
    /** Exclude transaction amounts from analytics */
    anonymizeAmounts?: boolean;
  };

  /** Enable session recording (default: false) */
  sessionRecording?: boolean;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Standard properties included in every event
 */
export interface BaseEventProperties {
  sdkVersion: string;
  network: AnalyticsNetwork;
  appName?: string;
  appUrl?: string;
  timestamp: string;
  sessionId?: string;
  environment?: string;
}

/**
 * Wallet-related properties
 */
export interface WalletProperties {
  walletAddress: string;
  walletType?: string;
  chainId?: number;
  chainName?: string;
}

/**
 * Transaction-related properties
 */
export interface TransactionProperties {
  token: string;
  amount: string | number;
  fromChainId?: number;
  toChainId: number;
  sourceChains?: number[];
  recipient?: string;
  txHash?: string;
  gasUsed?: string;
  fees?: string;
  duration?: number; // in milliseconds
  route?: string[];
  explorerUrl?: string;
}

/**
 * Error properties
 */
export interface ErrorProperties {
  errorType: string;
  errorMessage: string;
  errorStack?: string;
  errorCode?: string | number;
  operation?: string;
  context?: Record<string, unknown>;
}

/**
 * Performance properties
 */
export interface PerformanceProperties {
  [key: string]: unknown;
  operation: string;
  duration: number;
  success: boolean;
  errorMessage?: string;
  errorType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session properties
 */
export interface SessionProperties {
  [key: string]: unknown;
  sessionId: string;
  sessionDuration?: number;
  operationsAttempted?: number;
  operationsSucceeded?: number;
  successRate?: number;
  url?: string;
  referrer?: string;
}

/**
 * Balance properties
 */
export interface BalanceProperties {
  balanceCount?: number;
  totalBreakdowns?: number;
  chains?: number[];
  tokens?: string[];
  totalValueUsd?: number;
  timeSinceLastFetch?: number;
}

/**
 * Analytics provider interface
 */
export interface AnalyticsProvider {
  /**
   * Initialize the analytics provider
   */
  initialize(): void;

  /**
   * Track an event
   */
  track(event: string, properties?: Record<string, unknown>): void;

  /**
   * Identify a user
   */
  identify(userId: string, properties?: Record<string, unknown>): void;

  /**
   * Register global properties that are sent with every event
   */
  register(properties: Record<string, unknown>): void;

  /**
   * Reset user identification
   */
  reset(): void;

  /**
   * Check if the provider is initialized
   */
  isInitialized(): boolean;
}

/**
 * Operation tracking context
 */
export interface OperationContext {
  operationId: string;
  operationName: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}
