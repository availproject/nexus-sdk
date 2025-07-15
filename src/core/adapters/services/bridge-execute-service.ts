import { BaseService } from '../core/base-service';
import { NEXUS_EVENTS, TOKEN_METADATA, CHAIN_METADATA } from '../../../constants';
import { BridgeService } from './bridge-service';
import { ExecuteService } from './execute-service';
import { ApprovalService } from './approval-service';
import { extractErrorMessage, logger } from '../../utils';
import { parseUnits } from 'viem';
import type { ChainAbstractionAdapter } from '../chain-abstraction-adapter';

import type {
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  ExecuteParams,
  ExecuteSimulation,
  SimulationStep,
  SUPPORTED_TOKENS,
} from '../../../types';
import type { ProgressStep } from '@arcana/ca-sdk';

// Local constants for the service
const ADAPTER_CONSTANTS = {
  DEFAULT_DECIMALS: 18,
  APPROVAL_BUFFER_PERCENTAGE: 10000n, // 100%
};

// Type definitions for transaction-related objects
interface TransactionReceipt {
  status: string;
  gasUsed: string;
  blockNumber?: string;
  revertReason?: string;
}

interface Transaction {
  to: string;
  input: string;
  value?: string;
  from?: string;
  gas?: string;
  blockNumber?: string;
}

interface ProviderError extends Error {
  data?: {
    message?: string;
  };
}

export class BridgeExecuteService extends BaseService {
  private bridgeService: BridgeService;
  private executeService: ExecuteService;
  private approvalService: ApprovalService;

  constructor(adapter: ChainAbstractionAdapter) {
    super(adapter);
    this.bridgeService = new BridgeService(adapter);
    this.executeService = new ExecuteService(adapter);
    this.approvalService = new ApprovalService(adapter);
  }

  /**
   * Enable or disable gas estimation for execute transactions
   * This provides easy control over whether gas estimation runs before execution
   */
  public setGasEstimationEnabled(enabled: boolean): void {
    // Access the transaction service through the execute service's public method
    this.executeService.setGasEstimationEnabled(enabled);
  }

