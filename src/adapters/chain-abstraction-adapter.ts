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
} from '../utils';

import { parseUnits, formatUnits, formatGwei, hexToNumber } from 'viem';
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
  TransactionReceipt,
  RequestForFunds,
  ApprovalInfo,
  ApprovalSimulation,
  BridgeAndExecuteSimulationResult,
  SimulationStep,
} from '../types';
import { getSimulationClient } from '../integrations/tenderly';

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
   * Helper function to format hex gas values consistently
   * @private
   */
  private formatGasValues(gasUsed: string, gasPrice: string) {
    // Convert hex values to decimal if needed
    const gasUsedDecimal = gasUsed.startsWith('0x')
      ? hexToNumber(gasUsed as `0x${string}`).toString()
      : gasUsed;
    const gasPriceDecimal = gasPrice.startsWith('0x')
      ? hexToNumber(gasPrice as `0x${string}`).toString()
      : gasPrice;

    const gasCost = BigInt(gasUsedDecimal) * BigInt(gasPriceDecimal);
    const gasCostEth = formatUnits(gasCost, 18);
    const gasCostGwei = formatGwei(gasCost);

    return {
      gasUsed: gasUsedDecimal,
      gasPrice: gasPriceDecimal,
      estimatedCost: {
        wei: gasCost.toString(),
        eth: parseFloat(gasCostEth).toFixed(6),
        gwei: parseFloat(gasCostGwei).toFixed(2),
      },
    };
  }

  /**
   * Helper function to format hex EIP-1559 gas values consistently
   * @private
   */
  private formatEIP1559GasValue(hexValue: string | undefined): string | undefined {
    if (!hexValue) return undefined;
    return hexValue.startsWith('0x') ? hexToNumber(hexValue as `0x${string}`).toString() : hexValue;
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
      throw new Error(`Failed to switch to chain ${targetChainId}: ${error}`);
    }
  }

  /**
   * Check and handle token approval if needed
   */
  private async ensureTokenApproval(
    token: SUPPORTED_TOKENS,
    amount: string,
    chainId: number,
  ): Promise<void> {
    try {
      // Check current allowance
      const allowances = await this.getAllowance(chainId, [token]);
      const allowance = allowances.find((a) => a.token.toUpperCase() === token.toUpperCase());

      const currentAllowance = allowance?.allowance || 0n;
      const requiredAmount = BigInt(amount);

      // Allow small buffer (1% tolerance) to avoid unnecessary re-approvals
      const bufferAmount = requiredAmount + requiredAmount / 100n;

      if (currentAllowance < bufferAmount) {
        // Need to set allowance for the specific spender - use exact amount, not max
        await this.setAllowance(chainId, [token], requiredAmount);
      }
    } catch (error) {
      throw new Error(`Failed to ensure token approval for ${token}: ${error}`);
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
      tokenApproval,
    } = params;

    try {
      // 1. Ensure wallet is on correct chain
      await this.ensureCorrectChain(toChainId);

      // 2. Ensure token approval if needed
      await this.ensureTokenApproval(tokenApproval.token, tokenApproval.amount, toChainId);

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

      // Hard-coded token addresses for popular chains (this is where you'd expand with more tokens/chains)
      const knownTokenAddresses: Record<string, Record<number, string>> = {
        USDC: {
          1: '0xA0b86a33E6441B4c8B0e91BE5C55F49F4D55c76F', // Ethereum
          8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
          137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon
          42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum
          10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // Optimism
        },
        USDT: {
          1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum
          137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
          42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum
        },
      };

      // Get token contract address for this chain
      const tokenAddress = knownTokenAddresses[tokenApproval.token]?.[chainId];
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
      const decimals = tokenMetadata?.decimals || 18;

      let requiredAmount: bigint;
      try {
        // Handle both decimal strings and integer strings
        if (tokenApproval.amount.includes('.')) {
          // Use parseUnits for decimal amounts like "0.01"
          requiredAmount = parseUnits(tokenApproval.amount, decimals);
        } else {
          // Direct BigInt conversion for integer amounts like "10000"
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

      // ERC20 allowance function signature: allowance(address owner, address spender)
      const allowanceFunctionSelector = '0xdd62ed3e'; // allowance(address,address)
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

      // Add small buffer (1% tolerance) to avoid unnecessary re-approvals
      const bufferAmount = requiredAmount + requiredAmount / 100n;
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
   * Simulate an approval transaction
   * @param approvalInfo Approval information from checkApprovalNeeded
   * @returns Promise resolving to approval simulation result
   */
  private async simulateApproval(approvalInfo: ApprovalInfo): Promise<ApprovalSimulation> {
    const baseError = {
      gasUsed: '0',
      gasPrice: '0',
      estimatedCost: {
        wei: '0',
        eth: '0',
        gwei: '0',
      },
      success: false,
    };

    try {
      if (!this.evmProvider) {
        return { ...baseError, error: 'No provider available' };
      }

      // Get user account
      const accounts = (await this.evmProvider.request({ method: 'eth_accounts' })) as string[];
      if (!accounts || accounts.length === 0) {
        return { ...baseError, error: 'No wallet account connected' };
      }
      // Note: fromAddress not needed for standard approval gas estimation

      // Get token contract address from token metadata
      const tokenMetadata = TOKEN_METADATA[approvalInfo.token.toUpperCase()];
      if (!tokenMetadata) {
        return { ...baseError, error: `Unsupported token: ${approvalInfo.token}` };
      }

      // We need to get the actual token contract address for the specific chain
      // For now, we'll simulate with a standard approval gas estimate
      // In a real implementation, you'd have chain-specific token addresses

      // Standard ERC20 approve function gas estimate (typically ~46,000 gas)
      const approvalGasEstimate = '46000';

      // Get current gas price
      const gasPrice = (await this.evmProvider.request({
        method: 'eth_gasPrice',
        params: [],
      })) as string;

      // Format gas values consistently
      const formattedGas = this.formatGasValues(approvalGasEstimate, gasPrice);

      return {
        ...formattedGas,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown approval simulation error';
      return { ...baseError, error: `Approval simulation failed: ${errorMessage}` };
    }
  }

  /**
   * Simulate execute with proper approval handling
   * @param params Execute parameters
   * @param assumeApprovalExists Whether to assume approval already exists (for post-approval simulation)
   * @returns Promise resolving to execution simulation
   */
  private async simulateExecuteWithApprovalHandling(
    params: ExecuteParams,
    assumeApprovalExists: boolean = false,
  ): Promise<ExecuteSimulation> {
    // If we're assuming approval exists (like after simulating approval), proceed directly with skipped approval check
    if (assumeApprovalExists) {
      return this.simulateExecute(params, true); // Pass skipApprovalCheck=true
    }

    // If we're not assuming approval exists, check if we need approval first
    if (params.tokenApproval) {
      const approvalInfo = await this.checkApprovalNeeded(
        params.tokenApproval,
        params.contractAddress,
        params.toChainId,
      );

      if (approvalInfo.needsApproval) {
        return {
          gasUsed: '0',
          gasPrice: '0',
          estimatedCost: {
            wei: '0',
            eth: '0',
            gwei: '0',
          },
          success: false,
          error: `Token approval required: ${params.tokenApproval.token} allowance is ${approvalInfo.currentAllowance.toString()}, but ${approvalInfo.requiredAmount.toString()} is required for contract ${params.contractAddress}`,
        };
      }
    }

    // Proceed with normal simulation (approval exists or not needed)
    return this.simulateExecute(params, false); // Pass skipApprovalCheck=false for normal flow
  }

  /**
   * Simulate a execute to estimate gas costs and validate parameters
   * @param params Execute parameters for simulation
   * @param skipApprovalCheck Whether to skip approval checking (used when we know approval exists)
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(
    params: ExecuteParams,
    skipApprovalCheck: boolean = false,
  ): Promise<ExecuteSimulation> {
    const {
      toChainId,
      contractAddress,
      contractAbi,
      functionName,
      functionParams,
      value = '0x0',
      tokenApproval,
    } = params;

    const baseError = {
      gasUsed: '0',
      gasPrice: '0',
      estimatedCost: {
        wei: '0',
        eth: '0',
        gwei: '0',
      },
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

      // Check if approval is needed first (only if not skipping)
      if (!skipApprovalCheck && tokenApproval) {
        const approvalInfo = await this.checkApprovalNeeded(
          tokenApproval,
          contractAddress,
          toChainId,
        );

        if (approvalInfo.needsApproval) {
          return {
            ...baseError,
            error: `Token approval required: ${tokenApproval.token} allowance is ${formatTokenAmount(approvalInfo.currentAllowance.toString(), tokenApproval.token)}, but ${formatTokenAmount(approvalInfo.requiredAmount.toString(), tokenApproval.token)} is required for contract ${contractAddress}. Call setAllowance() or use bridgeAndExecute() which handles approvals automatically.`,
          };
        }
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
          // Format gas values consistently (handle both hex and decimal inputs)
          const formattedGas = this.formatGasValues(
            simulationResult.gasUsed,
            simulationResult.gasPrice,
          );

          return {
            gasUsed: formattedGas.gasUsed,
            gasPrice: formattedGas.gasPrice,
            maxFeePerGas: this.formatEIP1559GasValue(simulationResult.maxFeePerGas),
            maxPriorityFeePerGas: this.formatEIP1559GasValue(simulationResult.maxPriorityFeePerGas),
            estimatedCost: formattedGas.estimatedCost,
            success: true,
          };
        } else {
          console.warn('Backend simulation failed:', simulationResult.errorMessage);
        }
      } catch (simulationError) {
        console.warn('Backend simulation error:', simulationError);
        const errorMessage =
          simulationError instanceof Error ? simulationError.message : 'Unknown error';
        const lowerErrorMsg = errorMessage.toLowerCase();

        if (lowerErrorMsg.includes('allowance') || lowerErrorMsg.includes('exceeds allowance')) {
          return {
            ...baseError,
            error: `Token approval required: The contract ${contractAddress} needs approval to spend ${tokenApproval?.token || 'tokens'}. Current allowance may be insufficient.`,
          };
        } else if (lowerErrorMsg.includes('insufficient') || lowerErrorMsg.includes('balance')) {
          return {
            ...baseError,
            error: `Insufficient balance: You may not have enough ${tokenApproval?.token || 'tokens'} to complete this transaction.`,
          };
        } else if (lowerErrorMsg.includes('revert')) {
          return {
            ...baseError,
            error: `Transaction would revert: ${errorMessage}. This may indicate contract logic issues or invalid parameters.`,
          };
        } else {
          return {
            ...baseError,
            error: `Gas estimation failed: ${errorMessage}`,
          };
        }
      }

      return { ...baseError, error: 'Gas estimation failed' };
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
        this.caEvents.emit(NEXUS_EVENTS.APPROVAL_STARTED, {
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
          this.caEvents.emit(NEXUS_EVENTS.APPROVAL_FAILED, {
            message: approvalResult.error,
            code: 'APPROVAL_ERROR',
          });
          throw new Error(`Approval failed: ${approvalResult.error}`);
        }

        if (approvalResult.wasNeeded && approvalResult.transactionHash) {
          approvalTransactionHash = approvalResult.transactionHash;
          this.caEvents.emit(NEXUS_EVENTS.APPROVAL_COMPLETED, {
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
      const decimals = tokenMetadata?.decimals || 18; // Default to 18 decimals if unknown

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
      const warnings: string[] = [];
      const steps: SimulationStep[] = [];

      // Normalize the input amount to ensure consistent processing
      const normalizedAmount = this.normalizeAmountToWei(params.amount, params.token);

      // Step 1: Simulate the bridge to get output amount
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
      let bridgeFeeInEth = '0';
      let bridgeWarnings: string[] = [];

      if (bridgeSimulation?.intent) {
        const intent = bridgeSimulation.intent;

        // Extract destination amount (received amount after bridging)
        if (intent.destination?.amount && intent.destination.amount !== '0') {
          bridgeReceiveAmount = intent.destination.amount;
        } else {
          bridgeWarnings.push(
            'Bridge simulation shows 0 destination amount - this may indicate an issue with the bridge route or insufficient liquidity',
          );
        }

        // Format bridge fees properly
        if (intent.fees?.total) {
          bridgeFeeInEth = `${intent.fees.total}`;
        }

        // Check for source/destination amount discrepancy
        if (intent.sourcesTotal && bridgeReceiveAmount !== '0') {
          const sourceAmount = parseFloat(intent.sourcesTotal);
          const destAmount = parseFloat(bridgeReceiveAmount);
          const slippage = ((sourceAmount - destAmount) / sourceAmount) * 100;

          // Only warn for very high slippage (> 10%)
          if (slippage > 10) {
            bridgeWarnings.push(
              `High slippage detected: ${slippage.toFixed(2)}% (sending ${intent.sourcesTotal} ${params.token}, receiving ${bridgeReceiveAmount} ${params.token})`,
            );
          }
        }
      }

      warnings.push(...bridgeWarnings);

      let executeSimulation: ExecuteSimulation | undefined;
      let approvalSimulation: ApprovalSimulation | undefined;
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

          // Step 2: Simulate automatic approval handling with pending transaction awareness
          let approvalInfo: (ApprovalInfo & { hasPendingApproval?: boolean }) | undefined;

          // Always check approval if tokenApproval is provided in the execute params
          if (execute.tokenApproval) {
            approvalInfo = await this.checkApprovalWithPendingTx(
              {
                token: params.token,
                amount: receivedAmountForContract,
              },
              execute.contractAddress,
              params.toChainId,
              params.recentApprovalTxHash,
            );

            // Simulate approval if needed (unless there's a pending approval)
            if (approvalInfo.needsApproval && !approvalInfo.hasPendingApproval) {
              approvalRequired = true;
              approvalSimulation = await this.simulateApproval(approvalInfo);

              steps.push({
                type: 'approval',
                required: true,
                simulation: approvalSimulation,
                description: `Automatically approve ${params.token} for contract ${execute.contractAddress}`,
              });

              if (!approvalSimulation.success) {
                warnings.push(
                  `Automatic approval simulation failed: ${approvalSimulation.error}. This may affect the overall operation.`,
                );
              }
            } else if (approvalInfo.hasPendingApproval) {
              // Approval transaction is pending
              steps.push({
                type: 'approval',
                required: false,
                simulation: {
                  gasUsed: '0',
                  gasPrice: '0',
                  estimatedCost: {
                    wei: '0',
                    eth: '0',
                    gwei: '0',
                  },
                  success: true,
                },
                description: `${params.token} approval transaction pending confirmation for contract ${execute.contractAddress}`,
              });
            } else {
              // Approval exists, add informational step but mark as not required
              steps.push({
                type: 'approval',
                required: false,
                simulation: {
                  gasUsed: '0',
                  gasPrice: '0',
                  estimatedCost: {
                    wei: '0',
                    eth: '0',
                    gwei: '0',
                  },
                  success: true,
                },
                description: `${params.token} approval already exists for contract ${execute.contractAddress}`,
              });
            }
          }

          // Step 3: Simulate execute assuming approval exists
          executeSimulation = await this.simulateExecuteWithApprovalHandling(
            {
              ...modifiedExecuteParams,
              toChainId: params.toChainId,
              tokenApproval: {
                token: params.token,
                amount: receivedAmountForContract,
              },
            },
            approvalRequired, // Assume approval exists if we just simulated it
          );

          steps.push({
            type: 'execute',
            required: true,
            simulation: executeSimulation,
            description: `Execute ${execute.functionName} on contract ${execute.contractAddress}`,
          });

          // Enhanced execute analysis
          if (!executeSimulation.success) {
            const errorMsg = executeSimulation.error?.toLowerCase() || '';

            if (errorMsg.includes('allowance') || errorMsg.includes('exceeds allowance')) {
              if (!approvalRequired) {
                warnings.push(`Execute failed: Token approval required for ${params.token}`);
              }
            } else if (
              errorMsg.includes('insufficient') ||
              errorMsg.includes('balance') ||
              errorMsg.includes('revert')
            ) {
              warnings.push('Execute failed: Possible insufficient balance or contract issue');
            }
          }
        } catch (simulationError) {
          warnings.push(`Execute simulation error: ${simulationError}`);
          executeSimulation = {
            gasUsed: '0',
            gasPrice: '0',
            estimatedCost: {
              wei: '0',
              eth: '0',
              gwei: '0',
            },
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
        | { eth: string; breakdown: { bridge: string; approval: string; execute: string } }
        | undefined;

      if (
        bridgeFeeInEth !== '0' ||
        executeSimulation?.estimatedCost ||
        approvalSimulation?.estimatedCost
      ) {
        try {
          const bridgeFeeEth = bridgeFeeInEth ? parseFloat(bridgeFeeInEth.replace(' ETH', '')) : 0;
          const approvalFeeEth = approvalSimulation?.success
            ? parseFloat(approvalSimulation.estimatedCost.eth)
            : 0;
          const executeFeeEth = executeSimulation?.success
            ? parseFloat(executeSimulation.estimatedCost.eth)
            : 0;
          const totalEth = bridgeFeeEth + approvalFeeEth + executeFeeEth;

          totalEstimatedCost = {
            eth: totalEth.toFixed(6),
            breakdown: {
              bridge: bridgeFeeEth.toFixed(6),
              approval: approvalFeeEth.toFixed(6),
              execute: executeFeeEth.toFixed(6),
            },
          };
        } catch (error) {
          warnings.push('Could not calculate total cost - cost breakdown may be incomplete');
        }
      }

      return {
        steps,
        bridgeSimulation,
        approvalSimulation,
        executeSimulation,
        totalEstimatedCost,
        success: true,
        warnings: warnings.length > 0 ? warnings : undefined,
        // Additional helpful information
        metadata: {
          bridgeReceiveAmount:
            bridgeReceiveAmount !== '0' ? `${bridgeReceiveAmount} ${params.token}` : 'Unknown',
          bridgeFee: bridgeFeeInEth || 'Unknown',
          inputAmount: `${params.amount} ${params.token}`,
          targetChain: params.toChainId,
          approvalRequired,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown simulation error';
      return {
        steps: [],
        bridgeSimulation: null,
        executeSimulation: undefined,
        success: false,
        error: `Simulation failed: ${errorMessage}`,
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
      const approveFunctionSelector = '0x095ea7b3'; // approve(address,uint256)
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown approval error';
      return { wasNeeded: true, error: `Approval failed: ${errorMessage}` };
    }
  }

  /**
   * Wait for an approval transaction to be confirmed before proceeding
   * @param transactionHash The approval transaction hash to wait for
   * @param chainId The chain ID where the transaction was sent
   * @param timeoutMs Timeout in milliseconds (default: 60 seconds)
   * @returns Promise resolving to confirmation status
   */
  public async waitForApprovalConfirmation(
    transactionHash: string,
    chainId: number,
    timeoutMs: number = 60000,
  ): Promise<{ confirmed: boolean; error?: string }> {
    if (!this.evmProvider) {
      return { confirmed: false, error: 'No provider available' };
    }

    try {
      const receiptResult = await waitForTransactionReceipt(
        this.evmProvider,
        transactionHash as `0x${string}`,
        {
          timeout: timeoutMs,
          requiredConfirmations: 1,
        },
        chainId,
      );

      if (receiptResult.success) {
        return { confirmed: true };
      } else {
        return { confirmed: false, error: receiptResult.error };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown confirmation error';
      return { confirmed: false, error: errorMessage };
    }
  }

  /**
   * Check the status of a transaction
   * @param transactionHash The transaction hash to check
   * @returns Promise resolving to transaction status
   */
  public async getTransactionStatus(
    transactionHash: string,
  ): Promise<{ confirmed: boolean; pending: boolean; error?: string }> {
    if (!this.evmProvider) {
      return { confirmed: false, pending: false, error: 'No provider available' };
    }

    try {
      const receipt = await this.evmProvider.request({
        method: 'eth_getTransactionReceipt',
        params: [transactionHash],
      });

      if (receipt) {
        return { confirmed: true, pending: false };
      }

      // Check if transaction exists in mempool
      const tx = await this.evmProvider.request({
        method: 'eth_getTransactionByHash',
        params: [transactionHash],
      });

      if (tx) {
        return { confirmed: false, pending: true };
      }

      return { confirmed: false, pending: false, error: 'Transaction not found' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { confirmed: false, pending: false, error: errorMessage };
    }
  }

  /**
   * Enhanced approval checking that considers recent transactions
   * @param tokenApproval Token approval parameters
   * @param spenderAddress The contract address that needs to spend tokens
   * @param chainId The chain ID where the approval is needed
   * @param recentApprovalTxHash Optional recent approval transaction hash to consider
   * @returns Promise resolving to approval information
   */
  public async checkApprovalWithPendingTx(
    tokenApproval: { token: SUPPORTED_TOKENS; amount: string },
    spenderAddress: string,
    chainId: number,
    recentApprovalTxHash?: string,
  ): Promise<ApprovalInfo & { hasPendingApproval?: boolean }> {
    // First do the standard approval check
    const approvalInfo = await this.checkApprovalNeeded(tokenApproval, spenderAddress, chainId);

    // If approval is still needed but we have a recent transaction hash, check if it's pending
    if (approvalInfo.needsApproval && recentApprovalTxHash) {
      const txStatus = await this.getTransactionStatus(recentApprovalTxHash);

      if (txStatus.pending) {
        return {
          ...approvalInfo,
          hasPendingApproval: true,
        };
      } else if (txStatus.confirmed) {
        // Transaction is confirmed, re-check approval status
        // There might be a small delay before the state is updated
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
        const updatedApprovalInfo = await this.checkApprovalNeeded(
          tokenApproval,
          spenderAddress,
          chainId,
        );
        return updatedApprovalInfo;
      }
    }

    return approvalInfo;
  }
}
