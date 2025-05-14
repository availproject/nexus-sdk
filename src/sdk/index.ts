// src/sdk/index.ts
import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from '../constants';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';
import type {
  UnifiedBalanceResponse,
  TransactionResponse,
  BridgeParams,
  TransferParams,
  AllowanceParams,
  AllowanceResponse,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
} from '../adapters/chain-abstraction-adapter';

export class NexusSDK {
  public readonly nexusAdapter: ChainAbstractionAdapter;

  constructor() {
    this.nexusAdapter = new ChainAbstractionAdapter();
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
  public async bridge(params: BridgeParams): Promise<TransactionResponse> {
    return this.nexusAdapter.bridge(params);
  }

  /**
   * Transfer tokens
   */
  public async transfer(params: TransferParams): Promise<TransactionResponse> {
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
  public async setAllowance(chainId: number, token: string, amount: string): Promise<void> {
    return this.nexusAdapter.setAllowance(chainId, token, amount);
  }

  /**
   * Revoke allowance for a token on a specific chain
   */
  public async revokeAllowance(chainId: number, token: string): Promise<void> {
    return this.nexusAdapter.revokeAllowance(chainId, token);
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
  public isSupportedToken(
    token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS],
  ): boolean {
    return this.nexusAdapter.isSupportedToken(token);
  }

  /**
   * Get supported chains
   */
  public getSupportedChains(): typeof SUPPORTED_CHAINS {
    return SUPPORTED_CHAINS;
  }

  /**
   * Get supported tokens
   */
  public getSupportedTokens(): typeof SUPPORTED_TOKENS {
    return SUPPORTED_TOKENS;
  }
}

export type {
  UnifiedBalanceResponse,
  TransactionResponse,
  BridgeParams,
  TransferParams,
  AllowanceParams,
  AllowanceResponse,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
};
