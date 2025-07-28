import type { 
  TelemetryClient, 
  TelemetryConfig, 
  TelemetryEvent, 
  TelemetryEventType,
  UserInteractionData,
  TransactionData,
  BridgeData,
  WalletData,
  UIData,
  TelemetryEventBuilder
} from '../types';
import { DEFAULT_TELEMETRY_CONFIG, TELEMETRY_ENDPOINTS } from './constants';
import { 
  generateEventId, 
  generateSessionId, 
  getCurrentTimestamp,
  shouldSampleEvent,
  shouldFilterEvent,
  anonymizeData,
  validateEvent,
  sanitizeEventData,
  getBrowserInfo,
  getDeviceInfo,
  debounce,
  throttle,
  batchEventsByPriority,
  compressEventData
} from './utils';
import { createStorageAdapter, MultiLevelStorageAdapter } from './storage';
import { createTransport, MultiTransport } from './transport';
import { createEventBuilder, createEventBuilders, EventBuilders } from './builder';
import { logger } from '../utils/logger';

/**
 * Main telemetry client implementation
 */
export class NexusTelemetryClient implements TelemetryClient {
  private config: TelemetryConfig;
  private storage: MultiLevelStorageAdapter;
  private transport: MultiTransport;
  private eventBuilders: EventBuilders;
  private eventQueue: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;
  private flushPromise: Promise<void> | null = null;

  constructor(config?: Partial<TelemetryConfig>) {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    
    // Initialize storage
    this.storage = new MultiLevelStorageAdapter([
      'localStorage',
      'sessionStorage', 
      'memory'
    ]);

    // Initialize transport
    const transports = [];
    
    if (this.config.enabled && this.config.endpoint) {
      transports.push(createTransport('http', {
        endpoint: this.config.endpoint,
        apiKey: this.config.apiKey,
        timeout: this.config.timeout,
        maxRetries: this.config.maxRetries,
        retryDelay: this.config.retryDelay,
      }));
    }

    if (this.config.enabled && this.config.endpoint) {
      transports.push(createTransport('beacon', {
        endpoint: this.config.endpoint,
        apiKey: this.config.apiKey,
      }));
    }

    if (this.config.enableConsole) {
      transports.push(createTransport('console', {
        prefix: '[Nexus Telemetry]',
      }));
    }

    if (transports.length === 0) {
      transports.push(createTransport('noop'));
    }

    this.transport = new MultiTransport(transports);

    // Initialize event builders
    this.eventBuilders = createEventBuilders({
      sessionId: this.config.sessionId,
      version: this.config.version,
      environment: this.config.environment,
      userId: this.config.userId,
      walletAddress: this.config.walletAddress,
      chainId: this.config.chainId,
      network: this.config.network,
    });

    // Set up automatic flushing
    this.setupAutoFlush();

    // Set up page unload handler
    this.setupPageUnloadHandler();

    // Track SDK initialization
    this.track('sdk_initialized', {
      config: this.config,
      browser: getBrowserInfo(),
      device: getDeviceInfo(),
    });
  }

