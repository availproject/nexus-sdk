// src/core/sdk/index.ts
import { NexusUtils } from './utils';
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
  BridgeMaxResult,
  OnSwapIntentHook,
} from '../commons';
import { logger } from '../commons';
import { CA } from './ca-base';
// import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';

export class NexusSDK extends CA {
  public readonly utils: NexusUtils;

  constructor(config?: { network?: NexusNetwork; debug?: boolean; siweChain?: number }) {
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
  }

  /**
   * @deprecated use `getBalancesForBridge` for direct replacement.
   * @returns unified balances across all chains
   */
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[]> {
    return this._getUnifiedBalances(includeSwappableBalances);
  }

  /**
   * Bridge to destination chain from auto-selected or provided source chains
   */
  public async bridge(params: BridgeParams, options?: OnEventParam): Promise<BridgeResult> {
    const result = await this._createBridgeHandler(params, options).execute();
    return {
      explorerUrl: result.explorerURL ?? '',
    };
  }

  public async calculateMaxForBridge(
    params: Omit<BridgeParams, 'amount'>,
  ): Promise<BridgeMaxResult> {
    return this._calculateMaxForBridge(params);
  }

  /**
   * Bridge & transfer to an address (Attribution)
   */
  public async bridgeAndTransfer(
    params: TransferParams,
    options?: OnEventParam,
  ): Promise<TransferResult> {
    const result = await this._bridgeAndTransfer(params, options);
    return {
      transactionHash: result.executeTransactionHash,
      explorerUrl: result.executeExplorerUrl,
    };
  }

  public async swapWithExactIn(
    input: ExactInSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    const result = await this._swapWithExactIn(input, options);
    return {
      success: true,
      result,
    };
  }

  public async swapWithExactOut(
    input: ExactOutSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    const result = await this._swapWithExactOut(input, options);
    return {
      success: true,
      result,
    };
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    return this._createBridgeHandler(params).simulate();
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateBridgeAndTransfer(
    params: TransferParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    return this._simulateBridgeAndTransfer(params);
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
  public setOnSwapIntentHook(callback: OnSwapIntentHook): void {
    this._setOnSwapIntentHook(callback);
  }

  // public addTron(adapter: AdapterProps) {
  //   this._setTronAdapter(adapter);
  // }

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
  public async execute(params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult> {
    return this._execute(params, options);
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
   * @param params bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(
    params: BridgeAndExecuteParams,
    options?: OnEventParam,
  ): Promise<BridgeAndExecuteResult> {
    return this._bridgeAndExecute(params, options);
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

  /**
   * tokens returned here should be used in `input` for exact in swap
   * @returns balances that can be used in swap operations
   */
  public async getBalancesForSwap() {
    const result = await this._getBalancesForSwap();

    return result.assets;
  }

  /**
   * @returns balances that can be used in bridge operations
   */
  public getBalancesForBridge() {
    return this._getUnifiedBalances(false);
  }

  /**
   * @returns list of chains where swap is supported
   */
  public getSwapSupportedChains(): SupportedChainsResult {
    return this._getSwapSupportedChains();
  }

  public isInitialized() {
    return this._isInitialized();
  }

  /**
   * Helper function to convert an input like "1.13" to 1_130_000n for input to other functions
   * Number of decimals for a token depends on the chain.
   * ex: USDC on BNB chain has 18 decimals and 6 decimals on most other chains.
   */
  public convertTokenReadableAmountToBigInt = this._convertTokenReadableAmountToBigInt;
}
