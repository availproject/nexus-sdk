import type { 
  TelemetryEvent, 
  TelemetryEventType, 
  TelemetryCategory, 
  TelemetrySeverity,
  TelemetryConfig 
} from '../types';
import { EVENT_CATEGORY_MAP, EVENT_SEVERITY_MAP, TELEMETRY_LIMITS } from './constants';

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get the current timestamp in milliseconds
 */
export function getCurrentTimestamp(): number {
  return Date.now();
}

/**
 * Get the category for a given event type
 */
export function getEventCategory(eventType: TelemetryEventType): TelemetryCategory {
  return EVENT_CATEGORY_MAP[eventType];
}

/**
 * Get the severity for a given event type
 */
export function getEventSeverity(eventType: TelemetryEventType): TelemetrySeverity {
  return EVENT_SEVERITY_MAP[eventType];
}

/**
 * Check if an event should be sampled based on sample rate
 */
export function shouldSampleEvent(sampleRate: number): boolean {
  return Math.random() < sampleRate;
}

/**
 * Check if an event should be filtered based on configuration
 */
export function shouldFilterEvent(
  event: TelemetryEvent,
  config: TelemetryConfig
): boolean {
  const { filters } = config;
  if (!filters) return false;

  // Check include/exclude events
  if (filters.includeEvents && !filters.includeEvents.includes(event.type)) {
    return true;
  }
  if (filters.excludeEvents && filters.excludeEvents.includes(event.type)) {
    return true;
  }

  // Check include/exclude categories
  if (filters.includeCategories && !filters.includeCategories.includes(event.category)) {
    return true;
  }
  if (filters.excludeCategories && filters.excludeCategories.includes(event.category)) {
    return true;
  }

  // Check minimum severity
  if (filters.minSeverity) {
    const severityLevels: Record<TelemetrySeverity, number> = {
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
      fatal: 5,
    };
    const eventSeverityLevel = severityLevels[event.severity];
    const minSeverityLevel = severityLevels[filters.minSeverity];
    if (eventSeverityLevel < minSeverityLevel) {
      return true;
    }
  }

  return false;
}

/**
 * Anonymize sensitive data based on privacy settings
 */
export function anonymizeData(
  data: Record<string, unknown>,
  privacySettings: TelemetryConfig['privacySettings']
): Record<string, unknown> {
  if (!privacySettings?.anonymizeData) {
    return data;
  }

  const anonymized = { ...data };

  // Mask addresses if enabled
  if (privacySettings.maskAddresses) {
    Object.keys(anonymized).forEach(key => {
      const value = anonymized[key];
      if (typeof value === 'string' && value.match(/^0x[a-fA-F0-9]{40}$/)) {
        anonymized[key] = `${value.slice(0, 6)}...${value.slice(-4)}`;
      }
    });
  }

  // Mask balances if enabled
  if (privacySettings.maskBalances) {
    const balanceKeys = ['balance', 'amount', 'value', 'cost', 'fee'];
    balanceKeys.forEach(key => {
      if (anonymized[key] !== undefined) {
        anonymized[key] = '[MASKED]';
      }
    });
  }

  return anonymized;
}

/**
 * Validate telemetry event data
 */
