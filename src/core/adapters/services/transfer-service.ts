import { BaseService } from '../core/base-service';
import { validateBridgeTransferParams, validateForResultReturn } from '../core/validation';
import { extractErrorMessage, logger } from '../../utils';
import {
  NEXUS_EVENTS,
  CHAIN_METADATA,
  TOKEN_METADATA,
  TOKEN_CONTRACT_ADDRESSES,
} from '../../../constants';
import { parseUnits } from 'viem';
import { TransactionService } from './transaction-service';
import type { ProgressStep } from '@arcana/ca-sdk';
import type {
  TransferParams,
  TransferResult,
  SimulationResult,
  SUPPORTED_CHAINS_IDS,
  SUPPORTED_TOKENS,
} from '../../../types';

/**
 * Service responsible for handling transfer operations
 */
export class TransferService extends BaseService {
  private skipChainAbstraction: boolean = false;
  private transactionService: TransactionService;

  constructor(adapter: any) {
    super(adapter);
    this.transactionService = new TransactionService(adapter);
  }
  /**
   * Transfer tokens to a recipient
   * Uses direct EVM transfer when skipChainAbstraction is true, otherwise uses CA
   */
  async transfer(params: TransferParams): Promise<TransferResult> {
    try {
      // Validate parameters
      validateBridgeTransferParams(params);
      this.ensureInitialized();

      if (this.skipChainAbstraction) {
        logger.info(
          `Enhanced smart transfer: Using direct EVM transfer on chain ${params.chainId}`,
        );

        // Use direct EVM transfer
        return await this.executeDirectTransfer(params);
      }

      // Use CA transfer when insufficient balance on target chain
      logger.info('Using chain abstraction for transfer');
      const result = await this.waitForTransactionCompletion<TransferResult>(async () => {
        const transferQuery = await this.ca.transfer({
          to: params.recipient,
          token: params.token,
          amount: params.amount,
          chainID: params.chainId,
        });

        await transferQuery.exec();
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
        error: extractErrorMessage(error, 'transfer operation'),
      };
    }
  }

  /**
   * Simulate transfer operation
   * Checks balances first - if sufficient on target chain, skips CA and creates direct simulation
   */
  async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    try {
      // Validate parameters
      validateBridgeTransferParams(params);
      this.ensureInitialized();

      // Enhanced balance check BEFORE simulation
      this.skipChainAbstraction = await this.canSkipChainAbstraction(
        params.chainId,
        params.token,
        params.amount.toString(),
        params.recipient,
      );

      logger.info(
        `Enhanced balance check result: skipChainAbstraction = ${this.skipChainAbstraction} for chain ${params.chainId}`,
      );

      if (this.skipChainAbstraction) {
        // Create custom simulation result for direct transfer (same format as CA)
        logger.info('Creating direct transfer simulation - chain abstraction will be skipped');
        return await this.createDirectTransferSimulation(params);
      }

      // Use CA simulation when balance is insufficient
      logger.info('Using chain abstraction for transfer simulation');
      const transferQuery = await this.ca.transfer({
        to: params.recipient,
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
      });

      logger.info('Transfer query', transferQuery);
      return await transferQuery.simulate();
    } catch (error) {
      logger.error('Error transfer simulation:', error as Error);
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

  /**
   * Execute direct EVM transfer (ETH or ERC20) without chain abstraction
   * Includes event emission and allowance checking for consistency with CA flow
   */
  private async executeDirectTransfer(params: TransferParams): Promise<TransferResult> {
    try {
      const userAddress = await this.getUserAddress();
      if (!userAddress) {
        throw new Error('User address not available');
      }

      const tokenMetadata = TOKEN_METADATA[params.token.toUpperCase()];
      const isNativeToken = params.token.toUpperCase() === 'ETH' || tokenMetadata?.isNative;
      const chainMetadata = CHAIN_METADATA[params.chainId];

      // Helper function to create step objects
      const makeStep = (
        typeID: string,
        type: string,
        data: Record<string, unknown> = {},
      ): ProgressStep => ({
        typeID,
        type,
        data: {
          chainID: params.chainId,
          chainName: chainMetadata?.name || `Chain ${params.chainId}`,
          ...data,
        },
      });

      // Emit expected steps for the direct transfer flow (no allowance checks needed)
      const expectedSteps: ProgressStep[] = [
        makeStep('CS', 'CHAIN_SWITCH', { message: 'Switching to target chain' }),
        makeStep('TS', 'TRANSACTION_SENT', { message: 'Sending transaction' }),
        makeStep('IS', 'INTENT_SUBMITTED', { message: 'Transaction submitted' }),
      ];

      // Emit expected steps
      this.caEvents.emit(NEXUS_EVENTS.EXPECTED_STEPS, expectedSteps);

      // Step 1: Chain switch
      const chainResult = await this.transactionService.ensureCorrectChain(params.chainId);
      if (!chainResult.success) {
        throw new Error(`Failed to switch to chain ${params.chainId}: ${chainResult.error}`);
      }
      this.caEvents.emit(NEXUS_EVENTS.STEP_COMPLETE, makeStep('CS', 'CHAIN_SWITCH'));

      // Step 2: Execute the transfer
      this.caEvents.emit(NEXUS_EVENTS.STEP_COMPLETE, makeStep('TS', 'TRANSACTION_SENT'));

      let transactionResult: {
        success: boolean;
        hash?: `0x${string}`;
        error?: string;
      };

      if (isNativeToken) {
        // Native token transfer (ETH, MATIC, AVAX, etc.)
        logger.info('Executing direct native token transfer:', {
          token: params.token,
          amount: params.amount,
          from: userAddress,
          to: params.recipient,
          chainId: params.chainId,
        });

        transactionResult = await this.transactionService.transferNativeToken(
          this.evmProvider,
          userAddress,
          params.recipient,
          params.amount.toString(),
          tokenMetadata?.decimals || 18,
        );
      } else {
        // ERC20 token transfer
        const tokenAddress = TOKEN_CONTRACT_ADDRESSES[params.token.toUpperCase()]?.[params.chainId];
        if (!tokenAddress) {
          throw new Error(
            `Token contract address not found for ${params.token} on chain ${params.chainId}`,
          );
        }

        logger.info('Executing direct ERC20 token transfer:', {
          token: params.token,
          tokenAddress,
          amount: params.amount,
          from: userAddress,
          to: params.recipient,
          chainId: params.chainId,
        });

        transactionResult = await this.transactionService.transferERC20Token(
          this.evmProvider,
          userAddress,
          tokenAddress,
          params.recipient,
          params.amount.toString(),
          tokenMetadata?.decimals || 18,
        );
      }

      // Check if transaction was successful
      if (!transactionResult.success) {
        // Emit error step
        this.caEvents.emit(
          NEXUS_EVENTS.STEP_COMPLETE,
          makeStep('ER', 'TRANSACTION_FAILED', {
            error: transactionResult.error || 'Transaction failed',
          }),
        );
        return {
          success: false,
          error: transactionResult.error || 'Transaction failed',
        };
      }

      // Generate explorer URL
      const explorerUrl =
        chainMetadata?.blockExplorerUrls?.[0] && transactionResult.hash
          ? `${chainMetadata.blockExplorerUrls[0]}/tx/${transactionResult.hash}`
          : undefined;

      // Step 3: Transaction submitted with hash and explorer URL (matches CA flow)
      this.caEvents.emit(
        NEXUS_EVENTS.STEP_COMPLETE,
        makeStep('IS', 'INTENT_SUBMITTED', {
          transactionHash: transactionResult.hash,
          explorerURL: explorerUrl,
        }),
      );

      logger.info('Direct transfer completed successfully:', {
        transactionHash: transactionResult.hash,
        explorerUrl,
        chainId: params.chainId,
      });

      return {
        success: true,
        explorerUrl,
      };
    } catch (error) {
      logger.error('Direct transfer failed:', error as Error);

      // Emit error step for failed operation
      const errorMessage = extractErrorMessage(error, 'direct transfer');
      this.caEvents.emit(NEXUS_EVENTS.STEP_COMPLETE, {
        typeID: 'ER',
        type: 'OPERATION_FAILED',
        data: {
          chainID: params.chainId,
          chainName: CHAIN_METADATA[params.chainId]?.name || `Chain ${params.chainId}`,
          error: errorMessage,
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Create simulation result for direct transfer (same format as CA simulation)
   */
  private async createDirectTransferSimulation(params: TransferParams): Promise<SimulationResult> {
    try {
      const gasEstimate = await this.estimateTransferGas(
        params.chainId,
        params.token,
        params.amount.toString(),
        params.recipient,
      );

      if (!gasEstimate) {
        throw new Error('Failed to estimate gas for direct transfer');
      }

      // Get gas cost in ETH
      const gasPriceHex = (await this.evmProvider.request({
        method: 'eth_gasPrice',
      })) as string;
      const gasPriceWei = parseInt(gasPriceHex, 16);
      const gasUsedNum = parseFloat(gasEstimate);
      const gasCostEth = (gasUsedNum * gasPriceWei) / 1e18;

      // Get chain and token metadata
      const chainMetadata = CHAIN_METADATA[params.chainId];
      const tokenMetadata = TOKEN_METADATA[params.token.toUpperCase()];

      // Create simulation result in same format as CA
      const simulationResult: SimulationResult = {
        intent: {
          sources: [
            {
              chainID: params.chainId,
              chainLogo: chainMetadata?.logo,
              chainName: chainMetadata?.name || `Chain ${params.chainId}`,
              amount: params.amount.toString(),
              contractAddress:
                TOKEN_CONTRACT_ADDRESSES[params.token.toUpperCase()]?.[params.chainId],
            },
          ],
          destination: {
            chainID: params.chainId,
            chainLogo: chainMetadata?.logo,
            chainName: chainMetadata?.name || `Chain ${params.chainId}`,
            amount: params.amount.toString(),
          },
          sourcesTotal: params.amount.toString(),
          fees: {
            total: gasCostEth.toFixed(8),
            caGas: '0',
            gasSupplied: gasCostEth.toFixed(8),
            protocol: '0',
            solver: '0',
          },
          token: {
            name: tokenMetadata?.name || params.token,
            symbol: tokenMetadata?.symbol || params.token.toUpperCase(),
            decimals: tokenMetadata?.decimals || 18,
            logo: tokenMetadata?.icon,
          },
        },
        token: {
          name: tokenMetadata?.name || params.token,
          symbol: tokenMetadata?.symbol || params.token.toUpperCase(),
          decimals: tokenMetadata?.decimals || 18,
          logo: tokenMetadata?.icon,
          contractAddress: TOKEN_CONTRACT_ADDRESSES[params.token.toUpperCase()]?.[params.chainId],
        },
      };

      logger.info('Created direct transfer simulation result:', simulationResult);
      return simulationResult;
    } catch (error) {
      logger.error('Failed to create direct transfer simulation:', error as Error);
      throw new Error(
        `Direct transfer simulation failed: ${extractErrorMessage(error, 'direct simulation')}`,
      );
    }
  }

  /**
   * Enhanced balance check for transfers - validates both token and gas requirements
   * Checks if user has sufficient balance on target chain for direct transfer
   */
  private async canSkipChainAbstraction(
    chainId: SUPPORTED_CHAINS_IDS,
    token: SUPPORTED_TOKENS,
    amount: string,
    recipient: string,
  ): Promise<boolean> {
    try {
      // 1. Check token balance on target chain
      const hasTokenBalance = await this.checkTokenBalanceOnChain(chainId, token, amount);
      if (!hasTokenBalance) {
        logger.info(
          `Insufficient ${token} balance on chain ${chainId}, cannot skip chain abstraction`,
        );
        return false;
      }

      // 2. Estimate gas for the transfer and check native token balance
      const hasGasBalance = await this.checkGasBalanceForTransfer(
        chainId,
        token,
        amount,
        recipient,
      );
      if (!hasGasBalance) {
        logger.info(`Insufficient gas balance on chain ${chainId}, cannot skip chain abstraction`);
        return false;
      }

      logger.info(
        `All balance checks passed for chain ${chainId}, chain abstraction can be skipped`,
      );
      return true;
    } catch (error) {
      logger.warn(`Enhanced balance check failed: ${error}`);
      return false; // Default to using CA on error
    }
  }

  /**
   * Check if user has sufficient token balance on specific chain
   */
  private async checkTokenBalanceOnChain(
    chainId: SUPPORTED_CHAINS_IDS,
    token: SUPPORTED_TOKENS,
    requiredAmount: string,
  ): Promise<boolean> {
    try {
      // Get user's unified balances
      const balances = await this.adapter.ca.getUnifiedBalances();

      // Find the balance for the specific token
      const tokenBalance = balances.find((asset) => asset.symbol === token);

      if (!tokenBalance || !tokenBalance.breakdown) {
        logger.info(`No ${token} balance found`);
        return false;
      }

      // Find balance on the specific chain
      const chainBalance = tokenBalance.breakdown.find((balance) => balance.chain.id === chainId);

      if (!chainBalance) {
        logger.info(`No ${token} balance found on chain ${chainId}`);
        return false;
      }

      // Get token metadata for decimal conversion
      const tokenMetadata = TOKEN_METADATA[token.toUpperCase()];
      const decimals = tokenMetadata?.decimals || 18;

      // Convert the balance to wei for comparison
      const balanceInWei = parseUnits(chainBalance.balance, decimals);
      const requiredAmountInWei = parseUnits(requiredAmount, decimals);

      const hasSufficientBalance = balanceInWei >= requiredAmountInWei;

      logger.info(`Token balance check result:`, {
        token,
        chainId,
        userBalance: chainBalance.balance,
        requiredAmount,
        hasSufficientBalance,
      });

      return hasSufficientBalance;
    } catch (error) {
      logger.warn(`Failed to check token balance on chain: ${error}`);
      return false;
    }
  }

  /**
   * Check if user has sufficient native token balance for gas
   * Uses eth_estimateGas to get accurate gas estimate
   */
  private async checkGasBalanceForTransfer(
    chainId: SUPPORTED_CHAINS_IDS,
    token: SUPPORTED_TOKENS,
    amount: string,
    recipient: string,
  ): Promise<boolean> {
    try {
      // Get native token symbol for this chain
      const chainMetadata = CHAIN_METADATA[chainId];
      if (!chainMetadata) {
        logger.warn(`No chain metadata found for chain ${chainId}`);
        return false;
      }

      const nativeTokenSymbol = chainMetadata.nativeCurrency.symbol;

      // Get user's unified balances
      const balances = await this.adapter.ca.getUnifiedBalances();

      // Find the native token balance
      const nativeTokenBalance = balances.find((asset) => asset.symbol === nativeTokenSymbol);

      if (!nativeTokenBalance || !nativeTokenBalance.breakdown) {
        logger.info(`No ${nativeTokenSymbol} balance found`);
        return false;
      }

      // Find balance on the specific chain
      const chainBalance = nativeTokenBalance.breakdown.find(
        (balance) => balance.chain.id === chainId,
      );

      if (!chainBalance) {
        logger.info(`No ${nativeTokenSymbol} balance found on chain ${chainId}`);
        return false;
      }

      // Estimate gas for the transfer
      const gasEstimate = await this.estimateTransferGas(chainId, token, amount, recipient);
      if (!gasEstimate) {
        logger.warn(`Failed to estimate gas for transfer on chain ${chainId}`);
        return false;
      }

      // Convert gas estimate to native token cost
      const gasPriceHex = (await this.evmProvider.request({
        method: 'eth_gasPrice',
      })) as string;
      const gasPriceWei = parseInt(gasPriceHex, 16);

      const gasUsedNum = parseFloat(gasEstimate);
      const gasCostWei = gasUsedNum * gasPriceWei;
      const gasCostEth = gasCostWei / 1e18; // Convert wei to ETH/native token

      // Add 10% buffer for gas price fluctuations
      const gasCostWithBuffer = gasCostEth * 1.1;

      // Compare with user's native token balance
      const userBalance = parseFloat(chainBalance.balance);
      const hasSufficientGasBalance = userBalance >= gasCostWithBuffer;

      logger.info(`Gas balance check result:`, {
        nativeTokenSymbol,
        chainId,
        userBalance: chainBalance.balance,
        estimatedGasCost: gasCostEth.toString(),
        gasCostWithBuffer: gasCostWithBuffer.toString(),
        hasSufficientGasBalance,
      });

      return hasSufficientGasBalance;
    } catch (error) {
      logger.warn(`Failed to check gas balance for transfer: ${error}`);
      return false;
    }
  }

  /**
   * Estimate gas for a direct transfer (ETH or ERC20)
   */
  private async estimateTransferGas(
    chainId: SUPPORTED_CHAINS_IDS,
    token: SUPPORTED_TOKENS,
    amount: string,
    recipient: string,
  ): Promise<string | null> {
    try {
      const userAddress = await this.getUserAddress();
      if (!userAddress) {
        throw new Error('User address not available');
      }

      let gasEstimateHex: string;

      if (token.toUpperCase() === 'ETH' || TOKEN_METADATA[token.toUpperCase()]?.isNative) {
        // Native token transfer (ETH)
        const tokenMetadata = TOKEN_METADATA[token.toUpperCase()];
        const decimals = tokenMetadata?.decimals || 18;
        const valueInWei = parseUnits(amount, decimals);

        gasEstimateHex = (await this.evmProvider.request({
          method: 'eth_estimateGas',
          params: [
            {
              from: userAddress,
              to: recipient,
              value: `0x${valueInWei.toString(16)}`,
            },
          ],
        })) as string;
      } else {
        // ERC20 token transfer
        const tokenAddress = TOKEN_CONTRACT_ADDRESSES[token.toUpperCase()]?.[chainId];
        if (!tokenAddress) {
          throw new Error(`Token contract address not found for ${token} on chain ${chainId}`);
        }

        const tokenMetadata = TOKEN_METADATA[token.toUpperCase()];
        const decimals = tokenMetadata?.decimals || 18;
        const amountInWei = parseUnits(amount, decimals);

        // ERC20 transfer function selector: transfer(address,uint256)
        const transferSelector = '0xa9059cbb';
        const paddedRecipient = recipient.slice(2).padStart(64, '0');
        const paddedAmount = amountInWei.toString(16).padStart(64, '0');
        const transferData = `${transferSelector}${paddedRecipient}${paddedAmount}`;

        gasEstimateHex = (await this.evmProvider.request({
          method: 'eth_estimateGas',
          params: [
            {
              from: userAddress,
              to: tokenAddress,
              data: transferData,
            },
          ],
        })) as string;
      }

      const gasEstimateDecimal = parseInt(gasEstimateHex, 16);
      return gasEstimateDecimal.toString();
    } catch (error) {
      logger.error(`Gas estimation failed for transfer: ${error}`);
      return null;
    }
  }

  /**
   * Get current user address from provider
   */
  private async getUserAddress(): Promise<string | null> {
    try {
      const accounts = (await this.evmProvider.request({
        method: 'eth_accounts',
      })) as string[];
      return accounts[0] || null;
    } catch (error) {
      logger.error('Failed to get user address:', error as Error);
      return null;
    }
  }
}
