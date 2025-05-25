// src/sdk/index.ts
import { SUPPORTED_CHAINS } from '../constants';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';
import type {
  UnifiedBalanceResponse,
  BridgeParams,
  TransferParams,
  AllowanceParams,
  AllowanceResponse,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  PreSendTxParams,
  PreProcessOptions,
  EventListener,
} from '../types';
import SafeEventEmitter from '@metamask/safe-event-emitter';
export class NexusSDK {
  public readonly nexusAdapter: ChainAbstractionAdapter;
  public readonly nexusEvents: SafeEventEmitter;

  constructor() {
    this.nexusAdapter = new ChainAbstractionAdapter();
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
  public async getUnifiedBalances(): Promise<UnifiedBalanceResponse[]> {
    return this.nexusAdapter.getUnifiedBalances();
  }

  /**
   * Get unified balance for a specific token
   */
  public async getUnifiedBalance(symbol: string): Promise<UnifiedBalanceResponse | undefined> {
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

  /**
   * Check allowance for tokens on a specific chain
   */
  public async getAllowance(params: AllowanceParams): Promise<AllowanceResponse[]> {
    return this.nexusAdapter.getAllowance(params);
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

  public async deinit(): Promise<void> {
    await this.nexusAdapter.deinit();
  }

  public async request(args: RequestArguments): Promise<unknown> {
    return this.nexusAdapter.request(args);
  }

  public async preprocess(args: PreSendTxParams, options?: PreProcessOptions): Promise<void> {
    return this.nexusAdapter.preprocess(args, options);
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
