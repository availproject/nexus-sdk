import type { 
  TelemetryEvent, 
  TelemetryEventType, 
  TelemetryCategory, 
  TelemetrySeverity,
  TelemetryEventBuilder 
} from '../types';
import { 
  generateEventId, 
  getCurrentTimestamp, 
  getEventCategory, 
  getEventSeverity 
} from './utils';

/**
 * Telemetry event builder implementation
 */
export class EventBuilder implements TelemetryEventBuilder {
  private event: Partial<TelemetryEvent> = {};

  constructor(
    private readonly config: {
      sessionId: string;
      version: string;
      environment: 'development' | 'staging' | 'production';
      userId?: string;
      walletAddress?: string;
      chainId?: number;
      network?: 'mainnet' | 'testnet';
    }
  ) {
    // Initialize with default values
    this.event = {
      id: generateEventId(),
      timestamp: getCurrentTimestamp(),
      sessionId: config.sessionId,
      version: config.version,
      environment: config.environment,
      data: {},
      metadata: {},
      tags: [],
    };

    // Set user and chain info if available
    if (config.userId) {
      this.event.userId = config.userId;
    }
    if (config.walletAddress) {
      this.event.walletAddress = config.walletAddress;
    }
    if (config.chainId) {
      this.event.chainId = config.chainId;
    }
    if (config.network) {
      this.event.network = config.network;
    }
  }

  setType(type: TelemetryEventType): TelemetryEventBuilder {
    this.event.type = type;
    this.event.category = getEventCategory(type);
    this.event.severity = getEventSeverity(type);
    return this;
  }

  setCategory(category: TelemetryCategory): TelemetryEventBuilder {
    this.event.category = category;
    return this;
  }

  setSeverity(severity: TelemetrySeverity): TelemetryEventBuilder {
    this.event.severity = severity;
    return this;
  }

  setData(data: Record<string, unknown>): TelemetryEventBuilder {
    this.event.data = { ...data };
    return this;
  }

  addData(key: string, value: unknown): TelemetryEventBuilder {
    if (!this.event.data) {
      this.event.data = {};
    }
    this.event.data[key] = value;
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): TelemetryEventBuilder {
    this.event.metadata = { ...metadata };
    return this;
  }

  addMetadata(key: string, value: unknown): TelemetryEventBuilder {
    if (!this.event.metadata) {
      this.event.metadata = {};
    }
    this.event.metadata[key] = value;
    return this;
  }

  setTags(tags: string[]): TelemetryEventBuilder {
    this.event.tags = [...tags];
    return this;
  }

  addTag(tag: string): TelemetryEventBuilder {
    if (!this.event.tags) {
      this.event.tags = [];
    }
    this.event.tags.push(tag);
    return this;
  }

  setSource(source: string): TelemetryEventBuilder {
    this.event.source = source;
    return this;
  }

  setCorrelationId(correlationId: string): TelemetryEventBuilder {
    this.event.correlationId = correlationId;
    return this;
  }

  setParentEventId(parentEventId: string): TelemetryEventBuilder {
    this.event.parentEventId = parentEventId;
    return this;
  }

  setDuration(duration: number): TelemetryEventBuilder {
    this.event.duration = duration;
    return this;
  }

  setError(error: Error, context?: Record<string, unknown>): TelemetryEventBuilder {
    this.event.error = {
      message: error.message,
      code: (error as any).code,
      stack: error.stack,
      context,
    };
    return this;
  }

  setUser(userId: string, walletAddress?: string): TelemetryEventBuilder {
    this.event.userId = userId;
    if (walletAddress) {
      this.event.walletAddress = walletAddress;
    }
    return this;
  }

  setChain(chainId: number, network?: 'mainnet' | 'testnet'): TelemetryEventBuilder {
    this.event.chainId = chainId;
    if (network) {
      this.event.network = network;
    }
    return this;
  }

  track(): void {
    // This method is called when the event should be tracked
    // The actual tracking is handled by the telemetry client
    // This is a placeholder for the fluent API
  }

  build(): TelemetryEvent {
    // Validate that required fields are present
    if (!this.event.type) {
      throw new Error('Event type is required');
    }
    if (!this.event.category) {
      throw new Error('Event category is required');
    }
    if (!this.event.severity) {
      throw new Error('Event severity is required');
    }

    return this.event as TelemetryEvent;
  }