  /**
   * Bridge and execute operation - combines bridge and execute with proper sequencing
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    const {
      toChainId,
      token,
      amount,
      execute,
      enableTransactionPolling = false,
      transactionTimeout = 30000,
      waitForReceipt = true,
      receiptTimeout = 300000,
      requiredConfirmations = 1,
    } = params;

    // Declare here so accessible in catch/finally
    let stepForwarder: (step: ProgressStep) => void = () => {};

    try {
      // Set up listeners to capture Arcana bridge steps and forward step completions
      const bridgeStepsPromise: Promise<ProgressStep[]> = new Promise((resolve) => {
        const expectedHandler = (steps: ProgressStep[]) => {
          this.caEvents.off(NEXUS_EVENTS.EXPECTED_STEPS, expectedHandler);
          resolve(steps);
        };
        this.caEvents.on(NEXUS_EVENTS.EXPECTED_STEPS, expectedHandler);
      });

      stepForwarder = (step: ProgressStep) => {
        this.caEvents.emit(NEXUS_EVENTS.BRIDGE_EXECUTE_COMPLETED_STEPS, step);
      };
      this.caEvents.on(NEXUS_EVENTS.STEP_COMPLETE, stepForwarder);

      // Normalize the input amount to ensure consistent processing
      const normalizedAmount = this.normalizeAmountToWei(amount, token);

      // Perform the actual bridge transaction
      const bridgeResult = await this.bridgeService.bridge({
        token,
        amount,
        chainId: toChainId,
      });

      if (!bridgeResult.success) {
        throw new Error(`Bridge failed: ${bridgeResult.error}`);
      }

      // Wait for captured bridge steps
      const bridgeSteps = await bridgeStepsPromise;

      // Prepare extra steps for approval/execute/receipt/confirmation
      const extraSteps: ProgressStep[] = [];

      const makeStep = (
        typeID: string,
        type: string,
        data: Record<string, unknown> = {},
      ): ProgressStep => ({
        typeID,
        type,
        data: {
          chainID: toChainId,
          chainName: CHAIN_METADATA[toChainId]?.name || toChainId.toString(),
          ...data,
        },
      });

      if (execute?.tokenApproval) {
        extraSteps.push(makeStep('AP', 'APPROVAL'));
      }

      if (execute) {
        extraSteps.push(makeStep('TS', 'TRANSACTION_SENT'));
        if (waitForReceipt) {
          extraSteps.push(makeStep('RR', 'RECEIPT_RECEIVED'));
        }
        if ((requiredConfirmations ?? 0) > 0) {
          extraSteps.push(makeStep('CN', 'TRANSACTION_CONFIRMED'));
        }
      }

      // Emit consolidated expected steps for the whole operation
      this.caEvents.emit(NEXUS_EVENTS.BRIDGE_EXECUTE_EXPECTED_STEPS, [
        ...bridgeSteps,
        ...extraSteps,
      ]);

      const { executeTransactionHash, executeExplorerUrl, approvalTransactionHash } =
        await this.handleExecutePhase(
          execute,
          toChainId,
          token,
          normalizedAmount,
          enableTransactionPolling,
          transactionTimeout,
          waitForReceipt,
          receiptTimeout,
          requiredConfirmations,
          // pass helper to emit steps
          (step) => this.caEvents.emit(NEXUS_EVENTS.BRIDGE_EXECUTE_COMPLETED_STEPS, step),
          makeStep,
        );

      const result: BridgeAndExecuteResult = {
        executeTransactionHash,
        executeExplorerUrl,
        approvalTransactionHash,
        toChainId,
        success: true,
      };

      // Clean up listener
      this.caEvents.off(NEXUS_EVENTS.STEP_COMPLETE, stepForwarder);

      return result;
    } catch (error) {
      const errorMessage = extractErrorMessage(error, 'bridge and execute');

      // Forward error step (generic) for UI consumers
      this.caEvents.emit(NEXUS_EVENTS.BRIDGE_EXECUTE_COMPLETED_STEPS, {
        typeID: 'ER',
        type: 'operation.failed',
        data: {
          error: errorMessage,
          stage: errorMessage.includes('Execute phase failed') ? 'execute' : 'bridge',
        },
      });

      // Clean listener
      this.caEvents.off(NEXUS_EVENTS.STEP_COMPLETE, stepForwarder);

      return {
        toChainId,
        success: false,
        error: `Bridge and execute operation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Simulate bridge and execute operation
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    try {
      const { execute } = params;
      const steps: SimulationStep[] = [];

      // Normalize the input amount to ensure consistent processing
      const normalizedAmount = this.normalizeAmountToWei(params.amount, params.token);

      // Perform bridge simulation only
      const bridgeSimulation = await this.bridgeService.simulateBridge({
        token: params.token,
        amount: params.amount,
        chainId: params.toChainId,
      });

      steps.push({
        type: 'bridge',
        required: true,
        simulation: bridgeSimulation,
        description: `Bridge ${params.amount} ${params.token} to chain ${params.toChainId}`,
      });

      // Enhanced bridge analysis
      let bridgeReceiveAmount = '0';
      let totalBridgeFee = '0';

      if (bridgeSimulation?.intent) {
        const intent = bridgeSimulation.intent;

        // Extract destination amount (received amount after bridging)
        if (intent.destination?.amount && intent.destination.amount !== '0') {
          bridgeReceiveAmount = intent.destination.amount;
        }

        // Format bridge fees properly
        if (intent.fees?.total) {
          totalBridgeFee = `${intent.fees.total}`;
        }
      }

      let executeSimulation: ExecuteSimulation | undefined;
      const approvalRequired = false;

      if (execute) {
        try {
          // Use the received amount from bridge simulation for execute simulation
          let receivedAmountForContract = normalizedAmount; // fallback to normalized original amount

          if (bridgeReceiveAmount !== '0') {
            // Get token decimals from bridge simulation
            const tokenDecimals =
              bridgeSimulation?.intent?.token?.decimals || bridgeSimulation?.token?.decimals;

            if (tokenDecimals) {
              const receivedAmountBigInt = parseUnits(bridgeReceiveAmount, tokenDecimals);
              receivedAmountForContract = receivedAmountBigInt.toString();
            }
          }

          // Use the smart parameter replacement logic
          const { modifiedParams: modifiedExecuteParams } = this.replaceAmountInExecuteParams(
            execute,
            normalizedAmount,
            receivedAmountForContract,
            params.token,
          );

          executeSimulation = await this.executeService.simulateExecuteEnhanced({
            ...modifiedExecuteParams,
            toChainId: params.toChainId,
            tokenApproval: {
              token: params.token,
              amount: receivedAmountForContract,
            },
          });
          if (executeSimulation) {
            steps.push({
              type: 'execute',
              required: true,
              simulation: executeSimulation,
              description: `Execute ${execute.functionName} on contract ${execute.contractAddress}`,
            });
          }

          // Execute analysis details are available in the simulation result
        } catch (simulationError) {
          logger.warn(`Execute simulation error: ${simulationError}`);
          executeSimulation = {
            gasUsed: '0',
            success: false,
            error: `Simulation failed: ${simulationError}`,
          };

          steps.push({
            type: 'execute',
            required: true,
            simulation: executeSimulation,
            description: `Execute ${execute.functionName} on contract ${execute.contractAddress} (failed)`,
          });
        }
      }

      // Calculate enhanced total cost with approval step
      let totalEstimatedCost:
        | { total: string; breakdown: { bridge: string; execute: string } }
        | undefined;

      if (totalBridgeFee !== '0' || executeSimulation?.gasUsed) {
        logger.debug('DEBUG bridge-execute-service - totalBridgeFee (ETH):', totalBridgeFee);
        logger.debug(
          'DEBUG bridge-execute-service - executeSimulation?.gasUsed:',
          executeSimulation?.gasUsed,
        );

        try {
          const executeFee = executeSimulation?.gasCostEth || executeSimulation?.gasUsed || '0';
          logger.debug('DEBUG bridge-execute-service - executeFee source value:', executeFee);

          let executeFeeEth = executeFee;

          // If gasCostEth wasn't available, executeFee will be gas units – convert.
          if (executeSimulation?.gasCostEth === undefined) {
            logger.debug('DEBUG bridge-execute-service - executeFee (gas units):', executeFee);

            try {
              // Get the current gas price from the connected provider (wei, hex string)
              const gasPriceHex = (await this.evmProvider.request({
                method: 'eth_gasPrice',
              })) as string;
              const gasPriceWei = parseInt(gasPriceHex, 16);

              // gasUsed (string) * gasPriceWei (number) => wei, then convert to ETH
              const gasUsedNum = parseFloat(executeFee);
              const costEthNum = (gasUsedNum * gasPriceWei) / 1e18; // 1e18 wei per ETH
              executeFeeEth = costEthNum.toFixed(8); // keep reasonable precision
            } catch (gpErr) {
              logger.warn('Failed to fetch gas price for execute fee conversion:', gpErr);
            }
          }
          logger.debug('DEBUG bridge-execute-service - executeFee (ETH):', executeFeeEth);

          // Add bridge fee (already an ETH figure) with converted execute fee
          const totalFeeEth = (parseFloat(totalBridgeFee) + parseFloat(executeFeeEth)).toString();
          logger.debug('DEBUG bridge-execute-service - totalFeeEth:', totalFeeEth);

          totalEstimatedCost = {
            total: totalFeeEth,
            breakdown: {
              bridge: totalBridgeFee,
              execute: executeFeeEth,
            },
          };
        } catch (error) {
          logger.warn('Could not calculate total cost - cost breakdown may be incomplete:', error);
        }
      }

      return {
        steps,
        bridgeSimulation,
        executeSimulation,
        totalEstimatedCost,
        success: true,
        metadata: {
          bridgeReceiveAmount: bridgeReceiveAmount !== '0' ? bridgeReceiveAmount : '0',
          bridgeFee: totalBridgeFee.replace(' ETH', '') || '0',
          inputAmount: params.amount.toString(),
          targetChain: params.toChainId,
          approvalRequired,
        },
      };
    } catch (error) {
      return {
        steps: [],
        bridgeSimulation: null,
        executeSimulation: undefined,
        success: false,
        error: `Simulation failed: ${extractErrorMessage(error, 'simulation')}`,
      };
    }
  }

  /**
   * Handle the execute phase of bridge and execute
   */
  private async handleExecutePhase(
    execute: Omit<ExecuteParams, 'toChainId'> | undefined,
    toChainId: number,
    bridgeToken: SUPPORTED_TOKENS,
    bridgeAmount: string,
    enableTransactionPolling: boolean,
    transactionTimeout: number,
    waitForReceipt?: boolean,
    receiptTimeout?: number,
    requiredConfirmations?: number,
    emitStep?: (step: ProgressStep) => void,
    makeStep?: (typeID: string, type: string, data?: Record<string, unknown>) => ProgressStep,
  ): Promise<{
    executeTransactionHash?: string;
    executeExplorerUrl?: string;
    approvalTransactionHash?: string;
  }> {
    if (!execute || !emitStep || !makeStep) return {};

    try {
      // Debug logging to understand amount handling
      logger.info('DEBUG handleExecutePhase - Bridge amount:', bridgeAmount);
      logger.info('DEBUG handleExecutePhase - Bridge token:', bridgeToken);
      logger.info('DEBUG handleExecutePhase - Original execute params:', execute.functionParams);
      logger.info(
        'DEBUG handleExecutePhase - Token approval amount:',
        execute.tokenApproval?.amount,
      );

      let approvalTransactionHash: string | undefined;

      // Step 1: Automatically handle contract approval if needed
      if (execute.tokenApproval) {
        logger.info('DEBUG handleExecutePhase - Requesting approval for:', {
          token: bridgeToken,
          amount: bridgeAmount,
          spender: execute.contractAddress,
          chainId: toChainId,
        });

        const approvalResult = await this.approvalService.ensureContractApproval(
          {
            token: bridgeToken,
            amount: bridgeAmount,
          },
          execute.contractAddress,
          toChainId,
        );

        if (approvalResult.error) {
          emitStep(
            makeStep('AP', 'approval', {
              error: approvalResult.error,
            }),
          );
          throw new Error(`Approval failed: ${approvalResult.error}`);
        }

        if (approvalResult.wasNeeded && approvalResult.transactionHash) {
          approvalTransactionHash = approvalResult.transactionHash;
          emitStep(
            makeStep('AP', 'approval', {
              txHash: approvalTransactionHash,
            }),
          );
        } else {
          emitStep(
            makeStep('AP', 'approval', {
              skipped: true,
            }),
          );
        }
      }

      // Step 2: Execute the target contract call
      logger.info('DEBUG handleExecutePhase - Executing contract call with params:', {
        ...execute,
        toChainId,
        tokenApproval: {
          token: bridgeToken,
          amount: bridgeAmount,
        },
      });

      const executeResult = await this.executeService.execute({
        ...execute,
        toChainId,
        enableTransactionPolling,
        transactionTimeout,
        waitForReceipt,
        receiptTimeout,
        requiredConfirmations,
        tokenApproval: {
          token: bridgeToken,
          amount: bridgeAmount,
        },
      });

      // Check if we should verify transaction success
      if (executeResult.transactionHash) {
        // Transaction sent step
        emitStep(
          makeStep('TS', 'transaction.sent', {
            txHash: executeResult.transactionHash,
          }),
        );
      }

      if (waitForReceipt && executeResult.transactionHash) {
        logger.info(
          'DEBUG handleExecutePhase - Checking transaction success for:',
          executeResult.transactionHash,
        );

        const transactionCheck = await this.checkTransactionSuccess(
          executeResult.transactionHash,
          toChainId,
        );

        if (!transactionCheck.success) {
          logger.error('DEBUG handleExecutePhase - Transaction failed:', transactionCheck.error);
          emitStep(
            makeStep('EX', 'execute', {
              error: transactionCheck.error,
            }),
          );
          throw new Error(`Execute transaction failed: ${transactionCheck.error}`);
        }

        logger.info(
          'DEBUG handleExecutePhase - Transaction succeeded with gas used:',
          transactionCheck.gasUsed,
        );

        // Emit receipt received step
        emitStep(
          makeStep('RR', 'receipt.received', {
            txHash: executeResult.transactionHash,
          }),
        );

        // Emit confirmation step if requiredConfirmations met
        if ((requiredConfirmations ?? 0) > 0) {
          emitStep(
            makeStep('CN', 'transaction.confirmed', {
              confirmations: requiredConfirmations,
            }),
          );
        }
      }

      return {
        executeTransactionHash: executeResult.transactionHash,
        executeExplorerUrl: executeResult.explorerUrl,
        approvalTransactionHash,
      };
    } catch (executeError) {
      logger.error('DEBUG handleExecutePhase - Execute error:', executeError as Error);
      emitStep(makeStep('EX', 'execute', { error: (executeError as Error).message }));
      throw new Error(
        `Execute phase failed: ${extractErrorMessage(executeError, 'execute phase')}`,
      );
    }
  }

