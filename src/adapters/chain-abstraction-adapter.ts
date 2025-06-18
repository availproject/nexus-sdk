import { CA, Network, SDKConfig, ProgressStep } from '@arcana/ca-sdk';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { SUPPORTED_CHAINS, TOKEN_METADATA, CHAIN_METADATA, NEXUS_EVENTS } from '../constants';
import {
  formatTokenAmount,
  validateContractParams,
  encodeContractCall,
  getBlockExplorerUrl,
  getTransactionHashWithFallback,
  waitForTransactionReceipt,
  estimateGasWithValidation,
  formatGasCost,
  getEnhancedGasPrice,
} from '../utils';
import type {
  EthereumProvider,
  OnIntentHook,
  UserAsset,
  OnAllowanceHook,
  RequestArguments,
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  AllowanceResponse,
  EventListener,
  ChainMetadata,
  TokenBalance,
  SUPPORTED_TOKENS,
  SimulationResult,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  FeeData,
  GasPricingConfig,
  TransactionReceipt,
  RequestForFunds,
} from '../types';

/**
 * Adapter class that wraps CA SDK and provides a unified interface for chain abstraction operations.
 */
export class ChainAbstractionAdapter {
  private readonly ca: CA;
  private evmProvider: EthereumProvider | null = null;
  public readonly caEvents: SafeEventEmitter;
  private initialized = false;

  constructor(config?: SDKConfig) {
    this.ca = new CA(config);
    this.caEvents = this.ca.caEvents;
  }

  /**
   * Initialize the CA SDK with an EVM provider.
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    if (this.initialized) return;
    if (!provider) {
      throw new Error('Provider is required');
    }
    try {
      this.ca.setEVMProvider(provider);
      await this.ca.init();

      // Get the enhanced provider with CA functionality
      this.evmProvider = this.ca.getEVMProviderWithCA();
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize CA SDK: ${error}`);
    }
  }

  /**
   * Check if the adapter has been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the EVM provider enhanced with CA functionality
   */
  public getEVMProviderWithCA(): EthereumProvider {
    if (!this.evmProvider) {
      throw new Error('CA SDK not initialized. Call initialize() first.');
    }
    return this.evmProvider;
  }

  /**
   * Get unified balances for all supported tokens across all chains.
   */
  public async getUnifiedBalances(): Promise<UserAsset[]> {
    try {
      return await this.ca.getUnifiedBalances();
    } catch (error) {
      throw new Error(`Failed to fetch unified balances: ${error}`);
    }
  }

  /**
   * Get unified balance for a specific token symbol.
   */
  public async getUnifiedBalance(symbol: string): Promise<UserAsset | undefined> {
    try {
      return await this.ca.getUnifiedBalance(symbol);
    } catch (error) {
      throw new Error(`Failed to fetch unified balance for ${symbol}: ${error}`);
    }
  }

