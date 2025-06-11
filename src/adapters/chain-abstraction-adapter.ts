import { CA, Network, SDKConfig } from '@arcana/ca-sdk';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { SUPPORTED_CHAINS, TOKEN_METADATA, CHAIN_METADATA, NEXUS_EVENTS } from '../constants';
import {
  formatBalance,
  formatTokenAmount,
  getChainMetadata,
  isValidAddress,
  parseUnits,
  formatUnits,
  truncateAddress,
  chainIdToHex,
  hexToChainId,
  getMainnetTokenMetadata,
  getTestnetTokenMetadata,
} from '../utils';
import type {
  EthereumProvider,
  OnIntentHook,
  UserAsset,
  OnAllowanceHook,
  RequestArguments,
  BridgeParams,
  TransferParams,
  AllowanceResponse,
  EventListener,
  TokenMetadata,
  ChainMetadata,
  TokenBalance,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
  SimulationResult,
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
   * Bridge tokens between chains using the new API structure.
   */
  public async bridge(params: BridgeParams): Promise<unknown> {
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

      // Execute the bridge transaction
      const result = await bridgeQuery.exec();
      return result;
    } catch (error) {
      throw new Error(`Bridge transaction failed: ${error}`);
    }
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
  public async transfer(params: TransferParams): Promise<unknown> {
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

      // Execute the transfer transaction
      const result = await transferQuery.exec();
      return result;
    } catch (error) {
      throw new Error(`Transfer transaction failed: ${error}`);
    }
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
   * Get mainnet token metadata by symbol.
   */
  public getMainnetTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata | undefined {
    return getMainnetTokenMetadata(symbol);
  }

  /**
   * Get testnet token metadata by symbol.
   */
  public getTestnetTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata | undefined {
    return getTestnetTokenMetadata(symbol);
  }

  /**
   * Get token metadata by symbol (defaults to mainnet, kept for backward compatibility).
   */
  public getTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata | undefined {
    return getMainnetTokenMetadata(symbol);
  }

  /**
   * Get detailed chain metadata by chain ID.
   */
  public getChainMetadata(chainId: SUPPORTED_CHAINS_IDS): ChainMetadata | undefined {
    return getChainMetadata(chainId);
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
   * Format balance with proper decimals and precision.
   */
  public formatBalance(balance: string, decimals: number, precision?: number): string {
    return formatBalance(balance, decimals, precision);
  }

  /**
   * Parse units from human-readable string to smallest unit.
   */
  public parseUnits(value: string, decimals: number): bigint {
    return parseUnits(value, decimals);
  }

  /**
   * Format units from smallest unit to human-readable string.
   */
  public formatUnits(value: bigint, decimals: number): string {
    return formatUnits(value, decimals);
  }

  /**
   * Validate if an address is valid.
   */
  public isValidAddress(address: string): boolean {
    return isValidAddress(address);
  }

  /**
   * Subscribe to account change events.
   */
  public onAccountChanged(callback: (account: string) => void): void {
    this.ca.caEvents.on(NEXUS_EVENTS.ACCOUNTS_CHANGED, ((...args: unknown[]) => {
      const accounts = args[0] as string[];
      callback(accounts[0] || '');
    }) as EventListener);
  }

  /**
   * Subscribe to chain change events.
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.ca.caEvents.on(NEXUS_EVENTS.CHAIN_CHANGED, ((...args: unknown[]) => {
      const chainId = args[0] as string;
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
   * Truncate address for display.
   */
  public truncateAddress(address: string, startLength?: number, endLength?: number): string {
    return truncateAddress(address, startLength, endLength);
  }

  /**
   * Convert chain ID to hex format.
   */
  public chainIdToHex(chainId: number): string {
    return chainIdToHex(chainId);
  }

  /**
   * Convert hex chain ID to number.
   */
  public hexToChainId(hex: string): number {
    return hexToChainId(hex);
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
}
