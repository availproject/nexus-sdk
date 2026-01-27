import { Universe } from '@avail-project/ca-common';
import { createWalletClient, custom, Hex, WalletClient } from 'viem';
import { ChainList } from './chains';
import { getNetworkConfig } from './config';
import {
  ChainListType,
  EthereumProvider,
  NetworkConfig,
  NexusNetwork,
  OnAllowanceHook,
  OnIntentHook,
  BridgeAndExecuteParams,
  ExecuteParams,
  OnEventParam,
  OnSwapIntentHook,
  TronAdapter,
  getLogger,
  LOG_LEVEL,
  setLogLevel,
  Chain,
  TransferParams,
  BridgeParams,
  BeforeExecuteHook,
} from '../../commons';
import { createBridgeParams } from './requestHandlers/helpers';
import {
  getSupportedChains,
  tronHexToEvmAddress,
  getBalances,
  getBalancesForSwap,
  mulDecimals,
  setRpcOverrides,
} from './utils';
import { getSwapSupportedChains } from './swap/utils';
import { utils } from 'tronweb';
import BridgeHandler from './requestHandlers/bridge';
import { BridgeAndExecuteQuery } from './query/bridgeAndExecute';
import {
  BackendSimulationClient,
  createBackendSimulationClient,
} from '../../commons/utils/integrations/tenderly';
import { createBridgeAndTransferParams } from './query/bridgeAndTransfer';
import getMaxValueForBridge from './requestHandlers/bridgeMax';
import { Errors } from './errors';
import { setLoggerProvider } from './telemetry';

setLogLevel(LOG_LEVEL.NOLOGS);
const logger = getLogger();

enum INIT_STATUS {
  CREATED,
  RUNNING,
  DONE,
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
  protected _hooks: {
    onAllowance: OnAllowanceHook;
    onIntent: OnIntentHook;
    onSwapIntent: OnSwapIntentHook;
  } = {
    onAllowance: (data) => data.allow(data.sources.map(() => 'min')),
    onIntent: (data) => data.allow(),
    onSwapIntent: (data) => data.allow(),
  };
  protected _initStatus = INIT_STATUS.CREATED;
  protected _networkConfig: NetworkConfig;
  protected _initPromise: Promise<void> | null = null;
  private readonly simulationClient: BackendSimulationClient;

  protected constructor(
    config: { network?: NexusNetwork; debug?: boolean } = {
      debug: false,
      network: 'testnet',
    },
  ) {
    this._networkConfig = getNetworkConfig(config.network);
    console.log('[NEXUS-SDK] Constructor v2.1 - networkConfig:', JSON.stringify({
      NETWORK_HINT: this._networkConfig.NETWORK_HINT,
      hasRpcOverrides: !!this._networkConfig.rpcOverrides,
      hasVaultOverrides: !!this._networkConfig.vaultOverrides,
      rpcOverrideKeys: this._networkConfig.rpcOverrides ? Object.keys(this._networkConfig.rpcOverrides) : [],
      vaultOverrideKeys: this._networkConfig.vaultOverrides ? Object.keys(this._networkConfig.vaultOverrides) : [],
    }));
    this.chainList = new ChainList(this._networkConfig.NETWORK_HINT);
    this.simulationClient = createBackendSimulationClient({
      baseUrl: 'https://nexus-backend.avail.so',
    });

    if (config.debug) {
      setLogLevel(LOG_LEVEL.DEBUG);
    }

    // Set RPC overrides if provided (for local testing with Anvil/Hardhat forks)
    if (this._networkConfig.rpcOverrides) {
      console.log('[NEXUS-SDK] Setting RPC overrides in constructor:', this._networkConfig.rpcOverrides);
      setRpcOverrides(this._networkConfig.rpcOverrides);
    }

    // Set vault overrides if provided (for local testing with custom vault addresses)
    if (this._networkConfig.vaultOverrides) {
      console.log('[NEXUS-SDK] Setting vault overrides in constructor:', this._networkConfig.vaultOverrides);
      if (typeof this.chainList.setVaultOverrides === 'function') {
        this.chainList.setVaultOverrides(this._networkConfig.vaultOverrides);
      } else {
        console.error('[NEXUS-SDK] chainList.setVaultOverrides is not a function!');
      }
    }
  }

  protected _createBridgeHandler = (input: BridgeParams, options?: OnEventParam) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const params = createBridgeParams(input, this.chainList);
    this.universeCheck(params.dstChain);

    const bridgeHandler = new BridgeHandler(params, {
      chainList: this.chainList,
      evm: this._evm,
      hooks: this._hooks,
      tron: this._tron,
      networkConfig: this._networkConfig,
      emit: options?.onEvent,
    });

