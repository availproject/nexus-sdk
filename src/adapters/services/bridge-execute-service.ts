import { BaseService } from '../core/base-service';
import { NEXUS_EVENTS, TOKEN_METADATA } from '../../constants';
import { BridgeService } from './bridge-service';
import { ExecuteService } from './execute-service';
import { ApprovalService } from './approval-service';
import { extractErrorMessage } from '../../utils';
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
} from '../../types';

// Local constants for the service
const ADAPTER_CONSTANTS = {
  DEFAULT_DECIMALS: 18,
  APPROVAL_BUFFER_PERCENTAGE: 10000n, // 100%
};

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
      waitForReceipt = false,
      receiptTimeout = 300000,
      requiredConfirmations = 1,
    } = params;

    try {
      this.emitOperationEvents.started('OPERATION', { toChainId, hasExecute: !!execute });
      this.emitOperationEvents.started('BRIDGE', { toChainId, token, amount });

      const bridgeResult = await this.bridgeService.bridge({
        token,
        amount,
        chainId: toChainId,
      });

      if (!bridgeResult.success) {
        this.emitOperationEvents.failed(
          'BRIDGE',
          new Error(bridgeResult.error ?? 'Bridge failed'),
          'bridge',
        );
        throw new Error(`Bridge failed: ${bridgeResult.error}`);
      }

      this.emitOperationEvents.completed('BRIDGE', {
        success: true,
        toChainId,
      });

      // Get the actual bridge output amount for token approval
      let bridgeOutputAmount = this.normalizeAmountToWei(amount, token);

      // Try to get the actual received amount from bridge result
      // In a real implementation, we'd get this from the bridge transaction result
      // For now, use the original amount as fallback

      const { executeTransactionHash, executeExplorerUrl, approvalTransactionHash } =
        await this.handleExecutePhase(
          execute,
          toChainId,
          token,
          bridgeOutputAmount,
          enableTransactionPolling,
          transactionTimeout,
          waitForReceipt,
          receiptTimeout,
          requiredConfirmations,
        );

      const result: BridgeAndExecuteResult = {
        executeTransactionHash,
        executeExplorerUrl,
        approvalTransactionHash,
        toChainId,
      };

      this.emitOperationEvents.completed('OPERATION', {
        ...result,
        success: true,
      });
      return result;
    } catch (error) {
      const errorMessage = extractErrorMessage(error, 'bridge and execute');
      const stage = errorMessage.includes('Execute phase failed') ? 'execute' : 'bridge';

      // Emit error with stage information using the helper
      this.emitOperationEvents.failed('OPERATION', error, 'bridge and execute', stage);

      throw new Error(`Bridge and execute operation failed: ${errorMessage}`);
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
      let approvalRequired = false;

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

          executeSimulation = await this.executeService.simulateExecute({
            ...modifiedExecuteParams,
            toChainId: params.toChainId,
            tokenApproval: {
              token: params.token,
              amount: receivedAmountForContract,
            },
          });

          steps.push({
            type: 'execute',
            required: true,
            simulation: executeSimulation,
            description: `Execute ${execute.functionName} on contract ${execute.contractAddress}`,
          });

          // Execute analysis details are available in the simulation result
        } catch (simulationError) {
          console.warn(`Execute simulation error: ${simulationError}`);
          executeSimulation = {
            gasUsed: '0',
            gasPrice: '0',
            totalFee: '0',
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

      if (totalBridgeFee !== '0' || executeSimulation?.totalFee) {
        try {
          const bridgeFeeEth = totalBridgeFee ? parseFloat(totalBridgeFee.replace(' ETH', '')) : 0;

          const executeFeeEth = executeSimulation?.success
            ? parseFloat(executeSimulation.totalFee)
            : 0;
          const totalFee = bridgeFeeEth + executeFeeEth;

          totalEstimatedCost = {
            total: totalFee.toFixed(6),
            breakdown: {
              bridge: totalBridgeFee,
              execute: parseFloat(executeSimulation?.totalFee || '0').toFixed(6),
            },
          };
        } catch (error) {
          console.warn('Could not calculate total cost - cost breakdown may be incomplete');
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
  ): Promise<{
    executeTransactionHash?: string;
    executeExplorerUrl?: string;
    approvalTransactionHash?: string;
  }> {
    if (!execute) return {};

    try {
      let approvalTransactionHash: string | undefined;

      // Step 1: Automatically handle contract approval if needed
      if (execute.tokenApproval) {
        this.emitOperationEvents.started('APPROVAL', {
          token: execute.tokenApproval.token,
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
          this.emitOperationEvents.failed('APPROVAL', new Error(approvalResult.error), 'approval');
          throw new Error(`Approval failed: ${approvalResult.error}`);
        }

        if (approvalResult.wasNeeded && approvalResult.transactionHash) {
          approvalTransactionHash = approvalResult.transactionHash;
          this.emitOperationEvents.completed('APPROVAL', {
            transactionHash: approvalResult.transactionHash,
            token: execute.tokenApproval.token,
            spender: execute.contractAddress,
          });
        } else {
          this.caEvents.emit(NEXUS_EVENTS.APPROVAL_SKIPPED, {
            token: execute.tokenApproval.token,
            spender: execute.contractAddress,
            reason: 'Approval already exists',
          });
        }
      }

      // Step 2: Execute the target contract call
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

      return {
        executeTransactionHash: executeResult.transactionHash,
        executeExplorerUrl: executeResult.explorerUrl,
        approvalTransactionHash,
      };
    } catch (executeError) {
      this.emitOperationEvents.failed('OPERATION', executeError, 'execute phase', 'execute');
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

      // Handle edge cases
      if (!amountStr || amountStr === '0') {
        return '0';
      }

      // Get token metadata for accurate decimal handling
      const tokenUpper = token.toUpperCase();
      const tokenMetadata = TOKEN_METADATA[tokenUpper];
      const decimals = tokenMetadata?.decimals || ADAPTER_CONSTANTS?.DEFAULT_DECIMALS || 18;

      // If it's already in wei format (no decimals, large number), return as-is
      // Check length to avoid converting small integers to wei incorrectly
      if (!amountStr.includes('.') && amountStr.length > 10) {
        return amountStr;
      }

      // Handle hex values
      if (amountStr.startsWith('0x')) {
        return BigInt(amountStr).toString();
      }

      // Handle decimal amounts (need conversion to wei)
      if (amountStr.includes('.')) {
        return parseUnits(amountStr, decimals).toString();
      }

      // Handle whole number inputs
      const numValue = parseFloat(amountStr);

      // For small whole numbers, likely represent user-friendly amounts (e.g., "1" ETH)
      // For larger numbers, likely already in wei format
      if (numValue < 1000 || (tokenMetadata?.decimals === 6 && numValue < 1000000)) {
        // Convert small numbers as user-friendly amounts
        return parseUnits(amountStr, decimals).toString();
      } else {
        // Assume larger numbers are already in the correct format
        return amountStr;
      }
    } catch (error) {
      // If conversion fails, return original
      console.warn(`Failed to normalize amount ${amount} for token ${token}:`, error);
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

    // Handle payable functions (replace value field)
    if (execute.value && execute.value !== '0x0' && execute.value !== '0') {
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

          if (isExactMatch || isNumericSimilar || isLikelyAmount) {
            modifiedParams[i] = normalizedReceived;
            parameterReplaced = true;
            break;
          }
        }
      }

      modifiedExecuteParams.functionParams = modifiedParams;
    }

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
   * Determine if a parameter is likely an amount based on its value and position
   */
  private isLikelyAmountParameter(paramStr: string, index: number): boolean {
    try {
      const value = BigInt(paramStr);

      // Must be positive
      if (value <= 0n) return false;

      // Amount parameters are often at index 1 (after address) or index 0
      const isLikelyPosition = index <= 2;

      // Should be a reasonable number (not too small, not an address-like number)
      const valueStr = value.toString();
      const isReasonableSize = valueStr.length >= 4 && valueStr.length <= 30;

      // Not a small enum-like value
      const notEnum = value > 100n;

      return isLikelyPosition && isReasonableSize && notEnum;
    } catch (e) {
      return false;
    }
  }
}
