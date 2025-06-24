import { CA, Network, SDKConfig, ProgressStep } from '@arcana/ca-sdk';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { SUPPORTED_CHAINS, TOKEN_METADATA, NEXUS_EVENTS } from '../constants';
import {
  validateContractParams,
  encodeContractCall,
  getBlockExplorerUrl,
  getTransactionHashWithFallback,
  waitForTransactionReceipt,
  getTokenContractAddress,
  extractErrorMessage,
} from '../utils';

import { parseUnits, hexToNumber } from 'viem';
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
  SUPPORTED_TOKENS,
  SimulationResult,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  TransactionReceipt,
  RequestForFunds,
  ApprovalInfo,
  BridgeAndExecuteSimulationResult,
  SimulationStep,
} from '../types';
import { getSimulationClient } from '../integrations/tenderly';

/**
 * Internal constants for ERC20 function selectors and other hardcoded values
 */
const FUNCTION_SELECTORS = {
  ALLOWANCE: '0xdd62ed3e', // allowance(address,address)
  APPROVE: '0x095ea7b3', // approve(address,uint256)
} as const;

/**
 * Internal constants for adapter behavior
 */
const ADAPTER_CONSTANTS = {
  APPROVAL_BUFFER_PERCENTAGE: 100n, // 1% buffer to avoid unnecessary re-approvals (represented as 1/100)
  DEFAULT_DECIMALS: 18, // Default token decimals when metadata is not available
} as const;

/**
 * Adapter class that wraps CA SDK and provides a unified interface for chain abstraction operations.
 */
export class LegacyChainAbstractionAdapter {
  private readonly ca: CA;
  private evmProvider: EthereumProvider | null = null;
  public readonly caEvents: SafeEventEmitter;
  private initialized = false;

  constructor(config?: SDKConfig) {
    this.ca = new CA(config);
    this.caEvents = this.ca.caEvents;
  }

  /**
   * Helper method for common initialization validation
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CA SDK not initialized. Call initialize() first.');
    }
  }

  /**
   * Helper method for common bridge/transfer parameter validation
   */
  private validateBridgeTransferParams(params: {
    chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
    token: string;
  }): void {
    if (!this.isSupportedChain(params.chainId)) {
      throw new Error('Unsupported chain');
    }
    if (!this.isSupportedToken(params.token)) {
      throw new Error('Unsupported token');
    }
    this.ensureInitialized();
  }

  /**
   * Helper method for validation that returns result objects instead of throwing
   */
  private validateForResultReturn(params: {
    chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
    token: string;
  }): { success: boolean; error?: string } {
    if (!this.isSupportedChain(params.chainId)) {
      return { success: false, error: 'Unsupported chain' };
    }
    if (!this.isSupportedToken(params.token)) {
      return { success: false, error: 'Unsupported token' };
    }
    if (!this.initialized) {
      return { success: false, error: 'CA SDK not initialized. Call initialize() first.' };
    }
    return { success: true };
  }

