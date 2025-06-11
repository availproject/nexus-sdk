// src/sdk/index.ts
import { SUPPORTED_CHAINS } from '../constants';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';
import type {
  BridgeParams,
  TransferParams,
  AllowanceResponse,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  EventListener,
  TokenMetadata,
  ChainMetadata,
  TokenBalance,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
  UserAsset,
  SimulationResult,
  RequestForFunds,
  NexusNetwork,
} from '../types';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { Network, SDKConfig } from '@arcana/ca-sdk';

export class NexusSDK {
  public readonly nexusAdapter: ChainAbstractionAdapter;
  public readonly nexusEvents: SafeEventEmitter;

  constructor(
    config?: SDKConfig & Omit<SDKConfig, 'siweStatement' | 'network'> & { network?: NexusNetwork },
  ) {
    let nexusConfig: SDKConfig &
      Omit<SDKConfig, 'siweStatement' | 'network'> & { network?: Network } = {
      ...config,
      siweStatement: 'Sign in to enable Nexus',
    };
    if (config?.network) {
      nexusConfig.network = config?.network === 'testnet' ? Network.FOLLY : undefined;
    }

    this.nexusAdapter = new ChainAbstractionAdapter(nexusConfig);
    this.nexusEvents = this.nexusAdapter.caEvents;
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    await this.nexusAdapter.initialize(provider);
  }

  /**
   * Get unified balances across all chains
   */
  public async getUnifiedBalances(): Promise<UserAsset[]> {
    return this.nexusAdapter.getUnifiedBalances();
  }

  /**
   * Get unified balance for a specific token
   */
  public async getUnifiedBalance(symbol: string): Promise<UserAsset | undefined> {
    return this.nexusAdapter.getUnifiedBalance(symbol);
  }

  /**
   * Bridge tokens between chains
   */
  public async bridge(params: BridgeParams): Promise<unknown> {
    return this.nexusAdapter.bridge(params);
  }

  /**
   * Transfer tokens
   */
  public async transfer(params: TransferParams): Promise<unknown> {
    return this.nexusAdapter.transfer(params);
  }

  public getEVMProviderWithCA(): EthereumProvider {
    return this.nexusAdapter.getEVMProviderWithCA();
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    return this.nexusAdapter.simulateBridge(params);
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    return this.nexusAdapter.simulateTransfer(params);
  }

  /**
   * Get user's intents with pagination
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    return this.nexusAdapter.getMyIntents(page);
  }

  /**
   * Check allowance for tokens on a specific chain
   */
  public async getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]> {
    return this.nexusAdapter.getAllowance(chainId, tokens);
  }

  /**
   * Set allowance for a token on a specific chain
   */
  public async setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void> {
    return this.nexusAdapter.setAllowance(chainId, tokens, amount);
  }

  /**
   * Revoke allowance for a token on a specific chain
   */
  public async revokeAllowance(chainId: number, tokens: string[]): Promise<void> {
    return this.nexusAdapter.revokeAllowance(chainId, tokens);
  }

  /**
   * Set callback for intent status updates
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this.nexusAdapter.setOnIntentHook(callback);
  }

  /**
   * Set callback for allowance approval events
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this.nexusAdapter.setOnAllowanceHook(callback);
  }

  /**
   * Subscribe to account changes
   */
  public onAccountChanged(callback: (account: string) => void): void {
    this.nexusAdapter.onAccountChanged(callback);
  }

  /**
   * Subscribe to chain changes
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.nexusAdapter.onChainChanged(callback);
  }

  /**
   * Remove all event listeners
   */
  public removeAllListeners(): void {
    this.nexusAdapter.removeAllListeners();
  }

  /**
   * Check if a chain is supported
   */
  public isSupportedChain(
    chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS],
  ): boolean {
    return this.nexusAdapter.isSupportedChain(chainId);
  }

  /**
   * Check if a token is supported
   */
  public isSupportedToken(token: string): boolean {
    return this.nexusAdapter.isSupportedToken(token);
  }

  /**
   * Get supported chains
   */
  public getSupportedChains(): Array<{ id: number; name: string; logo: string }> {
    return this.nexusAdapter.getSupportedChains();
  }

  /**
   * Get mainnet token metadata by symbol
   */
  public getMainnetTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata | undefined {
    return this.nexusAdapter.getMainnetTokenMetadata(symbol);
  }

  /**
   * Get testnet token metadata by symbol
   */
  public getTestnetTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata | undefined {
    return this.nexusAdapter.getTestnetTokenMetadata(symbol);
  }

  /**
   * Get token metadata by symbol (defaults to mainnet, kept for backward compatibility)
   */
  public getTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata | undefined {
    return this.nexusAdapter.getTokenMetadata(symbol);
  }

  /**
   * Get detailed chain metadata by chain ID
   */
  public getChainMetadata(chainId: SUPPORTED_CHAINS_IDS): ChainMetadata | undefined {
    return this.nexusAdapter.getChainMetadata(chainId);
  }

  /**
   * Get enhanced chain metadata for all supported chains
   */
  public getSupportedChainsWithMetadata(): ChainMetadata[] {
    return this.nexusAdapter.getSupportedChainsWithMetadata();
  }

  /**
   * Get token balance for a specific token on a specific chain
   */
  public async getFormattedTokenBalance(
    symbol: SUPPORTED_TOKENS,
    chainId?: number,
  ): Promise<TokenBalance | undefined> {
    return this.nexusAdapter.getFormattedTokenBalance(symbol, chainId);
  }

  /**
   * Format balance with proper decimals and precision
   */
  public formatBalance(balance: string, decimals: number, precision?: number): string {
    return this.nexusAdapter.formatBalance(balance, decimals, precision);
  }

  /**
   * Parse units from human-readable string to smallest unit
   */
  public parseUnits(value: string, decimals: number): bigint {
    return this.nexusAdapter.parseUnits(value, decimals);
  }

  /**
   * Format units from smallest unit to human-readable string
   */
  public formatUnits(value: bigint, decimals: number): string {
    return this.nexusAdapter.formatUnits(value, decimals);
  }

  /**
   * Validate if an address is valid
   */
  public isValidAddress(address: string): boolean {
    return this.nexusAdapter.isValidAddress(address);
  }

  /**
   * Truncate address for display
   */
  public truncateAddress(address: string, startLength?: number, endLength?: number): string {
    return this.nexusAdapter.truncateAddress(address, startLength, endLength);
  }

  /**
   * Convert chain ID to hex format
   */
  public chainIdToHex(chainId: number): string {
    return this.nexusAdapter.chainIdToHex(chainId);
  }

  /**
   * Convert hex chain ID to number
   */
  public hexToChainId(hex: string): number {
    return this.nexusAdapter.hexToChainId(hex);
  }

  public async deinit(): Promise<void> {
    await this.nexusAdapter.deinit();
  }

  public async request(args: RequestArguments): Promise<unknown> {
    return this.nexusAdapter.request(args);
  }

  public on(eventName: string, listener: EventListener): void {
    this.nexusAdapter.on(eventName, listener);
  }

  public removeListener(eventName: string, listener: EventListener): void {
    this.nexusAdapter.removeListener(eventName, listener);
  }

  public removeAllCaEventListeners(eventName?: string): void {
    this.nexusAdapter.removeAllCaEventListeners(eventName);
  }
}
