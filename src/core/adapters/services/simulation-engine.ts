import { logger } from '../../utils/logger';
import type {
  EnhancedSimulationResult,
  EnhancedSimulationStep,
  StateOverride,
} from '../../integrations/types';
import { encodePacked, keccak256 } from 'viem';
import type {
  SUPPORTED_TOKENS,
  ExecuteParams,
  EthereumProvider,
  SUPPORTED_CHAINS_IDS,
} from '../../../types';
import { getSimulationClient } from '../../integrations/tenderly';
import { extractErrorMessage, getTokenContractAddress, isTestnetChain } from '../../utils';

/**
 * Minimal interface for what SimulationEngine needs from the adapter
 */
interface SimulationEngineAdapter {
  isInitialized(): boolean;
  evmProvider: EthereumProvider;
}

/**
 * Transaction service interface needed by SimulationEngine
 */
interface TransactionServiceInterface {
  prepareExecution(params: ExecuteParams): Promise<{ encodedData: string; fromAddress: string }>;
}

/**
 * Balance check result interface
 */
export interface BalanceCheckResult {
  balance: string;
  sufficient: boolean;
  shortfall: string;
  tokenAddress: string;
}

/**
 * Multi-step simulation engine with state override capabilities
 */
export class SimulationEngine {
  private adapter: SimulationEngineAdapter;
  private transactionService: TransactionServiceInterface;

  constructor(adapter: SimulationEngineAdapter, transactionService: TransactionServiceInterface) {
    this.adapter = adapter;
    this.transactionService = transactionService;
  }

  private ensureInitialized() {
    if (!this.adapter.isInitialized()) {
      throw new Error('Adapter not initialized');
    }
  }

  private get evmProvider() {
    return this.adapter.evmProvider;
  }

  /**
   * Main entry point for enhanced simulation with automatic state setup
   */
  async simulateWithStateSetup(params: {
    user: string;
    tokenRequired: SUPPORTED_TOKENS;
    amountRequired: string;
    contractCall: ExecuteParams;
  }): Promise<EnhancedSimulationResult> {
    this.ensureInitialized();

    try {
      const { user, tokenRequired, amountRequired, contractCall } = params;
      const chainId = contractCall.toChainId;

      logger.info('DEBUG SimulationEngine - Starting enhanced simulation:', {
        user,
        tokenRequired,
        amountRequired,
        chainId,
        contract: contractCall.contractAddress,
        function: contractCall.functionName,
      });

      // Step 1: Check user's current token balance
      const balanceCheck = await this.checkUserBalance(
        user,
        tokenRequired,
        chainId,
        amountRequired,
      );
      logger.info('DEBUG SimulationEngine - Balance check result:', balanceCheck);

      // Step 2: Generate simulation steps
      const steps = await this.generateSimulationSteps({
        user,
        tokenRequired,
        amountRequired,
        contractCall,
        balanceCheck,
      });

      logger.info('DEBUG SimulationEngine - Generated steps:', steps.length);

      // Step 3: Execute multi-step simulation
      const result = await this.executeBatchSimulation(steps, chainId);

      logger.info('DEBUG SimulationEngine - Simulation complete:', {
        success: result.success,
        totalGas: result.totalGasUsed,
        stepsExecuted: result.steps.length,
      });

      return result;
    } catch (error) {
      logger.error('DEBUG SimulationEngine - Simulation failed:', error as Error);
      return this.createFailedResult(
        `Enhanced simulation failed: ${extractErrorMessage(error, 'simulation')}`,
      );
    }
  }

