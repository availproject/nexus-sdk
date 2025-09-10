import { CA, Network, SDKConfig } from '@arcana/ca-sdk';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { isSupportedChain, isSupportedToken } from './core/validation';
// Services
import { BridgeService } from './services/bridge-service';
import { TransferService } from './services/transfer-service';
import { ExecuteService } from './services/execute-service';
import { BridgeExecuteService } from './services/bridge-execute-service';
import {
  type EthereumProvider,
  type OnIntentHook,
  type UserAsset,
  type OnAllowanceHook,
  type RequestArguments,
  type BridgeParams,
  type BridgeResult,
  type TransferParams,
  type TransferResult,
  type AllowanceResponse,
  type EventListener,
  type SimulationResult,
  type BridgeAndExecuteParams,
  type BridgeAndExecuteResult,
  type ExecuteParams,
  type ExecuteResult,
  type ExecuteSimulation,
  type RequestForFunds,
  type BridgeAndExecuteSimulationResult,
  type SUPPORTED_CHAINS_IDS,
  type SwapInput,
  type SwapOptionalParams,
  extractErrorMessage,
  logger,
  SwapResult,
  SwapBalances,
} from '@nexus/commons';
import SwapService from './services/swap-service';

/**
 * Provides a unified interface for chain abstraction operations.
 */
export class ChainAbstractionAdapter {
  public readonly ca: CA;
  public evmProvider: EthereumProvider | null = null;
  public readonly caEvents: SafeEventEmitter;
  private initialized = false;

  // Services
  private bridgeService: BridgeService;
  private transferService: TransferService;
  private executeService: ExecuteService;
  private bridgeExecuteService: BridgeExecuteService;
  private swapService: SwapService;

  constructor(config?: SDKConfig) {
    logger.debug('ChainAbstractionAdapter', { config });
    this.ca = new CA(config);
    this.caEvents = this.ca.caEvents;

    // Initialize services
    this.bridgeService = new BridgeService(this);
    this.transferService = new TransferService(this);
    this.executeService = new ExecuteService(this);
    this.bridgeExecuteService = new BridgeExecuteService(this);
    this.swapService = new SwapService(this);
    this.setGasEstimationEnabled(true);
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
    const caEvmProvider = this.ca.getEVMProviderWithCA();
    return caEvmProvider;
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
   * Get swap balances
   */
  public async getSwapBalances(): Promise<SwapBalances> {
    try {
      return await this.ca.getSwapBalances();
    } catch (error) {
      throw new Error(
        `Failed to fetch swap balances: ${extractErrorMessage(error, 'swap balances fetch')}`,
      );
    }
  }

  /**
   * Get allowance information for tokens.
   */
  public async getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]> {
    this.ensureInitialized();
    try {
      return await this.ca.allowance().get({ chainID: chainId, tokens });
    } catch (error) {
      throw new Error(
        `Failed to get allowance: ${extractErrorMessage(error, 'allowance retrieval')}`,
      );
    }
  }

  /**
   * Set allowance for tokens.
   */
  public async setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void> {
    this.ensureInitialized();
    try {
      await this.ca.allowance().set({ chainID: chainId, tokens, amount });
    } catch (error) {
      throw new Error(
        `Failed to set allowance: ${extractErrorMessage(error, 'allowance setting')}`,
      );
    }
  }

  /**
   * Revoke allowance for tokens.
   */
  public async revokeAllowance(chainId: number, tokens: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      await this.ca.allowance().revoke({ chainID: chainId, tokens });
    } catch (error) {
      throw new Error(
        `Failed to revoke allowance: ${extractErrorMessage(error, 'allowance revocation')}`,
      );
    }
  }

  /**
   * Set intent hook callback.
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this.ca.setOnIntentHook(callback);
  }

  /**
   * Set allowance hook callback.
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this.ca.setOnAllowanceHook(callback);
  }

  /**
   * Bridge tokens between chains using the bridge service.
   */
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    return this.bridgeService.bridge(params);
  }

  /**
   * Simulate bridge transaction using the bridge service.
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    return this.bridgeService.simulateBridge(params);
  }

  /**
   * Transfer tokens to a recipient using the transfer service.
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
    return this.transferService.transfer(params);
  }

  /**
   * Simulate transfer transaction using the transfer service.
   */
  public async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    return this.transferService.simulateTransfer(params);
  }

  /**
   * Swap tokens using the swap service.
   */
  public async swap(
    input: SwapInput,
    options?: Omit<SwapOptionalParams, 'emit'>,
  ): Promise<SwapResult> {
    return this.swapService.swap(input, options);
  }

  /**
   * Execute a contract call using the execute service.
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return this.executeService.execute(params);
  }

  /**
   * Simulate contract execution using the execute service.
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    return this.executeService.simulateExecute(params);
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
   * Remove all listeners for all events.
   */
  public removeAllListeners(): void {
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
  public isSupportedChain(chainId: SUPPORTED_CHAINS_IDS): boolean {
    return isSupportedChain(chainId);
  }

  /**
   * Check if a token is supported by the adapter.
   */
  public isSupportedToken(token: string): boolean {
    return isSupportedToken(token);
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
   * Remove all CA event listeners.
   */
  public removeAllCaEventListeners(eventName?: string): void {
    if (eventName) {
      this.ca.caEvents.removeAllListeners(eventName);
    } else {
      this.removeAllListeners();
    }
  }

  /**
   * Bridge and execute operation - uses the BridgeExecuteService
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    return this.bridgeExecuteService.bridgeAndExecute(params);
  }

  /**
   * Simulate bridge and execute operation
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    return this.bridgeExecuteService.simulateBridgeAndExecute(params);
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
   * Enable or disable gas estimation for transactions
   * When enabled, gas estimation will run before each transaction execution
   * This helps identify potential failures early and provides cost estimates
   */
  private setGasEstimationEnabled(enabled: boolean): void {
    this.bridgeExecuteService.setGasEstimationEnabled(enabled);
    this.executeService.setGasEstimationEnabled(enabled);
  }
}
