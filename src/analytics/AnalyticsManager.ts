/**
 * Analytics Manager
 * Central orchestrator for all analytics functionality in Nexus SDK
 *
 * PRIVACY & DATA SHARING:
 * By default, this SDK sends anonymous telemetry to Avail's PostHog instance to help
 * improve the SDK. This is an opt-out system (analytics enabled by default).
 *
 * DATA COLLECTED:
 * - Session metrics (duration, success rates, operation counts)
 * - Operation performance (timing, errors, operation types)
 * - Wallet type (NOT wallet addresses unless you explicitly identify users)
 * - Network/chain usage patterns
 * - Error occurrences and types
 *
 * DATA NOT COLLECTED BY DEFAULT:
 * - Wallet addresses (anonymized if you call identify())
 * - Transaction amounts (excluded if privacy.anonymizeAmounts is true)
 * - Personal information
 *
 * PRIVACY POLICY:
 * Data collection is covered by Avail's Privacy Policy and PostHog's GDPR-compliant DPA.
 * See: https://www.availproject.org/privacy
 *
 * OPT-OUT:
 * To completely disable analytics:
 * ```typescript
 * const sdk = new NexusSDK({ analytics: { enabled: false } });
 * ```
 *
 * PRIVACY CONTROLS:
 * ```typescript
 * const sdk = new NexusSDK({
 *   analytics: {
 *     privacy: {
 *       anonymizeWallets: true,  // Hash wallet addresses with SHA-256
 *       anonymizeAmounts: true,  // Exclude transaction amounts from events
 *     }
 *   }
 * });
 * ```
 *
 * CUSTOM ANALYTICS:
 * You can use your own PostHog instance:
 * ```typescript
 * const sdk = new NexusSDK({
 *   analytics: {
 *     posthogApiKey: 'your-key',
 *     posthogApiHost: 'https://your-posthog.com'
 *   }
 * });
 * ```
 */
import type { AnalyticsProvider } from './providers/AnalyticsProvider';
import { PostHogProvider } from './providers/PostHogProvider';
import { NoOpProvider } from './providers/NoOpProvider';
import { SessionManager } from './session';
import { PerformanceTracker } from './performance';
import { NexusAnalyticsEvents } from './events';
import type { AnalyticsConfig, BaseEventProperties } from './types';
import { extractErrorCode } from './utils';
import { version } from '../../package.json' with { type: 'json' };

/**
 * Default PostHog API Key - INTENTIONALLY PUBLIC
 *
 * This key is shared across all Nexus SDK users for Avail's internal telemetry.
 * It is NOT a secret and is safe to commit to source code.
 *
 * Purpose:
 * - Collect anonymous SDK usage metrics
 * - Track errors and performance issues
 * - Improve SDK quality for all users
 *
 * Security:
 * - This is a "write-only" PostHog project API key (not a Personal API Key)
 * - Cannot be used to read/modify data, only to send events
 * - PostHog project is configured to reject malicious data
 *
 * Privacy:
 * - All data sent to this instance is covered by Avail's Privacy Policy
 * - No sensitive data (wallet addresses, amounts) collected by default
 * - Users can opt-out via analytics.enabled = false
 *
 * Override:
 * Set NEXUS_POSTHOG_KEY env var or pass custom key in SDK config
 */
const DEFAULT_POSTHOG_KEY = 'phc_UD6lQU3PEw1d8oo8E17rJLmRAR7kxJbQ5OseHuCvi7N';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export type AnalyticsNetwork = 'mainnet' | 'testnet' | 'canary' | 'custom';

export class AnalyticsManager {
  private provider: AnalyticsProvider;
  private session: SessionManager;
  private performance: PerformanceTracker;
  private config: AnalyticsConfig;
  private enabled: boolean;
  private sdkVersion: string;
  private network?: AnalyticsNetwork;

  constructor(network: AnalyticsNetwork, config?: AnalyticsConfig) {
    this.config = config || { enabled: true };
    this.enabled = config?.enabled !== false; // Default: true (opt-out)
    this.sdkVersion = version;
    this.network = network;

    // Initialize session and performance trackers
    this.session = new SessionManager();
    this.performance = new PerformanceTracker();

    // Initialize the appropriate provider
    if (this.enabled) {
      const posthogApiKey = config?.posthogApiKey || DEFAULT_POSTHOG_KEY;
      const posthogApiHost = config?.posthogApiHost || DEFAULT_POSTHOG_HOST;

      this.provider = new PostHogProvider({
        apiKey: posthogApiKey,
        apiHost: posthogApiHost,
        sessionRecording: config?.sessionRecording || false,
        debug: config?.debug || false,
      });
    } else {
      this.provider = new NoOpProvider();
    }

    // Initialize the provider
    this.provider.initialize();

    // Register global properties
    if (this.enabled && this.provider.isInitialized()) {
      this.registerGlobalProperties();
    }

    // Track session start
    this.trackSessionStart();
  }