  /**
   * Helper method for operation event emission (started/completed/failed pattern)
   */
  private emitOperationEvents = {
    started: (operation: string, data: Record<string, unknown>) => {
      this.caEvents.emit(`${operation}_STARTED`, data);
    },
    completed: (operation: string, data: Record<string, unknown>) => {
      this.caEvents.emit(`${operation}_COMPLETED`, data);
    },
    failed: (operation: string, error: unknown, context: string, stage?: string) => {
      const eventData: Record<string, unknown> = {
        message: extractErrorMessage(error, context),
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      };
      if (stage) eventData.stage = stage;
      this.caEvents.emit(`${operation}_FAILED`, eventData);
    },
  };

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
      throw new Error(
        `Failed to initialize CA SDK: ${extractErrorMessage(error, 'initialization')}`,
      );
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
      throw new Error(
        `Failed to fetch unified balances: ${extractErrorMessage(error, 'unified balances fetch')}`,
      );
    }
  }

  /**
   * Get unified balance for a specific token symbol.
   */
  public async getUnifiedBalance(symbol: string): Promise<UserAsset | undefined> {
    try {
      return await this.ca.getUnifiedBalance(symbol);
    } catch (error) {
      throw new Error(
        `Failed to fetch unified balance for ${symbol}: ${extractErrorMessage(error, 'balance fetch')}`,
      );
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
      throw new Error(
        `Failed to check allowance: ${extractErrorMessage(error, 'allowance check')}`,
      );
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
      throw new Error(`Failed to set allowance: ${extractErrorMessage(error, 'allowance set')}`);
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
      throw new Error(
        `Failed to revoke allowance: ${extractErrorMessage(error, 'allowance revoke')}`,
      );
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
    const validation = this.validateForResultReturn(params);
    if (!validation.success) {
      return { success: false, error: validation.error! };
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
    this.validateBridgeTransferParams(params);

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
      throw new Error(
        `Bridge simulation failed: ${extractErrorMessage(error, 'bridge simulation')}`,
      );
    }
  }

  /**
   * Transfer tokens to a recipient using the new API structure.
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
    const validation = this.validateForResultReturn(params);
    if (!validation.success) {
      return { success: false, error: validation.error! };
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
    this.validateBridgeTransferParams(params);

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
      throw new Error(
        `Transfer simulation failed: ${extractErrorMessage(error, 'transfer simulation')}`,
      );
    }
  }

  /**
   * Get user's intents with pagination.
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    this.ensureInitialized();

    try {
      const intents = await this.ca.getMyIntents(page);
      return intents;
    } catch (error) {
      throw new Error(`Failed to fetch intents: ${extractErrorMessage(error, 'intent fetch')}`);
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
      throw new Error(
        `Failed to deinitialize CA SDK: ${extractErrorMessage(error, 'deinitialize')}`,
      );
    }
  }

  /**
   * Make a generic EIP-1193 request using the enhanced provider.
   */
  public async request(args: RequestArguments): Promise<unknown> {
    this.ensureInitialized();
    if (!this.evmProvider) throw new Error('Enhanced provider not available');

    try {
      // Use the enhanced provider instead of direct ca.request
      return await this.evmProvider.request(args);
    } catch (error) {
      throw new Error(`EIP-1193 request failed: ${extractErrorMessage(error, 'EIP-1193 request')}`);
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
   * Ensure wallet is connected to the correct chain
   */
  private async ensureCorrectChain(targetChainId: number): Promise<void> {
    if (!this.evmProvider) {
      throw new Error('Provider not available');
    }

    try {
      // Get current chain ID
      const currentChainIdHex = (await this.evmProvider.request({
        method: 'eth_chainId',
      })) as string;
      const currentChainId = parseInt(currentChainIdHex, 16);

      if (currentChainId !== targetChainId) {
        // Request chain switch
        await this.evmProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${targetChainId.toString(16)}` }],
        });
      }
    } catch (error) {
      throw new Error(
        `Failed to switch to chain ${targetChainId}: ${extractErrorMessage(error, 'chain switch')}`,
      );
    }
  }

  /**
   * Prepare and validate execution parameters
   */
  private async prepareExecution(params: ExecuteParams): Promise<{
    provider: EthereumProvider;
    fromAddress: string;
    encodedData: `0x${string}`;
  }> {
    // Emit start event
    this.emitOperationEvents.started('EXECUTE', {
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

    return {
      provider,
      fromAddress,
      encodedData: encoding.data!,
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
    options: {
      enableTransactionPolling?: boolean;
      transactionTimeout?: number;
    },
  ): Promise<`0x${string}`> {
    // Build basic transaction parameters - let wallet/provider handle gas estimation
    const txParams = {
      from: fromAddress,
      to: contractAddress,
      data: encodedData,
      value,
    };

    // Send transaction - wallet will estimate gas automatically
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
      // 1. Ensure wallet is on correct chain
      await this.ensureCorrectChain(toChainId);

      // 3. Prepare and validate execution parameters
      const { provider, fromAddress, encodedData } = await this.prepareExecution(params);

      // 4. Send transaction
      const transactionHash = await this.sendTransaction(
        provider,
        fromAddress,
        params.contractAddress,
        encodedData,
        params.value || '0x0',
        { enableTransactionPolling, transactionTimeout },
      );

      // 5. Handle confirmation if requested
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

      // 6. Build and return result
      const result = this.buildExecuteResult(transactionHash, toChainId, receiptInfo);

      this.emitOperationEvents.completed('EXECUTE', {
        ...result,
        success: true,
      });
      return result;
    } catch (error) {
      this.emitOperationEvents.failed('EXECUTE', error, 'execute');
      throw new Error(`Execute failed: ${extractErrorMessage(error, 'execute')}`);
    }
  }

  /**
   * Check if approval is needed for a token interaction
   * @param tokenApproval Token approval parameters
   * @param spenderAddress The contract address that needs to spend tokens
   * @param chainId The chain ID where the approval is needed
   * @returns Promise resolving to approval information
   */
  private async checkApprovalNeeded(
    tokenApproval: { token: SUPPORTED_TOKENS; amount: string },
    spenderAddress: string,
    chainId: number,
  ): Promise<ApprovalInfo> {
    try {
      if (!this.evmProvider) {
        console.warn('No EVM provider available for allowance check');
        // Assume approval is needed if we can't check
        return {
          needsApproval: true,
          currentAllowance: 0n,
          requiredAmount: 0n,
          spenderAddress,
          token: tokenApproval.token,
          chainId,
        };
      }

      // Get user account
      const accounts = (await this.evmProvider.request({ method: 'eth_accounts' })) as string[];
      if (!accounts || accounts.length === 0) {
        console.warn('No wallet account connected for allowance check');
        // Assume approval is needed if we can't check
        return {
          needsApproval: true,
          currentAllowance: 0n,
          requiredAmount: 0n,
          spenderAddress,
          token: tokenApproval.token,
          chainId,
        };
      }

      const userAddress = accounts[0];

      // Get token contract address for this chain from constants
      const tokenAddress = getTokenContractAddress(tokenApproval.token, chainId);
      if (!tokenAddress) {
        console.warn(
          `Token contract address not found for ${tokenApproval.token} on chain ${chainId}`,
        );
        // Assume approval is needed if we can't check
        return {
          needsApproval: true,
          currentAllowance: 0n,
          requiredAmount: 0n,
          spenderAddress,
          token: tokenApproval.token,
          chainId,
        };
      }

      // Convert amount to proper token units (wei)
      const tokenMetadata = TOKEN_METADATA[tokenApproval.token.toUpperCase()];
      const decimals = tokenMetadata?.decimals || ADAPTER_CONSTANTS.DEFAULT_DECIMALS;

      let requiredAmount: bigint;
      try {
        // Handle both decimal strings and integer strings
        if (tokenApproval.amount.includes('.')) {
          requiredAmount = parseUnits(tokenApproval.amount, decimals);
        } else {
          requiredAmount = BigInt(tokenApproval.amount);
        }
      } catch (error) {
        console.warn(`Failed to parse amount ${tokenApproval.amount}:`, error);
        // Assume approval is needed if we can't parse the amount
        return {
          needsApproval: true,
          currentAllowance: 0n,
          requiredAmount: 0n,
          spenderAddress,
          token: tokenApproval.token,
          chainId,
        };
      }

      const allowanceFunctionSelector = FUNCTION_SELECTORS.ALLOWANCE;
      const paddedOwner = userAddress.slice(2).padStart(64, '0');
      const paddedSpender = spenderAddress.slice(2).padStart(64, '0');
      const callData = allowanceFunctionSelector + paddedOwner + paddedSpender;

      // Call the allowance function
      const allowanceResult = (await this.evmProvider.request({
        method: 'eth_call',
        params: [
          {
            to: tokenAddress,
            data: callData,
          },
          'latest',
        ],
      })) as string;

      const currentAllowance = BigInt(allowanceResult || '0x0');

      // Add small buffer to avoid unnecessary re-approvals
      const bufferAmount =
        requiredAmount + requiredAmount / ADAPTER_CONSTANTS.APPROVAL_BUFFER_PERCENTAGE;
      const needsApproval = currentAllowance < bufferAmount;

      return {
        needsApproval,
        currentAllowance,
        requiredAmount,
        tokenAddress,
        spenderAddress,
        token: tokenApproval.token,
        chainId,
      };
    } catch (error) {
      console.warn(`Failed to check allowance for ${tokenApproval.token}:`, error);
      // Assume approval is needed if we can't check
      return {
        needsApproval: true,
        currentAllowance: 0n,
        requiredAmount: 0n,
        spenderAddress,
        token: tokenApproval.token,
        chainId,
      };
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
      gasUsed: '0',
      gasPrice: '0',
      totalFee: '0',
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

      // Get provider and account (basic checks)
      if (!this.evmProvider) {
        return { ...baseError, error: `No provider available for chain ${toChainId}` };
      }

      const accounts = (await this.evmProvider.request({ method: 'eth_accounts' })) as string[];
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

      // Try to use backend simulation for gas estimation
      const simulationClient = getSimulationClient();
      if (!simulationClient) {
        return { ...baseError, error: 'Simulation client not configured' };
      }

      try {
        const simulationResult = await simulationClient.simulate({
          chainId: toChainId.toString(),
          from: fromAddress,
          to: contractAddress,
          data: encoding.data!,
          value,
        });

        if (simulationResult.success) {
          const gasUsedDecimal = simulationResult.gasUsed.startsWith('0x')
            ? hexToNumber(simulationResult.gasUsed as `0x${string}`).toString()
            : simulationResult.gasUsed;
          const gasPriceDecimal = simulationResult.gasPrice.startsWith('0x')
            ? hexToNumber(simulationResult.gasPrice as `0x${string}`).toString()
            : simulationResult.gasPrice;

          const gasCost = BigInt(gasUsedDecimal) * BigInt(gasPriceDecimal);

          const formattedGas = {
            gasUsed: gasUsedDecimal,
            gasPrice: gasPriceDecimal,
            totalFee: gasCost.toString(),
          };

          return {
            gasUsed: formattedGas.gasUsed,
            gasPrice: formattedGas.gasPrice,
            maxFeePerGas: simulationResult.maxFeePerGas?.startsWith('0x')
              ? hexToNumber(simulationResult.maxFeePerGas as `0x${string}`).toString()
              : simulationResult.maxFeePerGas,
            maxPriorityFeePerGas: simulationResult.maxPriorityFeePerGas?.startsWith('0x')
              ? hexToNumber(simulationResult.maxPriorityFeePerGas as `0x${string}`).toString()
              : simulationResult.maxPriorityFeePerGas,
            totalFee: formattedGas.totalFee,
            success: true,
          };
        } else {
          console.warn('Simulation failed:', simulationResult.errorMessage);
        }
      } catch (simulationError) {
        console.warn('Simulation error:', simulationError);
        return {
          ...baseError,
          error: `Simulation failed: ${extractErrorMessage(simulationError, 'simulation')}`,
        };
      }

      return { ...baseError, error: 'Gas estimation failed' };
    } catch (error) {
      return {
        ...baseError,
        error: `Simulation failed: ${extractErrorMessage(error, 'simulation')}`,
      };
    }
  }

  /**
   * Handle execute phase of bridge and execute operation
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

        const approvalResult = await this.ensureContractApproval(
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
      const executeResult = await this.execute({
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
      this.emitOperationEvents.started('OPERATION', { toChainId, hasExecute: !!execute });
      this.emitOperationEvents.started('BRIDGE', { toChainId, token, amount });

      const bridgeResult = await this.bridge({ token, amount, chainId: toChainId });

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
        success: true,
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
      const decimals = tokenMetadata?.decimals || ADAPTER_CONSTANTS.DEFAULT_DECIMALS;

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

  /**
   * Simulate bridge and execute operation that uses bridge output for realistic execute simulation
   * @param params Bridge and execute parameters for simulation
   * @returns Promise resolving to enhanced simulation result with realistic cost estimates
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    try {
      const { execute } = params;
      const steps: SimulationStep[] = [];

      // Normalize the input amount to ensure consistent processing
      const normalizedAmount = this.normalizeAmountToWei(params.amount, params.token);

      const bridgeSimulation = await this.simulateBridge({
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

          executeSimulation = await this.simulateExecute({
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
   * Automatically handle token approval for a target contract
   * This is separate from the CA SDK's setAllowance which approves for CA contracts
   * @param tokenApproval Token approval parameters
   * @param spenderAddress The contract address that needs to spend tokens
   * @param chainId The chain ID where the approval is needed
   * @param waitForConfirmation Whether to wait for the approval transaction to be confirmed
   * @returns Promise resolving to transaction hash if approval was needed, undefined if not needed
   */
  public async ensureContractApproval(
    tokenApproval: { token: SUPPORTED_TOKENS; amount: string },
    spenderAddress: string,
    chainId: number,
    waitForConfirmation: boolean = false,
  ): Promise<{
    transactionHash?: string;
    wasNeeded: boolean;
    error?: string;
    confirmed?: boolean;
  }> {
    try {
      // Check if approval is needed
      const approvalInfo = await this.checkApprovalNeeded(tokenApproval, spenderAddress, chainId);

      if (!approvalInfo.needsApproval) {
        return { wasNeeded: false };
      }

      if (!this.evmProvider) {
        return { wasNeeded: true, error: 'No provider available for approval transaction' };
      }

      // Get user account
      const accounts = (await this.evmProvider.request({ method: 'eth_accounts' })) as string[];
      if (!accounts || accounts.length === 0) {
        return { wasNeeded: true, error: 'No wallet account connected' };
      }
      const fromAddress = accounts[0];

      // Ensure we're on the correct chain
      await this.ensureCorrectChain(chainId);

      // Build approval transaction
      // ERC20 approve function signature: approve(address spender, uint256 amount)
      const approveFunctionSelector = FUNCTION_SELECTORS.APPROVE;
      const paddedSpender = spenderAddress.slice(2).padStart(64, '0');
      const paddedAmount = approvalInfo.requiredAmount.toString(16).padStart(64, '0');
      const approvalData = approveFunctionSelector + paddedSpender + paddedAmount;

      // Send approval transaction
      const txParams = {
        from: fromAddress,
        to: approvalInfo.tokenAddress || '',
        data: approvalData,
        value: '0x0',
      };

      const response = await this.evmProvider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });

      // Get transaction hash
      const hashResult = await getTransactionHashWithFallback(this.evmProvider, response, {
        enablePolling: true,
        timeout: 30000,
        fromAddress,
      });

      if (!hashResult.success || !hashResult.hash) {
        return {
          wasNeeded: true,
          error: hashResult.error ?? 'Approval transaction failed',
        };
      }

      // Optionally wait for confirmation
      if (waitForConfirmation) {
        try {
          const receiptResult = await waitForTransactionReceipt(
            this.evmProvider,
            hashResult.hash,
            {
              timeout: 60000, // 1 minute timeout for approval confirmation
              requiredConfirmations: 1,
            },
            chainId,
          );

          if (receiptResult.success) {
            return {
              wasNeeded: true,
              transactionHash: hashResult.hash,
              confirmed: true,
            };
          } else {
            // Transaction sent but confirmation failed - still return success
            console.warn(`Approval confirmation failed: ${receiptResult.error}`);
            return {
              wasNeeded: true,
              transactionHash: hashResult.hash,
              confirmed: false,
            };
          }
        } catch (confirmationError) {
          console.warn(`Approval confirmation error: ${confirmationError}`);
          return {
            wasNeeded: true,
            transactionHash: hashResult.hash,
            confirmed: false,
          };
        }
      }

      return { wasNeeded: true, transactionHash: hashResult.hash };
    } catch (error) {
      return {
        wasNeeded: true,
        error: `Approval failed: ${extractErrorMessage(error, 'approval')}`,
      };
    }
  }
}