  /**
   * Reset the builder to create a new event
   */
  reset(): TelemetryEventBuilder {
    this.event = {
      id: generateEventId(),
      timestamp: getCurrentTimestamp(),
      sessionId: this.config.sessionId,
      version: this.config.version,
      environment: this.config.environment,
      data: {},
      metadata: {},
      tags: [],
    };

    // Restore user and chain info
    if (this.config.userId) {
      this.event.userId = this.config.userId;
    }
    if (this.config.walletAddress) {
      this.event.walletAddress = this.config.walletAddress;
    }
    if (this.config.chainId) {
      this.event.chainId = this.config.chainId;
    }
    if (this.config.network) {
      this.event.network = this.config.network;
    }

    return this;
  }
}

/**
 * Factory function to create an event builder
 */
export function createEventBuilder(config: {
  sessionId: string;
  version: string;
  environment: 'development' | 'staging' | 'production';
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  network?: 'mainnet' | 'testnet';
}): TelemetryEventBuilder {
  return new EventBuilder(config);
}

/**
 * Pre-built event builders for common event types
 */
export class EventBuilders {
  constructor(
    private readonly config: {
      sessionId: string;
      version: string;
      environment: 'development' | 'staging' | 'production';
      userId?: string;
      walletAddress?: string;
      chainId?: number;
      network?: 'mainnet' | 'testnet';
    }
  ) {}

  /**
   * Create a user interaction event
   */
  userInteraction(component: string, action: string, data?: Record<string, unknown>): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType('ui_interaction')
      .setData({
        component,
        action,
        ...data,
      });
  }

  /**
   * Create a transaction event
   */
  transaction(
    type: 'transaction_started' | 'transaction_completed' | 'transaction_failed',
    data: Record<string, unknown>
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data);
  }

  /**
   * Create a bridge event
   */
  bridge(
    type: 'bridge_initiated' | 'bridge_completed' | 'bridge_failed',
    data: Record<string, unknown>
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data);
  }

  /**
   * Create a transfer event
   */
  transfer(
    type: 'transfer_initiated' | 'transfer_completed' | 'transfer_failed',
    data: Record<string, unknown>
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data);
  }

  /**
   * Create an execute event
   */
  execute(
    type: 'execute_initiated' | 'execute_completed' | 'execute_failed',
    data: Record<string, unknown>
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data);
  }

  /**
   * Create an approval event
   */
  approval(
    type: 'approval_requested' | 'approval_granted' | 'approval_denied',
    data: Record<string, unknown>
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data);
  }

  /**
   * Create a wallet event
   */
  wallet(
    type: 'wallet_connected' | 'wallet_disconnected' | 'wallet_switched',
    data: Record<string, unknown>
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data);
  }

  /**
   * Create a performance event
   */
  performance(metric: string, value: number, unit: string = 'ms'): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType('performance_metric')
      .setData({
        metric,
        value,
        unit,
      });
  }

  /**
   * Create an error event
   */
  error(error: Error, context?: Record<string, unknown>): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType('error_occurred')
      .setError(error, context);
  }

  /**
   * Create a network event
   */
  network(
    type: 'network_request' | 'network_response',
    url: string,
    method: string,
    responseTime: number,
    statusCode?: number
  ): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData({
        url,
        method,
        responseTime,
        statusCode,
      });
  }

  /**
   * Create a feature usage event
   */
  featureUsed(feature: string, data?: Record<string, unknown>): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType('feature_used')
      .setData({
        feature,
        ...data,
      });
  }

  /**
   * Create a custom event
   */
  custom(type: TelemetryEventType, data?: Record<string, unknown>): TelemetryEventBuilder {
    return createEventBuilder(this.config)
      .setType(type)
      .setData(data || {});
  }
}

/**
 * Factory function to create event builders
 */
export function createEventBuilders(config: {
  sessionId: string;
  version: string;
  environment: 'development' | 'staging' | 'production';
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  network?: 'mainnet' | 'testnet';
}): EventBuilders {
  return new EventBuilders(config);
} 