import { BaseService } from '../core/base-service';
import {
  validateContractParams,
  encodeContractCall,
  getBlockExplorerUrl,
  getTransactionHashWithFallback,
  waitForTransactionReceipt,
  extractErrorMessage,
  logger,
} from '../../utils';
import type { EthereumProvider, ExecuteParams } from '../../../types';
import type {
  TransactionOptions,
  TransactionResult,
  ExecutePreparation,
  ChainSwitchResult,
} from '../types/service-types';

// Interface for gas estimation result
interface GasEstimationResult {
  success: boolean;
  gasEstimate?: string;
  gasEstimateDecimal?: number;
  gasPriceGwei?: string;
  estimatedCostEth?: string;
  error?: string;
  revertReason?: string;
}

/**
 * Service responsible for transaction handling and preparation
 */
export class TransactionService extends BaseService {
  // Flag to enable/disable gas estimation (can be set via constructor or method)
  private enableGasEstimation: boolean = true;

  /**
   * Enable or disable gas estimation before transaction execution
   */
  setGasEstimationEnabled(enabled: boolean): void {
    this.enableGasEstimation = enabled;
  }

  /**
   * Estimate gas for a transaction before execution
   */
  async estimateTransactionGas(
    provider: EthereumProvider,
    transactionParams: {
      from: string;
      to: string;
      data: string;
      value: string;
    },
  ): Promise<GasEstimationResult> {
    logger.info('DEBUG TransactionService - Starting gas estimation...');
    logger.info('DEBUG TransactionService - Transaction params:', {
      from: transactionParams.from,
      to: transactionParams.to,
      data: transactionParams.data.slice(0, 50) + '...', // Truncate for logging
      value: transactionParams.value,
    });

    try {
      // Step 1: Estimate gas
      const gasEstimate = (await provider.request({
        method: 'eth_estimateGas',
        params: [transactionParams],
      })) as string;

      const gasEstimateDecimal = parseInt(gasEstimate, 16);

      logger.info('DEBUG TransactionService - Gas estimation successful:', {
        gasEstimateHex: gasEstimate,
        gasEstimateDecimal: gasEstimateDecimal,
        gasEstimateFormatted: gasEstimateDecimal.toLocaleString(),
      });

      // Step 2: Get current gas price for cost calculation
      let gasPriceGwei: string | undefined;
      let estimatedCostEth: string | undefined;

      try {
        const gasPrice = (await provider.request({
          method: 'eth_gasPrice',
        })) as string;

        const gasPriceDecimal = parseInt(gasPrice, 16);
        const estimatedCostWei = gasEstimateDecimal * gasPriceDecimal;
        const estimatedCostEthNum = estimatedCostWei / 1e18;

        gasPriceGwei = (gasPriceDecimal / 1e9).toFixed(4) + ' gwei';
        estimatedCostEth = estimatedCostEthNum.toFixed(8) + ' ETH';

        logger.info('DEBUG TransactionService - Gas cost estimation:', {
          gasPriceHex: gasPrice,
          gasPriceGwei: gasPriceGwei,
          estimatedCostWei: estimatedCostWei.toString(),
          estimatedCostEth: estimatedCostEth,
        });
      } catch (gasPriceError) {
        logger.warn('DEBUG TransactionService - Failed to get gas price:', gasPriceError);
      }

      return {
        success: true,
        gasEstimate,
        gasEstimateDecimal,
        gasPriceGwei,
        estimatedCostEth,
      };
    } catch (gasEstimateError) {
      logger.error('DEBUG TransactionService - Gas estimation failed:', gasEstimateError as Error);

      // Extract revert reason if available
      let revertReason: string | undefined;
      let errorMessage = 'Gas estimation failed';

      if (gasEstimateError && typeof gasEstimateError === 'object') {
        if ('data' in gasEstimateError && gasEstimateError.data) {
          logger.error(
            'DEBUG TransactionService - Gas estimation revert data:',
            gasEstimateError.data as string,
          );
          revertReason = JSON.stringify(gasEstimateError.data);
        }
        if ('message' in gasEstimateError && gasEstimateError.message) {
          errorMessage = gasEstimateError.message as string;
          logger.error('DEBUG TransactionService - Gas estimation error message:', errorMessage);

          // Extract common revert patterns
          if (errorMessage.includes('execution reverted')) {
            const revertMatch = errorMessage.match(/execution reverted:?\s*(.+)/i);
            if (revertMatch && revertMatch[1]) {
              revertReason = revertMatch[1].trim();
            } else {
              revertReason = 'Transaction would revert (no reason provided)';
            }
          } else if (errorMessage.includes('insufficient funds')) {
            revertReason = 'Insufficient funds for gas * price + value';
          } else if (errorMessage.includes('out of gas')) {
            revertReason = 'Transaction would run out of gas';
          }
        }
      }

      return {
        success: false,
        error: errorMessage,
        revertReason,
      };
    }
  }

