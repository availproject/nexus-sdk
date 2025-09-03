import React from 'react';
import type {
  ISwapController,
  SwapInputData,
  ActiveTransaction,
  SwapSimulationResult,
} from '../types';
import { NexusSDK } from '@nexus/core';
import {
  type SwapResult,
  type SwapInput,
  logger,
  type SwapOptionalParams,
  type SwapIntent,
  TOKEN_CONTRACT_ADDRESSES,
  parseUnits,
  TOKEN_METADATA,
} from '@nexus/commons';
import { SwapTransactionForm } from '../components/shared/unified-transaction-form';

const SwapInputForm: React.FC<{
  prefill: Partial<SwapInputData>;
  onUpdate: (data: SwapInputData) => void;
  isBusy: boolean;
  prefillFields?: {
    fromChainID?: boolean;
    toChainID?: boolean;
    fromTokenAddress?: boolean;
    toTokenAddress?: boolean;
    fromAmount?: boolean;
    toAmount?: boolean;
  };
}> = ({ prefill, onUpdate, isBusy, prefillFields = {} }) => {
  const defaultData: SwapInputData = {
    fromChainID: undefined,
    toChainID: undefined,
    fromTokenAddress: undefined,
    toTokenAddress: undefined,
    fromAmount: undefined,
    toAmount: undefined,
    ...prefill,
  };

  return (
    <SwapTransactionForm
      inputData={defaultData}
      onUpdate={onUpdate}
      disabled={isBusy}
      prefillFields={prefillFields}
    />
  );
};

export class SwapController implements ISwapController {
  InputForm = SwapInputForm;

  private capturedIntent: SwapIntent | null = null;
  private intentAllowCallback: (() => void) | null = null;
  private intentRefreshCallback: (() => Promise<SwapIntent>) | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  hasSufficientInput(inputData: Partial<SwapInputData>): boolean {
    if (!inputData) {
      logger.warn('SwapController: No input data provided');
      return false;
    }

    // Check for required fields
    const hasRequiredFields =
      (inputData.fromChainID || inputData.chainId) &&
      (inputData.toChainID || inputData.toChainId) &&
      (inputData.fromTokenAddress || inputData.inputToken || inputData.token) &&
      (inputData.toTokenAddress || inputData.outputToken) &&
      (inputData.fromAmount || inputData.amount);

    if (!hasRequiredFields) {
      logger.warn('SwapController: Missing required fields', inputData);
      return false;
    }

    const amount = inputData.fromAmount || inputData.amount;
    const amountNum = parseFloat(amount?.toString() || '0');
    const isValidAmount = !isNaN(amountNum) && amountNum > 0;

    logger.debug('SwapController: Input validation', {
      hasRequiredFields,
      isValidAmount,
      inputData,
    });

    return isValidAmount;
  }

  async runReview(sdk: NexusSDK, inputData: Partial<SwapInputData>): Promise<SwapSimulationResult> {
    try {
      logger.info('SwapController: Starting intent capture for swap', inputData);

      if (
        !inputData?.fromChainID ||
        !inputData?.toChainID ||
        !inputData?.toTokenAddress ||
        !inputData?.fromAmount ||
        !inputData?.fromTokenAddress ||
        !inputData?.toTokenAddress
      ) {
        throw new Error('Missing required fields');
      }

      if (typeof sdk.swap !== 'function') {
        throw new Error('sdk.swap is not available. Please ensure you are using a version of @nexus/core that includes swap functionality.');
      }

      this.capturedIntent = null;

      logger.info('SwapController: Swap input data', inputData);

      // Convert SwapInputData to SwapInput format for SDK
      const fromAmount = inputData.fromAmount ?? '0';
      const actualFromTokenAddress =
        TOKEN_CONTRACT_ADDRESSES[inputData?.fromTokenAddress][inputData.fromChainID];
      const actualToTokenAddress =
        TOKEN_CONTRACT_ADDRESSES[inputData?.toTokenAddress][inputData.toChainID];
      const swapInput: SwapInput = {
        fromChainID: inputData.fromChainID,
        toChainID: inputData.toChainID,
        fromTokenAddress: actualFromTokenAddress as `0x${string}`,
        toTokenAddress: actualToTokenAddress as `0x${string}`,
        fromAmount: parseUnits(fromAmount, TOKEN_METADATA[inputData?.fromTokenAddress]?.decimals),
      };

      logger.info('SwapController: Prepared Swap input data', swapInput);

      // Prepare intent capture callback
      const intentPromise = new Promise<SwapIntent>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Intent capture timed out after 30 seconds'));
        }, 30000);