  /**
   * Check user's token balance on specific chain
   */
  async checkUserBalance(
    user: string,
    token: SUPPORTED_TOKENS,
    chainId: number,
    requiredAmount?: string,
  ): Promise<BalanceCheckResult> {
    try {
      const tokenAddress = getTokenContractAddress(
        token,
        chainId as SUPPORTED_CHAINS_IDS,
        isTestnetChain(chainId as SUPPORTED_CHAINS_IDS),
      );
      if (!tokenAddress) {
        throw new Error(`Token ${token} not supported on chain ${chainId}`);
      }

      // For native ETH, use eth_getBalance
      if (token === 'ETH') {
        const balance = (await this.evmProvider.request({
          method: 'eth_getBalance',
          params: [user, 'latest'],
        })) as string;

        const balanceBigInt = BigInt(balance);
        const requiredBigInt = requiredAmount ? BigInt(requiredAmount) : BigInt(0);
        const sufficient = balanceBigInt >= requiredBigInt;
        const shortfall = sufficient ? '0' : (requiredBigInt - balanceBigInt).toString();

        return {
          balance,
          sufficient,
          shortfall,
          tokenAddress,
        };
      }

      // For ERC20 tokens, use balanceOf call
      const balanceCallData = `0x70a08231${user.slice(2).padStart(64, '0')}`;

      const balanceResponse = (await this.evmProvider.request({
        method: 'eth_call',
        params: [
          {
            to: tokenAddress,
            data: balanceCallData,
          },
          'latest',
        ],
      })) as string;

      const balance = BigInt(balanceResponse || '0x0').toString();

      if (requiredAmount) {
        const balanceBigInt = BigInt(balance);
        const requiredBigInt = BigInt(requiredAmount);
        const sufficient = balanceBigInt >= requiredBigInt;
        const shortfall = sufficient ? '0' : (requiredBigInt - balanceBigInt).toString();

        return {
          balance,
          sufficient,
          shortfall,
          tokenAddress,
        };
      }

      return {
        balance,
        sufficient: false, // Cannot determine without required amount
        shortfall: '0',
        tokenAddress,
      };
    } catch (error) {
      logger.warn(`Failed to check balance for ${token} on chain ${chainId}:`, error);
      return {
        balance: '0',
        sufficient: false,
        shortfall: requiredAmount || '0',
        tokenAddress:
          getTokenContractAddress(
            token,
            chainId as SUPPORTED_CHAINS_IDS,
            isTestnetChain(chainId as SUPPORTED_CHAINS_IDS),
          ) || '',
      };
    }
  }

  /**
   * Get the storage slot for token balances mapping - Production Ready Static Mapping
   * Based on actual contract analysis for all supported tokens and chains
   */
  private getBalanceStorageSlot(token: SUPPORTED_TOKENS, chainId: number): number {
    const storageSlotMapping: Record<number, Record<SUPPORTED_TOKENS, number>> = {
      // Ethereum Mainnet (1)
      1: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Base Mainnet (8453)
      8453: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Arbitrum One (42161)
      42161: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Optimism (10)
      10: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Polygon (137)
      137: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Avalanche C-Chain (43114)
      43114: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Scroll (534352)
      534352: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Base Sepolia Testnet (84532)
      84532: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Arbitrum Sepolia Testnet (421614)
      421614: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Optimism Sepolia Testnet (11155420)
      11155420: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },

      // Polygon Amoy Testnet (80002)
      80002: {
        ETH: 0,
        USDC: 9,
        USDT: 2,
      },
    };

    const chainMapping = storageSlotMapping[chainId];
    if (!chainMapping) {
      logger.warn(`Unsupported chain ${chainId}, falling back to defaults`);
      // Fallback defaults based on most common patterns
      return token === 'USDC' ? 9 : token === 'USDT' ? 2 : 0;
    }

    const slot = chainMapping[token];
    if (slot === undefined) {
      logger.warn(`Token ${token} not supported on chain ${chainId}, falling back to defaults`);
      return token === 'USDC' ? 9 : token === 'USDT' ? 2 : 0;
    }

