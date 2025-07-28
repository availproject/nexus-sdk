import type { 
  TelemetryTransport, 
  TelemetryEvent, 
  TelemetryBatch, 
  TelemetryResponse 
} from '../types';
import { retryWithBackoff } from './utils';

/**
 * HTTP transport implementation for sending telemetry events
 */
export class HTTPTransport implements TelemetryTransport {
  private endpoint: string;
  private apiKey?: string;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;

  constructor(config: {
    endpoint: string;
    apiKey?: string;
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
  }) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 10000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  async send(events: TelemetryEvent[]): Promise<TelemetryResponse> {
    return this.sendBatch({
      events,
      timestamp: Date.now(),
      size: events.length,
      retryCount: 0,
      maxRetries: this.maxRetries,
    });
  }

  async sendBatch(batch: TelemetryBatch): Promise<TelemetryResponse> {
    const { events, timestamp, size, retryCount } = batch;

    if (events.length === 0) {
      return {
        success: true,
        eventIds: [],
        timestamp: Date.now(),
      };
    }

    const payload = {
      events,
      batch: {
        timestamp,
        size,
        retryCount,
      },
    };

    try {
      const response = await retryWithBackoff(
        () => this.makeRequest(payload),
        this.maxRetries,
        this.retryDelay
      );

      return {
        success: true,
        eventIds: events.map(event => event.id),
        batchId: response.batchId,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        eventIds: events.map(event => event.id),
        timestamp: Date.now(),
        errors: [{
          eventId: 'batch',
          error: error instanceof Error ? error.message : 'Unknown error',
        }],
      };
    }
  }

  private async makeRequest(payload: unknown): Promise<{ batchId?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.endpoint}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Beacon API transport for sending events when page is unloading
 */
export class BeaconTransport implements TelemetryTransport {
  private endpoint: string;
  private apiKey?: string;

  constructor(config: { endpoint: string; apiKey?: string }) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
  }

  async send(events: TelemetryEvent[]): Promise<TelemetryResponse> {
    return this.sendBatch({
      events,
      timestamp: Date.now(),
      size: events.length,
      retryCount: 0,
      maxRetries: 0,
    });
  }

  async sendBatch(batch: TelemetryBatch): Promise<TelemetryResponse> {
    const { events } = batch;

    if (events.length === 0) {
      return {
        success: true,
        eventIds: [],
        timestamp: Date.now(),
      };
    }

    const payload = {
      events,
      batch: {
        timestamp: batch.timestamp,
        size: batch.size,
        retryCount: batch.retryCount,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const url = new URL(`${this.endpoint}/events`);
    const data = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    const success = navigator.sendBeacon(url.toString(), data);

    return {
      success,
      eventIds: events.map(event => event.id),
      timestamp: Date.now(),
    };
  }

  async healthCheck(): Promise<boolean> {
    // Beacon API doesn't support health checks
    return true;
  }
}

/**
 * Console transport for debugging and development
 */
export class ConsoleTransport implements TelemetryTransport {
  private prefix: string;

  constructor(prefix: string = '[Nexus Telemetry]') {
    this.prefix = prefix;
  }

  async send(events: TelemetryEvent[]): Promise<TelemetryResponse> {
    return this.sendBatch({
      events,
      timestamp: Date.now(),
      size: events.length,
      retryCount: 0,
      maxRetries: 0,
    });
  }

  async sendBatch(batch: TelemetryBatch): Promise<TelemetryResponse> {
    const { events } = batch;

    console.group(`${this.prefix} Batch (${events.length} events)`);
    events.forEach(event => {
      console.log(`Event: ${event.type}`, {
        id: event.id,
        timestamp: new Date(event.timestamp).toISOString(),
        category: event.category,
        severity: event.severity,
        data: event.data,
        metadata: event.metadata,
      });
    });
    console.groupEnd();

    return {
      success: true,
      eventIds: events.map(event => event.id),
      timestamp: Date.now(),
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * No-op transport for when telemetry is disabled
 */
export class NoOpTransport implements TelemetryTransport {
  async send(events: TelemetryEvent[]): Promise<TelemetryResponse> {
    return {
      success: true,
      eventIds: events.map(event => event.id),
      timestamp: Date.now(),
    };
  }

  async sendBatch(batch: TelemetryBatch): Promise<TelemetryResponse> {
    return {
      success: true,
      eventIds: batch.events.map(event => event.id),
      timestamp: Date.now(),
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Multi-transport implementation that sends to multiple transports
 */
export class MultiTransport implements TelemetryTransport {
  private transports: TelemetryTransport[];

  constructor(transports: TelemetryTransport[]) {
    this.transports = transports;
  }

  async send(events: TelemetryEvent[]): Promise<TelemetryResponse> {
    const responses = await Promise.allSettled(
      this.transports.map(transport => transport.send(events))
    );

    const successfulResponses = responses
      .filter((result): result is PromiseFulfilledResult<TelemetryResponse> => 
        result.status === 'fulfilled'
      )
      .map(result => result.value);

    const failedResponses = responses
      .filter((result): result is PromiseRejectedResult => 
        result.status === 'rejected'
      );

    if (successfulResponses.length === 0) {
      throw new Error(`All transports failed: ${failedResponses.map(r => r.reason).join(', ')}`);
    }

    // Return the first successful response
    return successfulResponses[0];
  }

  async sendBatch(batch: TelemetryBatch): Promise<TelemetryResponse> {
    const responses = await Promise.allSettled(
      this.transports.map(transport => transport.sendBatch(batch))
    );

    const successfulResponses = responses
      .filter((result): result is PromiseFulfilledResult<TelemetryResponse> => 
        result.status === 'fulfilled'
      )
      .map(result => result.value);

    const failedResponses = responses
      .filter((result): result is PromiseRejectedResult => 
        result.status === 'rejected'
      );

    if (successfulResponses.length === 0) {
      throw new Error(`All transports failed: ${failedResponses.map(r => r.reason).join(', ')}`);
    }

    // Return the first successful response
    return successfulResponses[0];
  }

  async healthCheck(): Promise<boolean> {
    const healthChecks = await Promise.allSettled(
      this.transports.map(transport => transport.healthCheck())
    );

    return healthChecks.some(result => 
      result.status === 'fulfilled' && result.value === true
    );
  }
}

/**
 * Factory function to create the appropriate transport
 */
export function createTransport(
  type: 'http' | 'beacon' | 'console' | 'noop',
  config?: {
    endpoint?: string;
    apiKey?: string;
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    prefix?: string;
  }
): TelemetryTransport {
  switch (type) {
    case 'http':
      if (!config?.endpoint) {
        throw new Error('HTTP transport requires an endpoint');
      }
      return new HTTPTransport({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        timeout: config.timeout,
        maxRetries: config.maxRetries,
        retryDelay: config.retryDelay,
      });
    
    case 'beacon':
      if (!config?.endpoint) {
        throw new Error('Beacon transport requires an endpoint');
      }
      return new BeaconTransport({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
      });
    
    case 'console':
      return new ConsoleTransport(config?.prefix);
    
    case 'noop':
      return new NoOpTransport();
    
    default:
      throw new Error(`Unsupported transport type: ${type}`);
  }
} 