  /**
   * Normalize amount input to wei format for consistent processing
   * Supports various input formats and automatically handles token decimals
   */
  private normalizeAmountToWei(amount: string | number, token: string): string {
    try {
      // Convert to string if it's a number
      const amountStr = amount.toString();

      logger.info('DEBUG normalizeAmountToWei - Input:', { amount: amountStr, token });

      // Handle edge cases
      if (!amountStr || amountStr === '0') {
        return '0';
      }

      // Get token metadata for accurate decimal handling
      const tokenUpper = token.toUpperCase();
      const tokenMetadata = TOKEN_METADATA[tokenUpper];
      const decimals = tokenMetadata?.decimals || ADAPTER_CONSTANTS?.DEFAULT_DECIMALS || 18;

      logger.info('DEBUG normalizeAmountToWei - Token info:', {
        tokenUpper,
        decimals,
        tokenMetadata,
      });

      // If it's already in wei format (no decimals, large number), return as-is
      // Check length to avoid converting small integers to wei incorrectly
      if (!amountStr.includes('.') && amountStr.length > 10) {
        logger.info('DEBUG normalizeAmountToWei - Already in wei format');
        return amountStr;
      }

      // Handle hex values
      if (amountStr.startsWith('0x')) {
        const result = BigInt(amountStr).toString();
        logger.info(`DEBUG normalizeAmountToWei - Hex conversion: ${result}`);
        return result;
      }

      // Handle decimal amounts (need conversion to wei)
      if (amountStr.includes('.')) {
        const result = parseUnits(amountStr, decimals).toString();
        logger.info(`DEBUG normalizeAmountToWei - Decimal conversion: ${amountStr} -> ${result}`);
        return result;
      }

      // Handle whole number inputs
      const numValue = parseFloat(amountStr);

      // For USDC specifically, be more careful with the conversion
      // USDC typically has 6 decimals, so 1 USDC = 1,000,000 micro-USDC
      const USDC_MICRO_UNITS_THRESHOLD = 1_000_000; // 1 USDC

      if (tokenUpper === 'USDC') {
        // For USDC, small numbers (< 1,000,000) are likely user amounts that need conversion
        if (numValue < USDC_MICRO_UNITS_THRESHOLD) {
          const result = parseUnits(amountStr, 6).toString();
          logger.info(
            `DEBUG normalizeAmountToWei - USDC user amount conversion: ${amountStr} -> ${result}`,
          );
          return result;
        } else {
          // Larger numbers are likely already in micro-USDC
          logger.info('DEBUG normalizeAmountToWei - USDC already in micro format');
          return amountStr;
        }
      }

      // For small whole numbers, likely represent user-friendly amounts (e.g., "1" ETH)
      // For larger numbers, likely already in wei format
      if (numValue < 1000 || (tokenMetadata?.decimals === 6 && numValue < 1000000)) {
        // Convert small numbers as user-friendly amounts
        const result = parseUnits(amountStr, decimals).toString();
        logger.info(
          `DEBUG normalizeAmountToWei - User amount conversion: ${amountStr} -> ${result}`,
        );
        return result;
      } else {
        // Assume larger numbers are already in the correct format
        logger.info('DEBUG normalizeAmountToWei - Already in correct format');
        return amountStr;
      }
    } catch (error) {
      // If conversion fails, return original
      logger.warn(`Failed to normalize amount ${amount} for token ${token}:`, error);
      return amount.toString();
    }
  }

