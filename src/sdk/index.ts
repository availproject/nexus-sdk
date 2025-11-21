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
  AnalyticsConfig,
} from '../commons';
import { logger } from '../commons';
import { CA } from './ca-base';
import { AnalyticsManager } from '../analytics/AnalyticsManager';
import { NexusAnalyticsEvents } from '../analytics/events';
// import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';
import nodePackage from '../../package.json' with { type: 'json' };

export class NexusSDK extends CA {
  public readonly utils: NexusUtils;
  public readonly analytics: AnalyticsManager;

  constructor(config?: { network?: NexusNetwork; debug?: boolean; siweChain?: number; analytics?: AnalyticsConfig }) {
    super(config);
    logger.debug('Nexus SDK initialized with config:', config);
    this.utils = new NexusUtils(this.chainList);

    // Initialize analytics (backwards compatible - enabled by default)
    this.analytics = new AnalyticsManager(
      config?.analytics,
      nodePackage.version, // SDK version from package.json
      config?.network === 'mainnet' ? 'mainnet' : 'testnet'
    );

    // Make analytics available to CA base class for wallet/balance events
    this._analytics = this.analytics;

    // Track SDK initialization
    this.analytics.track(NexusAnalyticsEvents.SDK_INITIALIZED, {
      network: config?.network || 'testnet',
      debug: config?.debug || false,
    });
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
    // Track bridge started
    this.analytics.track(NexusAnalyticsEvents.BRIDGE_INITIATED, {
      toChainId: params.toChainId,
      token: params.token,
      sourceChains: params.sourceChains,
    });

    try {
      const result = await this._createBridgeHandler(params, options).execute();

      // Track bridge completed
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        token: params.token,
        explorerUrl: result.explorerURL,
      });

      return {
        explorerUrl: result.explorerURL ?? '',
      };
    } catch (error) {
      // Track bridge failed
      this.analytics.trackError('bridge', error, {
        toChainId: params.toChainId,
        token: params.token,
      });
      throw error;
    }
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
    // Track transfer started
    this.analytics.track(NexusAnalyticsEvents.TRANSFER_INITIATED, {
      toChainId: params.toChainId,
      token: params.token,
      recipient: params.recipient,
    });

    try {
      const result = await this._bridgeAndTransfer(params, options);

      // Track transfer completed
      this.analytics.track(NexusAnalyticsEvents.TRANSFER_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        token: params.token,
        recipient: params.recipient,
        transactionHash: result.executeTransactionHash,
        explorerUrl: result.executeExplorerUrl,
      });

      return {
        transactionHash: result.executeTransactionHash,
        explorerUrl: result.executeExplorerUrl,
      };
    } catch (error) {
      // Track transfer failed
      this.analytics.trackError('transfer', error, {
        toChainId: params.toChainId,
        token: params.token,
        recipient: params.recipient,
      });
      throw error;
    }
  }

  /**
   * Swap with exact in
   * Useful when trying to swap with fixed sources and destination
   * @param input swap input
   * @param options event parameters
   * @throws NexusError if the swap fails
   * @returns swap result with success flag and result
   */
  public async swapWithExactIn(
    input: ExactInSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    // Track swap started
    this.analytics.track(NexusAnalyticsEvents.SWAP_INITIATED, {
      swapType: 'exactIn',
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
      sourceChains: input.from.map(f => f.chainId),
    });

    try {
      const result = await this._swapWithExactIn(input, options);

      // Track swap completed
      this.analytics.track(NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS, {
        swapType: 'exactIn',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });

      return {
        success: true,
        result,
      };
    } catch (error) {
      // Track swap failed
      this.analytics.trackError('swap', error, {
        swapType: 'exactIn',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });
      throw error;
    }
  }

  /**
   * Swap with exact out
   * Useful when trying to swap with a fixed destination.
   * Sources are calculated automatically.
   * @param input swap input
   * @param options event parameters
   * @throws NexusError if the swap fails
   * @returns swap result with success flag and result
   */
  public async swapWithExactOut(
    input: ExactOutSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    // Track swap started
    this.analytics.track(NexusAnalyticsEvents.SWAP_INITIATED, {
      swapType: 'exactOut',
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
    });

    try {
      const result = await this._swapWithExactOut(input, options);

      // Track swap completed
      this.analytics.track(NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS, {
        swapType: 'exactOut',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });

      return {
        success: true,
        result,
      };
    } catch (error) {
      // Track swap failed
      this.analytics.trackError('swap', error, {
        swapType: 'exactOut',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });
      throw error;
    }
  }

  /**
   * Simulate bridge transaction to get costs and fees
   * @param params bridge parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    try {
      const result = await this._createBridgeHandler(params).simulate();

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        token: params.token,
      });

      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError('bridgeSimulation', error, {
        toChainId: params.toChainId,
        token: params.token,
      });
      throw error;
    }
  }

  /**
   * Simulate bridge + transfer transaction to get costs and fees
   * @param params transfer parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridgeAndTransfer(
    params: TransferParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    try {
      const result = await this._simulateBridgeAndTransfer(params);

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.TRANSFER_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        token: params.token,
        recipient: params.recipient,
      });

      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError('transferSimulation', error, {
        toChainId: params.toChainId,
        token: params.token,
      });
      throw error;
    }
  }

  /**
   * Get user's past intents with pagination
   * @param page page number
   * @returns list of intents
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    return this._getMyIntents(page);
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
    // Track session end before deinitializing
    this.analytics.trackSessionEnd();

    // Track SDK deinitialization
    this.analytics.track(NexusAnalyticsEvents.SDK_DEINITIALIZED, {
      sessionDuration: Date.now() - this.analytics.getSessionId().length, // Approximate
    });

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
    // Track execute started
    this.analytics.track(NexusAnalyticsEvents.EXECUTE_INITIATED, {
      toChainId: params.toChainId,
      contractAddress: params.to,
    });

    try {
      const result = await this._execute(params, options);

      // Track execute completed
      this.analytics.track(NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        contractAddress: params.to,
        transactionHash: result.transactionHash,
        explorerUrl: result.explorerUrl,
      });

      return result;
    } catch (error) {
      // Track execute failed
      this.analytics.trackError('execute', error, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });
      throw error;
    }
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @throws NexusError if the simulate execute fails
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    try {
      const result = await this._simulateExecute(params);

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.EXECUTE_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });

      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError('executeSimulation', error, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });
      throw error;
    }
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
    // Track bridge and execute started
    this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_INITIATED, {
      toChainId: params.toChainId,
      token: params.token,
      contractAddress: params.execute?.to,
    });

    try {
      const result = await this._bridgeAndExecute(params, options);

      // Track bridge and execute completed
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        token: params.token,
        contractAddress: params.execute?.to,
        executeTransactionHash: result.executeTransactionHash,
        bridgeExplorerUrl: result.bridgeExplorerUrl,
      });

      return result;
    } catch (error) {
      // Track bridge and execute failed
      this.analytics.trackError('bridgeAndExecute', error, {
        toChainId: params.toChainId,
        token: params.token,
        contractAddress: params.execute?.to,
      });
      throw error;
    }
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
    try {
      const result = await this._simulateBridgeAndExecute(params);

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        token: params.token,
        contractAddress: params.execute?.to,
      });

      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError('bridgeAndExecuteSimulation', error, {
        toChainId: params.toChainId,
        token: params.token,
        contractAddress: params.execute?.to,
      });
      throw error;
    }
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
