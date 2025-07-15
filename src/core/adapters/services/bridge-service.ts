import { BaseService } from '../core/base-service';
import { validateBridgeTransferParams, validateForResultReturn } from '../core/validation';
import { extractErrorMessage, logger } from '../../utils';
import { NEXUS_EVENTS } from '../../../constants';
import type { ProgressStep } from '@arcana/ca-sdk';
import type { BridgeParams, BridgeResult, SimulationResult } from '../../../types';

/**
 * Service responsible for handling bridge operations
 */
export class BridgeService extends BaseService {
  /**
   * Bridge tokens between chains
   */
  async bridge(params: BridgeParams): Promise<BridgeResult> {
    try {
      // Validate parameters
      validateBridgeTransferParams(params);
      this.ensureInitialized();

      // Execute bridge operation using CA SDK
      const result = await this.waitForTransactionCompletion<BridgeResult>(async () => {
        const bridgeQuery = await this.ca.bridge({
          token: params.token,
          amount: params.amount,
          chainID: params.chainId,
          gas: params.gas ? BigInt(params.gas) : undefined,
        });

        await bridgeQuery.exec();
      });

      return result;
    } catch (error) {
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
        error: extractErrorMessage(error, 'bridge operation'),
      };
    }
  }

  /**
   * Simulate bridge operation
   */
  async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    try {
      // Validate parameters
      validateBridgeTransferParams(params);
      this.ensureInitialized();

      // Execute bridge simulation using CA SDK
      const bridgeQuery = await this.ca.bridge({
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
        gas: params.gas ? BigInt(params.gas) : undefined,
      });

      return await bridgeQuery.simulate();
    } catch (error) {
      throw new Error(
        `Bridge simulation failed: ${extractErrorMessage(error, 'bridge simulation')}`,
      );
    }
  }

  /**
   * Wait for transaction completion with progress tracking
   */
  private async waitForTransactionCompletion<T extends BridgeResult>(
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
