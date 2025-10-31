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
  SwapResult,
  SupportedChainsResult,
  ExactInSwapInput,
  SwapInputOptionalParams,
  ExactOutSwapInput,
} from '@nexus/commons';
import { logger } from '@nexus/commons';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { CA } from './ca-base';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';
import {
  trackAllowance,
  trackError,
  trackIntent,
  trackNexusTransaction,
  trackSDKBackendInitialized,
  trackSdkDeInitialized,
  trackSDKInitialized,
} from '../utils/analytics';

export class NexusSDK extends CA {
  private readonly nexusAdapter: ChainAbstractionAdapter;
  public readonly nexusEvents: SafeEventEmitter;
  public readonly utils: NexusUtils;

  constructor(config?: { network?: NexusNetwork; debug?: boolean }) {
    super(config);
    logger.debug('Nexus SDK initialized with config:', config);
    this.nexusAdapter = new ChainAbstractionAdapter(this);
    this.nexusEvents = this._caEvents;
    this.utils = new NexusUtils(this.nexusAdapter, () => this.isInitialized());
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    // Initialize the core adapter first
    this._setEVMProvider(provider);
    await this._init();
    trackSDKInitialized(this._config);
    const BACKEND_URL = 'https://nexus-backend.avail.so';
    if (BACKEND_URL) {
      try {
        const initResult = await initializeSimulationClient(BACKEND_URL);

        if (!initResult.success) {
          trackError(new Error('Backend initialization failed') as Error, {
            function: 'backend_initialization_failed',
          });
          throw new Error('Backend initialization failed');
        }
        trackSDKBackendInitialized(this._config);
      } catch (error) {
        trackError(error as Error, {
          function: 'backend_initialization_failed',
        });
        throw new Error('Backend initialization failed');
      }
    }
  }

  /**
   * Get unified balances across all chains
   */
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[]> {
    return this._getUnifiedBalances(includeSwappableBalances);
  }

  /**
   * Get unified balance for a specific token
   */
  public async getUnifiedBalance(
    symbol: string,
    includeSwappableBalances = false,
  ): Promise<UserAsset | undefined> {
    return this._getUnifiedBalance(symbol, includeSwappableBalances);
  }

