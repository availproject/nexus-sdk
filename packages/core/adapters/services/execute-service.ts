import { BaseService } from '../core/base-service';
import { TransactionService } from './transaction-service';
import { ApprovalService } from './approval-service';
import { getSimulationClient } from '../../integrations/tenderly';
import {
  extractErrorMessage,
  logger,
  type ExecuteParams,
  type ExecuteResult,
  type ExecuteSimulation,
} from '@nexus/commons';
import { ChainAbstractionAdapter } from '../chain-abstraction-adapter';
import { Hex, hexToNumber } from 'viem';
import { SimulationEngine } from './simulation-engine';

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
   * Enable or disable gas estimation for transactions
   */
  public setGasEstimationEnabled(enabled: boolean): void {
    this.transactionService.setGasEstimationEnabled(enabled);
  }

  /**
   * Execute a contract call with approval handling
   */
  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    this.ensureInitialized();

    try {
      // Prepare execution (includes chain switching)
      const preparation = await this.transactionService.prepareExecution(params);

      // Handle approval if needed (after chain switching)
      let approvalTxHash: string | undefined;
      if (params.tokenApproval) {
        const approvalResult = await this.approvalService.ensureContractApproval(
          params.tokenApproval,
          params.contractAddress,
          params.toChainId,
          true, // Wait for approval confirmation before proceeding
          params.approvalBufferBps,
        );

        if (approvalResult.error) {
          throw new Error(`Approval failed: ${approvalResult.error}`);
        }

        approvalTxHash = approvalResult.transactionHash;
      }

      // Send transaction
      const transactionHash = await this.transactionService.sendTransaction(
        preparation.provider,
        preparation.fromAddress,
        params.contractAddress,
        preparation.encodedData,
        preparation.value || params.value || '0x0',
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

      // If approval happened, attach approval tx hash if available
      if (params.tokenApproval && approvalTxHash) {
        // Augment the typed result by casting to the extended type locally before returning
        const extendedResult: ExecuteResult = {
          ...result,
          approvalTransactionHash: approvalTxHash,
        };
        return extendedResult;
      }

      return result;
    } catch (error) {
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
          contractAddress: params.contractAddress,
          functionName: params.functionName,
          gasUsed: '0',
          success: false,
          error: 'Simulation client not configured',
        };
      }

      // Get user address for callback
      const fromAddress = (await this.adapter.evmProvider!.request({
        method: 'eth_accounts',
      })) as string[];

      if (!fromAddress || fromAddress.length === 0) {
        throw new Error('No accounts available');
      }

      // Prepare execution to get encoded data and value (calls buildFunctionParams internally)
      const preparation = await this.transactionService.prepareExecution(params);

      // Create simulation parameters
      const simulationParams = {
        from: preparation.fromAddress,
        to: params.contractAddress,
        data: preparation.encodedData,
        value: preparation.value || params.value || '0x0',
        chainId: params.toChainId.toString(),
      };

      // Run simulation
      const simulationResult = await simulationClient.simulate(simulationParams);

      if (!simulationResult.success) {
        return {
          contractAddress: params.contractAddress,
          functionName: params.functionName,
          gasUsed: '0',
          success: false,
          error: simulationResult.errorMessage || 'Simulation failed',
        } as ExecuteSimulation;
      }

      const gasUsedDecimal = hexToNumber(simulationResult.gasUsed as Hex);
      let gasCostEth: string | undefined;
      try {
        const gasPriceHex = (await this.adapter.evmProvider!.request({
          method: 'eth_gasPrice',
        })) as string;
        const gasPriceWei = parseInt(gasPriceHex, 16);
        const costEthNum = (gasUsedDecimal * gasPriceWei) / 1e18;
        gasCostEth = costEthNum.toFixed(8);
      } catch (gpErr) {
        logger.warn('Failed to fetch gas price during simulation cost calc:', gpErr);
      }

      return {
        gasUsed: gasUsedDecimal.toString(),
        success: true,
        ...(gasCostEth ? { gasCostEth } : {}),
      } as ExecuteSimulation;
    } catch (error) {
      return {
        contractAddress: params.contractAddress,
        functionName: params.functionName,
        gasUsed: '0',
        success: false,
        error: extractErrorMessage(error, 'execution simulation'),
      };
    }
  }

  /**
   * Enhanced simulation with automatic state setup
   */
  async simulateExecuteEnhanced(params: ExecuteParams): Promise<ExecuteSimulation> {
    this.ensureInitialized();

    try {
      // Check if we should use enhanced simulation
      logger.debug('DEBUG ExecuteService - Full params received:', {
        functionName: params.functionName,
        contractAddress: params.contractAddress,
        tokenApproval: params.tokenApproval,
        buildFunctionParams: typeof params.buildFunctionParams,
        toChainId: params.toChainId,
      });

      const shouldUseEnhancedSimulation = this.shouldUseEnhancedSimulation(params);
      logger.debug(
        'DEBUG ExecuteService - Final enhanced simulation decision:',
        shouldUseEnhancedSimulation,
      );

      if (shouldUseEnhancedSimulation) {
        return await this.runEnhancedSimulation(params);
      }

      return await this.simulateExecute(params);
    } catch (error) {
      return {
        contractAddress: params.contractAddress,
        functionName: params.functionName,
        gasUsed: '0',
        success: false,
        error: extractErrorMessage(error, 'enhanced simulation'),
      };
    }
  }

  /**
   * Determine if enhanced simulation should be used
   */
  private shouldUseEnhancedSimulation(params: ExecuteParams): boolean {
    // Use enhanced simulation if:
    // 1. Token approval is required (indicates ERC20 interaction)
    // 2. Function is likely to fail without proper balance setup
    const shouldUse =
      params.tokenApproval !== undefined &&
      params.tokenApproval.token !== 'ETH' &&
      this.isComplexContractCall(params);
    logger.debug('DEBUG shouldUseEnhancedSimulation - Decision:', {
      hasTokenApproval: !!params.tokenApproval,
      isComplex: this.isComplexContractCall(params),
      functionName: params.functionName,
      finalDecision: shouldUse,
    });
    return (
      params.tokenApproval !== undefined &&
      params.tokenApproval.token !== 'ETH' &&
      this.isComplexContractCall(params)
    );
  }

  /**
   * Check if this is a complex contract call that benefits from enhanced simulation
   */
  private isComplexContractCall(params: ExecuteParams): boolean {
    const complexFunctions = [
      'deposit',
      'withdraw',
      'swap',
      'trade',
      'stake',
      'unstake',
      'mint',
      'burn',
      'transfer',
      'transferFrom',
      'approve',
      'supply',
      'borrow',
      'repay',
      'redeem',
      'lend',
    ];

    return complexFunctions.some((func) =>
      params.functionName.toLowerCase().includes(func.toLowerCase()),
    );
  }

  /**
   * Run enhanced simulation with automatic state setup
   */
  private async runEnhancedSimulation(params: ExecuteParams): Promise<ExecuteSimulation> {
    try {
      // Check if evmProvider is available
      if (!this.adapter.evmProvider) {
        throw new Error('EVM provider not available for enhanced simulation');
      }

      // Create a proper adapter for SimulationEngine
      const simulationAdapter = {
        isInitialized: () => this.adapter.isInitialized(),
        evmProvider: this.adapter.evmProvider,
      };

      const simulationEngine = new SimulationEngine(simulationAdapter);

      // Get user address
      const preparation = await this.transactionService.prepareExecution(params);

      // Convert tokenApproval amount to proper format if needed
      const tokenAmount = params.tokenApproval?.amount || '0';

      logger.info('DEBUG ExecuteService - Running enhanced simulation:', {
        user: preparation.fromAddress,
        token: params.tokenApproval?.token,
        amount: tokenAmount,
        function: params.functionName,
      });

      // Run enhanced simulation (tokenApproval is guaranteed to exist here due to shouldUseEnhancedSimulation check)
      if (!params.tokenApproval) {
        throw new Error('Enhanced simulation requires token approval information');
      }

      const enhancedResult = await simulationEngine.simulateWithStateSetup({
        user: preparation.fromAddress,
        tokenRequired: params.tokenApproval.token,
        amountRequired: tokenAmount,
        contractCall: params,
      });

      // Convert enhanced result to ExecuteSimulation format
      if (!enhancedResult.success) {
        return {
          contractAddress: params.contractAddress,
          functionName: params.functionName,
          gasUsed: '0',
          success: false,
          error: enhancedResult.error || 'Enhanced simulation failed',
        };
      }

      // enhancedResult.totalGasUsed is already an ETH-denominated string (SimulationEngine converts)
      return {
        contractAddress: params.contractAddress,
        functionName: params.functionName,
        gasUsed: enhancedResult.totalGasUsed,
        success: true,
        gasCostEth: enhancedResult.totalGasUsed,
      } as ExecuteSimulation;
    } catch (error) {
      logger.error('Enhanced simulation failed, falling back to standard:', error as Error);

      // Fallback to standard simulation
      return await this.simulateExecute(params);
    }
  }
}