  /**
   * Smart parameter replacement that handles various input types and payable functions
   */
  private replaceAmountInExecuteParams(
    execute: Omit<ExecuteParams, 'toChainId'>,
    originalAmount: string,
    bridgeReceivedAmount: string,
    token: string,
  ): { modifiedParams: Omit<ExecuteParams, 'toChainId'>; parameterReplaced: boolean } {
    const modifiedExecuteParams = { ...execute };
    let parameterReplaced = false;

    // Normalize amounts to ensure consistent comparison
    const normalizedOriginal = this.normalizeAmountToWei(originalAmount, token);
    const normalizedReceived = this.normalizeAmountToWei(bridgeReceivedAmount, token);

    logger.info('DEBUG replaceAmountInExecuteParams:', {
      originalAmount,
      bridgeReceivedAmount,
      normalizedOriginal,
      normalizedReceived,
      token,
      functionParams: execute.functionParams,
    });

    // If the amounts are the same, no replacement needed
    if (normalizedOriginal === normalizedReceived) {
      logger.info('DEBUG replaceAmountInExecuteParams - Amounts are equal, no replacement needed');
      return { modifiedParams: modifiedExecuteParams, parameterReplaced: false };
    }

    // Handle payable functions (replace value field)
    if (execute.value && execute.value !== '0x0' && execute.value !== '0') {
      logger.info(
        `DEBUG replaceAmountInExecuteParams - Replacing value field: ${execute.value} -> ${normalizedReceived}`,
      );
      modifiedExecuteParams.value = normalizedReceived;
      parameterReplaced = true;
    }

    // Handle function parameters for non-payable functions or additional parameters
    if (execute.functionParams && Array.isArray(execute.functionParams)) {
      const modifiedParams = [...execute.functionParams];

      // Try to find and replace amount parameters if we haven't replaced value field
      if (!parameterReplaced) {
        for (let i = 0; i < modifiedParams.length; i++) {
          const param = modifiedParams[i];
          const paramStr = param?.toString();

          if (!paramStr) continue;

          // Check for various types of matches
          const isExactMatch = paramStr === normalizedOriginal || paramStr === originalAmount;
          const isNumericSimilar = this.isAmountSimilar(paramStr, normalizedOriginal, 0.001);
          const isLikelyAmount = this.isLikelyAmountParameter(paramStr, i);

          logger.info(`DEBUG replaceAmountInExecuteParams - Param ${i}:`, {
            param: paramStr,
            isExactMatch,
            isNumericSimilar,
            isLikelyAmount,
          });

          if (isExactMatch || isNumericSimilar || isLikelyAmount) {
            logger.info(
              `DEBUG replaceAmountInExecuteParams - Replacing param ${i}: ${paramStr} -> ${normalizedReceived}`,
            );
            modifiedParams[i] = normalizedReceived;
            parameterReplaced = true;
            break;
          }
        }
      }

      modifiedExecuteParams.functionParams = modifiedParams;
    }

    logger.info('DEBUG replaceAmountInExecuteParams - Result:', {
      parameterReplaced,
      originalParams: execute.functionParams,
      modifiedParams: modifiedExecuteParams.functionParams,
    });

    return { modifiedParams: modifiedExecuteParams, parameterReplaced };
  }

