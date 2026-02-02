/**
 * Performance tracking utilities for SDK operations
 */
import type { OperationContext, PerformanceProperties } from './types';

export class PerformanceTracker {
  private activeOperations: Map<string, OperationContext> = new Map();

  /**
   * Start tracking an operation
   * @param operationName - Name of the operation
   * @param metadata - Additional metadata
   * @returns Operation ID for later reference
   */
  startOperation(operationName: string, metadata?: Record<string, unknown>): string {
    const operationId = this.generateOperationId();
    const context: OperationContext = {
      operationId,
      operationName,
      startTime: Date.now(),
      metadata,
    };

    this.activeOperations.set(operationId, context);
    return operationId;
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
    const context = this.activeOperations.get(operationId);
    if (!context) {
      console.warn(`[PerformanceTracker] Unknown operation ID: ${operationId}`);
      return null;
    }

    const duration = Date.now() - context.startTime;
    const properties: PerformanceProperties = {
      operation: context.operationName,
      duration,
      success: result.success,
      errorMessage: result.error?.message,
      errorType: result.error?.name,
      metadata: context.metadata,
    };

    // Cleanup
    this.activeOperations.delete(operationId);

    return properties;
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
      return {
        result,
        performance: this.endOperation(operationId, { success })!,
      };
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

  /**
   * Get the number of active operations
   */
  getActiveOperationCount(): number {
    return this.activeOperations.size;
  }

  /**
   * Clear all active operations (for cleanup/reset)
   */
  clear(): void {
    this.activeOperations.clear();
  }
}