  // Configuration methods
  configure(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update event builders with new config
    this.eventBuilders = createEventBuilders({
      sessionId: this.config.sessionId,
      version: this.config.version,
      environment: this.config.environment,
      userId: this.config.userId,
      walletAddress: this.config.walletAddress,
      chainId: this.config.chainId,
      network: this.config.network,
    });

    // Track configuration change
    this.track('privacy_settings_changed', { config: this.config });
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  enable(): void {
    this.config.enabled = true;
    this.track('telemetry_enabled');
  }

  disable(): void {
    this.config.enabled = false;
    this.track('telemetry_disabled');
  }

  // Event tracking methods
  track(eventType: TelemetryEventType, data?: Record<string, unknown>): void {
    if (!this.config.enabled || this.isDestroyed) {
      return;
    }

    // Check sampling
    if (!shouldSampleEvent(this.config.sampleRate || 1.0)) {
      return;
    }

    try {
      const event = this.createEvent(eventType, data);
      
      // Check filtering
      if (shouldFilterEvent(event, this.config)) {
        return;
      }

      // Apply transformers
      if (this.config.transformers?.beforeSend) {
        const transformed = this.config.transformers.beforeSend(event);
        if (transformed === null) {
          return;
        }
        event = transformed;
      }

      // Call hooks
      this.config.hooks?.onEventCreated?.(event);

      // Add to queue
      this.eventQueue.push(event);

      // Flush if queue is full
      if (this.eventQueue.length >= (this.config.batchSize || 10)) {
        this.flush();
      }
    } catch (error) {
      logger.error('Failed to track event', error);
    }
  }

  trackUserInteraction(component: string, action: string, data?: Partial<UserInteractionData>): void {
    this.track('ui_interaction', {
      component,
      action,
      ...data,
    });
  }

  trackTransaction(transactionData: Partial<TransactionData>): void {
    this.track('transaction_started', transactionData);
  }

  trackBridge(bridgeData: Partial<BridgeData>): void {
    this.track('bridge_initiated', bridgeData);
  }

  trackError(error: Error, context?: Record<string, unknown>): void {
    this.track('error_occurred', {
      errorType: error.constructor.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      context,
    });
  }

  trackPerformance(metric: string, value: number, unit: string = 'ms'): void {
    this.track('performance_metric', {
      metric,
      value,
      unit,
    });
  }

  trackNetwork(url: string, method: string, responseTime: number, statusCode?: number): void {
    this.track('network_response', {
      url,
      method,
      responseTime,
      statusCode,
    });
  }

  trackWallet(walletData: Partial<WalletData>): void {
    this.track('wallet_connected', walletData);
  }

  trackUI(uiData: Partial<UIData>): void {
    this.track('ui_interaction', uiData);
  }

  // Session management methods
  setSessionId(sessionId: string): void {
    this.config.sessionId = sessionId;
    this.storage.set('sessionId', sessionId);
  }

  setUserId(userId: string): void {
    this.config.userId = userId;
    this.storage.set('userId', userId);
  }

  setWalletAddress(address: string): void {
    this.config.walletAddress = address;
    this.storage.set('walletAddress', address);
  }

  setChainId(chainId: number): void {
    this.config.chainId = chainId;
    this.storage.set('chainId', chainId);
  }

  setNetwork(network: 'mainnet' | 'testnet'): void {
    this.config.network = network;
    this.storage.set('network', network);
  }

  // Privacy and consent methods
  setPrivacySettings(settings: Partial<TelemetryConfig['privacySettings']>): void {
    this.config.privacySettings = { ...this.config.privacySettings, ...settings };
    this.storage.set('privacySettings', this.config.privacySettings);
    this.track('privacy_settings_changed', { settings });
  }

  setAnalyticsConsent(consent: boolean): void {
    this.track('analytics_consent_changed', { consent });
  }

  setTelemetryConsent(consent: boolean): void {
    if (consent) {
      this.enable();
    } else {
      this.disable();
    }
  }

  // Batching and flushing methods
  async flush(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = this.performFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  async flushImmediate(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  // Utility methods
  generateEventId(): string {
    return generateEventId();
  }

  generateSessionId(): string {
    return generateSessionId();
  }

  getSessionId(): string {
    return this.config.sessionId;
  }

  getUserId(): string | undefined {
    return this.config.userId;
  }

  getWalletAddress(): string | undefined {
    return this.config.walletAddress;
  }

  getChainId(): number | undefined {
    return this.config.chainId;
  }

  getNetwork(): 'mainnet' | 'testnet' | undefined {
    return this.config.network;
  }

  // Cleanup
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
    
    // Clear storage
    await this.storage.clear();
  }

  // Private methods
  private createEvent(eventType: TelemetryEventType, data?: Record<string, unknown>): TelemetryEvent {
    const event = createEventBuilder({
      sessionId: this.config.sessionId,
      version: this.config.version,
      environment: this.config.environment,
      userId: this.config.userId,
      walletAddress: this.config.walletAddress,
      chainId: this.config.chainId,
      network: this.config.network,
    })
      .setType(eventType)
      .setData(data || {})
      .build();

    // Apply privacy settings
    if (this.config.privacySettings) {
      event.data = anonymizeData(event.data, this.config.privacySettings);
    }

    // Sanitize sensitive data
    event.data = sanitizeEventData(event.data);

    // Validate event
    const validation = validateEvent(event);
    if (!validation.isValid) {
      throw new Error(`Invalid telemetry event: ${validation.errors.join(', ')}`);
    }

    return event;
  }

  private async performFlush(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      // Batch events by priority
      const batches = batchEventsByPriority(events);
      
      for (const batch of batches) {
        if (batch.length === 0) continue;

        const batchData = {
          events: batch,
          timestamp: getCurrentTimestamp(),
          size: batch.length,
          retryCount: 0,
          maxRetries: this.config.maxRetries || 3,
        };

        try {
          const response = await this.transport.sendBatch(batchData);
          
          // Call hooks
          this.config.hooks?.onBatchSent?.(batch, response);
          
          if (response.success) {
            // Remove sent events from storage
            for (const event of batch) {
              await this.storage.remove(`event_${event.id}`);
            }
          } else {
            // Re-queue failed events
            this.eventQueue.push(...batch);
            this.config.hooks?.onBatchFailed?.(batch, new Error('Transport failed'));
          }
        } catch (error) {
          // Re-queue failed events
          this.eventQueue.push(...batch);
          this.config.hooks?.onBatchFailed?.(batch, error as Error);
          logger.error('Failed to send telemetry batch', error);
        }
      }
    } catch (error) {
      logger.error('Failed to flush telemetry events', error);
    }
  }

  private setupAutoFlush(): void {
    const flushTimeout = this.config.batchTimeout || 5000;
    
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.setupAutoFlush();
    }, flushTimeout);
  }

  private setupPageUnloadHandler(): void {
    if (typeof window === 'undefined') return;

    const handlePageUnload = () => {
      // Use beacon transport for page unload
      if (this.config.enabled && this.config.endpoint && this.eventQueue.length > 0) {
        const beaconTransport = createTransport('beacon', {
          endpoint: this.config.endpoint,
          apiKey: this.config.apiKey,
        });

        const events = [...this.eventQueue];
        beaconTransport.send(events).catch(() => {
          // Ignore errors during page unload
        });
      }
    };

    window.addEventListener('beforeunload', handlePageUnload);
    window.addEventListener('pagehide', handlePageUnload);
  }
}

/**
 * Factory function to create a telemetry client
 */
export function createTelemetryClient(config?: Partial<TelemetryConfig>): TelemetryClient {
  return new NexusTelemetryClient(config);
}

/**
 * Default telemetry client instance
 */
let defaultTelemetryClient: TelemetryClient | null = null;

/**
 * Get or create the default telemetry client
 */
export function getTelemetryClient(): TelemetryClient {
  if (!defaultTelemetryClient) {
    defaultTelemetryClient = createTelemetryClient();
  }
  return defaultTelemetryClient;
}

/**
 * Set the default telemetry client
 */
export function setTelemetryClient(client: TelemetryClient): void {
  defaultTelemetryClient = client;
}

/**
 * Initialize telemetry with configuration
 */
export function initializeTelemetry(config: Partial<TelemetryConfig>): TelemetryClient {
  const client = createTelemetryClient(config);
  setTelemetryClient(client);
 