  /**
   * Check if two amounts are similar within a tolerance
   */
  private isAmountSimilar(amount1: string, amount2: string, tolerance: number): boolean {
    try {
      const val1 = BigInt(amount1);
      const val2 = BigInt(amount2);

      if (val1 === val2) return true;

      // Check percentage difference
      const diff = val1 > val2 ? val1 - val2 : val2 - val1;
      const larger = val1 > val2 ? val1 : val2;

      // Avoid division by zero
      if (larger === 0n) return diff === 0n;

      // Calculate percentage difference (multiply by 1000 to avoid floating point)
      const percentDiff = (diff * 1000n) / larger;
      return percentDiff <= BigInt(Math.floor(tolerance * 1000));
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if amount parameter is likely to be an amount-related parameter
   */
  private isLikelyAmountParameter(paramStr: string, index: number): boolean {
    // Check if it's a numeric string that could represent an amount
    if (!/^\d+$/.test(paramStr)) return false;

    // If it's the first or second parameter, it's more likely to be an amount
    if (index <= 1) return true;

    // Check if the value is reasonably sized (not too small, not too large)
    const numValue = BigInt(paramStr);
    return numValue > 0n && numValue < BigInt('1000000000000000000000000'); // Less than 1M tokens with 18 decimals
  }

  /**
   * Get transaction receipt with retry logic
   * Note: Assumes we're already on the correct chain (handled by checkTransactionSuccess)
   */
  private async getTransactionReceipt(
    txHash: string,
    maxRetries: number = 3,
  ): Promise<TransactionReceipt> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const receipt = (await this.adapter.evmProvider?.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        })) as unknown;

