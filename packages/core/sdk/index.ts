// src/core/sdk/index.ts
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
  SwapInput,
  SwapOptionalParams,
  SwapResult,
  SwapBalances,
} from '@nexus/commons';
import { setLogLevel, LOG_LEVEL, logger } from '@nexus/commons';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { Network, SDKConfig } from '@arcana/ca-sdk';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';

export class NexusSDK {
  private readonly nexusAdapter: ChainAbstractionAdapter;
  public readonly nexusEvents: SafeEventEmitter;
  public readonly utils: NexusUtils;

  constructor(config?: { network?: NexusNetwork; debug?: boolean }) {
    const nexusConfig: SDKConfig &
      Omit<SDKConfig, 'siweStatement' | 'network'> & { network?: Network } = {
      ...config,
      siweStatement: 'Sign in to enable Nexus',
    };
    if (config?.network) {
      nexusConfig.network = config?.network === 'testnet' ? Network.FOLLY : undefined;
    }

    // Initialize logger based on debug flag
    this.initializeLogger(config?.debug);
    logger.debug('Nexus SDK initialized with config:', nexusConfig);
    this.nexusAdapter = new ChainAbstractionAdapter(nexusConfig);
    this.nexusEvents = this.nexusAdapter.caEvents;
    this.utils = new NexusUtils(this.nexusAdapter, () => this.nexusAdapter.isInitialized());
  }

  /**
   * Initialize logger based on debug configuration
   * @private
   */
  private initializeLogger(debug?: boolean): void {
    if (debug) {
      setLogLevel(LOG_LEVEL.DEBUG);
      logger.info('Nexus SDK Logger initialized in DEBUG mode');
    } else {
      // Default to NOLOGS to suppress all logging in production
      setLogLevel(LOG_LEVEL.NOLOGS);
    }
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    // Initialize the core adapter first
    await this.nexusAdapter.initialize(provider);
    const BACKEND_URL = 'https://nexus-backend.avail.so';
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
   * Get swap balances
   */
  public async getSwapBalances(): Promise<SwapBalances> {
    return this.nexusAdapter.getSwapBalances();
  }

  /**
   * Get unified balance for a specific token
   */
  public async getUnifiedBalance(symbol: string): Promise<UserAsset | undefined> {
    return this.nexusAdapter.getUnifiedBalance(symbol);
  }

  /**
   * Cross chain token transfer
   */
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    return this.nexusAdapter.bridge(params);
  }

  /**
   * Cross chain token transfer to EOA
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
    return this.nexusAdapter.transfer(params);
  }

  /**
   * Swaps
   */
  public async swap(
    inputs: SwapInput,
    options?: Omit<SwapOptionalParams, 'emit'>,
  ): Promise<SwapResult> {
    return this.nexusAdapter.swap(inputs, options);
  }

  /**
   * Get chain abstracted provider allowing use of chain asbtraction
   * @returns EthereumProvider
   */

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

  public async deinit(): Promise<void> {
    await this.nexusAdapter.deinit();
  }

  public async request(args: RequestArguments): Promise<unknown> {
    return this.nexusAdapter.request(args);
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
