import {
  NEXUS_EVENTS,
  type SwapInput,
  type SwapOptionalParams,
  SwapResult,
  type SwapStep,
  extractErrorMessage,
  logger,
} from '@nexus/commons';
import { BaseService } from '../core/base-service';

export class SwapService extends BaseService {
  public async swap(
    inputs: SwapInput,
    options?: Omit<SwapOptionalParams, 'emit'>,
  ): Promise<SwapResult> {
    try {
      this.ensureInitialized();
      const result = await this.waitForTransactionCompletion(async () => {
        await this.ca.swap(inputs, options);
      });
      return result;
    } catch (error) {
      logger.error('SwapService.swap', error as Error);
      return {
        success: false,
        error: extractErrorMessage(error, 'swap operation'),
      };
    }
  }

  private async waitForTransactionCompletion<T extends SwapResult>(
    executionFn: () => Promise<void>,
    timeout: number = 300000,
  ): Promise<T> {
    return new Promise((resolve) => {
      let sourceExplorerUrl: string | undefined;
      let destinationExplorerUrl: string | undefined;
      let hasCompleted = false;

      // Set up event listeners to capture transaction data
      const handleStepComplete = (step: SwapStep) => {
        try {
          if (step.type === 'SOURCE_SWAP_HASH' && step.explorerURL) {
            // Source Swap Completed - capture explorer URL
            sourceExplorerUrl = step.explorerURL;
          }
          if (step.type === 'DESTINATION_SWAP_HASH' && step.explorerURL) {
            // Destination Swap Completed - transaction completed successfully
            sourceExplorerUrl = step.explorerURL;
          }
          if (step.type === 'SWAP_COMPLETE' && step.completed) {
            // Swap Completed - transaction completed successfully
            if (!hasCompleted) {
              hasCompleted = true;
              cleanup();
              resolve({
                success: true,
                sourceExplorerUrl: sourceExplorerUrl,
                destinationExplorerUrl: destinationExplorerUrl,
              } as unknown as T);
            }
          }
        } catch (error) {
          logger.error('Error processing step completion:', error as Error);
        }
      };

      const cleanup = () => {
        this.caEvents.off(NEXUS_EVENTS.STEP_COMPLETE, handleStepComplete);
        clearTimeout(timeoutId);
      };

      // Add event listeners - only using known events
      this.caEvents.on(NEXUS_EVENTS.STEP_COMPLETE, handleStepComplete);

      // Set a timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        if (!hasCompleted) {
          hasCompleted = true;
          cleanup();
          resolve({
            success: false,
            error: 'Transaction timeout',
          } as T);
        }
      }, timeout);

      // Execute the transaction
      executionFn().catch((error) => {
        if (!hasCompleted) {
          hasCompleted = true;
          cleanup();
          resolve({
            success: false,
            error: error?.message ?? 'Transaction execution failed',
          } as T);
        }
      });
    });
  }
}

export default SwapService;
