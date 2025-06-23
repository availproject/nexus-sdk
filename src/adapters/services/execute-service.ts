import { BaseService } from '../core/base-service';
import { TransactionService } from './transaction-service';
import { ApprovalService } from './approval-service';
import { getSimulationClient } from '../../integrations/tenderly';
import { extractErrorMessage } from '../../utils';
import type { ExecuteParams, ExecuteResult, ExecuteSimulation } from '../../types';
import { ChainAbstractionAdapter } from '../chain-abstraction-adapter';

/**
 * Service responsible for handling execution operations
 */
export class ExecuteService extends BaseService {
  private transactionService: TransactionService;
  private approvalService: ApprovalService;

  constructor(adapter: ChainAbstractionAdapter) {
    super(adapter);
    this.transactionService = new TransactionService(adapter);
    this.approvalService = new ApprovalService(adapter);
  }

  /**
   * Execute a contract call with approval handling
   */
  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    this.ensureInitialized();

    try {
      // Emit started event
      this.emitOperationEvents.started('EXECUTE', {
        chainId: params.toChainId,
        contractAddress: params.contractAddress,
      });

      // Handle approval if needed
      if (params.tokenApproval) {
        const approvalResult = await this.approvalService.ensureContractApproval(
          params.tokenApproval,
          params.contractAddress,
          params.toChainId,
          false,
        );

        if (approvalResult.error) {
          this.emitOperationEvents.failed(
            'EXECUTE',
            new Error(approvalResult.error),
            'approval',
            'approval',
          );
          throw new Error(`Approval failed: ${approvalResult.error}`);
        }
      }

      // Prepare execution
      const preparation = await this.transactionService.prepareExecution(params);

      // Send transaction
      const transactionHash = await this.transactionService.sendTransaction(
        preparation.provider,
        preparation.fromAddress,
        params.contractAddress,
        preparation.encodedData,
        params.value || '0x0',
        {
          enableTransactionPolling: params.enableTransactionPolling,
          transactionTimeout: params.transactionTimeout,
          waitForReceipt: params.waitForReceipt,
          receiptTimeout: params.receiptTimeout,
          requiredConfirmations: params.requiredConfirmations,
        },
      );

      // Handle transaction confirmation
      const receiptInfo = await this.transactionService.handleTransactionConfirmation(
        preparation.provider,
        transactionHash,
        {
          waitForReceipt: params.waitForReceipt,
          receiptTimeout: params.receiptTimeout,
          requiredConfirmations: params.requiredConfirmations,
        },
        params.toChainId,
      );

      // Build result
      const result = this.transactionService.buildExecuteResult(
        transactionHash,
        params.toChainId,
        receiptInfo,
      );

      // Emit completion event
      this.emitOperationEvents.completed('EXECUTE', result);

      return result;
    } catch (error) {
      // Emit failure event
      this.emitOperationEvents.failed('EXECUTE', error, 'contract execution');
      throw error;
    }
  }

  /**
   * Simulate contract execution
   */
  async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    this.ensureInitialized();

    try {
      // Get simulation client
      const simulationClient = getSimulationClient();

      if (!simulationClient) {
        return {
          gasUsed: '0',
          gasPrice: '0',
          totalFee: '0',
          success: false,
          error: 'Simulation client not configured',
        };
      }

      // Prepare execution to get encoded data
      const preparation = await this.transactionService.prepareExecution(params);

      // Create simulation parameters
      const simulationParams = {
        from: preparation.fromAddress,
        to: params.contractAddress,
        data: preparation.encodedData,
        value: params.value || '0x0',
        chainId: params.toChainId.toString(),
      };

      // Run simulation
      const simulationResult = await simulationClient.simulate(simulationParams);

      if (!simulationResult.success) {
        return {
          gasUsed: '0',
          gasPrice: '0',
          totalFee: '0',
          success: false,
          error: simulationResult.errorMessage || 'Simulation failed',
        };
      }

      return {
        gasUsed: simulationResult.gasUsed || '0',
        gasPrice: simulationResult.gasPrice || '0',
        maxFeePerGas: simulationResult.maxFeePerGas,
        maxPriorityFeePerGas: simulationResult.maxPriorityFeePerGas,
        totalFee: simulationResult.estimatedCost?.wei || '0',
        success: true,
      };
    } catch (error) {
      return {
        gasUsed: '0',
        gasPrice: '0',
        totalFee: '0',
        success: false,
        error: extractErrorMessage(error, 'execution simulation'),
      };
    }
  }
}
