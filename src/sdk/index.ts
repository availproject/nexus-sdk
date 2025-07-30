// src/sdk/index.ts
import { NexusUtils } from './utils';
import { initializeSimulationClient } from '../integrations/tenderly';
import { setLogLevel, LOG_LEVEL, logger } from '../utils/logger';
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
  TelemetryConfig,
  TelemetryClient,
  TelemetryEventType,
} from '../types';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { Network, SDKConfig } from '@arcana/ca-sdk';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';
import { createTelemetryClient, getTelemetryClient } from '../telemetry';

export class NexusSDK {
  public readonly nexusAdapter: ChainAbstractionAdapter;
  public readonly nexusEvents: SafeEventEmitter;
  public readonly utils: NexusUtils;
  public readonly telemetry: TelemetryClient;

  constructor(
    config?: Omit<SDKConfig, 'siweStatement' | 'network'> & {
      network?: NexusNetwork;
      debug?: boolean;
      telemetry?: Partial<TelemetryConfig>;
    },
  ) {
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
    
    // Initialize telemetry client
    this.telemetry = this.initializeTelemetry(config?.telemetry, config?.network);
    
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
   * Initialize telemetry client with configuration
   * @private
   */
  private initializeTelemetry(telemetryConfig?: Partial<TelemetryConfig>, network?: NexusNetwork): TelemetryClient {
    const defaultTelemetryConfig: Partial<TelemetryConfig> = {
      enabled: true,
      environment: (process.env.NODE_ENV as 'development' | 'staging' | 'production') || 'development',
      version: '0.1.1',
      sessionId: `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      network: network || 'mainnet',
      sampleRate: 1.0,
      batchSize: 10,
      batchTimeout: 5000,
      enableDebug: false,
      enableConsole: false,
      privacySettings: {
        trackUserInteractions: true,
        trackTransactions: true,
        trackErrors: true,
        trackPerformance: true,
        trackNetwork: true,
        trackWallet: true,
        trackUI: true,
        anonymizeData: false,
        maskAddresses: false,
        maskBalances: false,
      },
    };

    const finalConfig = { ...defaultTelemetryConfig, ...telemetryConfig };
    return createTelemetryClient(finalConfig);
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    // Track initialization start
    this.telemetry.track('sdk_initialized', {
      provider: provider.constructor.name,
      hasProvider: !!provider,
    });

    try {
      // Initialize the core adapter first
      await this.nexusAdapter.initialize(provider);
      
      // Track successful initialization
      this.telemetry.track('user_connected', {
        provider: provider.constructor.name,
        hasProvider: !!provider,
      });

      const BACKEND_URL = 'https://nexus-backend.avail.so';
      if (BACKEND_URL) {
        try {
          const initResult = await initializeSimulationClient(BACKEND_URL);
          if (!initResult.success) {
            throw new Error('Backend initialization failed');
          }
          
          // Track backend initialization success
          this.telemetry.track('network_response', {
            url: BACKEND_URL,
            method: 'GET',
            responseTime: 0,
            statusCode: 200,
          });
        } catch (error) {
          // Track backend initialization failure
          this.telemetry.trackError(error as Error, {
            context: 'backend_initialization',
            url: BACKEND_URL,
          });
          throw new Error('Backend initialization failed');
        }
      }
    } catch (error) {
      // Track initialization failure
      this.telemetry.trackError(error as Error, {
        context: 'sdk_initialization',
        provider: provider.constructor.name,
      });
      throw error;
    }
  }

  /**
   * Get unified balances across all chains
   */
  public async getUnifiedBalances(): Promise<UserAsset[]> {
    const startTime = Date.now();
    try {
      const balances = await this.nexusAdapter.getUnifiedBalances();
      
      // Track balance check performance
      this.telemetry.trackPerformance('balance_check', Date.now() - startTime, 'ms');
      this.telemetry.track('balance_checked', {
        balanceCount: balances.length,
        chains: balances.map(b => b.chainId),
      });
      
      return balances;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'get_unified_balances' });
      throw error;
    }
  }

  /**
   * Get unified balance for a specific token
   */
  public async getUnifiedBalance(symbol: string): Promise<UserAsset | undefined> {
    const startTime = Date.now();
    try {
      const balance = await this.nexusAdapter.getUnifiedBalance(symbol);
      
      // Track balance check performance
      this.telemetry.trackPerformance('balance_check_single', Date.now() - startTime, 'ms');
      this.telemetry.track('balance_checked', {
        symbol,
        hasBalance: !!balance,
      });
      
      return balance;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'get_unified_balance', symbol });
      throw error;
    }
  }

  /**
   * Bridge tokens between chains
   */
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    const startTime = Date.now();
    
    // Track bridge initiation
    this.telemetry.track('bridge_initiated', {
      token: params.token,
      amount: params.amount,
      chainId: params.chainId,
      gas: params.gas?.toString(),
    });

    try {
      const result = await this.nexusAdapter.bridge(params);
      
      // Track bridge completion
      this.telemetry.track('bridge_completed', {
        token: params.token,
        amount: params.amount,
        chainId: params.chainId,
        success: result.success,
        error: result.error,
        explorerUrl: result.explorerUrl,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      // Track bridge failure
      this.telemetry.track('bridge_failed', {
        token: params.token,
        amount: params.amount,
        chainId: params.chainId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      });
      this.telemetry.trackError(error as Error, { context: 'bridge', params });
      throw error;
    }
  }

  /**
   * Transfer tokens
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
    const startTime = Date.now();
    
    // Track transfer initiation
    this.telemetry.track('transfer_initiated', {
      token: params.token,
      amount: params.amount,
      chainId: params.chainId,
      recipient: params.recipient,
    });

    try {
      const result = await this.nexusAdapter.transfer(params);
      
      // Track transfer completion
      this.telemetry.track('transfer_completed', {
        token: params.token,
        amount: params.amount,
        chainId: params.chainId,
        recipient: params.recipient,
        success: result.success,
        error: result.error,
        explorerUrl: result.explorerUrl,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      // Track transfer failure
      this.telemetry.track('transfer_failed', {
        token: params.token,
        amount: params.amount,
        chainId: params.chainId,
        recipient: params.recipient,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      });
      this.telemetry.trackError(error as Error, { context: 'transfer', params });
      throw error;
    }
  }

  public getEVMProviderWithCA(): EthereumProvider {
    return this.nexusAdapter.getEVMProviderWithCA();
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    const startTime = Date.now();
    
    // Track simulation request
    this.telemetry.track('simulation_requested', {
      type: 'bridge',
      token: params.token,
      amount: params.amount,
      chainId: params.chainId,
    });

    try {
      const result = await this.nexusAdapter.simulateBridge(params);
      
      // Track simulation completion
      this.telemetry.track('transaction_simulated', {
        type: 'bridge',
        token: params.token,
        amount: params.amount,
        chainId: params.chainId,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'simulate_bridge', params });
      throw error;
    }
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    const startTime = Date.now();
    
    // Track simulation request
    this.telemetry.track('simulation_requested', {
      type: 'transfer',
      token: params.token,
      amount: params.amount,
      chainId: params.chainId,
      recipient: params.recipient,
    });

    try {
      const result = await this.nexusAdapter.simulateTransfer(params);
      
      // Track simulation completion
      this.telemetry.track('transaction_simulated', {
        type: 'transfer',
        token: params.token,
        amount: params.amount,
        chainId: params.chainId,
        recipient: params.recipient,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'simulate_transfer', params });
      throw error;
    }
  }

  /**
   * Get user's intents with pagination
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    try {
      const intents = await this.nexusAdapter.getMyIntents(page);
      
      this.telemetry.track('feature_used', {
        feature: 'get_my_intents',
        page,
        intentCount: intents.length,
      });
      
      return intents;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'get_my_intents', page });
      throw error;
    }
  }

  /**
   * Check allowance for tokens on a specific chain
   */
  public async getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]> {
    try {
      const allowances = await this.nexusAdapter.getAllowance(chainId, tokens);
      
      this.telemetry.track('approval_requested', {
        chainId,
        tokenCount: tokens?.length || 0,
        allowanceCount: allowances.length,
      });
      
      return allowances;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'get_allowance', chainId, tokens });
      throw error;
    }
  }

  /**
   * Set allowance for a token on a specific chain
   */
  public async setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void> {
    const startTime = Date.now();
    
    this.telemetry.track('approval_requested', {
      chainId,
      tokens,
      amount: amount.toString(),
    });

    try {
      await this.nexusAdapter.setAllowance(chainId, tokens, amount);
      
      this.telemetry.track('approval_granted', {
        chainId,
        tokens,
        amount: amount.toString(),
        executionTime: Date.now() - startTime,
      });
    } catch (error) {
      this.telemetry.track('approval_denied', {
        chainId,
        tokens,
        amount: amount.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      });
      this.telemetry.trackError(error as Error, { context: 'set_allowance', chainId, tokens, amount: amount.toString() });
      throw error;
    }
  }

  /**
   * Revoke allowance for a token on a specific chain
   */
  public async revokeAllowance(chainId: number, tokens: string[]): Promise<void> {
    try {
      await this.nexusAdapter.revokeAllowance(chainId, tokens);
      
      this.telemetry.track('approval_denied', {
        chainId,
        tokens,
        action: 'revoke',
      });
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'revoke_allowance', chainId, tokens });
      throw error;
    }
  }

  /**
   * Set callback for intent status updates
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this.nexusAdapter.setOnIntentHook(callback);
    this.telemetry.track('feature_used', { feature: 'set_on_intent_hook' });
  }

  /**
   * Set callback for allowance approval events
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this.nexusAdapter.setOnAllowanceHook(callback);
    this.telemetry.track('feature_used', { feature: 'set_on_allowance_hook' });
  }

  /**
   * Subscribe to account changes
   */
  public onAccountChanged(callback: (account: string) => void): void {
    this.nexusAdapter.onAccountChanged((account: string) => {
      this.telemetry.track('account_changed', { account });
      callback(account);
    });
  }

  /**
   * Subscribe to chain changes
   */
  public onChainChanged(callback: (chainId: number) => void): void {
    this.nexusAdapter.onChainChanged((chainId: number) => {
      this.telemetry.track('chain_switched', { chainId });
      callback(chainId);
    });
  }

  /**
   * Remove all event listeners
   */
  public removeAllListeners(): void {
    this.nexusAdapter.removeAllListeners();
    this.telemetry.track('feature_used', { feature: 'remove_all_listeners' });
  }

  public async deinit(): Promise<void> {
    this.telemetry.track('user_disconnected');
    await this.nexusAdapter.deinit();
    await this.telemetry.destroy();
  }

  public async request(args: RequestArguments): Promise<unknown> {
    try {
      const result = await this.nexusAdapter.request(args);
      this.telemetry.track('feature_used', { feature: 'request', method: args.method });
      return result;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'request', method: args.method });
      throw error;
    }
  }

  public on(eventName: string, listener: EventListener): void {
    this.nexusAdapter.on(eventName, listener);
    this.telemetry.track('feature_used', { feature: 'on_event', eventName });
  }

  public removeListener(eventName: string, listener: EventListener): void {
    this.nexusAdapter.removeListener(eventName, listener);
    this.telemetry.track('feature_used', { feature: 'remove_listener', eventName });
  }

  public removeAllCaEventListeners(eventName?: string): void {
    this.nexusAdapter.removeAllCaEventListeners(eventName);
    this.telemetry.track('feature_used', { feature: 'remove_all_ca_event_listeners', eventName });
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const startTime = Date.now();
    
    this.telemetry.track('execute_initiated', {
      toChainId: params.toChainId,
      contractAddress: params.contractAddress,
      functionName: params.functionName,
      tokenApproval: params.tokenApproval,
    });

    try {
      const result = await this.nexusAdapter.execute(params);
      
      this.telemetry.track('execute_completed', {
        toChainId: params.toChainId,
        contractAddress: params.contractAddress,
        functionName: params.functionName,
        transactionHash: result.transactionHash,
        explorerUrl: result.explorerUrl,
        chainId: result.chainId,
        success: true,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      this.telemetry.track('execute_failed', {
        toChainId: params.toChainId,
        contractAddress: params.contractAddress,
        functionName: params.functionName,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      });
      this.telemetry.trackError(error as Error, { context: 'execute', params });
      throw error;
    }
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    const startTime = Date.now();
    
    this.telemetry.track('simulation_requested', {
      type: 'execute',
      toChainId: params.toChainId,
      contractAddress: params.contractAddress,
      functionName: params.functionName,
    });

    try {
      const result = await this.nexusAdapter.simulateExecute(params);
      
      this.telemetry.track('transaction_simulated', {
        type: 'execute',
        toChainId: params.toChainId,
        contractAddress: params.contractAddress,
        functionName: params.functionName,
        gasUsed: result.gasUsed,
        success: result.success,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'simulate_execute', params });
      throw error;
    }
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    const startTime = Date.now();
    
    this.telemetry.track('bridge_initiated', {
      type: 'bridge_and_execute',
      toChainId: params.toChainId,
      token: params.token,
      amount: params.amount,
      hasExecute: !!params.execute,
    });

    try {
      const result = await this.nexusAdapter.bridgeAndExecute(params);
      
      this.telemetry.track('bridge_completed', {
        type: 'bridge_and_execute',
        toChainId: params.toChainId,
        token: params.token,
        amount: params.amount,
        success: result.success,
        executeTransactionHash: result.executeTransactionHash,
        executeExplorerUrl: result.executeExplorerUrl,
        approvalTransactionHash: result.approvalTransactionHash,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      this.telemetry.track('bridge_failed', {
        type: 'bridge_and_execute',
        toChainId: params.toChainId,
        token: params.token,
        amount: params.amount,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      });
      this.telemetry.trackError(error as Error, { context: 'bridge_and_execute', params });
      throw error;
    }
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
    const startTime = Date.now();
    
    this.telemetry.track('simulation_requested', {
      type: 'bridge_and_execute',
      toChainId: params.toChainId,
      token: params.token,
      amount: params.amount,
      hasExecute: !!params.execute,
    });

    try {
      const result = await this.nexusAdapter.simulateBridgeAndExecute(params);
      
      this.telemetry.track('transaction_simulated', {
        type: 'bridge_and_execute',
        toChainId: params.toChainId,
        token: params.token,
        amount: params.amount,
        success: result.success,
        stepCount: result.steps?.length || 0,
        executionTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      this.telemetry.trackError(error as Error, { context: 'simulate_bridge_and_execute', params });
      throw error;
    }
  }

  /**
   * Track a custom telemetry event
   */
  public trackEvent(eventType: TelemetryEventType, data?: Record<string, unknown>): void {
    this.telemetry.track(eventType, data);
  }

  /**
   * Get the telemetry client for advanced usage
   */
  public getTelemetryClient(): TelemetryClient {
    return this.telemetry;
  }
}
