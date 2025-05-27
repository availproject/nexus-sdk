import { CA, Network } from '@arcana/ca-sdk';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { SUPPORTED_CHAINS, AVAILABLE_TOKENS, CHAIN_METADATA, NEXUS_EVENTS } from '../constants';
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
  getTokenMetadata,
} from '../utils';
import type {
  EthereumProvider,
  OnIntentHook,
  OnAllowanceHook,
  RequestArguments,
  PreSendTxParams,
  PreProcessOptions,
  UnifiedBalanceResponse,
  BridgeParams,
  TransferParams,
  AllowanceResponse,
  EventListener,
  TokenMetadata,
  ChainMetadata,
  TokenBalance,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
} from '../types';

/**
 * Adapter class that wraps CA SDK and provides a unified interface for chain abstraction operations.
 */
export class ChainAbstractionAdapter {
  private readonly ca: CA;
  public readonly caEvents: SafeEventEmitter;
  private initialized = false;

  constructor() {
    this.ca = new CA();
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
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize CA SDK: ${error}`);
    }
  }

  /**
   * Get unified balances for all supported tokens across all chains.
   */
  public async getUnifiedBalances(): Promise<UnifiedBalanceResponse[]> {
    try {
      return await this.ca.getUnifiedBalances();
    } catch (error) {
      throw new Error(`Failed to fetch unified balances: ${error}`);
    }
  }

  /**
   * Get unified balance for a specific token symbol.
   */
  public async getUnifiedBalance(symbol: string): Promise<UnifiedBalanceResponse | undefined> {
    try {
      return await this.ca.getUnifiedBalance(symbol);
    } catch (error) {
      throw new Error(`Failed to fetch unified balance for ${symbol}: ${error}`);
    }
  }

  /**
   * Check the current allowance for a token on a specific chain.
   */
  public async getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]> {
    try {
      let allowances: AllowanceResponse[];

      if (chainId && tokens) {
        // Get specific tokens allowance for specific chain
        allowances = await this.ca.allowance().tokens(tokens).chain(chainId).get();
      } else if (chainId) {
        // Get all tokens allowance for specific chain
        allowances = await this.ca.allowance().chain(chainId).get();
      } else if (tokens) {
        // Get specific tokens allowance for all chains
        allowances = await this.ca.allowance().tokens(tokens).get();
      } else {
        // Get all tokens allowance for all chains
        allowances = await this.ca.allowance().get();
      }

      return allowances;
    } catch (error) {
      throw new Error(`Failed to check allowance: ${error}`);
    }
  }

  /**
   * Set the allowance for a token on a specific chain.
   */
  public async setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void> {
    try {
      await this.ca.allowance().tokens(tokens).amount(amount).chain(chainId).set();
    } catch (error) {
      throw new Error(`Failed to set allowance: ${error}`);
    }
  }

  /**
   * Revoke the allowance for a token on a specific chain.
   */
  public async revokeAllowance(chainId: number, tokens: string[]): Promise<void> {
    try {
      await this.ca.allowance().tokens(tokens).chain(chainId).revoke();
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
   * Bridge tokens between chains using the intent system.
   */
  public async bridge(params: BridgeParams): Promise<unknown> {
    if (!this.isSupportedChain(params.chainId)) throw new Error('Unsupported chain');
    if (!this.isSupportedToken(params.token)) throw new Error('Unsupported token');
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');
    try {
      const bridgeBuilder = this.ca
        .bridge()
        .token(params.token)
        .amount(params.amount)
        .chain(params.chainId);
      if (params.gas !== undefined) bridgeBuilder.gas(BigInt(params.gas));
      const result = await bridgeBuilder.exec();
      return result;
    } catch (error) {
      throw new Error(`Bridge transaction failed: ${error}`);
    }
  }

  /**
   * Transfer tokens to a recipient using the intent system.
   */
  public async transfer(params: TransferParams): Promise<`0x${string}`> {
    if (!this.isSupportedChain(params.chainId)) {
      throw new Error('Unsupported chain');
    }
    if (!this.isSupportedToken(params.token)) {
      throw new Error('Unsupported token');
    }
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');
    try {
      const transferBuilder = this.ca
        .transfer()
        .to(params.recipient)
        .amount(params.amount)
        .chain(params.chainId)
        .token(params.token);
      const result = await transferBuilder.exec();
      return result;
    } catch (error) {
      throw new Error(`Transfer transaction failed: ${error}`);
    }
  }

  /**
   * Get supported tokens with metadata.
   */
  public getTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata {
    return getTokenMetadata(symbol);
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
    this.on(NEXUS_EVENTS.ACCOUNTS_CHANGED, ((...args: unknown[]) => {
      const accounts = args[0] as string[];
      callback(accounts[0] || '');
    }) as EventListener);
  }

  /**
   * Subscribe to chain change events.
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.on(NEXUS_EVENTS.CHAIN_CHANGED, ((...args: unknown[]) => {
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
    return AVAILABLE_TOKENS.some((availableToken) => availableToken.symbol === token);
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
   * Make a generic EIP-1193 request to the provider.
   */
  public async request(args: RequestArguments): Promise<unknown> {
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');
    try {
      return await this.ca.request(args);
    } catch (error) {
      throw new Error(`EIP-1193 request failed: ${error}`);
    }
  }

  /**
   * Preprocess a transaction (e.g., for gas estimation or validation).
   */
  public async preprocess(args: PreSendTxParams, options?: PreProcessOptions): Promise<void> {
    if (!this.initialized) throw new Error('CA SDK not initialized. Call initialize() first.');
    try {
      await this.ca.preprocess(args, options);
    } catch (error) {
      throw new Error(`Transaction preprocessing failed: ${error}`);
    }
  }

  /**
   * Subscribe to any event emitted by the CA SDK.
   */
  public on(eventName: string, listener: EventListener): void {
    this.ca.on(eventName, listener);
  }

  /**
   * Remove a specific event listener.
   */
  public removeListener(eventName: string, listener: EventListener): void {
    this.ca.removeListener(eventName, listener);
  }

  /**
   * Remove all listeners for a specific event from ca.caEvents, or all if eventName is undefined.
   */
  public removeAllCaEventListeners(eventName?: string): void {
    if (this.ca.caEvents) this.ca.caEvents.removeAllListeners(eventName);
  }
}
