/**
 * Performance tracking utilities for SDK operations
 */
import { isEmptyObject, pickBy } from 'es-toolkit';
import type {
  OperationContext,
  PerformanceProperties,
  SpanContext,
  SpanProperties,
  SpanTags,
} from './types';

export class PerformanceTracker {
  private activeSpans: Map<string, SpanContext> = new Map();

  /**
   * Start tracking a span
   * @param name - Name of the span/operation
   * @param options - Optional parent span and tags
   * @returns Span ID for later reference
   */
  startSpan(name: string, options?: { parentSpanId?: string; tags?: SpanTags }): string {
    return this.startSpanInternal(name, options);
  }

  /**
   * End tracking a span and get span properties
   * @param spanId - The span ID from startSpan
   * @param result - Span result (success/error)
   * @returns Span properties for analytics/logging
   */
  endSpan(spanId: string, result: { success: boolean; error?: Error }): SpanProperties | null {
    try {
      const context = this.activeSpans.get(spanId);
      if (!context) {
        console.warn(`[PerformanceTracker] Unknown span ID: ${spanId}`);
        return null;
      }

      const endedAtIso = new Date().toISOString();
      const duration = Date.now() - context.startTime;
      const properties: SpanProperties = {
        operation: context.operationName,
        duration,
        success: result.success,
        errorMessage: result.error?.message,
        errorType: result.error?.name,
        metadata: context.metadata,
        spanId: context.spanId,
        parentSpanId: context.parentSpanId,
        rootSpanId: context.rootSpanId,
        startedAtIso: context.startedAtIso,
        endedAtIso,
        tags: context.tags,
      };

      this.activeSpans.delete(spanId);
      return properties;
    } catch (error) {
      console.warn('[PerformanceTracker] Failed to end span', error);
      this.activeSpans.delete(spanId);
      return null;
    }
  }

  /**
   * Wrap an async operation with automatic span tracking
   * @param name - Name of the span/operation
   * @param fn - The async function to track
   * @param options - Optional parent span and tags
   * @returns Promise with the operation result
   */
  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    options?: { parentSpanId?: string; tags?: SpanTags }
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
   * Start tracking an operation
   * @param operationName - Name of the operation
   * @param metadata - Additional metadata
   * @returns Operation ID for later reference
   */
  startOperation(operationName: string, metadata?: Record<string, unknown>): string {
    return this.startSpanInternal(operationName, {
      metadata,
      tags: this.extractTags(metadata),
    });
  }

  /**
   * End tracking an operation and get performance properties
   * @param operationId - The operation ID from startOperation
   * @param result - Operation result (success/error)
   * @returns Performance properties for analytics
   */
  endOperation(
    operationId: string,
    result: { success: boolean; error?: Error }
  ): PerformanceProperties | null {
    return this.endSpan(operationId, result);
  }

  /**
   * Wrap an async operation with automatic performance tracking
   * @param operationName - Name of the operation
   * @param fn - The async function to track
   * @param metadata - Additional metadata
   * @returns Promise with the operation result and performance data
   */
  async trackOperation<T>(
    operationName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<{ result: T; performance: PerformanceProperties }> {
    const operationId = this.startOperation(operationName, metadata);
    let success = false;
    let error: Error | undefined;
    let result: T;

    try {
      result = await fn();
      success = true;
      const performance = this.endOperation(operationId, { success });
      if (!performance) {
        throw new Error(`Performance span for ${operationName} closed without metrics`);
      }
      return { result, performance };
    } catch (e) {
      error = e as Error;
      this.endOperation(operationId, { success: false, error });
      throw error; // Re-throw after tracking
    }
  }

  /**
   * Generate a unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private startSpanInternal(
    operationName: string,
    options?: {
      parentSpanId?: string;
      tags?: SpanTags;
      metadata?: Record<string, unknown>;
    }
  ): string {
    const spanId = this.generateOperationId();
    try {
      const parentSpanId = options?.parentSpanId;
      const parentSpan = parentSpanId ? this.activeSpans.get(parentSpanId) : undefined;
      const context: OperationContext = {
        operationId: spanId,
        operationName,
        startTime: Date.now(),
        metadata: options?.metadata ?? options?.tags,
      };
      const spanContext: SpanContext = {
        ...context,
        spanId,
        parentSpanId,
        rootSpanId: parentSpan?.rootSpanId ?? spanId,
        tags: options?.tags,
        startedAtIso: new Date().toISOString(),
      };
      this.activeSpans.set(spanId, spanContext);
    } catch (error) {
      console.warn('[PerformanceTracker] Failed to start span', error);
    }
    return spanId;
  }

  private extractTags(metadata?: Record<string, unknown>): SpanTags | undefined {
    if (!metadata) return undefined;

    const tags = pickBy(
      metadata,
      (value): value is string | number | boolean =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ) as SpanTags;
    return isEmptyObject(tags) ? undefined : tags;
  }

  /**
   * Get the number of active operations
   */
  getActiveOperationCount(): number {
    return this.activeSpans.size;
  }

  /**
   * Clear all active operations (for cleanup/reset)
   */
  clear(): void {
    this.activeSpans.clear();
  }
}
