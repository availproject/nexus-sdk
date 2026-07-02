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
 * const sdk = createNexusClient({ analytics: { enabled: false } });
 * ```
 *
 * AUTO-DISABLE IN DEV / TEST / LOCALHOST:
 * By default the SDK auto-disables in non-browser, on `NODE_ENV` of
 * test/ci/development, and on localhost. To force-emit (e.g. to test analytics
 * from local dev or a Vercel preview), set `mode: 'on'`. To force-disable
 * regardless of environment, set `mode: 'off'` (equivalent to `enabled: false`).
 * `enabled: false` always wins over `mode: 'on'`.
 * ```typescript
 * const sdk = createNexusClient({ analytics: { mode: 'on' } });
 * ```
 *
 * PRIVACY CONTROLS:
 * ```typescript
 * const sdk = createNexusClient({
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
 * const sdk = createNexusClient({
 *   analytics: {
 *     posthogApiKey: 'your-key',
 *     posthogApiHost: 'https://your-posthog.com'
 *   }
 * });
 * ```
 */

import { clamp, omit } from 'es-toolkit';
import { version } from '../../package.json' with { type: 'json' };
import type { ChainListType, TimingSpanHooks } from '../domain';
import { type OperationName, toError } from '../domain/errors';
import { getLogger } from '../domain/utils/logger';
import { reportOperationError } from '../services/error-telemetry';
import type { NexusOperationName } from './events';
import { type NexusAnalyticsEvent, NexusAnalyticsEvents } from './events';
import { PerformanceTracker } from './performance';
import type { AnalyticsProvider } from './providers/AnalyticsProvider';
import { NoOpProvider } from './providers/NoOpProvider';
import { PostHogProvider } from './providers/PostHogProvider';
import { SessionManager } from './session';
import type {
  AnalyticsConfig,
  BaseEventProperties,
  DevTimingConfig,
  SpanProperties,
} from './types';
import {
  anonymizeWalletAddress,
  normalizeAddresses,
  sanitizeUrl,
  serializeForAnalytics,
} from './utils';

// Codes/messages that represent the integrator calling `deny()` on the
// onIntent hook. Post-rev 10 `Errors.userDeniedIntent()` throws a typed
// UserActionError with code `'user_action/intent_hook_denied'`; the legacy
// entries cover branches/flows that may still throw the pre-rev 10 shape.
const PLAN_REJECTED_CODES = new Set(['user_action/intent_hook_denied', 'USER_DENIED_INTENT']);
const PLAN_REJECTED_MESSAGES = new Set([
  'User rejected the intent.', // rev 10 UserActionError default message
  'User denied swap intent', // pre-rev 10 plain Error
]);

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
const logger = getLogger();

export type AnalyticsNetwork = 'mainnet' | 'testnet' | 'canary' | 'custom';

/**
 * Strips error fields (`errorMessage`, `errorType`) from a span before the
 * `OPERATION_PERFORMANCE` payload reaches PostHog. The SigNoz/PostHog
 * boundary is intentional: SigNoz holds error details (via
 * `reportOperationError` in `services/error-telemetry`), PostHog holds the
 * outcome. Exported so unit tests can assert the filter directly without
 * reaching through a full `trackBridge` flow.
 */
export function sanitizePerformanceSpanForPostHog(span: SpanProperties): Record<string, unknown> {
  const { errorMessage: _errorMessage, errorType: _errorType, ...payload } = span;
  return payload as Record<string, unknown>;
}

export class AnalyticsManager {
  private provider: AnalyticsProvider;
  private session: SessionManager;
  private performance: PerformanceTracker;
  private config: AnalyticsConfig;
  private devTiming: Required<Omit<DevTimingConfig, 'onSpanComplete'>> &
    Pick<DevTimingConfig, 'onSpanComplete'>;
  private enabled: boolean;
  private sdkVersion: string;
  private network?: AnalyticsNetwork;
  private chainListGetter?: () => ChainListType | null | undefined;

  constructor(
    network: AnalyticsNetwork,
    config?: AnalyticsConfig,
    devTiming?: DevTimingConfig,
    chainListGetter?: () => ChainListType | null | undefined
  ) {
    this.chainListGetter = chainListGetter;
    this.config = config || { enabled: true };
    this.devTiming = this.resolveDevTimingConfig(devTiming);
    this.enabled = config?.enabled !== false; // Default: true (opt-out)

    // `mode` controls the auto-detection policy. `'on'` bypasses the env
    // guard (useful for testing analytics from local dev). `'off'` always
    // disables. `'auto'` (default) runs the env guard below.
    const mode = config?.mode ?? 'auto';
    if (this.enabled && mode === 'off') {
      this.enabled = false;
    } else if (this.enabled && mode === 'auto') {
      // Disable outside the browser, on NODE_ENV test/ci/development, and on
      // localhost.
      if (typeof window === 'undefined') {
        this.enabled = false;
      } else {
        const nodeEnv =
          typeof process !== 'undefined' && process.env ? process.env.NODE_ENV : undefined;
        if (nodeEnv === 'test' || nodeEnv === 'ci' || nodeEnv === 'development') {
          this.enabled = false;
        } else {
          const host = window.location?.hostname ?? '';
          if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
            this.enabled = false;
          }
        }
      }
    }

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

  private resolveDevTimingConfig(
    config?: DevTimingConfig
  ): Required<Omit<DevTimingConfig, 'onSpanComplete'>> & Pick<DevTimingConfig, 'onSpanComplete'> {
    const sampleRate = config?.sampleRate ?? 1;
    return {
      enabled: config?.enabled ?? false,
      emitAnalytics: config?.emitAnalytics ?? true,
      emitLogs: config?.emitLogs ?? true,
      captureNetworkTiming: config?.captureNetworkTiming ?? true,
      verbose: config?.verbose ?? false,
      sampleRate: clamp(sampleRate, 0, 1),
      onSpanComplete: config?.onSpanComplete,
    };
  }

  private shouldCollectDevTimingSample(): boolean {
    if (!this.devTiming.enabled) {
      return false;
    }
    if (this.devTiming.sampleRate >= 1) {
      return true;
    }
    return Math.random() <= this.devTiming.sampleRate;
  }

  private emitSpanCompletion(
    span: SpanProperties,
    options?: { alwaysEmitAnalytics?: boolean }
  ): void {
    // Analytics sink (legacy operation tracking always emits when analytics is enabled).
    // The PostHog payload runs through `sanitizePerformanceSpanForPostHog` so error
    // fields don't ride along. The full `SpanProperties` (with `errorMessage` /
    // `errorType`) is still passed to the dev-timing log + `onSpanComplete` callback
    // below for local debugging.
    if (
      this.enabled &&
      (options?.alwaysEmitAnalytics ||
        (this.devTiming.enabled && this.devTiming.emitAnalytics !== false))
    ) {
      this.track(
        NexusAnalyticsEvents.OPERATION_PERFORMANCE,
        sanitizePerformanceSpanForPostHog(span)
      );
    }

    // Dev timing sinks (logs/callback) are opt-in and independent from analytics transport
    if (!this.devTiming.enabled) {
      return;
    }

    if (this.devTiming.emitLogs !== false) {
      logger.info('dev_timing.span_complete', {
        name: span.operation,
        duration: span.duration,
        success: span.success,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        rootSpanId: span.rootSpanId,
        tags: span.tags,
        errorType: span.errorType,
      });
    }

    if (this.devTiming.onSpanComplete) {
      try {
        this.devTiming.onSpanComplete(span);
      } catch (error) {
        logger.warn('dev_timing.onSpanComplete callback failed', { error });
      }
    }
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
      globalProps.appUrl = sanitizeUrl(this.config.appMetadata.appUrl);
    }

    // Add environment if in browser
    if (typeof window !== 'undefined') {
      globalProps.environment = this.detectEnvironment();
    }

    this.provider.register(globalProps);

    if (this.config.debug) {
      logger.debug('[AnalyticsManager] Global properties registered', globalProps);
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

    // Strip query params and fragments before sending the URL to analytics.
    const rawUrl = typeof window !== 'undefined' ? window.location.href : undefined;
    const url = rawUrl ? sanitizeUrl(rawUrl) : undefined;
    const rawReferrer =
      typeof document !== 'undefined' ? document.referrer || undefined : undefined;
    const referrer = rawReferrer ? sanitizeUrl(rawReferrer) : undefined;

    this.track(
      NexusAnalyticsEvents.SESSION_STARTED,
      this.session.getSessionStartProperties(url, referrer) as Record<string, unknown>
    );

    if (this.config.debug) {
      logger.debug('[AnalyticsManager] Session started', {
        sessionId: this.session.getSessionId(),
      });
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
    return Object.assign(Object.create(null), omit(properties, sensitiveFields));
  }

  /**
   * Validate properties to prevent prototype pollution and injection attacks
   */
  private validateProperties(properties: Record<string, unknown>): Record<string, unknown> {
    const blacklist = ['__proto__', 'constructor', 'prototype'];
    return Object.assign(Object.create(null), omit(properties, blacklist));
  }

  // Looks up a chain name from the SDK-provided chain list. Returns undefined
  // when the chain isn't supported or the list isn't initialized yet, so
  // callers can keep emitting events with just the chain id.
  private resolveChainName(chainId: unknown): string | undefined {
    if (typeof chainId !== 'number') return undefined;
    const chainList = this.chainListGetter?.();
    if (!chainList) return undefined;
    try {
      return chainList.getChainByID(chainId).name;
    } catch {
      return undefined;
    }
  }

  // Auto-fill chainName / toChainName so call sites only need to pass the
  // numeric chain id. Existing names are preserved.
  private enrichChainNames(properties: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...properties };
    if (typeof next.chainId === 'number' && next.chainName === undefined) {
      const name = this.resolveChainName(next.chainId);
      if (name !== undefined) next.chainName = name;
    }
    if (typeof next.toChainId === 'number' && next.toChainName === undefined) {
      const name = this.resolveChainName(next.toChainId);
      if (name !== undefined) next.toChainName = name;
    }
    return next;
  }

  /**
   * Track an event with optional properties
   */
  track(event: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    // Apply privacy sanitization and validation
    let sanitized = this.sanitizeProperties(properties);
    sanitized = this.validateProperties(sanitized);
    sanitized = this.enrichChainNames(sanitized);

    const eventProps: Record<string, unknown> = {
      ...sanitized,
      timestamp: new Date().toISOString(),
    };

    // Convert bigints to strings; PostHog serializes payloads as JSON.
    const serialized = serializeForAnalytics(eventProps) as Record<string, unknown>;

    // Lowercase 0x-addresses; hash known user-wallet fields when
    // anonymizeWallets is set.
    const normalized = normalizeAddresses(serialized, {
      hashUserWallets: !!this.config.privacy?.anonymizeWallets,
      salt: this.session.getSessionId().substring(0, 16),
    }) as Record<string, unknown>;

    this.provider.track(event, normalized);

    if (this.config.debug) {
      logger.debug(`[AnalyticsManager] Event tracked: ${event}`, eventProps);
    }
  }

  /**
   * Identify a user (typically by wallet address). Anonymization uses the
   * same hash as event-payload normalization so the user id and any payload
   * `walletAddress` field collapse to the same `anon_<hex>` — dashboards can
   * correlate them.
   */
  identify(userId: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const userIdToUse = this.config.privacy?.anonymizeWallets
      ? anonymizeWalletAddress(userId, this.session.getSessionId().substring(0, 16))
      : userId;

    const enriched = properties ? this.enrichChainNames(properties) : properties;
    this.provider.identify(userIdToUse, enriched);

    if (this.config.debug) {
      logger.debug('[AnalyticsManager] User identified', { userId: userIdToUse });
    }
  }

  /**
   * Associates the current user with a group (PostHog Groups feature). Safe
   * to call before identify().
   * @param groupType - The group taxonomy (e.g. `'dapp'`, `'chain'`).
   * @param groupKey - The group identifier within the type.
   * @param properties - Optional group properties to register/update.
   */
  group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.provider.group?.(groupType, groupKey, properties);
    if (this.config.debug) {
      logger.debug('[AnalyticsManager] Group set', { groupType, groupKey });
    }
  }

  /**
   * Registers an alias for the current distinct id. Call before identify() to
   * attribute pre-identify events to the resulting user.
   * @param aliasId - The new id to alias (typically the wallet address).
   */
  alias(aliasId: string): void {
    if (!this.enabled) return;
    this.provider.alias?.(aliasId);
  }

  /**
   * Fires `*_PLAN_REJECTED` when the error represents the integrator calling
   * `deny()` on the onIntent hook (rev 10 typed `user_action/intent_hook_denied`,
   * the legacy `USER_DENIED_INTENT` code, or the matching plain Error messages).
   * No-op otherwise. The event payload is intentionally empty — the event name
   * itself conveys "user rejected"; any error code/message belongs in SigNoz.
   */
  private trackPlanRejectedIfApplicable(error: unknown, planRejectedEvent: string): void {
    if (!this.enabled) return;
    if (!error || typeof error !== 'object') return;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && PLAN_REJECTED_CODES.has(code)) {
      this.track(planRejectedEvent);
      return;
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && PLAN_REJECTED_MESSAGES.has(message)) {
      this.track(planRejectedEvent);
    }
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
  endOperation(operationId: string, result: { success: boolean; error?: Error }): void {
    try {
      const perfProperties = this.performance.endOperation(operationId, result);
      if (perfProperties) {
        if (result.success) {
          this.session.trackOperationSuccess();
        }
        this.emitSpanCompletion(perfProperties as SpanProperties, { alwaysEmitAnalytics: true });
      }
    } catch (error) {
      logger.warn('AnalyticsManager.endOperation failed', { operationId, error });
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

  isDevTimingEnabled(): boolean {
    return this.devTiming.enabled;
  }

  startSpan(
    name: string,
    options?: { parentSpanId?: string; tags?: Record<string, string | number | boolean> }
  ): string {
    if (!this.shouldCollectDevTimingSample()) {
      return '';
    }
    this.session.trackOperationAttempt();
    try {
      return this.performance.startSpan(name, options);
    } catch (error) {
      logger.warn('AnalyticsManager.startSpan failed', { name, error });
      return '';
    }
  }

  endSpan(spanId: string, result: { success: boolean; error?: Error }): SpanProperties | null {
    if (!spanId) {
      return null;
    }
    try {
      const span = this.performance.endSpan(spanId, result);
      if (!span) {
        return null;
      }
      if (result.success) {
        this.session.trackOperationSuccess();
      }
      this.emitSpanCompletion(span);
      return span;
    } catch (error) {
      logger.warn('AnalyticsManager.endSpan failed', { spanId, error });
      return null;
    }
  }

  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    options?: { parentSpanId?: string; tags?: Record<string, string | number | boolean> }
  ): Promise<T> {
    const spanId = this.startSpan(name, options);
    try {
      const result = await fn();
      this.endSpan(spanId, { success: true });
      return result;
    } catch (error) {
      this.endSpan(spanId, { success: false, error: error as Error });
      throw error;
    }
  }

  /**
   * Returns a `TimingSpanHooks` whose `startSpan` / `withSpan` calls default
   * `parentSpanId` to the given id. Explicit caller opts override (so flow
   * code that passes its own `parentSpanId` for nested sub-trees keeps
   * working). Used by `runOp` so flow files don't need to know which
   * public-op invocation they're running under — the parent comes from the
   * scoped hook injected into `deps.timing`.
   *
   * @internal Boundary plumbing used by `src/core/sdk/operation-boundary.ts`
   *   and `src/core/sdk/base.ts` to wire dev-timing parents. Not a stable
   *   integrator-facing API — keep callers inside the SDK.
   */
  scopedTimingHooks(parentSpanId?: string): TimingSpanHooks {
    return {
      startSpan: (name, opts) =>
        this.startSpan(name, parentSpanId ? { parentSpanId, ...opts } : opts),
      endSpan: (spanId, result) => this.endSpan(spanId, result),
      withSpan: <T>(
        name: string,
        fn: () => Promise<T>,
        opts?: Parameters<TimingSpanHooks['withSpan']>[2]
      ) => this.withSpan(name, fn, parentSpanId ? { parentSpanId, ...opts } : opts),
    };
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
      logger.debug('[AnalyticsManager] Analytics reset');
    }
  }

  /**
   * Disable analytics
   */
  disable(): void {
    this.enabled = false;

    if (this.config.debug) {
      logger.debug('[AnalyticsManager] Analytics disabled');
    }
  }

  /**
   * Enable analytics
   */
  enable(): void {
    this.enabled = true;

    if (this.config.debug) {
      logger.debug('[AnalyticsManager] Analytics enabled');
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
      logger.debug('[AnalyticsManager] Session ended');
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

  // ──────────────────────────────────────────────────────────────────────────
  // Boundary orchestration
  //
  // Public-op wrappers live in `src/core/sdk/operation-boundary.ts` (so the
  // analytics layer stays generic and doesn't import core/swap types). Those
  // wrappers call `runOp` which owns the full lifecycle: `track(INITIATED)` →
  // `startOperation` → run → `track(SUCCESS)` + `endOperation(success)` on
  // the happy path, or `trackPlanRejectedIfApplicable` (when configured) +
  // `track(FAILED)` + `reportOperationError` + `endOperation(failure)` +
  // `throw` on the catch path. PostHog payloads carry only input-param
  // context — error details (message, code, category, step ids) flow
  // exclusively through OTel.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @internal Boundary plumbing used by `src/core/sdk/operation-boundary.ts`.
   *   The lifecycle contract (initiated → start → run → success/failed +
   *   endOperation + throw) is the load-bearing piece — do not call from
   *   integrator code or sketch out a parallel boundary on top of it.
   *   If a new public op needs tracking, add a typed wrapper in
   *   `operation-boundary.ts` that delegates here.
   */
  async runOp<TResult>(cfg: {
    events: {
      initiated?: NexusAnalyticsEvent;
      success: NexusAnalyticsEvent;
      failed: NexusAnalyticsEvent;
      planRejected?: NexusAnalyticsEvent;
    };
    opName: NexusOperationName;
    operation: OperationName;
    initiatedProps?: Record<string, unknown>;
    failedProps?: Record<string, unknown>;
    params?: unknown;
    options?: unknown;
    run: (opId: string) => Promise<TResult>;
    success?: (result: TResult) => Record<string, unknown>;
    selectSuccessEvent?: (result: TResult) => NexusAnalyticsEvent;
  }): Promise<TResult> {
    if (cfg.events.initiated) {
      this.track(cfg.events.initiated, cfg.initiatedProps);
    }
    const opId = this.startOperation(cfg.opName);
    try {
      const result = await cfg.run(opId);
      const successEvent = cfg.selectSuccessEvent?.(result) ?? cfg.events.success;
      const successAdditional = cfg.success?.(result) ?? {};
      this.track(successEvent, { ...(cfg.initiatedProps ?? {}), ...successAdditional });
      this.endOperation(opId, { success: true });
      return result;
    } catch (error) {
      if (cfg.events.planRejected) {
        this.trackPlanRejectedIfApplicable(error, cfg.events.planRejected);
      }
      this.track(cfg.events.failed, cfg.failedProps ?? cfg.initiatedProps);
      reportOperationError({
        operation: cfg.operation,
        operationId: opId,
        params: cfg.params,
        options: cfg.options,
        error,
      });
      this.endOperation(opId, { success: false, error: toError(error) });
      throw error;
    }
  }
}