        if (receipt && receipt !== null) {
          // Type guard to ensure receipt has the expected structure
          if (typeof receipt === 'object' && receipt !== null && 'status' in receipt) {
            return receipt as TransactionReceipt;
          }
        }

        // If no receipt yet, wait a bit before retrying
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        logger.warn(`Attempt ${i + 1} to get receipt failed:`, error);
        if (i === maxRetries - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error(`Failed to get transaction receipt after ${maxRetries} attempts`);
  }

  /**
   * Simulate a failed transaction to get the revert reason
   * Note: Assumes we're already on the correct chain (handled by checkTransactionSuccess)
   */
  private async simulateFailedTransaction(txHash: string): Promise<string | null> {
    try {
      // Get the original transaction details
      const tx = (await this.adapter.evmProvider?.request({
        method: 'eth_getTransactionByHash',
        params: [txHash],
      })) as unknown;

      if (!tx || tx === null) {
        return null;
      }

      // Type guard to ensure transaction has required properties
      if (typeof tx !== 'object' || tx === null) {
        return 'Invalid transaction data';
      }

      const transaction = tx as Transaction;
      if (!transaction.to || !transaction.input) {
        return 'Invalid transaction data';
      }

      // Get the transaction receipt to find the block number where it failed
      const receipt = (await this.adapter.evmProvider?.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      })) as unknown;

