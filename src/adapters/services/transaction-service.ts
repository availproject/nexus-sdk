import { BaseService } from '../core/base-service';
import {
  validateContractParams,
  encodeContractCall,
  getBlockExplorerUrl,
  getTransactionHashWithFallback,
  waitForTransactionReceipt,
  extractErrorMessage,
} from '../../utils';
import type { EthereumProvider, ExecuteParams } from '../../types';
import type {
  TransactionOptions,
  TransactionResult,
  ExecutePreparation,
  ChainSwitchResult,
} from '../types/service-types';

/**
 * Service responsible for transaction handling and preparation
 */
export class TransactionService extends BaseService {
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

    // Validate contract parameters
    const validation = validateContractParams({
      contractAddress: params.contractAddress,
      contractAbi: params.contractAbi,
      functionName: params.functionName,
      functionParams: params.functionParams,
      chainId: params.toChainId,
    });

    if (!validation.isValid) {
      throw new Error(`Invalid contract parameters: ${validation.error}`);
    }

    // Ensure we're on the correct chain
    const chainResult = await this.ensureCorrectChain(params.toChainId);
    if (!chainResult.success) {
      throw new Error(`Failed to switch to chain ${params.toChainId}: ${chainResult.error}`);
    }

    // Get the from address
    const fromAddress = (await this.evmProvider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!fromAddress || fromAddress.length === 0) {
      throw new Error('No accounts available');
    }

    // Encode the function call
    const encodingResult = encodeContractCall({
      contractAbi: params.contractAbi,
      functionName: params.functionName,
      functionParams: params.functionParams,
    });

    if (!encodingResult.success) {
      throw new Error(`Failed to encode contract call: ${encodingResult.error}`);
    }

    return {
      provider: this.evmProvider,
      fromAddress: fromAddress[0],
      encodedData: encodingResult.data!,
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
        console.warn(`Failed to get transaction receipt: ${receiptResult.error}`);
        return {};
      }

      return {
        receipt: receiptResult.receipt,
        confirmations: receiptResult.confirmations,
        gasUsed: receiptResult.receipt?.gasUsed?.toString(),
        effectiveGasPrice: receiptResult.receipt?.effectiveGasPrice?.toString(),
      };
    } catch (error) {
      console.warn(`Receipt retrieval failed: ${extractErrorMessage(error, 'receipt retrieval')}`);
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
}
