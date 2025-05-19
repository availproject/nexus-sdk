import {
  CA,
  EthereumProvider,
  OnIntentHook,
  OnAllowanceHook,
  RequestArguments,
  Network,
} from '@arcana/ca-sdk';
import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from '../constants';

/**
 * Parameters for sending a transaction.
 */
export type PreSendTxParams = {
  to?: `0x${string}`;
  from?: `0x${string}`;
  value?: `0x${string}`;
  data?: `0x${string}`;
};

/**
 * Unified balance response structure for a token across chains.
 */
export interface UnifiedBalanceResponse {
  symbol: string;
  balance: string;
  balanceInFiat: number;
  decimals: number;
  icon?: string;
  breakdown: {
    chain: {
      id: number;
      name: string;
      logo: string;
    };
    network: 'evm';
    contractAddress: `0x${string}`;
    isNative?: boolean;
    balance: string;
    balanceInFiat: number;
  }[];
  abstracted?: boolean;
}

/**
 * Parameters for checking or setting token allowance.
 */
export interface AllowanceParams {
  tokens: string[];
  amount: number;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
}

/**
 * Response structure for token allowance.
 */
export interface AllowanceResponse {
  chainId: number;
  allowance: string;
  token: string;
}

/**
 * Options for preprocessing a transaction.
 */
export interface PreProcessOptions {
  bridge: boolean;
  extraGas: bigint;
}

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS];
  amount: number | string;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
  gas?: string | number | bigint;
}

/**
 * Parameters for transferring tokens.
 */
export interface TransferParams {
  token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS];
  amount: number | string;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
  recipient: `0x${string}`;
}

/**
 * Adapter class that wraps Arcana CA SDK and provides a unified interface for chain abstraction operations.
 */
export class ChainAbstractionAdapter {
  private readonly ca: CA;
  public readonly caEvents;
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
  public async checkAllowance(chainId: number, token: string): Promise<string> {
    try {
      const allowances = await this.ca.allowance().tokens([token]).chain(chainId).get();
      return allowances[0]?.allowance.toString() || '0';
    } catch (error) {
      throw new Error(`Failed to check allowance: ${error}`);
    }
  }

  /**
   * Set the allowance for a token on a specific chain.
   */
  public async setAllowance(chainId: number, token: string, amount: string): Promise<void> {
    try {
      await this.ca.allowance().tokens([token]).amount(BigInt(amount)).chain(chainId).set();
    } catch (error) {
      throw new Error(`Failed to set allowance: ${error}`);
    }
  }

  /**
   * Revoke the allowance for a token on a specific chain.
   */
  public async revokeAllowance(chainId: number, token: string): Promise<void> {
    try {
      await this.ca.allowance().tokens([token]).chain(chainId).revoke();
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
  public async transfer(params: TransferParams): Promise<unknown> {
    if (!this.isSupportedChain(params.chainId)) {
      throw new Error('Unsupported chain');
    }
    if (!this.isSupportedToken(params.token)) {
      throw new Error('Unsupported token');
    }
    try {
      return await this.ca
        .transfer()
        .to(params.recipient)
        .amount(params.amount)
        .chain(params.chainId)
        .token(params.token)
        .exec();
    } catch (error) {
      throw new Error(`Transfer transaction failed: ${error}`);
    }
  }

  /**
   * Get token allowances for specified tokens on a chain.
   */
  public async getAllowance(params: AllowanceParams): Promise<AllowanceResponse[]> {
    if (!this.isSupportedChain(params.chainId)) {
      throw new Error('Unsupported chain');
    }
    try {
      const allowances = await this.ca
        .allowance()
        .tokens(params.tokens)
        .chain(params.chainId)
        .get();
      return allowances.map((allowance) => ({
        chainId: allowance.chainID,
        allowance: allowance.allowance.toString(),
        token: allowance.token,
      }));
    } catch (error) {
      throw new Error(`Failed to fetch allowance: ${error}`);
    }
  }

  /**
   * Subscribe to account change events.
   */
  public onAccountChanged(callback: (account: string) => void): void {
    this.on('accountsChanged', (accounts: string[]) => {
      callback(accounts[0] || '');
    });
  }

  /**
   * Subscribe to chain change events.
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.on('chainChanged', (chainId: string) => {
      callback(parseInt(chainId, 16));
    });
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
    // Remove known listeners from CA instance
    this.ca.removeListener('accountsChanged', () => {});
    this.ca.removeListener('chainChanged', () => {});
  }

  /**
   * Get the list of supported chains from the Arcana SDK.
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
  public isSupportedToken(
    token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS],
  ): boolean {
    return Object.values(SUPPORTED_TOKENS).includes(token);
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
  public on(eventName: string, listener: (...args: any[]) => void): void {
    this.ca.on(eventName, listener);
  }

  /**
   * Remove a specific event listener.
   */
  public removeListener(eventName: string, listener: (...args: any[]) => void): void {
    this.ca.removeListener(eventName, listener);
  }

  /**
   * Remove all listeners for a specific event from ca.caEvents, or all if eventName is undefined.
   */
  public removeAllCaEventListeners(eventName?: string): void {
    if (this.ca.caEvents) this.ca.caEvents.removeAllListeners(eventName);
  }
}

export type {
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  ProgressStep,
  ProgressSteps,
} from '@arcana/ca-sdk';
