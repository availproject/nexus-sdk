/**
 * Analytics type definitions for Nexus SDK
 */

import type { AnalyticsNetwork } from './AnalyticsManager';

/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /**
   * Master kill switch (default: `true`). `enabled: false` always disables
   * regardless of `mode`.
   */
  enabled?: boolean;

  /**
   * Controls the auto-disable env guard (default: `'auto'`).
   *
   * - `'auto'` — disable in non-browser, on `NODE_ENV` test/ci/development,
   *   and on localhost.
   * - `'on'` — bypass the env guard; force-emit from any environment.
   * - `'off'` — bypass the env guard and force-disable.
   *
   * `enabled: false` wins over `mode: 'on'`.
   */
  mode?: 'auto' | 'on' | 'off';

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
  'nexus.network': AnalyticsNetwork;
  appName?: string;
  appUrl?: string;
  timestamp: string;
  sessionId?: string;
  environment?: string;
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

export type SpanId = string;

export type SpanTagValue = string | number | boolean;

export type SpanTags = Record<string, SpanTagValue>;

export interface SpanContext extends OperationContext {
  spanId: SpanId;
  parentSpanId?: SpanId;
  rootSpanId: SpanId;
  tags?: SpanTags;
  startedAtIso: string;
}

export interface SpanProperties extends PerformanceProperties {
  spanId: SpanId;
  parentSpanId?: SpanId;
  rootSpanId: SpanId;
  startedAtIso: string;
  endedAtIso: string;
  tags?: SpanTags;
}

export interface DevTimingConfig {
  /** Enable or disable developer timing instrumentation (default: false) */
  enabled?: boolean;
  /** Emit timing spans to analytics transport (default: true) */
  emitAnalytics?: boolean;
  /** Emit timing spans to logs (default: true) */
  emitLogs?: boolean;
  /** Capture network timing via transport interceptors (default: true) */
  captureNetworkTiming?: boolean;
  /** Enable verbose timing logs (default: false) */
  verbose?: boolean;
  /** Sample rate for span collection, from 0 to 1 (default: 1) */
  sampleRate?: number;
  /** Callback invoked when a span completes */
  onSpanComplete?: (span: SpanProperties) => void;
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
 * Operation tracking context
 */
export interface OperationContext {
  operationId: string;
  operationName: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}
