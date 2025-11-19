/**
 * Analytics Manager
 * Central orchestrator for all analytics functionality in Nexus SDK
 */
import { AnalyticsProvider } from './providers/AnalyticsProvider';
import { PostHogProvider } from './providers/PostHogProvider';
import { NoOpProvider } from './providers/NoOpProvider';
import { SessionManager } from './session';
import { PerformanceTracker } from './performance';
import { NexusAnalyticsEvents } from './events';
import { AnalyticsConfig, BaseEventProperties } from './types';

// Default PostHog API key (Avail's shared analytics instance)
// This is Avail's PostHog project for collecting Nexus SDK telemetry
// All apps using Nexus SDK automatically send analytics to this instance
// Apps can override this with their own key if they want custom analytics
const DEFAULT_POSTHOG_KEY = process.env.NEXUS_POSTHOG_KEY || 'phc_6j3VAnM7MFbXQjLbCZZnIczqN3OswwGbWKKLTtKN5kQ';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export class AnalyticsManager {
  private provider: AnalyticsProvider;
  private session: SessionManager;
  private performance: PerformanceTracker;
  private config: AnalyticsConfig;
  private enabled: boolean;
  private sdkVersion: string;
  private network?: 'mainnet' | 'testnet';

  constructor(config?: AnalyticsConfig, sdkVersion: string = '0.0.1', network?: 'mainnet' | 'testnet') {
    this.config = config || { enabled: true };
    this.enabled = config?.enabled !== false; // Default: true (opt-out)
    this.sdkVersion = sdkVersion;
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
   * Track an event with optional properties
   */
  track(event: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const eventProps: Record<string, unknown> = {
      ...properties,
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
  identify(userId: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    // Apply privacy settings
    const userIdToUse = this.config.privacy?.anonymizeWallets
      ? this.hashWalletAddress(userId)
      : userId;

    this.provider.identify(userIdToUse, properties);

    if (this.config.debug) {
      console.log('[AnalyticsManager] User identified:', userIdToUse);
    }
  }

  /**
   * Hash wallet address for privacy
   */
  private hashWalletAddress(address: string): string {
    // Simple hash for anonymization
    // In production, consider using a more robust hashing algorithm
    let hash = 0;
    for (let i = 0; i < address.length; i++) {
      const char = address.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `anon_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Start tracking an operation's performance
   */
  startOperation(operationName: string, metadata?: Record<string, unknown>): string {
    this.session.trackOperationAttempt();
    return this.performance.startOperation(operationName, metadata);
  }

  /**
   * End tracking an operation and emit performance event
   */
  endOperation(
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
  async trackOperation<T>(
    operationName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const operationId = this.startOperation(operationName, metadata);

    try {
      const result = await fn();
      this.endOperation(operationId, { success: true });
      return result;
    } catch (error) {
      this.endOperation(operationId, { success: false, error: error as Error });
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
      network: this.network,
      appName: this.config.appMetadata?.appName,
      appUrl: this.config.appMetadata?.appUrl,
      timestamp: new Date().toISOString(),
      sessionId: this.session.getSessionId(),
    };
  }
}
