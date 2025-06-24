// src/sdk/index.ts
import { NexusUtils } from './utils';
import { initializeSimulationClient } from '../integrations/tenderly';
import type {
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  AllowanceResponse,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  EventListener,
  UserAsset,
  SimulationResult,
  RequestForFunds,
  NexusNetwork,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  BridgeAndExecuteSimulationResult,
} from '../types';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { Network, SDKConfig } from '@arcana/ca-sdk';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';

export const BACKEND_URL = 'https://sample-nexus-backend.onrender.com';

export class NexusSDK {
  public readonly nexusAdapter: ChainAbstractionAdapter;
  public readonly nexusEvents: SafeEventEmitter;
  public readonly utils: NexusUtils;

  constructor(config?: Omit<SDKConfig, 'siweStatement' | 'network'> & { network?: NexusNetwork }) {
    const nexusConfig: SDKConfig &
      Omit<SDKConfig, 'siweStatement' | 'network'> & { network?: Network } = {
      ...config,
      siweStatement: 'Sign in to enable Nexus',
    };
    if (config?.network) {
      nexusConfig.network = config?.network === 'testnet' ? Network.FOLLY : undefined;
    }

    this.nexusAdapter = new ChainAbstractionAdapter(nexusConfig);
    this.nexusEvents = this.nexusAdapter.caEvents;
    this.utils = new NexusUtils(this.nexusAdapter, () => this.nexusAdapter.isInitialized());
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    // Initialize the core adapter first
    await this.nexusAdapter.initialize(provider);

    if (BACKEND_URL) {
      try {
        const initResult = await initializeSimulationClient(BACKEND_URL);
        if (!initResult.success) {
          throw new Error('Backend initialization failed');
        }
      } catch (error) {
        throw new Error('Backend initialization failed');
      }
    }
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
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    return this.nexusAdapter.bridge(params);
  }

  /**
   * Transfer tokens
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
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

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return this.nexusAdapter.execute(params);
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    return this.nexusAdapter.simulateExecute(params);
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    return this.nexusAdapter.bridgeAndExecute(params);
  }

  /**
   * Simulate bridge and execute operation using bridge output amounts for realistic execute cost estimation
   * This method provides more accurate gas estimates by using the actual amount that will be
   * received on the destination chain after bridging (accounting for fees, slippage, etc.)
   * Includes detailed step-by-step breakdown with approval handling.
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    return this.nexusAdapter.simulateBridgeAndExecute(params);
  }
}
