// src/core/sdk/index.ts
import { NexusUtils } from './utils';
import { initializeSimulationClient } from '../integrations/tenderly';
import type {
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
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
  ExactOutSwapInput,
  OnEventParam,
} from '@nexus/commons';
import { logger } from '@nexus/commons';
import { CA } from './ca-base';
import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';

export class NexusSDK extends CA {
  public readonly utils: NexusUtils;

  constructor(config?: { network?: NexusNetwork; debug?: boolean }) {
    super(config);
    logger.debug('Nexus SDK initialized with config:', config);
    this.utils = new NexusUtils(this.chainList);
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    await this._setEVMProvider(provider);
    await this._init();
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
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[]> {
    return this._getUnifiedBalances(includeSwappableBalances);
  }

  /**
   * Bridge to destination chain from auto-selected or provided source chains
   */
  public async bridge(params: BridgeParams): Promise<BridgeResult> {
    try {
      const bridgeHandler = await this.createBridgeHandler(params);
      const result = await bridgeHandler.execute();
      return {
        success: true,
        explorerUrl: result.explorerURL ?? '',
      };
    } catch (e) {
      logger.debug('BridgeError: ', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Bridge & transfer to an address (Attribution)
   */
  public async bridgeAndTransfer(params: TransferParams): Promise<TransferResult> {
    try {
      const result = await this._bridgeAndTransfer({ ...params, to: params.recipient });
      if (result.success) {
        return {
          success: result.success,
          transactionHash: result.executeTransactionHash,
          explorerUrl: result.executeExplorerUrl,
        };
      }

      return result;
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  public async swapWithExactIn(
    input: ExactInSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    try {
      const result = await this._swapWithExactIn(input, options);
      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error('Error in swap with exact out', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async swapWithExactOut(
    input: ExactOutSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    try {
      const result = await this._swapWithExactOut(input, options);
      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error('Error in swap with exact out', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    return (await this.createBridgeHandler(params)).simulate();
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateTransfer(params: TransferParams): Promise<BridgeAndExecuteSimulationResult> {
    return this._simulateBridgeAndTransfer({ ...params, to: params.recipient });
  }

  /**
   * Get user's intents with pagination
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    return this._getMyIntents(page);
  }

  /**
   * Set callback for intent status updates
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this._setOnIntentHook(callback);
  }

  /**
   * Set callback for swap intent details
   */
  public setOnSwapIntentHook(callback: OnIntentHook): void {
    this._setOnIntentHook(callback);
  }

  public addTron(adapter: AdapterProps) {
    this._setTronAdapter(adapter);
  }

  /**
   * Set callback for allowance approval events
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this._setOnAllowanceHook(callback);
  }

  public async deinit(): Promise<void> {
    return this._deinit();
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return this._execute(params);
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    return this._simulateExecute(params);
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    return this.bridgeAndExecute(params);
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
    return this._simulateBridgeAndExecute(params);
  }

  public getSwapSupportedChainsAndTokens(): SupportedChainsResult {
    return this._getSwapSupportedChainsAndTokens();
  }

  public isInitialized() {
    return this._isInitialized();
  }
}
