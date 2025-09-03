import { CA } from '@arcana/ca-sdk';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { type EthereumProvider, extractErrorMessage } from '@nexus/commons';

/**
 * Base service class that provides common functionality for all adapter services
 */
export abstract class BaseService {
  constructor(protected adapter: any) {}

  /**
   * Get the CA SDK instance
   */
  protected get ca(): CA {
    return this.adapter.ca;
  }

  /**
   * Get the EVM provider with CA functionality
   */
  protected get evmProvider(): EthereumProvider {
    return this.adapter.evmProvider!;
  }

  /**
   * Get the CA events emitter
   */
  protected get caEvents(): SafeEventEmitter {
    return this.adapter.caEvents;
  }

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
      this.caEvents.emit(`${operation}_STARTED`, data);
    },
    completed: (operation: string, data: Record<string, unknown>) => {
      this.caEvents.emit(`${operation}_COMPLETED`, data);
    },
    failed: (operation: string, error: unknown, context: string, stage?: string) => {
      const eventData: Record<string, unknown> = {
        message: extractErrorMessage(error, context),
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      };
      if (stage) eventData.stage = stage;
      this.caEvents.emit(`${operation}_FAILED`, eventData);
    },
  };
}

// Forward declaration - will be resolved when this is imported
declare class ChainAbstractionAdapter {
  ca: CA;
  evmProvider: EthereumProvider | null;
  caEvents: SafeEventEmitter;
  isInitialized(): boolean;
}
