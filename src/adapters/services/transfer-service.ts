import { BaseService } from '../core/base-service';
import { validateBridgeTransferParams, validateForResultReturn } from '../core/validation';
import { extractErrorMessage, logger } from '../../utils';
import { NEXUS_EVENTS } from '../../constants';
import type { ProgressStep } from '@arcana/ca-sdk';
import type { TransferParams, TransferResult, SimulationResult } from '../../types';

/**
 * Service responsible for handling transfer operations
 */
export class TransferService extends BaseService {
  /**
   * Transfer tokens to a recipient
   */
  async transfer(params: TransferParams): Promise<TransferResult> {
    try {
      // Validate parameters
      validateBridgeTransferParams(params);
      this.ensureInitialized();

      // Emit started event
      this.emitOperationEvents.started('TRANSFER', {
        toChainId: params.chainId,
        tokenAddress: params.token,
        amount: params.amount.toString(),
        recipient: params.recipient,
      });

      // Execute transfer operation using CA SDK
      const result = await this.waitForTransactionCompletion<TransferResult>(async () => {
        const transferQuery = await this.ca.transfer({
          to: params.recipient,
          token: params.token,
          amount: params.amount,
          chainID: params.chainId,
        });

        await transferQuery.exec();
      });

      // Emit completion event
      this.emitOperationEvents.completed('TRANSFER', { result });

      return result;
    } catch (error) {
      // Emit failure event
      this.emitOperationEvents.failed('TRANSFER', error, 'transfer operation');

      // Validate parameters for error return format
      const validation = validateForResultReturn({
        chainId: params.chainId,
        token: params.token,
        initialized: this.isInitialized,
      });

      if (!validation.success) {
        return {
          success: false,
          error: validation.error,
        };
      }

      return {
        success: false,
        error: extractErrorMessage(error, 'transfer operation'),
      };
    }
  }

  /**
   * Simulate transfer operation
   */
  async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    try {
      // Validate parameters
      validateBridgeTransferParams(params);
      this.ensureInitialized();

      // Execute transfer simulation using CA SDK
      const transferQuery = await this.ca.transfer({
        to: params.recipient,
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
      });

      return await transferQuery.simulate();
    } catch (error) {
      throw new Error(
        `Transfer simulation failed: ${extractErrorMessage(error, 'transfer simulation')}`,
      );
    }
  }

  /**
   * Wait for transaction completion with progress tracking
   */
  private async waitForTransactionCompletion<T extends TransferResult>(
    executionFn: () => Promise<void>,
    timeout: number = 300000,
  ): Promise<T> {
    return new Promise((resolve) => {
      let explorerUrl: string | undefined;
      let hasCompleted = false;

      // Set up event listeners to capture transaction data
      const handleStepComplete = (step: ProgressStep) => {
        try {
          if (step.typeID === 'IS' && step.data) {
            // Intent Submitted - capture explorer URL
            if ('explorerURL' in step.data) {
              explorerUrl = step.data.explorerURL;
            }
          } else if (step.typeID === 'IF') {
            // Intent Fulfilled - transaction completed successfully
            if (!hasCompleted) {
              hasCompleted = true;
              cleanup();
              resolve({
                success: true,
                explorerUrl: explorerUrl,
              } as T);
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
