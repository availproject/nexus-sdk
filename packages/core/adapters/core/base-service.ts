import { extractErrorMessage } from '@nexus/commons';

/**
 * Base service class that provides common functionality for all adapter services
 */
export abstract class BaseService {
  constructor(protected adapter: any) {}

  /**
   * Check if the adapter is initialized
   */
  protected get isInitialized(): boolean {
    return this.adapter.isInitialized();
  }

  /**
   * Ensure the adapter is initialized
   */
  protected ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('CA SDK not initialized. Call initialize() first.');
    }
  }

  /**
   * Helper method for operation event emission (started/completed/failed pattern)
   */
  protected emitOperationEvents = {
    started: (operation: string, data: Record<string, unknown>) => {
      this.adapter.nexusEvents.emit(`${operation}_STARTED`, data);
    },
    completed: (operation: string, data: Record<string, unknown>) => {
      this.adapter.nexusEvents.emit(`${operation}_COMPLETED`, data);
    },
    failed: (operation: string, error: unknown, context: string, stage?: string) => {
      const eventData: Record<string, unknown> = {
        message: extractErrorMessage(error, context),
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      };
      if (stage) eventData.stage = stage;
      this.adapter.nexusEvents.emit(`${operation}_FAILED`, eventData);
    },
  };
}