        // Create options with intent capture callback
        const options: Omit<SwapOptionalParams, 'emit'> = {
          swapIntentHook: (data: {
            allow: () => void;
            deny: () => void;
            intent: SwapIntent;
            refresh: () => Promise<SwapIntent>;
          }) => {
            clearTimeout(timeoutId);
            logger.info('SwapController: Intent captured successfully', data.intent);

            // Store intent and callbacks for later execution
            this.capturedIntent = data.intent;
            this.intentAllowCallback = data.allow;
            this.intentRefreshCallback = data.refresh;

            // Start refresh interval for intent
            this.startIntentRefresh();

            resolve(data.intent);
            // Don't call allow() here - wait for user confirmation
          },
        };

        // Call swap to capture intent (this should not execute)
        sdk.swap(swapInput, options).catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });

      const intent = await intentPromise;

      // Return swap simulation result with captured intent
      return {
        success: true,
        intent: intent,
        swapMetadata: {
          type: 'swap' as const,
          inputToken: swapInput.fromTokenAddress,
          outputToken: swapInput.toTokenAddress,
          fromChainId: swapInput.fromChainID,
          toChainId: swapInput.toChainID,
          inputAmount: swapInput.fromAmount.toString(),
          outputAmount: intent.destination.amount,
        },
        allowance: {
          needsApproval: false,
          chainDetails: [],
        },
      };
    } catch (error) {
      logger.error('SwapController: Intent capture failed', error as Error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to capture swap intent',
        allowance: {
          needsApproval: false,
          chainDetails: [],
        },
      };
    }
  }

  async confirmAndProceed(
    _sdk: NexusSDK,
    inputData: Partial<SwapInputData>,
    simulationResult?: ActiveTransaction['simulationResult'],
  ): Promise<SwapResult> {
    try {
      logger.info('SwapController: Executing swap', { inputData, simulationResult });

      if (!this.capturedIntent || !this.intentAllowCallback) {
        throw new Error('No swap intent captured. Please retry the transaction.');
      }

      // Call the allow callback to execute the captured intent
      logger.info('SwapController: Calling allow() to execute swap intent');
      this.intentAllowCallback();

      // Stop the refresh interval since we're executing
      this.stopIntentRefresh();

      // Clear the captured intent and callbacks after execution
      this.clearCapturedIntent();

      logger.info('SwapController: Swap execution initiated');

      // For now, return a successful result since the actual execution
      // is handled by the intent system
      return {
        success: true,
      };
    } catch (error) {
      logger.error('SwapController: Swap execution failed', error as Error);

      // Don't clear intent on failure in case user wants to retry
      return {
        success: false,
        error: (error as Error).message || 'Swap execution failed',
      };
    }
  }

  // Helper methods
  getCapturedIntent(): SwapIntent | null {
    return this.capturedIntent;
  }

  clearCapturedIntent(): void {
    this.capturedIntent = null;
    this.intentAllowCallback = null;
    this.intentRefreshCallback = null;
    this.stopIntentRefresh();
  }

  private startIntentRefresh(): void {
    // Clear any existing interval
    this.stopIntentRefresh();

    // Start new interval to refresh intent every 15 seconds
    this.refreshInterval = setInterval(async () => {
      if (this.intentRefreshCallback) {
        try {
          logger.debug('SwapController: Refreshing swap intent');
          const refreshedIntent = await this.intentRefreshCallback();
          this.capturedIntent = refreshedIntent;
          logger.debug('SwapController: Intent refreshed successfully');
        } catch (error) {
          logger.warn('SwapController: Failed to refresh intent:', error);
        }
      }
    }, 15000); // 15 seconds
  }

  private stopIntentRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // Check if intent is ready for execution
  hasValidIntent(): boolean {
    return !!(this.capturedIntent && this.intentAllowCallback);
  }
}
