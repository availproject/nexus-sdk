import { CA, EthereumProvider, OnIntentHook, OnAllowanceHook } from '@arcana/ca-sdk';
import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from '../constants';

export type TransactionResponse = `0x${string}`;

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

export interface AllowanceParams {
  tokens: string[];
  amount: number;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
}

export interface AllowanceResponse {
  chainId: number;
  allowance: string;
  token: string;
}

export interface BridgeParams {
  token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS];
  amount: number | string;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
}

export interface TransferParams {
  token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS];
  amount: number | string;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
  recipient: `0x${string}`;
}

export class ChainAbstractionAdapter {
  public readonly ca: CA;
  private initialized = false;

  constructor() {
    this.ca = new CA();
  }

  /**
   * Initialize the CA SDK
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
   * Get unified balances across all chains
   */
  public async getUnifiedBalances(): Promise<UnifiedBalanceResponse[]> {
    try {
      return await this.ca.getUnifiedBalances();
    } catch (error) {
      throw new Error(`Failed to fetch unified balances: ${error}`);
    }
  }

  /**
   * Get unified balance for a specific token
   */
  public async getUnifiedBalance(symbol: string): Promise<UnifiedBalanceResponse | undefined> {
    try {
      return await this.ca.getUnifiedBalance(symbol);
    } catch (error) {
      throw new Error(`Failed to fetch unified balance for ${symbol}: ${error}`);
    }
  }

  /**
   * Check current allowance for a token on a specific chain
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
   * Set allowance for a token on a specific chain
   */
  public async setAllowance(chainId: number, token: string, amount: string): Promise<void> {
    try {
      await this.ca.allowance().tokens([token]).amount(BigInt(amount)).chain(chainId).set();
    } catch (error) {
      throw new Error(`Failed to set allowance: ${error}`);
    }
  }

  /**
   * Revoke allowance for a token on a specific chain
   */
  public async revokeAllowance(chainId: number, token: string): Promise<void> {
    try {
      await this.ca.allowance().tokens([token]).chain(chainId).revoke();
    } catch (error) {
      throw new Error(`Failed to revoke allowance: ${error}`);
    }
  }

  /**
   * Set callback for intent status updates
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this.ca.setOnIntentHook(callback);
  }

  /**
   * Set callback for allowance approval events
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this.ca.setOnAllowanceHook(callback);
  }

  /**
   * Bridge tokens between chains using intent
   */
  public async bridge(params: BridgeParams): Promise<TransactionResponse> {
    if (!this.isSupportedChain(params.chainId)) {
      throw new Error('Unsupported chain');
    }

    if (!this.isSupportedToken(params.token)) {
      throw new Error('Unsupported token');
    }

    try {
      const result = await this.ca
        .bridge()
        .token(params.token)
        .amount(params.amount)
        .chain(params.chainId)
        .exec();

      return result as TransactionResponse;
    } catch (error) {
      throw new Error(`Bridge transaction failed: ${error}`);
    }
  }

  /**
   * Transfer tokens using intent
   */
  public async transfer(params: TransferParams): Promise<TransactionResponse> {
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
   * Get token allowances for specified tokens on a chain
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
   * Subscribe to account changes
   */
  public onAccountChanged(callback: (account: string) => void): void {
    this.ca.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length > 0) {
        callback(accounts[0]);
      }
    });
  }

  /**
   * Subscribe to chain changes
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.ca.on('chainChanged', (chainId: string) => {
      callback(parseInt(chainId, 16));
    });
  }

  /**
   * Remove all event listeners
   */
  public removeAllListeners(): void {
    this.ca.removeListener('accountsChanged', () => {});
    this.ca.removeListener('chainChanged', () => {});
  }

  public isSupportedChain(
    chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS],
  ): boolean {
    return Object.values(SUPPORTED_CHAINS).includes(chainId);
  }

  public isSupportedToken(
    token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS],
  ): boolean {
    return Object.values(SUPPORTED_TOKENS).includes(token);
  }
}

export type { OnIntentHook, OnAllowanceHook, EthereumProvider } from '@arcana/ca-sdk';