    logger.info(`Using storage slot ${slot} for ${token} on chain ${chainId}`);
    return slot;
  }

  /**
   * Generate state overrides to fund user with required tokens
   */
  async generateStateOverrides(
    user: string,
    token: SUPPORTED_TOKENS,
    requiredAmount: string,
    chainId: number,
  ): Promise<StateOverride> {
    try {
      const tokenAddress = getTokenContractAddress(
        token,
        chainId as SUPPORTED_CHAINS_IDS,
        isTestnetChain(chainId as SUPPORTED_CHAINS_IDS),
      );
      if (!tokenAddress) {
        throw new Error(`Token ${token} not supported on chain ${chainId}`);
      }

      // For native ETH
      if (token === 'ETH') {
        return {
          [user]: {
            balance: `0x${BigInt(requiredAmount).toString(16)}`,
          },
        };
      }

      // For ERC20 tokens - override the balance mapping using verified storage slots
      const balanceSlot = this.getBalanceStorageSlot(token, chainId);

      // Calculate storage slot for user's balance: keccak256(user_address . balances_slot)
      const userBalanceSlot = keccak256(
        encodePacked(['address', 'uint256'], [user as `0x${string}`, BigInt(balanceSlot)]),
      );

      // Convert amount to hex with proper padding
      const amountHex = `0x${BigInt(requiredAmount).toString(16).padStart(64, '0')}`;

      logger.info(
        `Generating state override for ${token} on chain ${chainId}: slot=${balanceSlot}, storageKey=${userBalanceSlot}`,
      );

      return {
        [tokenAddress]: {
          storage: {
            [userBalanceSlot]: amountHex,
          },
        },
      };
    } catch (error) {
      logger.error('Error generating state overrides:', error as Error);
      throw error;
    }
  }

  /**
   * Generate the sequence of simulation steps needed
   */
  private async generateSimulationSteps(params: {
    user: string;
    tokenRequired: SUPPORTED_TOKENS;
    amountRequired: string;
    contractCall: ExecuteParams;
    balanceCheck: BalanceCheckResult;
  }): Promise<EnhancedSimulationStep[]> {
    const { user, tokenRequired, amountRequired, contractCall, balanceCheck } = params;
    const steps: EnhancedSimulationStep[] = [];

    // Check if user has sufficient balance
    const requiredAmountBigInt = BigInt(amountRequired);
    const currentBalanceBigInt = BigInt(balanceCheck.balance);
    const needsFunding = currentBalanceBigInt < requiredAmountBigInt;

    logger.info('DEBUG generateSimulationSteps - Balance analysis:', {
      required: requiredAmountBigInt.toString(),
      current: currentBalanceBigInt.toString(),
      needsFunding,
    });

    // Step 1: Funding step (if needed)
    if (needsFunding) {
      const stateOverrides = await this.generateStateOverrides(
        user,
        tokenRequired,
        amountRequired,
        contractCall.toChainId,
      );

      steps.push({
        type: 'funding',
        required: true,
        description: `Fund user with ${amountRequired} ${tokenRequired}`,
        stepId: 'funding-step',
        stateOverride: stateOverrides,
        params: {
          chainId: contractCall.toChainId.toString(),
          from: user,
          to: user,
          value: '0x0',
        },
      });
    }

    // Step 2: Approval step (if needed for ERC20)
    if (tokenRequired !== 'ETH' && contractCall.tokenApproval) {
      const approvalCallData = await this.buildApprovalCallData(
        contractCall.contractAddress,
        amountRequired,
      );

      steps.push({
        type: 'approval',
        required: true,
        description: `Approve ${contractCall.contractAddress} to spend ${tokenRequired}`,
        stepId: 'approval-step',
        dependsOn: needsFunding ? ['funding-step'] : undefined,
        params: {
          chainId: contractCall.toChainId.toString(),
          from: user,
          to: balanceCheck.tokenAddress,
          data: approvalCallData,
          value: '0x0',
        },
      });
    }

    // Step 3: Execute step
    const preparation = await this.prepareExecutionCall(contractCall);
    steps.push({
      type: 'execute',
      required: true,
      description: `Execute ${contractCall.functionName} on ${contractCall.contractAddress}`,
      stepId: 'execute-step',
      dependsOn:
        tokenRequired !== 'ETH' ? ['approval-step'] : needsFunding ? ['funding-step'] : undefined,
      params: {
        chainId: contractCall.toChainId.toString(),
        from: user,
        to: contractCall.contractAddress,
        data: preparation.encodedData,
        value: contractCall.value || '0x0',
      },
    });

    return steps;
  }

  /**
   * Build approval call data for ERC20 token
   */
  private async buildApprovalCallData(spender: string, amount: string): Promise<string> {
    // ERC20 approve function selector: approve(address,uint256)
    const approveSelector = '0x095ea7b3';
    const paddedSpender = spender.slice(2).padStart(64, '0');
    const paddedAmount = BigInt(amount).toString(16).padStart(64, '0');

    return `${approveSelector}${paddedSpender}${paddedAmount}`;
  }

  /**
   * Prepare execution call data
   */
  private async prepareExecutionCall(params: ExecuteParams) {
    return await this.transactionService.prepareExecution(params);
  }

  /**
   * Execute batch simulation using bundle endpoint
   */
  private async executeBatchSimulation(
    steps: EnhancedSimulationStep[],
    chainId: number,
  ): Promise<EnhancedSimulationResult> {
    const simulationClient = getSimulationClient();
    if (!simulationClient) {
      return this.createFailedResult('Simulation client not configured');
    }

    logger.info(
      `DEBUG executeBatchSimulation - Starting bundle simulation with ${steps.length} steps`,
    );

    // Build cumulative state overrides
    let cumulativeStateOverrides: StateOverride = {};
    const bundleSimulations: Array<{
      stepId: string;
      type: string;
      from: string;
      to: string;
      data: string;
      value: string;
      stateOverride: StateOverride;
    }> = [];

    for (const step of steps) {
      // Merge cumulative state overrides with step-specific overrides
      cumulativeStateOverrides = this.mergeStateOverrides(
        cumulativeStateOverrides,
        step.stateOverride || {},
      );

      // Add to bundle
      bundleSimulations.push({
        stepId: step.stepId || '',
        type: step.type,
        from: step.params.from || '',
        to: step.params.to || '',
        data: step.params.data || '0x',
        value: step.params.value || '0x0',
        stateOverride: { ...cumulativeStateOverrides }, // Each step gets cumulative state
      });

      logger.info(`DEBUG executeBatchSimulation - Prepared step: ${step.stepId} (${step.type})`);
    }

    try {
      // Execute bundle simulation
      const bundleRequest = {
        chainId: chainId.toString(),
        simulations: bundleSimulations,
      };

      logger.info('DEBUG executeBatchSimulation - Sending bundle request');
      const bundleResult = await simulationClient.simulateBundle(bundleRequest);

      if (!bundleResult.success) {
        return {
          totalGasUsed: '0',
          success: false,
          error: 'Bundle simulation failed',
          steps: bundleResult.results.map((result) => ({
            stepId: result.stepId,
            type: bundleSimulations.find((sim) => sim.stepId === result.stepId)?.type || '',
            gasUsed: result.gasUsed,
            success: result.success,
            error: result.error,
          })),
          stateOverrides: cumulativeStateOverrides,
        };
      }

      // Process successful bundle result
      const executedSteps = bundleResult.results.map((result) => {
        const stepType = bundleSimulations.find((sim) => sim.stepId === result.stepId)?.type || '';

        logger.info(`DEBUG executeBatchSimulation - Step ${result.stepId} completed:`, {
          gasUsed: result.gasUsed,
        });

        return {
          stepId: result.stepId,
          type: stepType,
          gasUsed: result.gasUsed,
          success: result.success,
          error: result.error,
          stateChanges: bundleSimulations.find((sim) => sim.stepId === result.stepId)
            ?.stateOverride,
        };
      });

      return {
        totalGasUsed: bundleResult.totalGasUsed,
        success: true,
        steps: executedSteps,
        stateOverrides: cumulativeStateOverrides,
        simulationMetadata: {
          blockNumber: 'latest',
          timestamp: new Date().toISOString(),
          chainId: chainId.toString(),
        },
      };
    } catch (error) {
      logger.error('Bundle simulation error:', error as Error);
      return this.createFailedResult(
        `Bundle simulation failed: ${extractErrorMessage(error, 'bundle simulation')}`,
      );
    }
  }

  /**
   * Merge two state override objects
   */
  private mergeStateOverrides(base: StateOverride, additional: StateOverride): StateOverride {
    const merged: StateOverride = { ...base };

    for (const [address, overrides] of Object.entries(additional)) {
      if (merged[address]) {
        merged[address] = {
          ...merged[address],
          ...overrides,
          storage: {
            ...merged[address].storage,
            ...overrides.storage,
          },
        };
      } else {
        merged[address] = overrides;
      }
    }

    return merged;
  }

  /**
   * Create a failed simulation result
   */
  private createFailedResult(error: string): EnhancedSimulationResult {
    return {
      totalGasUsed: '0',
      success: false,
      error,
      steps: [],
    };
  }
}
