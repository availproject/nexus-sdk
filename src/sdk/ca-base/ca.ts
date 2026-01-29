import { Universe } from '@avail-project/ca-common';
import { utils } from 'tronweb';
import { createWalletClient, custom, type Hex, type WalletClient } from 'viem';
import type { AnalyticsManager } from '../../analytics';
import { NexusAnalyticsEvents } from '../../analytics/events';
import { getWalletType } from '../../analytics/utils';
import {
  type BeforeExecuteHook,
  type BridgeAndExecuteParams,
  type BridgeParams,
  type Chain,
  type ChainListType,
  type EthereumProvider,
  type ExecuteParams,
  getLogger,
  LOG_LEVEL,
  type NetworkConfig,
  type NexusNetwork,
  type OnAllowanceHook,
  type OnEventParam,
  type OnIntentHook,
  setLogLevel,
  type TransferParams,
  type TronAdapter,
} from '../../commons';
import {
  type BackendSimulationClient,
  createBackendSimulationClient,
} from '../../integrations/tenderly';
import { ChainList } from './chains';
import { getNetworkConfig } from './config';
import { Errors } from './errors';
import { BridgeAndExecuteQuery } from './query/bridgeAndExecute';
import { createBridgeAndTransferParams } from './query/bridgeAndTransfer';
import BridgeHandler from './requestHandlers/bridge';
import { createBridgeParams } from './requestHandlers/helpers';
import { setLoggerProvider } from './telemetry';
import {
  createMiddlewareClient,
  equalFold,
  getBalancesForBridge,
  getSupportedChains,
  mulDecimals,
  tronHexToEvmAddress,
} from './utils';

const logger = getLogger();

enum INIT_STATUS {
  CREATED = 1,
  RUNNING = 2,
  DONE = 3,
}

export class CA {
  static readonly getSupportedChains = getSupportedChains;
  public chainList: ChainListType;
  protected _evm?: {
    client: WalletClient;
    provider: EthereumProvider;
    address: Hex;
  };
  protected _tron?: {
    address: string;
    adapter: TronAdapter;
  };
  protected middlewareClient: ReturnType<typeof createMiddlewareClient>;
  protected _hooks: {
    onAllowance: OnAllowanceHook;
    onIntent: OnIntentHook;
  } = {
    onAllowance: (data) => data.allow(data.sources.map(() => 'min')),
    onIntent: (data) => data.allow(),
  };
  protected _initStatus = INIT_STATUS.CREATED;
  protected _networkConfig: NetworkConfig;
  protected _refundInterval: number | undefined;
  protected _initPromise: Promise<void> | null = null;
  private readonly simulationClient: BackendSimulationClient;
  protected _analytics?: AnalyticsManager; // Analytics manager set by subclass

  protected constructor(
    config: { network?: NexusNetwork; debug?: boolean; siweChain?: number } = {
      debug: false,
      network: 'testnet',
    }
  ) {
    this._networkConfig = getNetworkConfig(config.network);
    this.chainList = new ChainList(this._networkConfig.NETWORK_HINT);
    this.simulationClient = createBackendSimulationClient({
      baseUrl: 'https://nexus-backend.avail.so',
    });

    this.middlewareClient = createMiddlewareClient(
      this._networkConfig.MIDDLEWARE_HTTP_URL,
      this._networkConfig.MIDDLEWARE_WS_URL
    );

    if (config.debug) {
      setLogLevel(LOG_LEVEL.DEBUG);
    }
  }

  protected _createBridgeHandler = (input: BridgeParams, options?: OnEventParam) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const params = createBridgeParams(input, this.chainList);
    this.universeCheck(params.dstChain);