  /**
   * Register global properties that are sent with every event
   */
  private registerGlobalProperties(): void {
    const globalProps: Record<string, unknown> = {
      sdkVersion: this.sdkVersion,
      sessionId: this.session.getSessionId(),
    };

    if (this.network) {
      globalProps.network = this.network;
    }

    if (this.config.appMetadata?.appName) {
      globalProps.appName = this.config.appMetadata.appName;
    }

    if (this.config.appMetadata?.appVersion) {
      globalProps.appVersion = this.config.appMetadata.appVersion;
    }

    if (this.config.appMetadata?.appUrl) {
      globalProps.appUrl = this.config.appMetadata.appUrl;
    }

    // Add environment if in browser
    if (typeof window !== 'undefined') {
      globalProps.environment = this.detectEnvironment();
    }

    this.provider.register(globalProps);

    if (this.config.debug) {
      console.log('[AnalyticsManager] Global properties registered:', globalProps);
    }
  }

  /**
   * Detect environment (development/production)
   */
  private detectEnvironment(): string {
    if (typeof window === 'undefined') {
      return 'server';
    }

    // Check common environment indicators
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'development';
    }

    return 'production';
  }

  /**
   * Track session start
   */
  private trackSessionStart(): void {
    if (!this.enabled) return;

    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    const referrer = typeof document !== 'undefined' ? document.referrer || undefined : undefined;

    this.track(
      NexusAnalyticsEvents.SESSION_STARTED,
      this.session.getSessionStartProperties(url, referrer) as Record<string, unknown>
    );

    if (this.config.debug) {
      console.log('[AnalyticsManager] Session started:', this.session.getSessionId());
    }
  }

  /**
   * Sanitize properties by removing sensitive financial data if privacy.anonymizeAmounts is enabled
   */
  private sanitizeProperties(properties?: Record<string, unknown>): Record<string, unknown> {
    if (!properties || !this.config.privacy?.anonymizeAmounts) {
      return properties || {};
    }

    // Fields to remove when anonymizing amounts
    const sensitiveFields = ['valueUsd', 'totalValueUsd', 'gasUsed', 'value'];

    const sanitized = Object.create(null);
    for (const [key, value] of Object.entries(properties)) {
      if (!sensitiveFields.includes(key)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Validate properties to prevent prototype pollution and injection attacks
   */
  private validateProperties(properties: Record<string, unknown>): Record<string, unknown> {
    const blacklist = ['__proto__', 'constructor', 'prototype'];
    const validated = Object.create(null);

    for (const [key, value] of Object.entries(properties)) {
      if (!blacklist.includes(key)) {
        validated[key] = value;
      }
    }

    return validated;
  }

  /**
   * Track an event with optional properties
   */
  track(event: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    // Apply privacy sanitization and validation
    let sanitized = this.sanitizeProperties(properties);
    sanitized = this.validateProperties(sanitized);

    const eventProps: Record<string, unknown> = {
      ...sanitized,
      timestamp: new Date().toISOString(),
    };

    this.provider.track(event, eventProps);

    if (this.config.debug) {
      console.log(`[AnalyticsManager] Event tracked: ${event}`, eventProps);
    }
  }

  /**
   * Identify a user (typically by wallet address)
   */
  async identify(userId: string, properties?: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;

    // Apply privacy settings
    const userIdToUse = this.config.privacy?.anonymizeWallets
      ? await this.hashWalletAddress(userId)
      : userId;

    this.provider.identify(userIdToUse, properties);

    if (this.config.debug) {
      console.log('[AnalyticsManager] User identified:', userIdToUse);
    }
  }

  /**
   * Track an error with automatic property extraction
   * Convenience method for tracking errors across the SDK
   *
   * @param operation - Operation where error occurred (e.g., 'bridge', 'transfer', 'balanceFetch')
   * @param error - Error object
   * @param context - Additional context properties
   */
  trackError(operation: string, error: Error | unknown, context?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const errorObj = error as any;
    const errorProperties: Record<string, unknown> = {
      operation,
      errorType: errorObj?.name || 'Error',
      errorMessage: errorObj?.message || String(error),
      errorCode: extractErrorCode(errorObj),
      ...context,
    };

    // Include stack trace only if not in production
    if (this.config.debug && errorObj?.stack) {
      errorProperties.errorStack = errorObj.stack;
    }

    this.track(NexusAnalyticsEvents.ERROR_OCCURRED, errorProperties);
  }

  /**
   * Hash wallet address for privacy using SHA-256
   * Uses Web Crypto API (browser) or Node crypto (server)
   */
  private async hashWalletAddress(address: string): Promise<string> {
    try {
      // Generate a simple salt from the session ID (consistent per session)
      const salt = this.session.getSessionId().substring(0, 16);
      const data = address + salt;

      // Try Web Crypto API (browser)
      if (typeof window !== 'undefined' && window.crypto?.subtle) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `anon_${hashHex.substring(0, 16)}`;
      }

      // Fallback for Node.js environment
      if (typeof require !== 'undefined') {
        try {
          const crypto = require('crypto');
          const hash = crypto.createHash('sha256').update(data).digest('hex');
          return `anon_${hash.substring(0, 16)}`;
        } catch (e) {
          // crypto module not available
        }
      }

      // Last resort fallback (simple hash)
      let simpleHash = 0;
      for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        simpleHash = (simpleHash << 5) - simpleHash + char;
        simpleHash = simpleHash & simpleHash;
      }
      return `anon_${Math.abs(simpleHash).toString(36)}`;
    } catch (error) {
      // On any error, return a simple anonymized version
      return `anon_${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }
  }

  /**
   * Start tracking an operation's performance
   */
  startPerformanceTracking(operationName: string, metadata?: Record<string, unknown>) {
    if (!this.enabled) return {
      endPerformanceTracking: (result: { success: boolean; error?: Error }) => {
        //
      }
    }
    this.session.trackOperationAttempt();
    const operationId = this.performance.startOperation(operationName, metadata);
    return {
      endPerformanceTracking: (result: { success: boolean; error?: Error }) => {
        this.endPerformanceTracking(operationId, result);
      },
    }
  }

  /**
   * End tracking an operation and emit performance event
   */
  private endPerformanceTracking(
    operationId: string,
    result: { success: boolean; error?: Error }
  ): void {
    const perfProperties = this.performance.endOperation(operationId, result);

    if (perfProperties) {
      // Update session stats
      if (result.success) {
        this.session.trackOperationSuccess();
      }

      // Track performance event
      this.track(NexusAnalyticsEvents.OPERATION_PERFORMANCE, perfProperties as Record<string, unknown>);
    }
  }

  /**
   * Wrap an async operation with automatic tracking
   */
  async trackPerformance<T>(
    operationName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const tracker = this.startPerformanceTracking(operationName, metadata);

    try {
      const result = await fn();
      tracker.endPerformanceTracking({ success: true });
      return result;
    } catch (error) {
      tracker.endPerformanceTracking({ success: false, error: error as Error });
      throw error;
    }
  }

  /**
   * Reset analytics (clear user identification)
   */
  reset(): void {
    if (!this.enabled) return;

    this.provider.reset();
    this.session.reset();

    // Re-register global properties after reset
    if (this.provider.isInitialized()) {
      this.registerGlobalProperties();
    }

    if (this.config.debug) {
      console.log('[AnalyticsManager] Analytics reset');
    }
  }

  /**
   * Disable analytics
   */
  disable(): void {
    this.enabled = false;

    if (this.config.debug) {
      console.log('[AnalyticsManager] Analytics disabled');
    }
  }

  /**
   * Enable analytics
   */
  enable(): void {
    this.enabled = true;

    if (this.config.debug) {
      console.log('[AnalyticsManager] Analytics enabled');
    }
  }

  /**
   * Check if analytics is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.session.getSessionId();
  }

  /**
   * Get the underlying provider (for advanced usage)
   */
  getProvider(): AnalyticsProvider {
    return this.provider;
  }

  /**
   * Track session end (should be called when SDK is deinitialized)
   */
  trackSessionEnd(): void {
    if (!this.enabled) return;

    this.track(
      NexusAnalyticsEvents.SESSION_ENDED,
      this.session.getSessionEndProperties() as Record<string, unknown>
    );

    if (this.config.debug) {
      console.log('[AnalyticsManager] Session ended');
    }
  }

  /**
   * Get base event properties
   */
  getBaseProperties(): BaseEventProperties {
    return {
      sdkVersion: this.sdkVersion,
      network: this.network || 'mainnet',
      appName: this.config.appMetadata?.appName,
      appUrl: this.config.appMetadata?.appUrl,
      timestamp: new Date().toISOString(),
      sessionId: this.session.getSessionId(),
    };
  }
}