export function validateEvent(event: TelemetryEvent): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  if (!event.id) errors.push('Event ID is required');
  if (!event.timestamp) errors.push('Event timestamp is required');
  if (!event.type) errors.push('Event type is required');
  if (!event.category) errors.push('Event category is required');
  if (!event.severity) errors.push('Event severity is required');
  if (!event.sessionId) errors.push('Session ID is required');
  if (!event.version) errors.push('Version is required');
  if (!event.environment) errors.push('Environment is required');
  if (!event.data) errors.push('Event data is required');

  // Check data types
  if (typeof event.timestamp !== 'number') errors.push('Timestamp must be a number');
  if (typeof event.data !== 'object') errors.push('Data must be an object');
  if (event.metadata && typeof event.metadata !== 'object') errors.push('Metadata must be an object');
  if (event.tags && !Array.isArray(event.tags)) errors.push('Tags must be an array');

  // Check size limits
  const eventSize = JSON.stringify(event).length;
  if (eventSize > TELEMETRY_LIMITS.MAX_EVENT_SIZE) {
    errors.push(`Event size (${eventSize}) exceeds maximum allowed size (${TELEMETRY_LIMITS.MAX_EVENT_SIZE})`);
  }

  // Check timestamp validity
  const now = Date.now();
  const eventAge = now - event.timestamp;
  if (eventAge > TELEMETRY_LIMITS.MAX_EVENT_AGE) {
    errors.push(`Event is too old (${eventAge}ms > ${TELEMETRY_LIMITS.MAX_EVENT_AGE}ms)`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize event data to remove sensitive information
 */
export function sanitizeEventData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'password',
    'privateKey',
    'secret',
    'token',
    'apiKey',
    'authorization',
    'cookie',
    'session',
  ];

  const sanitized = { ...data };
  
  sensitiveKeys.forEach(key => {
    if (sanitized[key] !== undefined) {
      sanitized[key] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Get browser information for telemetry
 */
export function getBrowserInfo(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { environment: 'node' };
  }

  const { navigator, screen, location } = window;
  
  return {
    userAgent: navigator?.userAgent,
    language: navigator?.language,
    languages: navigator?.languages,
    platform: navigator?.platform,
    cookieEnabled: navigator?.cookieEnabled,
    onLine: navigator?.onLine,
    screenWidth: screen?.width,
    screenHeight: screen?.height,
    colorDepth: screen?.colorDepth,
    pixelDepth: screen?.pixelDepth,
    url: location?.href,
    referrer: document?.referrer,
    title: document?.title,
  };
}

/**
 * Get device information for telemetry
 */
export function getDeviceInfo(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { environment: 'node' };
  }

  const { navigator, screen } = window;
  
  // Detect mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator?.userAgent || ''
  );

  // Detect touch capability
  const hasTouch = 'ontouchstart' in window || navigator?.maxTouchPoints > 0;

  return {
    isMobile,
    hasTouch,
    screenWidth: screen?.width,
    screenHeight: screen?.height,
    devicePixelRatio: window?.devicePixelRatio || 1,
    orientation: screen?.orientation?.type || 'unknown',
  };
}

/**
 * Calculate event size in bytes
 */
export function getEventSize(event: TelemetryEvent): number {
  return new Blob([JSON.stringify(event)]).size;
}

/**
 * Check if storage is available
 */
export function isStorageAvailable(type: 'localStorage' | 'sessionStorage'): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    const storage = window[type];
    const testKey = '__storage_test__';
    storage.setItem(testKey, 'test');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if IndexedDB is available
 */
export function isIndexedDBAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    return 'indexedDB' in window;
  } catch {
    return false;
  }
}

/**
 * Debounce function for telemetry events
 */
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function for telemetry events
 */
export function throttle<T extends (...args: unknown[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Batch events by priority
 */
export function batchEventsByPriority(events: TelemetryEvent[]): TelemetryEvent[][] {
  const batches: TelemetryEvent[][] = [[], [], []];
  
  events.forEach(event => {
    const priority = getEventPriority(event.type);
    batches[priority - 1].push(event);
  });
  
  return batches.filter(batch => batch.length > 0);
}

/**
 * Get event priority (1 = high, 2 = medium, 3 = low)
 */
function getEventPriority(eventType: TelemetryEventType): number {
  // This is a simplified version - in practice, you'd use the EVENT_PRIORITIES constant
  const highPriorityEvents: TelemetryEventType[] = [
    'sdk_error',
    'error_occurred',
    'transaction_failed',
    'bridge_failed',
    'transfer_failed',
    'execute_failed',
    'timeout_occurred',
    'rate_limit_hit',
  ];
  
  const mediumPriorityEvents: TelemetryEventType[] = [
    'user_connected',
    'user_disconnected',
    'wallet_connected',
    'wallet_disconnected',
    'transaction_completed',
    'bridge_completed',
    'transfer_completed',
    'execute_completed',
    'approval_granted',
    'approval_denied',
  ];
  
  if (highPriorityEvents.includes(eventType)) return 1;
  if (mediumPriorityEvents.includes(eventType)) return 2;
  return 3;
}

/**
 * Compress event data for efficient storage/transmission
 */
export function compressEventData(data: Record<string, unknown>): string {
  // Simple compression by removing undefined values and nulls
  const compressed = Object.fromEntries(
    Object.entries(data).filter(([_, value]) => value !== undefined && value !== null)
  );
  
  return JSON.stringify(compressed);
}

/**
 * Decompress event data
 */
export function decompressEventData(compressed: string): Record<string, unknown> {
  try {
    return JSON.parse(compressed);
  } catch {
    return {};
  }
} 