      // Use the block number where the transaction was mined, or the previous block
      // This ensures we simulate the exact state when the transaction failed
      let simulationBlock = 'latest';

      if (receipt && typeof receipt === 'object' && receipt !== null && 'blockNumber' in receipt) {
        const receiptTyped = receipt as TransactionReceipt;
        if (receiptTyped.blockNumber) {
          simulationBlock = `0x${(parseInt(receiptTyped.blockNumber, 16) - 1).toString(16)}`;
        }
      } else if (transaction.blockNumber) {
        simulationBlock = transaction.blockNumber;
      }

      logger.info(`DEBUG simulateFailedTransaction - Simulating at block: ${simulationBlock}`);

      // Simulate the transaction call to get revert reason
      await this.adapter.evmProvider?.request({
        method: 'eth_call',
        params: [
          {
            to: transaction.to,
            data: transaction.input,
            value: transaction.value || '0x0',
            from: transaction.from,
            gas: transaction.gas,
          },
          simulationBlock,
        ],
      });

      // If eth_call succeeds when we expected it to fail, this is suspicious
      // The original transaction failed but the simulation passes
      logger.warn(
        'DEBUG simulateFailedTransaction - eth_call succeeded but original transaction failed. This might indicate a state-dependent failure.',
      );
      return 'Transaction failed due to state changes or gas issues';
    } catch (error: unknown) {
      logger.info(
        'DEBUG simulateFailedTransaction - eth_call failed as expected, extracting revert reason',
      );

      // This is the expected path - eth_call should fail and give us the revert reason
      // Extract revert reason from error
      if (error && typeof error === 'object' && 'data' in error) {
        const providerError = error as ProviderError;
        if (providerError.data?.message) {
          return providerError.data.message;
        }
      }

      if (error && typeof error === 'object' && 'message' in error) {
        const errorWithMessage = error as { message: string };

        // Parse common revert reason patterns
        const revertMatch = errorWithMessage.message.match(/revert (.+?)(?:\s|$)/i);
        if (revertMatch) {
          return revertMatch[1];
        }

        // Check for execution reverted patterns
        if (errorWithMessage.message.includes('execution reverted')) {
          const cleanMessage = errorWithMessage.message.replace('execution reverted: ', '').trim();
          return cleanMessage || 'Transaction reverted without reason';
        }

        // Handle other common error patterns
        if (errorWithMessage.message.includes('insufficient funds')) {
          return 'Insufficient funds for gas * price + value';
        }

        if (errorWithMessage.message.includes('gas required exceeds allowance')) {
          return 'Out of gas';
        }

        return errorWithMessage.message;
      }

      return 'Transaction simulation failed';
    }
  }

  /**
   * Check transaction success and get detailed error information
   */
  private async checkTransactionSuccess(
    txHash: string,
    chainId: number,
    maxRetries: number = 5,
    retryDelay: number = 3000,
  ): Promise<{
    success: boolean;
    error?: string;
    gasUsed?: string;
  }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `DEBUG checkTransactionSuccess - Attempt ${attempt}/${maxRetries}: Checking transaction: ${txHash} on chain: ${chainId}`,
        );

        // Ensure we're on the correct chain before checking transaction
        const currentChainId = (await this.adapter.evmProvider?.request({
          method: 'eth_chainId',
        })) as string;
        const currentChainIdDecimal = parseInt(currentChainId, 16);

        if (currentChainIdDecimal !== chainId) {
          logger.info(
            `DEBUG checkTransactionSuccess - Switching from chain ${currentChainIdDecimal} to ${chainId}`,
          );
          try {
            await this.adapter.evmProvider?.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${chainId.toString(16)}` }],
            });
            // Wait a bit after chain switch
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } catch (switchError) {
            logger.error(
              `DEBUG checkTransactionSuccess - Failed to switch to chain ${chainId}:`,
              switchError as Error,
            );
            return {
              success: false,
              error: `Failed to switch to chain ${chainId} for transaction verification`,
            };
          }
        }

        // 1. Get transaction receipt - basic success/failure
        const receipt = await this.getTransactionReceipt(txHash);

        if (!receipt) {
          if (attempt < maxRetries) {
            logger.info(
              `DEBUG checkTransactionSuccess - Receipt not found, retrying in ${retryDelay}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue; // Retry
          }

          return {
            success: false,
            error: 'Transaction receipt not found after multiple attempts',
          };
        }

        logger.info(`DEBUG checkTransactionSuccess - Receipt status: ${receipt.status}`);

        // Check if transaction succeeded
        if (receipt.status === '0x1') {
          return {
            success: true,
            gasUsed: receipt.gasUsed,
          };
        }

        // Transaction failed - now get the error reason
        let errorMessage = 'Transaction failed';

        // 2. Try to get revert reason from receipt (some providers include this)
        if (receipt.revertReason) {
          errorMessage = receipt.revertReason;
        } else {
          // 3. Simulate the transaction to get detailed error
          try {
            const simulationError = await this.simulateFailedTransaction(txHash);
            if (simulationError) {
              errorMessage = simulationError;
            }
          } catch (simError) {
            logger.warn('DEBUG checkTransactionSuccess - Simulation failed:', simError);
            // Keep generic error message if simulation fails
          }
        }

        logger.info(`DEBUG checkTransactionSuccess - Final error: ${errorMessage}`);

        return {
          success: false,
          error: errorMessage,
          gasUsed: receipt.gasUsed,
        };
      } catch (error) {
        logger.error(`DEBUG checkTransactionSuccess - Attempt ${attempt} failed:`, error as Error);

        if (attempt < maxRetries) {
          logger.info(`DEBUG checkTransactionSuccess - Retrying in ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue; // Retry
        }

        // Final attempt failed
        return {
          success: false,
          error: `Failed to check transaction status after ${maxRetries} attempts: ${extractErrorMessage(error, 'transaction check')}`,
        };
      }
    }

    // This should never be reached, but just in case
    return {
      success: false,
      error: `Transaction check failed after ${maxRetries} attempts`,
    };
  }
}