  /**
   * Ensure we're on the correct chain, switch if needed
   */
  async ensureCorrectChain(targetChainId: number): Promise<ChainSwitchResult> {
    try {
      const currentChainId = await this.evmProvider.request({ method: 'eth_chainId' });
      const currentChainIdDecimal = parseInt(currentChainId as string, 16);

      if (currentChainIdDecimal !== targetChainId) {
        try {
          await this.evmProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${targetChainId.toString(16)}` }],
          });
          return { success: true };
        } catch (switchError) {
          if (
            switchError &&
            typeof switchError === 'object' &&
            'code' in switchError &&
            switchError.code === 4902
          ) {
            throw new Error(
              `Chain ${targetChainId} is not configured in wallet. Please add it manually.`,
            );
          }
          throw switchError;
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: extractErrorMessage(error, 'chain switching'),
      };
    }
  }

  /**
   * Prepare execution by validating parameters and encoding function call
   */
  async prepareExecution(params: ExecuteParams): Promise<ExecutePreparation> {
    this.ensureInitialized();

    // Get the from address first (needed for callback)
    const fromAddress = (await this.evmProvider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!fromAddress || fromAddress.length === 0) {
      throw new Error('No accounts available');
    }

    // Ensure we're on the correct chain
    const chainResult = await this.ensureCorrectChain(params.toChainId);
    if (!chainResult.success) {
      throw new Error(`Failed to switch to chain ${params.toChainId}: ${chainResult.error}`);
    }

    // Call buildFunctionParams callback to get the actual function parameters
    // For ETH transactions, provide ETH as token and 0 as amount if tokenApproval is undefined
    const token = params.tokenApproval?.token || 'ETH';
    const amount = params.tokenApproval?.amount || '0';

    const { functionParams, value: callbackValue } = params.buildFunctionParams(
      token,
      amount,
      params.toChainId,
      fromAddress[0] as `0x${string}`,
    );

    // Validate contract parameters with built function params
    const validation = validateContractParams({
      contractAddress: params.contractAddress,
      contractAbi: params.contractAbi,
      functionName: params.functionName,
      functionParams,
      chainId: params.toChainId,
    });

    if (!validation.isValid) {
      throw new Error(`Invalid contract parameters: ${validation.error}`);
    }

    // Encode the function call
    const encodingResult = encodeContractCall({
      contractAbi: params.contractAbi,
      functionName: params.functionName,
      functionParams,
    });

    if (!encodingResult.success) {
      throw new Error(`Failed to encode contract call: ${encodingResult.error}`);
    }

    return {
      provider: this.evmProvider,
      fromAddress: fromAddress[0],
      encodedData: encodingResult.data!,
      value: callbackValue,
    };
  }

  /**
   * Send transaction with enhanced error handling and polling support
   */
  async sendTransaction(
    provider: EthereumProvider,
    fromAddress: string,
    contractAddress: string,
    encodedData: `0x${string}`,
    value: string,
    options: TransactionOptions,
  ): Promise<`0x${string}`> {
    const transactionParams = {
      from: fromAddress,
      to: contractAddress,
      data: encodedData,
      value: value || '0x0',
    };

    try {
      // Perform gas estimation if enabled
      if (this.enableGasEstimation) {
        logger.info('DEBUG TransactionService - Performing pre-execution gas estimation...');
        const gasEstimation = await this.estimateTransactionGas(provider, transactionParams);

        if (!gasEstimation.success) {
          logger.error(
            'DEBUG TransactionService - Pre-execution gas estimation failed:',
            gasEstimation.error,
          );

          if (gasEstimation.revertReason) {
            logger.warn(
              `DEBUG TransactionService - Transaction will likely fail: ${gasEstimation.revertReason}`,
            );
            throw new Error(`Transaction simulation failed: ${gasEstimation.revertReason}`);
          }
        } else {
          logger.info('DEBUG TransactionService - Gas estimation completed successfully:', {
            gasEstimate: gasEstimation.gasEstimate,
            estimatedCost: gasEstimation.estimatedCostEth,
            gasPrice: gasEstimation.gasPriceGwei,
          });
        }
      } else {
        logger.info(
          'DEBUG TransactionService - Gas estimation disabled, proceeding with transaction',
        );
      }

      logger.info('DEBUG TransactionService - Sending transaction...');
      const response = await provider.request({
        method: 'eth_sendTransaction',
        params: [transactionParams],
      });

      // Get transaction hash with fallback polling
      const hashResult = await getTransactionHashWithFallback(provider, response, {
        enablePolling: options.enableTransactionPolling,
        timeout: options.transactionTimeout,
        fromAddress,
      });

      if (!hashResult.success || !hashResult.hash) {
        throw new Error(
          hashResult.error || 'Failed to retrieve transaction hash from provider response',
        );
      }

      logger.info('DEBUG TransactionService - Transaction sent successfully:', {
        transactionHash: hashResult.hash,
      });

      return hashResult.hash;
    } catch (error) {
      // Enhanced error handling for common transaction failures
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 4001) {
          throw new Error('Transaction rejected by user');
        } else if (error.code === -32000) {
          throw new Error('Insufficient funds for transaction');
        } else if (error.code === -32603) {
          throw new Error('Internal JSON-RPC error during transaction');
        }
      }

      throw new Error(`Transaction failed: ${extractErrorMessage(error, 'transaction')}`);
    }
  }

  /**
   * Handle transaction confirmation with receipt and confirmations
   */
  async handleTransactionConfirmation(
    provider: EthereumProvider,
    transactionHash: `0x${string}`,
    options: TransactionOptions,
    chainId: number,
  ): Promise<TransactionResult> {
    if (!options.waitForReceipt) {
      return {};
    }

    try {
      const receiptResult = await waitForTransactionReceipt(
        provider,
        transactionHash,
        {
          timeout: options.receiptTimeout,
          requiredConfirmations: options.requiredConfirmations,
        },
        chainId,
      );

      if (!receiptResult.success) {
        logger.warn(`Failed to get transaction receipt: ${receiptResult.error}`);
        return {};
      }

      return {
        receipt: receiptResult.receipt,
        confirmations: receiptResult.confirmations,
        gasUsed: receiptResult.receipt?.gasUsed?.toString(),
        effectiveGasPrice: receiptResult.receipt?.effectiveGasPrice?.toString(),
      };
    } catch (error) {
      logger.warn(`Receipt retrieval failed: ${extractErrorMessage(error, 'receipt retrieval')}`);
      return {};
    }
  }

  /**
   * Build execute result with transaction information
   */
  buildExecuteResult(transactionHash: string, chainId: number, receiptInfo: TransactionResult) {
    return {
      transactionHash,
      explorerUrl: getBlockExplorerUrl(chainId, transactionHash),
      chainId,
      ...receiptInfo,
    };
  }

  /**
   * Direct native token transfer (ETH, MATIC, AVAX, etc.)
   */
  async transferNativeToken(
    provider: EthereumProvider,
    fromAddress: string,
    toAddress: string,
    amount: string, // Amount in human-readable format (e.g., "0.1")
    decimals: number = 18,
  ): Promise<{
    success: boolean;
    hash?: `0x${string}`;
    error?: string;
  }> {
    const { parseUnits } = await import('viem');

    const valueInWei = parseUnits(amount, decimals);
    const transactionParams = {
      from: fromAddress,
      to: toAddress,
      data: '0x',
      value: `0x${valueInWei.toString(16)}`,
    };

    try {
      // Perform gas estimation if enabled
      if (this.enableGasEstimation) {
        logger.info(
          'DEBUG TransactionService - Performing gas estimation for native token transfer...',
        );
        const gasEstimation = await this.estimateTransactionGas(provider, transactionParams);

        if (!gasEstimation.success) {
          logger.error(
            'DEBUG TransactionService - Gas estimation failed for native token transfer:',
            gasEstimation.error,
          );
          throw new Error(`Native token transfer gas estimation failed: ${gasEstimation.error}`);
        }

        logger.info('DEBUG TransactionService - Native token transfer gas estimation successful:', {
          gasEstimate: gasEstimation.gasEstimate,
          estimatedCost: gasEstimation.estimatedCostEth,
        });
      }

      logger.info('DEBUG TransactionService - Sending native token transfer...');
      const response = await provider.request({
        method: 'eth_sendTransaction',
        params: [transactionParams],
      });

      const transactionHash = getTransactionHashWithFallback(provider, response);
      logger.info(
        'DEBUG TransactionService - Native token transfer sent successfully:',
        transactionHash,
      );
      return transactionHash;
    } catch (error) {
      logger.error('DEBUG TransactionService - Native token transfer failed:', error as Error);
      throw new Error(
        `Native token transfer failed: ${extractErrorMessage(error, 'native transfer')}`,
      );
    }
  }

  /**
   * Direct ERC20 token transfer
   */
  async transferERC20Token(
    provider: EthereumProvider,
    fromAddress: string,
    tokenAddress: string,
    toAddress: string,
    amount: string, // Amount in human-readable format (e.g., "100")
    decimals: number = 18,
  ): Promise<{
    success: boolean;
    hash?: `0x${string}`;
    error?: string;
  }> {
    const { parseUnits } = await import('viem');

    try {
      const amountInWei = parseUnits(amount, decimals);

      // ERC20 transfer function selector: transfer(address,uint256)
      const transferSelector = '0xa9059cbb';
      const paddedRecipient = toAddress.slice(2).padStart(64, '0');
      const paddedAmount = amountInWei.toString(16).padStart(64, '0');
      const transferData = `${transferSelector}${paddedRecipient}${paddedAmount}`;

      const transactionParams = {
        from: fromAddress,
        to: tokenAddress,
        data: transferData,
        value: '0x0',
      };

      // Perform gas estimation if enabled
      if (this.enableGasEstimation) {
        logger.info('DEBUG TransactionService - Performing gas estimation for ERC20 transfer...');
        const gasEstimation = await this.estimateTransactionGas(provider, transactionParams);

        if (!gasEstimation.success) {
          logger.error(
            'DEBUG TransactionService - Gas estimation failed for ERC20 transfer:',
            gasEstimation.error,
          );

          if (gasEstimation.revertReason) {
            throw new Error(`ERC20 transfer will fail: ${gasEstimation.revertReason}`);
          }
          throw new Error(`ERC20 transfer gas estimation failed: ${gasEstimation.error}`);
        }

        logger.info('DEBUG TransactionService - ERC20 transfer gas estimation successful:', {
          gasEstimate: gasEstimation.gasEstimate,
          estimatedCost: gasEstimation.estimatedCostEth,
        });
      }

      logger.info('DEBUG TransactionService - Sending ERC20 transfer...');
      const response = await provider.request({
        method: 'eth_sendTransaction',
        params: [transactionParams],
      });

      const transactionHash = getTransactionHashWithFallback(provider, response);
      logger.info('DEBUG TransactionService - ERC20 transfer sent successfully:', transactionHash);
      return transactionHash;
    } catch (error) {
      logger.error('DEBUG TransactionService - ERC20 transfer failed:', error as Error);
      throw new Error(`ERC20 transfer failed: ${extractErrorMessage(error, 'ERC20 transfer')}`);
    }
  }
}