  /**
   * Cross chain token transfer
   */
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    try {
      trackNexusTransaction({ name: 'bridge', config: this._config, bridgeParams: params });
      const result = await (await this._bridge(params)).exec();
      trackNexusTransaction({
        name: 'bridge',
        config: this._config,
        bridgeParams: params,
        properties: {
          success: true,
          explorerUrl: result?.explorerURL ?? '',
        },
      });
      return {
        success: true,
        explorerUrl: result?.explorerURL ?? '',
      };
    } catch (e) {
      trackError(e as Error, {
        function: 'bridge_error',
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Cross chain token transfer to EOA
   */
  public async transfer(params: TransferParams): Promise<TransferResult> {
    try {
      trackNexusTransaction({
        name: 'transfer',
        config: this._config,
        transaferParams: params,
      });
      const result = await (await this._transfer({ ...params, to: params.recipient })).exec();
      trackNexusTransaction({
        name: 'transfer',
        config: this._config,
        transaferParams: params,
        properties: {
          success: true,
          transactionHash: result.hash,
          explorerUrl: result.explorerURL,
        },
      });
      return {
        success: true,
        transactionHash: result.hash,
        explorerUrl: result.explorerURL,
      };
    } catch (e) {
      trackError(e as Error, {
        function: 'transfer_error',
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  public async swapWithExactIn(
    input: ExactInSwapInput,
    options?: SwapInputOptionalParams,
  ): Promise<SwapResult> {
    try {
      trackNexusTransaction({
        name: 'swapWithExactIn',
        config: this._config,
        exactInParams: { input, options },
      });
      const result = await this._swapWithExactIn(input, options);
      trackNexusTransaction({
        name: 'swapWithExactIn',
        config: this._config,
        exactInParams: { input, options },
        properties: {
          success: true,
          result,
        },
      });
      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error('Error in swap with exact out', error);
      trackError(error as Error, {
        function: 'swapWithExactIn_error',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async swapWithExactOut(
    input: ExactOutSwapInput,
    options?: SwapInputOptionalParams,
  ): Promise<SwapResult> {
    try {
      trackNexusTransaction({
        name: 'swapWithExactOut',
        config: this._config,
        exactOutParams: { input, options },
      });
      const result = await this._swapWithExactOut(input, options);
      trackNexusTransaction({
        name: 'swapWithExactOut',
        config: this._config,
        exactOutParams: { input, options },
        properties: {
          success: true,
          result,
        },
      });
      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error('Error in swap with exact out', error);
      trackError(error as Error, {
        function: 'swapWithExactOut_error',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get chain abstracted provider allowing use of chain asbtraction
   * @returns EthereumProvider
   */

  public getEVMProviderWithCA(): EthereumProvider {
    return this._getEVMProviderWithCA();
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    trackNexusTransaction({
      name: 'simulateBridge',
      config: this._config,
      simulateBridge: params,
    });
    return (await this._bridge(params)).simulate();
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateTransfer(params: TransferParams): Promise<SimulationResult> {
    trackNexusTransaction({
      name: 'simulateTransfer',
      config: this._config,
      simulateTransfer: params,
    });
    return (await this._transfer({ ...params, to: params.recipient })).simulate();
  }

  /**
   * Get user's intents with pagination
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    return this._getMyIntents(page);
  }

  /**
   * Check allowance for tokens on a specific chain
   */
  public async getAllowance(chainId?: number, tokens?: string[]): Promise<AllowanceResponse[]> {
    trackNexusTransaction({
      name: 'getAllowance',
      config: this._config,
      chainId,
      tokens,
    });
    return this._allowance().get({ chainID: chainId, tokens });
  }

  /**
   * Set allowance for a token on a specific chain
   */
  public async setAllowance(chainId: number, tokens: string[], amount: bigint): Promise<void> {
    trackNexusTransaction({
      name: 'setAllowance',
      config: this._config,
      chainId,
      tokens,
      amount,
    });
    return this._allowance().set({ chainID: chainId, tokens, amount });
  }

  /**
   * Revoke allowance for a token on a specific chain
   */
  public async revokeAllowance(chainId: number, tokens: string[]): Promise<void> {
    trackNexusTransaction({
      name: 'revokeAllowance',
      config: this._config,
      chainId,
      tokens,
    });
    return this._allowance().revoke({ chainID: chainId, tokens });
  }

  /**
   * Set callback for intent status updates
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    const wrappedCallback: OnIntentHook = (data) => {
      trackIntent(data.intent);
      callback(data);
    };

    this._setOnIntentHook(wrappedCallback);
  }

  /**
   * Set callback for allowance approval events
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    const wrappedCallback: OnAllowanceHook = (data) => {
      trackAllowance(data.sources);
      callback(data);
    };

    this._setOnAllowanceHook(wrappedCallback);
  }

  public async deinit(): Promise<void> {
    trackSdkDeInitialized(this._config);
    return this._deinit();
  }

  public async request(args: RequestArguments): Promise<unknown> {
    return this._handleEVMTx(args);
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    trackNexusTransaction({
      name: 'execute',
      config: this._config,
      executeParams: params,
    });
    return this.nexusAdapter.execute(params);
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    trackNexusTransaction({
      name: 'simulateExecute',
      config: this._config,
      simulateExecute: params,
    });
    return this.nexusAdapter.simulateExecute(params);
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    trackNexusTransaction({
      name: 'bridgeAndExecute',
      config: this._config,
      bridgeAndExecuteParams: params,
    });
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
    trackNexusTransaction({
      name: 'simulateBridgeAndExecute',
      config: this._config,
      simulateBridgeAndExecute: params,
    });
    return this.nexusAdapter.simulateBridgeAndExecute(params);
  }

  public getSwapSupportedChainsAndTokens(): SupportedChainsResult {
    return this._getSwapSupportedChainsAndTokens();
  }

  public isInitialized() {
    return this._isInitialized();
  }
}
