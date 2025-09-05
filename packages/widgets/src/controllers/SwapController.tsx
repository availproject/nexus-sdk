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
  type SwapIntent,
  parseUnits,
  TOKEN_METADATA,
  SwapIntentHook,
} from '@nexus/commons';
import { getTokenAddress } from '../utils/token-utils';
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

  private capturedIntent: SwapIntent | undefined = undefined;
  private intentAllowCallback: (() => void) | null = null;
  private intentRefreshCallback: (() => Promise<SwapIntent>) | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  private lastLoggedValidationState = '';

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
      const currentState = 'missing-fields';
      if (this.lastLoggedValidationState !== currentState) {
        logger.warn('SwapController: Missing required fields', inputData);
        this.lastLoggedValidationState = currentState;
      }
      return false;
    }

    // Get the amount from the correct field - check inputData.amount as well for form compatibility
    const amount = inputData.fromAmount || inputData.amount;
    const amountNum = parseFloat(amount?.toString() || '0');
    const isValidAmount = !isNaN(amountNum) && amountNum > 0;

    // Only log when validation state changes to reduce noise
    const currentState = `${hasRequiredFields ? 'fields-ok' : 'missing-fields'}-${isValidAmount ? 'amount-ok' : 'amount-invalid'}-${amount}`;
    if (this.lastLoggedValidationState !== currentState) {
      logger.debug('SwapController: Input validation', {
        hasRequiredFields,
        isValidAmount,
        amount,
      });
      this.lastLoggedValidationState = currentState;
    }

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
        throw new Error(
          'sdk.swap is not available. Please ensure you are using a version of @nexus/core that includes swap functionality.',
        );
      }

      this.capturedIntent = undefined;

      logger.info('SwapController: Swap input data', inputData);

      // Convert SwapInputData to SwapInput format for SDK
      // Get amount from correct field - prioritize fromAmount, fall back to amount
      const fromAmountStr = inputData.fromAmount || inputData.amount || '0';
      const fromAmountNumber = parseFloat(fromAmountStr.toString());

      // Validate amount before proceeding
      if (isNaN(fromAmountNumber) || fromAmountNumber <= 0) {
        throw new Error('Invalid amount provided for swap');
      }

      // Use enhanced token address resolution that supports destination swap tokens
      const actualFromTokenAddress = getTokenAddress(
        inputData.fromTokenAddress,
        inputData.fromChainID,
        'swap',
      );
      const actualToTokenAddress = getTokenAddress(
        inputData.toTokenAddress,
        inputData.toChainID,
        'swap',
      );
      const swapInput: SwapInput = {
        fromChainID: inputData.fromChainID,
        toChainID: inputData.toChainID,
        fromTokenAddress: actualFromTokenAddress as `0x${string}`,
        toTokenAddress: actualToTokenAddress as `0x${string}`,
        fromAmount: parseUnits(
          fromAmountStr.toString(),
          TOKEN_METADATA[inputData?.fromTokenAddress]?.decimals,
        ),
      };

      logger.info('SwapController: Prepared Swap input data', swapInput);

      return new Promise<SwapSimulationResult>((resolve) => {
        sdk
          .swap(swapInput, {
            swapIntentHook: async (data: SwapIntentHook) => {
              logger.info('SwapController: Intent captured successfully', data.intent);
              console.log('SwapController: Intent captured successfully', data.intent);

              // Store intent and callbacks for later execution
              this.capturedIntent = data.intent;
              this.intentAllowCallback = data.allow;
              this.intentRefreshCallback = data.refresh;

              // Start refresh interval for intent
              setTimeout(() => {
                this.startIntentRefresh();
              }, 5000);

              // Resolve immediately with simulation result once intent is captured
              resolve({
                success: true,
                intent: this.capturedIntent,
                swapMetadata: {
                  type: 'swap' as const,
                  inputToken: swapInput.fromTokenAddress,
                  outputToken: swapInput.toTokenAddress,
                  fromChainId: swapInput.fromChainID,
                  toChainId: swapInput.toChainID,
                  inputAmount: swapInput.fromAmount.toString(),
                  outputAmount:
                    (this.capturedIntent as unknown as SwapIntent).destination?.amount.toString() ??
                    '0',
                },
                allowance: {
                  needsApproval: false,
                  chainDetails: [],
                },
              });
            },
          })
          .then((result) => {
            logger.info('SwapController: Swap result', result);
            console.log('SwapController: Swap result', result);

            if (!result?.success) {
              throw new Error(`Swap failed: ${result?.error || 'Unknown error'}`);
            }

            return result;
          })
          .catch((error) => {
            logger.error('SwapController: Intent capture failed', error as Error);

            // Provide more specific error messages based on the error type
            let errorMessage = 'Failed to capture swap intent';
            if (error instanceof Error) {
              if (error.message.includes('timeout') || error.message.includes('timed out')) {
                errorMessage = 'Swap quote request timed out. Please try again.';
              } else if (error.message.includes('quote') || error.message.includes('400')) {
                errorMessage =
                  'Unable to get swap quote. Please verify your token selection and amount.';
              } else if (error.message.includes('network') || error.message.includes('fetch')) {
                errorMessage =
                  'Network error occurred. Please check your connection and try again.';
              } else if (error.message.includes('Invalid amount')) {
                errorMessage = 'Please enter a valid amount greater than 0.';
              } else {
                errorMessage = error.message;
              }
            }

            resolve({
              success: false,
              error: errorMessage,
              allowance: {
                needsApproval: false,
                chainDetails: [],
              },
            });
          });
      });
    } catch (error) {
      logger.error('SwapController: Intent capture failed', error as Error);

      // Provide more specific error messages based on the error type
      let errorMessage = 'Failed to capture swap intent';
      if (error instanceof Error) {
        if (error.message.includes('timeout') || error.message.includes('timed out')) {
          errorMessage = 'Swap quote request timed out. Please try again.';
        } else if (error.message.includes('quote') || error.message.includes('400')) {
          errorMessage = 'Unable to get swap quote. Please verify your token selection and amount.';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage = 'Network error occurred. Please check your connection and try again.';
        } else if (error.message.includes('Invalid amount')) {
          errorMessage = 'Please enter a valid amount greater than 0.';
        } else {
          errorMessage = error.message;
        }
      }

      return {
        success: false,
        error: errorMessage,
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
  getCapturedIntent(): SwapIntent | undefined {
    return this.capturedIntent;
  }

  clearCapturedIntent(): void {
    this.capturedIntent = undefined;
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