  /**
   * Check the current allowance for tokens on a specific chain.
   */
  public async getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]> {
    try {
      const input: { chainID?: number; tokens?: string[] } = {};

      if (chainId) input.chainID = chainId;
      if (tokens) input.tokens = tokens;

      const allowances = await this.ca.allowance().get(input);

      return allowances;
    } catch (error) {
      throw new Error(`Failed to check allowance: ${error}`);
    }
  }

  /**
   * Set the allowance for tokens on a specific chain.
   */
  public async setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void> {
    try {
      await this.ca.allowance().set({
        chainID: chainId,
        tokens,
        amount,
      });
    } catch (error) {
      throw new Error(`Failed to set allowance: ${error}`);
    }
  }

  /**
   * Revoke the allowance for tokens on a specific chain.
   */
  public async revokeAllowance(chainId: number, tokens: string[]): Promise<void> {
    try {
      await this.ca.allowance().revoke({
        chainID: chainId,
        tokens,
      });
    } catch (error) {
      throw new Error(`Failed to revoke allowance: ${error}`);
    }
  }

  /**
   * Set a callback for intent status updates.
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this.ca.setOnIntentHook(callback);
  }

  /**
   * Set a callback for allowance approval events.
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this.ca.setOnAllowanceHook(callback);
  }

  /**
   * Generic transaction listener for CA SDK operations
   * @private
   */
  private async waitForTransactionCompletion<T extends BridgeResult | TransferResult>(
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
          console.error('Error processing step completion:', error);
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
   * Bridge tokens between chains using the new API structure.
   */
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    if (!this.isSupportedChain(params.chainId)) {
      return { success: false, error: 'Unsupported chain' };
    }
    if (!this.isSupportedToken(params.token)) {
      return { success: false, error: 'Unsupported token' };
    }
    if (!this.initialized) {
      return { success: false, error: 'CA SDK not initialized. Call initialize() first.' };
    }

    return await this.waitForTransactionCompletion<BridgeResult>(async () => {
      const bridgeQuery = await this.ca.bridge({
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
        gas: params.gas ? BigInt(params.gas) : undefined,
      });

      await bridgeQuery.exec();
    });
  }

  /**
   * Simulate bridge transaction to get costs and fees.
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    if (!this.isSupportedChain(params.chainId)) throw new Error('Unsupported chain');
    if (!this.isSupportedToken(params.token)) throw new Error('Unsupported token');
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');

    try {
      const bridgeQuery = await this.ca.bridge({
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
        gas: params.gas ? BigInt(params.gas) : undefined,
      });

      // Simulate the bridge transaction
      const result = await bridgeQuery.simulate();
      return result;
    } catch (error) {
      throw new Error(`Bridge simulation failed: ${error}`);
    }
  }

  /**
   * Transfer tokens to a recipient using the new API structure.
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
    if (!this.isSupportedChain(params.chainId)) {
      return { success: false, error: 'Unsupported chain' };
    }
    if (!this.isSupportedToken(params.token)) {
      return { success: false, error: 'Unsupported token' };
    }
    if (!this.initialized) {
      return { success: false, error: 'CA SDK not initialized. Call initialize() first.' };
    }

    return await this.waitForTransactionCompletion<TransferResult>(async () => {
      const transferQuery = await this.ca.transfer({
        to: params.recipient,
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
      });

      await transferQuery.exec();
    });
  }

  /**
   * Simulate transfer transaction to get costs and fees.
   */
  public async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    if (!this.isSupportedChain(params.chainId)) {
      throw new Error('Unsupported chain');
    }
    if (!this.isSupportedToken(params.token)) {
      throw new Error('Unsupported token');
    }
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');

    try {
      const transferQuery = await this.ca.transfer({
        to: params.recipient,
        token: params.token,
        amount: params.amount,
        chainID: params.chainId,
      });

      // Simulate the transfer transaction
      const result = await transferQuery.simulate();
      return result;
    } catch (error) {
      throw new Error(`Transfer simulation failed: ${error}`);
    }
  }

  /**
   * Get user's intents with pagination.
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');

    try {
      const intents = await this.ca.getMyIntents(page);
      return intents;
    } catch (error) {
      throw new Error(`Failed to fetch intents: ${error}`);
    }
  }

  /**
   * Get token balance for a specific token on a specific chain from unified balance.
   */
  public async getFormattedTokenBalance(
    symbol: SUPPORTED_TOKENS,
    chainId?: number,
  ): Promise<TokenBalance | undefined> {
    try {
      const unifiedBalance = await this.ca.getUnifiedBalance(symbol);
      if (!unifiedBalance) return undefined;

      if (chainId) {
        const chainBalance = unifiedBalance.breakdown.find((b) => b.chain.id === chainId);
        if (!chainBalance) return undefined;

        return {
          symbol: unifiedBalance.symbol,
          balance: chainBalance.balance,
          formattedBalance: formatTokenAmount(chainBalance.balance, symbol),
          balanceInFiat: chainBalance.balanceInFiat,
          chainId: chainBalance.chain.id,
          contractAddress: chainBalance.contractAddress,
          isNative: chainBalance.isNative,
        };
      }

      // Return total balance across all chains
      return {
        symbol: unifiedBalance.symbol,
        balance: unifiedBalance.balance,
        formattedBalance: formatTokenAmount(unifiedBalance.balance, symbol),
        balanceInFiat: unifiedBalance.balanceInFiat,
        chainId: 0, // 0 indicates cross-chain total
      };
    } catch (error) {
      throw new Error(`Failed to get token balance: ${error}`);
    }
  }

  /**
   * Subscribe to account change events.
   */
  public onAccountChanged(callback: (account: string) => void): void {
    this.ca.caEvents.on(NEXUS_EVENTS.ACCOUNTS_CHANGED, ((accounts: string[]) => {
      callback(accounts[0] || '');
    }) as EventListener);
  }

  /**
   * Subscribe to chain change events.
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.ca.caEvents.on(NEXUS_EVENTS.CHAIN_CHANGED, ((chainId: string) => {
      callback(parseInt(chainId, 16));
    }) as EventListener);
  }

  /**
   * Remove all listeners for all events from ca.caEvents and the main CA instance.
   */
  public removeAllListeners(): void {
    // Remove all listeners from ca.caEvents (SafeEventEmitter)
    if (this.ca.caEvents && typeof this.ca.caEvents.eventNames === 'function') {
      for (const event of this.ca.caEvents.eventNames()) {
        this.ca.caEvents.removeAllListeners(event);
      }
    }
  }

  /**
   * Get the list of supported chains from the CA SDK.
   */
  public getSupportedChains(env?: Network): Array<{ id: number; name: string; logo: string }> {
    return CA.getSupportedChains(env);
  }

  /**
   * Get enhanced chain metadata for all supported chains.
   */
  public getSupportedChainsWithMetadata(): ChainMetadata[] {
    return Object.values(CHAIN_METADATA);
  }

  /**
   * Check if a chain is supported by the adapter.
   */
  public isSupportedChain(
    chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS],
  ): boolean {
    return Object.values(SUPPORTED_CHAINS).includes(chainId);
  }

  /**
   * Check if a token is supported by the adapter.
   */
  public isSupportedToken(token: string): boolean {
    return Object.keys(TOKEN_METADATA).includes(token);
  }

  /**
   * Deinitialize the CA SDK and clean up resources.
   */
  public async deinit(): Promise<void> {
    if (!this.initialized) return;
    try {
      this.ca.deinit();
      this.initialized = false;
    } catch (error) {
      throw new Error(`Failed to deinitialize CA SDK: ${error}`);
    }
  }

  /**
   * Make a generic EIP-1193 request using the enhanced provider.
   */
  public async request(args: RequestArguments): Promise<unknown> {
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');
    if (!this.evmProvider) throw new Error('Enhanced provider not available');

    try {
      // Use the enhanced provider instead of direct ca.request
      return await this.evmProvider.request(args);
    } catch (error) {
      throw new Error(`EIP-1193 request failed: ${error}`);
    }
  }

  /**
   * Subscribe to any event emitted by the CA SDK.
   */
  public on(eventName: string, listener: EventListener): void {
    this.ca.caEvents.on(eventName, listener);
  }

  /**
   * Remove a specific event listener.
   */
  public removeListener(eventName: string, listener: EventListener): void {
    this.ca.caEvents.removeListener(eventName, listener);
  }

  /**
   * Remove all listeners for a specific event from ca.caEvents, or all if eventName is undefined.
   */
  public removeAllCaEventListeners(eventName?: string): void {
    if (this.ca.caEvents) this.ca.caEvents.removeAllListeners(eventName);
  }

  /**
   * Enhanced gas parameter preparation with EIP-1559 support
   */
  private async prepareEnhancedGasParams(
    provider: EthereumProvider,
    fromAddress: string,
    contractAddress: string,
    encodedData: `0x${string}`,
    value: string,
    params: {
      gasLimit?: bigint;
      maxGasPrice?: string;
      gasPricingConfig?: GasPricingConfig;
    },
    chainId: number,
  ): Promise<{
    gasLimit: string;
    feeData: FeeData;
    totalCost: string;
  }> {
    // Estimate gas limit if not provided
    let finalGasLimit = params.gasLimit?.toString();
    if (!finalGasLimit) {
      const gasEstimation = await estimateGasWithValidation(
        provider,
        {
          from: fromAddress,
          to: contractAddress,
          data: encodedData,
          value,
        },
        chainId,
      );
      if (!gasEstimation.success) {
        throw new Error(gasEstimation.error);
      }
      finalGasLimit = gasEstimation.gasLimit!;
    }

    // Get enhanced gas pricing
    const gasPricingConfig: GasPricingConfig = {
      strategy: 'standard',
      maxGasPrice: params.maxGasPrice,
      fallbackToLegacy: true,
      retryAttempts: 2,
      ...params.gasPricingConfig,
    };

    const gasPriceResult = await getEnhancedGasPrice(provider, gasPricingConfig, chainId);
    if (!gasPriceResult.success || !gasPriceResult.feeData) {
      throw new Error(gasPriceResult.error || 'Failed to get gas price');
    }

    // Calculate total cost estimate
    const gasLimitBigInt = BigInt(finalGasLimit);
    let totalCost: string;

    if (gasPriceResult.feeData.type === 'eip1559') {
      // Use maxFeePerGas for cost calculation
      const maxFee = BigInt(gasPriceResult.feeData.maxFeePerGas!);
      totalCost = (gasLimitBigInt * maxFee).toString();
    } else {
      // Use legacy gas price
      const gasPrice = BigInt(gasPriceResult.feeData.gasPrice!);
      totalCost = (gasLimitBigInt * gasPrice).toString();
    }

    return {
      gasLimit: finalGasLimit,
      feeData: gasPriceResult.feeData,
      totalCost,
    };
  }

  /**
   * Prepare and validate execution parameters
   */
  private async prepareExecution(params: ExecuteParams): Promise<{
    provider: EthereumProvider;
    fromAddress: string;
    encodedData: `0x${string}`;
    gasParams: { gasLimit: string; feeData: FeeData; totalCost: string };
  }> {
    // Emit start event
    this.caEvents.emit(NEXUS_EVENTS.EXECUTE_STARTED, {
      chainId: params.toChainId,
      contractAddress: params.contractAddress,
    });

    // Validate contract parameters
    const validation = validateContractParams({
      contractAddress: params.contractAddress,
      contractAbi: params.contractAbi,
      functionName: params.functionName,
      functionParams: params.functionParams,
      chainId: params.toChainId,
    });
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Get provider
    const provider = this.evmProvider;
    if (!provider) {
      throw new Error(`No provider available for chain ${params.toChainId}`);
    }

    // Get user account
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('No wallet account connected');
    }
    const fromAddress = accounts[0];

    // Encode contract call
    const encoding = encodeContractCall({
      contractAbi: params.contractAbi,
      functionName: params.functionName,
      functionParams: params.functionParams,
    });
    if (!encoding.success) {
      throw new Error(encoding.error);
    }

    // Prepare gas parameters with enhanced pricing
    const gasParams = await this.prepareEnhancedGasParams(
      provider,
      fromAddress,
      params.contractAddress,
      encoding.data!,
      params.value || '0x0',
      {
        gasLimit: params.gasLimit,
        maxGasPrice: params.maxGasPrice,
        gasPricingConfig: params.gasPricingConfig,
      },
      params.toChainId,
    );

    return {
      provider,
      fromAddress,
      encodedData: encoding.data!,
      gasParams,
    };
  }

  /**
   * Send transaction with appropriate gas settings
   */
  private async sendTransaction(
    provider: EthereumProvider,
    fromAddress: string,
    contractAddress: string,
    encodedData: `0x${string}`,
    value: string,
    gasParams: { gasLimit: string; feeData: FeeData },
    options: {
      enableTransactionPolling?: boolean;
      transactionTimeout?: number;
    },
  ): Promise<`0x${string}`> {
    // Build transaction parameters based on fee type
    const baseTxParams = {
      from: fromAddress,
      to: contractAddress,
      data: encodedData,
      value,
      gas: gasParams.gasLimit,
    };

    interface TransactionParams {
      from: string;
      to: string;
      data: `0x${string}`;
      value: string;
      gas: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasPrice?: string;
    }

    let txParams: TransactionParams;
    if (gasParams.feeData.type === 'eip1559') {
      // EIP-1559 transaction
      txParams = {
        ...baseTxParams,
        maxFeePerGas: gasParams.feeData.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.feeData.maxPriorityFeePerGas,
      };
    } else {
      // Legacy transaction
      txParams = {
        ...baseTxParams,
        gasPrice: gasParams.feeData.gasPrice,
      };
    }

    // Send transaction
    const response = await provider.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    });

    // Get transaction hash with fallback strategies
    const hashResult = await getTransactionHashWithFallback(provider, response, {
      enablePolling: options.enableTransactionPolling,
      timeout: options.transactionTimeout,
      fromAddress,
    });

    if (!hashResult.success || !hashResult.hash) {
      throw new Error(hashResult.error ?? 'Transaction submission failed');
    }

    return hashResult.hash;
  }

  /**
   * Handle transaction confirmation and receipt waiting
   */
  private async handleTransactionConfirmation(
    provider: EthereumProvider,
    transactionHash: `0x${string}`,
    options: {
      waitForReceipt?: boolean;
      receiptTimeout?: number;
      requiredConfirmations?: number;
    },
    chainId: number,
  ): Promise<{
    receipt?: TransactionReceipt;
    confirmations?: number;
    gasUsed?: string;
    effectiveGasPrice?: string;
  }> {
    // Emit transaction sent event
    this.caEvents.emit(NEXUS_EVENTS.TRANSACTION_SENT, {
      hash: transactionHash,
    });

    if (!options.waitForReceipt) {
      return {};
    }

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
      // Transaction was sent but receipt failed - log warning but don't fail
      console.warn(`Receipt waiting failed: ${receiptResult.error}`);
      return {};
    }

    const { receipt, confirmations } = receiptResult;

    // Emit receipt events
    this.caEvents.emit(NEXUS_EVENTS.RECEIPT_RECEIVED, {
      hash: transactionHash,
      receipt,
      confirmations,
    });

    if (
      confirmations &&
      options.requiredConfirmations &&
      confirmations >= options.requiredConfirmations
    ) {
      this.caEvents.emit(NEXUS_EVENTS.TRANSACTION_CONFIRMED, {
        hash: transactionHash,
        confirmations,
      });
    }

    return {
      receipt,
      confirmations,
      gasUsed: receipt?.gasUsed?.toString(),
      effectiveGasPrice: receipt?.effectiveGasPrice?.toString(),
    };
  }

  /**
   * Build the final execute result
   */
  private buildExecuteResult(
    transactionHash: string,
    chainId: number,
    receiptInfo: {
      receipt?: TransactionReceipt;
      confirmations?: number;
      gasUsed?: string;
      effectiveGasPrice?: string;
    },
  ): ExecuteResult {
    return {
      transactionHash,
      explorerUrl: getBlockExplorerUrl(chainId, transactionHash),
      chainId,
      receipt: receiptInfo.receipt,
      confirmations: receiptInfo.confirmations,
      gasUsed: receiptInfo.gasUsed,
      effectiveGasPrice: receiptInfo.effectiveGasPrice,
    };
  }

  /**
   * Refactored execute function with improved structure and enhanced gas pricing
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const {
      toChainId,
      enableTransactionPolling = false,
      transactionTimeout = 30000,
      waitForReceipt = false,
      receiptTimeout = 300000,
      requiredConfirmations = 1,
    } = params;

    try {
      // 1. Prepare and validate execution parameters
      const { provider, fromAddress, encodedData, gasParams } = await this.prepareExecution(params);

      // 2. Send transaction
      const transactionHash = await this.sendTransaction(
        provider,
        fromAddress,
        params.contractAddress,
        encodedData,
        params.value || '0x0',
        gasParams,
        { enableTransactionPolling, transactionTimeout },
      );

      // 3. Handle confirmation if requested
      const receiptInfo = await this.handleTransactionConfirmation(
        provider,
        transactionHash,
        {
          waitForReceipt,
          receiptTimeout,
          requiredConfirmations,
        },
        toChainId,
      );

      // 4. Build and return result
      const result = this.buildExecuteResult(transactionHash, toChainId, receiptInfo);

      this.caEvents.emit(NEXUS_EVENTS.EXECUTE_COMPLETED, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown execute error';
      this.caEvents.emit(NEXUS_EVENTS.EXECUTE_FAILED, {
        message: errorMessage,
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      throw new Error(`Execute failed: ${errorMessage}`);
    }
  }

  /**
   * Simulate a execute to estimate gas costs and validate parameters
   * @param params Execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    const {
      toChainId,
      contractAddress,
      contractAbi,
      functionName,
      functionParams,
      value = '0x0',
    } = params;

    const baseError = {
      gasLimit: '0',
      gasPrice: '0',
      estimatedCost: '0',
      estimatedCostEth: '0',
      success: false,
    };

    try {
      // Validate contract parameters
      const validation = validateContractParams({
        contractAddress,
        contractAbi,
        functionName,
        functionParams,
        chainId: toChainId,
      });

      if (!validation.isValid) {
        return { ...baseError, error: validation.error };
      }

      // Get provider for the target chain
      const provider = this.evmProvider;
      if (!provider) {
        return { ...baseError, error: `No provider available for chain ${toChainId}` };
      }

      // Get current account
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      if (!accounts || accounts.length === 0) {
        return { ...baseError, error: 'No wallet account connected' };
      }
      const fromAddress = accounts[0];

      // Encode contract call
      const encoding = encodeContractCall({
        contractAbi,
        functionName,
        functionParams,
      });

      if (!encoding.success) {
        return { ...baseError, error: encoding.error };
      }

      // Estimate gas
      const gasEstimation = await estimateGasWithValidation(
        provider,
        {
          from: fromAddress,
          to: contractAddress,
          data: encoding.data!,
          value,
        },
        toChainId,
      );

      if (!gasEstimation.success) {
        return { ...baseError, error: gasEstimation.error };
      }

      // Get gas price
      const gasPriceResult = await getEnhancedGasPrice(
        provider,
        {
          strategy: 'standard',
          fallbackToLegacy: true,
          retryAttempts: 2,
        },
        toChainId,
      );

      if (!gasPriceResult.success || !gasPriceResult.feeData) {
        return { ...baseError, error: gasPriceResult.error || 'Failed to get gas price' };
      }

      // Get appropriate gas price for cost calculation
      const effectiveGasPrice =
        gasPriceResult.feeData.type === 'eip1559'
          ? gasPriceResult.feeData.maxFeePerGas!
          : gasPriceResult.feeData.gasPrice!;

      // Format costs
      const costs = formatGasCost(gasEstimation.gasLimit!, effectiveGasPrice);

      return {
        gasLimit: gasEstimation.gasLimit!, // Keep as hex string
        maxGasPrice: effectiveGasPrice,
        estimatedCost: costs.totalCostWei,
        estimatedCostEth: costs.totalCostEth,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown simulation error';
      return { ...baseError, error: `Simulation failed: ${errorMessage}` };
    }
  }

  /**
   * Handle execute phase of bridge and execute operation
   */
  private async handleExecutePhase(
    execute: Omit<ExecuteParams, 'toChainId'> | undefined,
    toChainId: number,
    enableTransactionPolling: boolean,
    transactionTimeout: number,
    waitForReceipt?: boolean,
    receiptTimeout?: number,
    requiredConfirmations?: number,
  ): Promise<{ executeTransactionHash?: string; executeExplorerUrl?: string }> {
    if (!execute) return {};

    try {
      const executeResult = await this.execute({
        ...execute,
        toChainId,
        enableTransactionPolling,
        transactionTimeout,
        waitForReceipt,
        receiptTimeout,
        requiredConfirmations,
      });

      return {
        executeTransactionHash: executeResult.transactionHash,
        executeExplorerUrl: executeResult.explorerUrl,
      };
    } catch (executeError) {
      const errorMessage =
        executeError instanceof Error ? executeError.message : 'Unknown execute error';

      this.caEvents.emit(NEXUS_EVENTS.OPERATION_FAILED, {
        message: errorMessage,
        stage: 'execute' as const,
        code: executeError instanceof Error ? executeError.name : 'UNKNOWN_ERROR',
      });

      throw new Error(`Execute phase failed: ${errorMessage}`);
    }
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
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
      this.caEvents.emit(NEXUS_EVENTS.OPERATION_STARTED, { toChainId, hasExecute: !!execute });
      this.caEvents.emit(NEXUS_EVENTS.BRIDGE_STARTED, { toChainId, token, amount });

      const bridgeResult = await this.bridge({ token, amount, chainId: toChainId });

      if (!bridgeResult.success) {
        this.caEvents.emit(NEXUS_EVENTS.BRIDGE_FAILED, {
          message: bridgeResult.error ?? 'Bridge failed',
          code: 'BRIDGE_ERROR',
        });
        throw new Error(`Bridge failed: ${bridgeResult.error}`);
      }

      this.caEvents.emit(NEXUS_EVENTS.BRIDGE_COMPLETED, {
        success: true,
        toChainId,
      });

      const { executeTransactionHash, executeExplorerUrl } = await this.handleExecutePhase(
        execute,
        toChainId,
        enableTransactionPolling,
        transactionTimeout,
        waitForReceipt,
        receiptTimeout,
        requiredConfirmations,
      );

      const result: BridgeAndExecuteResult = {
        executeTransactionHash,
        executeExplorerUrl,
        toChainId,
      };

      this.caEvents.emit(NEXUS_EVENTS.OPERATION_COMPLETED, result);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown bridge and execute error';
      const stage = errorMessage.includes('Execute phase failed') ? 'execute' : 'bridge';

      this.caEvents.emit(NEXUS_EVENTS.OPERATION_FAILED, {
        message: errorMessage,
        stage,
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });

      throw new Error(`Bridge and execute operation failed: ${errorMessage}`);
    }
  }

  /**
   * Simulate bridge and execute operation to estimate total costs
   * @param params Bridge and execute parameters for simulation
   * @returns Promise resolving to simulation result with combined cost estimates
   */
  public async simulateBridgeAndExecute(params: BridgeAndExecuteParams): Promise<{
    bridgeSimulation: SimulationResult | null;
    executeSimulation?: ExecuteSimulation;
    success: boolean;
    error?: string;
  }> {
    try {
      const { execute } = params;

      const bridgeSimulation = await this.simulateBridge({
        token: params.token,
        amount: params.amount,
        chainId: params.toChainId,
      });

      let executeSimulation: ExecuteSimulation | undefined;

      if (execute) {
        executeSimulation = await this.simulateExecute({
          ...execute,
          toChainId: params.toChainId,
        });

        if (!executeSimulation.success) {
          return {
            bridgeSimulation,
            executeSimulation,
            success: false,
            error: executeSimulation.error,
          };
        }
      }

      return {
        bridgeSimulation,
        executeSimulation,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown simulation error';
      return {
        bridgeSimulation: null,
        executeSimulation: undefined,
        success: false,
        error: `Simulation failed: ${errorMessage}`,
      };
    }
  }
}