    return this.withReinit(async () => {
      return new BridgeHandler(params, {
        chainList: this.chainList,
        evm: this._evm!,
        hooks: this._hooks,
        tron: this._tron,
        middlewareClient: this.middlewareClient,
        intentExplorerUrl: this._networkConfig.INTENT_EXPLORER_URL,
        emit: options?.onEvent,
      });
    });
  };

  protected _deinit = () => {
    // Track wallet disconnection before cleanup
    if (this._analytics && this._evm) {
      this._analytics.track(NexusAnalyticsEvents.WALLET_DISCONNECTED, {
        walletType: getWalletType(this._evm.provider),
      });
    }

    if (this._evm?.provider.removeListener) {
      this._evm.provider.removeListener('accountsChanged', this._onAccountsChanged);
    }

    if (this._refundInterval) {
      clearInterval(this._refundInterval);
      this._refundInterval = undefined;
    }

    this._initStatus = INIT_STATUS.CREATED;
  };

  protected _getMyIntents = async () => {
    return this.withReinit(async () => {
      const rffList = await this.middlewareClient.listRFFs({
        address: this._evm!.address,
      });
      return rffList;
    });
  };

  protected _getBalancesForBridge = async () => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return this.withReinit(async () => {
      return getBalancesForBridge({
        evmAddress: this._evm!.address,
        chainList: this.chainList,
        middlewareClient: this.middlewareClient,
      });
    });
  };

  protected _isInitialized = () => {
    return this._initStatus === INIT_STATUS.DONE;
  };

  protected _init = () => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }
    // Return existing promise if initialization already started or done
    if (this._initStatus === INIT_STATUS.RUNNING || this._initStatus === INIT_STATUS.DONE) {
      return this._initPromise!;
    }

    // Prevent concurrent initializations
    if (this._initStatus !== INIT_STATUS.CREATED) {
      throw Errors.sdkInitStateNotExpected(this._initStatus);
    }

    this._initStatus = INIT_STATUS.RUNNING;

    this._initPromise = (async () => {
      try {
        await setLoggerProvider(this._networkConfig);
        this._setProviderHooks();
        this._initStatus = INIT_STATUS.DONE;
      } catch (e) {
        this._initStatus = INIT_STATUS.CREATED;
        logger.error('Error initializing CA', e, { cause: 'SDK_NOT_INITIALIZED' });
        throw e;
      }
    })();

    return this._initPromise;
  };

  protected _onAccountsChanged = (accounts: Array<`0x${string}`>) => {
    const oldAddress = this._evm?.address;

    // Track wallet change
    if (this._analytics && accounts.length !== 0) {
      this._analytics.track(NexusAnalyticsEvents.WALLET_CHANGED, {
        oldAddress: oldAddress || undefined,
        newAddress: accounts[0],
      });
    }

    this._deinit();
    if (accounts.length !== 0) {
      if (this._evm) {
        this._evm.address = accounts[0];
      }
      this._init();
    }
  };

  protected onChainChanged = async (chainId: string) => {
    // Track network change
    if (this._analytics && this._evm) {
      const oldChainId = await this._evm.client.getChainId().catch(() => undefined);
      const newChainId = Number.parseInt(chainId, 16);

      this._analytics.track(NexusAnalyticsEvents.WALLET_NETWORK_CHANGED, {
        oldChainId,
        newChainId,
      });
    }
  };

  async _setEVMProvider(provider: EthereumProvider) {
    if (this._evm?.provider === provider) {
      return;
    }

    try {
      const client = createWalletClient({
        transport: custom({ ...provider, request: provider.request.bind(provider) }),
      });

      const address = (await client.getAddresses())[0];
      const chainId = await client.getChainId();

      this._evm = {
        client,
        provider,
        address,
      };

      // Track successful wallet connection
      if (this._analytics) {
        this._analytics.track(NexusAnalyticsEvents.WALLET_CONNECTED, {
          walletType: getWalletType(provider),
          chainId,
        });
      }
    } catch (error) {
      // Track wallet connection failure
      if (this._analytics) {
        this._analytics.trackError('walletConnect', error, {
          walletType: getWalletType(provider),
        });
      }
      throw error;
    }
  }

  protected _setTronAdapter = async (adapter: TronAdapter) => {
    if (this._tron) {
      logger.debug('Already has tron adapter, so skip', {
        adapter,
        classVal: this._tron,
      });
      return;
    }

    if (!adapter.connected) {
      await adapter.connect();
    }

    logger.debug('setTronAdapter', {
      address: adapter.address,
      classVal: this._tron,
    });

    this._tron = {
      adapter,
      address: tronHexToEvmAddress(utils.address.toHex(adapter.address as string)),
    };
  };

  protected _setOnAllowanceHook = (hook: OnAllowanceHook) => {
    this._hooks.onAllowance = hook;
  };

  protected _setOnIntentHook = (hook: OnIntentHook) => {
    this._hooks.onIntent = hook;
  };

  protected _bridgeAndTransfer = async (input: TransferParams, options?: OnEventParam) => {
    return this.withReinit(() => {
      const params = createBridgeAndTransferParams(input, this.chainList);
      return this._bridgeAndExecute(params, options);
    });
  };

  protected _simulateBridgeAndTransfer = async (input: TransferParams) => {
    return this.withReinit(() => {
      const params = createBridgeAndTransferParams(input, this.chainList);
      return this._simulateBridgeAndExecute(params);
    });
  };

  protected _getEVMAddress = async () => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }
    return (await this._evm.client.requestAddresses())[0];
  };

  protected _setProviderHooks = async () => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }
    if (this._evm.provider?.on) {
      this._evm.provider.on('accountsChanged', this._onAccountsChanged);
    }
  };

  protected _simulateBridgeAndExecute = (params: BridgeAndExecuteParams) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return this.withReinit(() => {
      return new BridgeAndExecuteQuery(
        this.chainList,
        this._evm!.client,
        this._createBridgeHandler,
        this._getBalancesForBridge,
        this.simulationClient
      ).simulateBridgeAndExecute(params);
    });
  };

  protected _bridgeAndExecute = (
    params: BridgeAndExecuteParams,
    options?: OnEventParam & BeforeExecuteHook
  ) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return this.withReinit(() => {
      return new BridgeAndExecuteQuery(
        this.chainList,
        this._evm!.client,
        this._createBridgeHandler,
        this._getBalancesForBridge,
        this.simulationClient
      ).bridgeAndExecute(params, options);
    });
  };

  protected _execute = async (params: ExecuteParams, options?: OnEventParam) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return this.withReinit(() => {
      return new BridgeAndExecuteQuery(
        this.chainList,
        this._evm!.client,
        this._createBridgeHandler,
        this._getBalancesForBridge,
        this.simulationClient
      ).execute(params, options);
    });
  };

  protected _simulateExecute = (params: ExecuteParams) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return this.withReinit(() => {
      return new BridgeAndExecuteQuery(
        this.chainList,
        this._evm!.client,
        this._createBridgeHandler,
        this._getBalancesForBridge,
        this.simulationClient
      ).simulateExecute(params, this._evm!.address);
    });
  };

  protected _triggerAccountChange = async () => {
    await this.reinitOnAccountChange();
  };

  private readonly universeCheck = (dstChain: Chain) => {
    if (dstChain.universe === Universe.TRON && !this._tron) {
      throw Errors.walletNotConnected('Tron');
    }
  };

  private readonly reinitOnAccountChange = async () => {
    if (!this._evm) {
      return;
    }

    const account = (await this._evm.client.getAddresses())[0];
    if (!equalFold(account, this._evm.address)) {
      this._deinit();
      if (this._evm) {
        this._evm.address = account;
      }
    }

    // Init regardless
    await this._init();
  };

  private async withReinit<T>(fn: () => Promise<T>): Promise<T> {
    await this.reinitOnAccountChange();
    return fn();
  }

  protected _convertTokenReadableAmountToBigInt = (
    amount: string,
    tokenSymbol: string,
    chainId: number
  ) => {
    const token = this.chainList.getTokenInfoBySymbol(chainId, tokenSymbol);
    if (!token) {
      throw Errors.tokenNotFound(tokenSymbol, chainId);
    }
    return mulDecimals(amount, token.decimals);
  };
}