    return bridgeHandler;
  };

  protected _calculateMaxForBridge = async (params: Omit<BridgeParams, 'amount' | 'recipient'>) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return getMaxValueForBridge(params, {
      chainList: this.chainList,
      evm: this._evm,
      tron: this._tron,
      networkConfig: this._networkConfig,
    });
  };

  protected _deinit = () => {
    if (this._evm) {
      this._evm.provider.removeListener('accountsChanged', this._onAccountsChanged);
    }

    this._initStatus = INIT_STATUS.CREATED;
  };

  protected _getUnifiedBalances = async (includeSwappableBalances = false) => {
    if (!this._evm || this._initStatus !== INIT_STATUS.DONE) {
      throw Errors.sdkNotInitialized();
    }

    const { assets } = await getBalances({
      networkHint: this._networkConfig.NETWORK_HINT,
      evmAddress: (await this._evm.client.requestAddresses())[0],
      chainList: this.chainList,
      filter: false,
      isCA: includeSwappableBalances === false,
      vscDomain: this._networkConfig.VSC_DOMAIN,
      tronAddress: this._tron?.address,
      useV2Middleware: this._networkConfig.useV2Middleware,
      middlewareUrl: this._networkConfig.MIDDLEWARE_URL,
    });
    return assets;
  };

  protected _getBalancesForSwap = async () => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const balances = await getBalancesForSwap({
      evmAddress: (await this._evm.client.requestAddresses())[0],
      chainList: this.chainList,
    });
    return balances;
  };

  protected _isInitialized = () => {
    return this._initStatus === INIT_STATUS.DONE;
  };

  protected async _init() {
    // V2: No cosmos wallet or SIWE needed
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
        setLoggerProvider(this._networkConfig);
        this._setProviderHooks();
        this._initStatus = INIT_STATUS.DONE;

        logger.debug('_init:complete', {
          evmAddress: this._evm!.address,
        });
      } catch (e) {
        this._initStatus = INIT_STATUS.CREATED;
        logger.error('Error initializing CA', e, { cause: 'SDK_NOT_INITIALIZED' });
        throw e;
      }
    })();

    return this._initPromise;
  }

  protected _onAccountsChanged = (accounts: Array<`0x${string}`>) => {
    this._deinit();
    if (accounts.length !== 0) {
      if (this._evm) {
        this._evm.address = accounts[0];
      }
      this._init();
    }
  };

  protected _setEVMProvider = async (provider: EthereumProvider) => {
    if (this._evm?.provider === provider) {
      return;
    }
    const client = createWalletClient({
      transport: custom({ ...provider, request: provider.request.bind(provider) }),
    });

    const address = (await client.getAddresses())[0];

    this._evm = {
      client,
      provider,
      address,
    };
  };

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

  protected _setOnSwapIntentHook = (hook: OnSwapIntentHook) => {
    this._hooks.onSwapIntent = hook;
  };

  protected _bridgeAndTransfer = async (input: TransferParams, options?: OnEventParam) => {
    const params = createBridgeAndTransferParams(input, this.chainList);
    return this._bridgeAndExecute(params, options);
  };

  protected _simulateBridgeAndTransfer = async (input: TransferParams) => {
    const params = createBridgeAndTransferParams(input, this.chainList);
    return this._simulateBridgeAndExecute(params);
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
    if (this._evm.provider) {
      this._evm.provider.on('accountsChanged', this._onAccountsChanged);
    }
  };

  protected _getSwapSupportedChains = () => {
    return getSwapSupportedChains(this.chainList);
  };

  protected _simulateBridgeAndExecute = (params: BridgeAndExecuteParams) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const handler = new BridgeAndExecuteQuery(
      this.chainList,
      this._evm.client,
      this._createBridgeHandler,
      this._getUnifiedBalances,
      this.simulationClient,
    );

    return handler.simulateBridgeAndExecute(params);
  };

  protected _bridgeAndExecute = (
    params: BridgeAndExecuteParams,
    options?: OnEventParam & BeforeExecuteHook,
  ) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const handler = new BridgeAndExecuteQuery(
      this.chainList,
      this._evm.client,
      this._createBridgeHandler,
      this._getUnifiedBalances,
      this.simulationClient,
    );

    return handler.bridgeAndExecute(params, options);
  };

  protected _execute = async (params: ExecuteParams, options?: OnEventParam) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const handler = new BridgeAndExecuteQuery(
      this.chainList,
      this._evm.client,
      this._createBridgeHandler,
      this._getUnifiedBalances,
      this.simulationClient,
    );

    return handler.execute(params, options);
  };

  protected _simulateExecute = (params: ExecuteParams) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const handler = new BridgeAndExecuteQuery(
      this.chainList,
      this._evm.client,
      this._createBridgeHandler,
      this._getUnifiedBalances,
      this.simulationClient,
    );

    return handler.simulateExecute(params, this._evm.address);
  };

  private readonly universeCheck = (dstChain: Chain) => {
    if (dstChain.universe === Universe.TRON && !this._tron) {
      throw Errors.walletNotConnected('Tron');
    }
  };

  protected _convertTokenReadableAmountToBigInt = (
    amount: string,
    tokenSymbol: string,
    chainId: number,
  ) => {
    const token = this.chainList.getTokenInfoBySymbol(chainId, tokenSymbol);
    if (!token) {
      throw Errors.tokenNotFound(tokenSymbol, chainId);
    }
    return mulDecimals(amount, token.decimals);
  };
}
