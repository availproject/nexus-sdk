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
  BeforeExecuteHook,
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
   * @param provider Ethereum provider
   * @throws NexusError if the initialize fails
   * @returns Promise resolving to void
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    await this._setEVMProvider(provider);
    await this._init();
  }

  /**
   * Returns unified balance for tokens across all chains
   * @deprecated use `getBalancesForBridge` for direct replacement.
   * @returns unified balances across all chains
   */
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[]> {
    return this._getUnifiedBalances(includeSwappableBalances);
  }

  /**
   * Bridge to destination chain from auto-selected sources or provided source chains
   * @param params bridge parameters
   * @param options event parameters
   * @throws NexusError if the bridge fails
   * @returns bridge result with explorer URL
   */
  public async bridge(params: BridgeParams, options?: OnEventParam): Promise<BridgeResult> {
    const handler = this._createBridgeHandler(params, options);
    const result = await handler.execute();
    return {
      explorerUrl: result.explorerURL ?? '',
    };
  }

  /**
   * Calculates the maximum amount that can be bridged for a given token and destination chain
   * @param params
   * @returns
   */
  public async calculateMaxForBridge(
    params: Omit<BridgeParams, 'amount'>,
  ): Promise<BridgeMaxResult> {
    return this._calculateMaxForBridge(params);
  }

  /**
   * Bridge & transfer to an address (Attribution)
   * @param params transfer parameters
   * @param options event parameters
   * @throws NexusError if the bridge and transfer fails
   * @returns transfer result with transaction hash and explorer URL
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

  /**
   * Swap with exact in
   * Useful when trying to swap with fixed sources and destination
   * @param input swap input
   * @param options event parameters
   * @throws NexusError if the swap fails
   * @returns swap result with success flag and result
   */
  /**
   * @deprecated V1 swap not available in V2. Use bridge() for cross-chain transfers.
   */
  public async swapWithExactIn(
    _input: ExactInSwapInput,
    _options?: OnEventParam,
  ): Promise<SwapResult> {
    throw new Error('swapWithExactIn: V1 swap not available in V2. Use bridge() for cross-chain transfers.');
  }

  /**
   * @deprecated V1 swap not available in V2. Use bridge() for cross-chain transfers.
   */
  public async swapWithExactOut(
    _input: ExactOutSwapInput,
    _options?: OnEventParam,
  ): Promise<SwapResult> {
    throw new Error('swapWithExactOut: V1 swap not available in V2. Use bridge() for cross-chain transfers.');
  }

  /**
   * Simulate bridge transaction to get costs and fees
   * @param params bridge parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    return this._createBridgeHandler(params).simulate();
  }

  /**
   * Simulate bridge + transfer transaction to get costs and fees
   * @param params transfer parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridgeAndTransfer(
    params: TransferParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    return this._simulateBridgeAndTransfer(params);
  }

  /**
   * Get user's past intents with pagination
   * @param page page number
   * @returns list of intents
   */
  /**
   * @deprecated V1 intents query not available in V2. Use getRffs() from middleware instead.
   */
  public async getMyIntents(_page: number = 1): Promise<RequestForFunds[]> {
    throw new Error('getMyIntents: V1 cosmos intents not available in V2. Use middleware getRffs() API.');
  }

  /**
   * Set callback for intent status updates
   * Useful for capturing intent and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback intent status update callback
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this._setOnIntentHook(callback);
  }

  /**
   * Set callback for swap intent details
   * Useful for capturing swap intent and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback swap intent details callback
   */
  public setOnSwapIntentHook(callback: OnSwapIntentHook): void {
    this._setOnSwapIntentHook(callback);
  }

  // public addTron(adapter: AdapterProps) {
  //   this._setTronAdapter(adapter);
  // }

  /**
   * Set callback for allowance approval events
   * Useful for capturing allowance approval and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback allowance approval event callback
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this._setOnAllowanceHook(callback);
  }

  /**
   * Deinitialize the SDK
   * @returns Promise resolving to void
   */
  public async deinit(): Promise<void> {
    return this._deinit();
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @param options event parameters
   * @throws NexusError if the execute fails
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult> {
    return this._execute(params, options);
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @throws NexusError if the simulate execute fails
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    return this._simulateExecute(params);
  }

  /**
   * Bridge and execute function
   * Starts with an optional bridge transaction if user doesn't have enough funds on the destination chain.
   * Then executes the contract call on the destination chain.
   * @param params bridge and execute parameters
   * @param options event parameters
   * @throws NexusError if the bridge and execute fails
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(
    params: BridgeAndExecuteParams,
    options?: OnEventParam & BeforeExecuteHook,
  ): Promise<BridgeAndExecuteResult> {
    return this._bridgeAndExecute(params, options);
  }

  /**
   * Simulate bridge and execute operation using bridge output amounts for realistic execute cost estimation
   * This method provides more accurate gas estimates by using the actual amount that will be
   * received on the destination chain after bridging (accounting for fees, slippage, etc.)
   * Includes detailed step-by-step breakdown with approval handling.
   * @param params bridge and execute parameters
   * @throws NexusError if the simulate bridge and execute fails
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    return this._simulateBridgeAndExecute(params);
  }

  /**
   * Tokens returned here should be used in `input` for exact in swap
   * @throws NexusError if the get balances for swap fails
   * @returns balances that can be used in swap operations
   */
  public async getBalancesForSwap() {
    const result = await this._getBalancesForSwap();

    return result.assets;
  }

  /**
   * Tokens returned here should be used in bridge, bridgeAndTransfer and bridgeAndExecute operations
   * @throws NexusError if the get balances for bridge fails
   * @returns balances that can be used in bridge operations
   */
  public getBalancesForBridge() {
    return this._getUnifiedBalances(false);
  }

  /**
   * Get list of chains where swap is supported
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
