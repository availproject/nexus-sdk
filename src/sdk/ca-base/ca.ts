import {
  createCosmosClient,
  createCosmosWallet,
  Environment,
  Universe,
} from '@avail-project/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import { createWalletClient, custom, Hex, UserRejectedRequestError, WalletClient } from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { ChainList } from './chains';
import { getNetworkConfig } from './config';
import { NexusAnalyticsEvents } from '../../analytics/events';
import { getWalletType, extractBreakdownStats } from '../../analytics/utils';
import {
  ChainListType,
  EthereumProvider,
  ExactInSwapInput,
  ExactOutSwapInput,
  NetworkConfig,
  NexusNetwork,
  OnAllowanceHook,
  OnIntentHook,
  SwapMode,
  SwapParams,
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
  CosmosOptions,
  SUPPORTED_CHAINS,
} from '../../commons';
import { AnalyticsManager } from '../../analytics';
import { createBridgeParams } from './requestHandlers/helpers';
import {
  cosmosFeeGrant,
  fetchMyIntents,
  getSupportedChains,
  minutesToMs,
  refundExpiredIntents,
  tronHexToEvmAddress,
  getBalances,
  retrieveSIWESignatureFromLocalStorage,
  storeSIWESignatureToLocalStorage,
  getBalancesForSwap,
  switchChain,
  intentTransform,
  mulDecimals,
  getCosmosURL,
} from './utils';
import { swap } from './swap/swap';
import { getSwapSupportedChains } from './swap/utils';
import { utils } from 'tronweb';
import BridgeHandler from './requestHandlers/bridge';
import { BridgeAndExecuteQuery } from './query/bridgeAndExecute';
import {
  BackendSimulationClient,
  createBackendSimulationClient,
} from '../../integrations/tenderly';
import { createBridgeAndTransferParams } from './query/bridgeAndTransfer';
import getMaxValueForBridge from './requestHandlers/bridgeMax';
import { Errors } from './errors';
import { setLoggerProvider } from './telemetry';
import Decimal from 'decimal.js';

setLogLevel(LOG_LEVEL.NOLOGS);
const logger = getLogger();

enum INIT_STATUS {
  CREATED,
  RUNNING,
  DONE,
}

const SIWE_STATEMENT = 'Sign in to enable Nexus';

export class CA {
  static readonly getSupportedChains = getSupportedChains;
  #cosmos?: CosmosOptions & {
    wallet: DirectSecp256k1Wallet;
  };
  #ephemeralWallet?: PrivateKeyAccount;
  public chainList: ChainListType;
  private readonly _siweChain;
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
  protected _refundInterval: number | undefined;
  protected _initPromise: Promise<void> | null = null;
  private simulationClient: BackendSimulationClient;
  protected _analytics?: AnalyticsManager; // Analytics manager set by subclass
  private _balancesFetched = false; // Track if balances have been fetched for BALANCES_REFRESHED event

  protected constructor(
    config: { network?: NexusNetwork; debug?: boolean; siweChain?: number } = {
      debug: false,
      network: 'testnet',
      siweChain: 1,
    },
  ) {
    this._networkConfig = getNetworkConfig(config.network);
    this.chainList = new ChainList(this._networkConfig.NETWORK_HINT);
    this.simulationClient = createBackendSimulationClient({
      baseUrl: 'https://nexus-backend.avail.so',
    });

    this._siweChain =
      config?.siweChain ?? this._networkConfig.NETWORK_HINT === Environment.FOLLY
        ? SUPPORTED_CHAINS.SEPOLIA
        : SUPPORTED_CHAINS.ETHEREUM;

    if (config.debug) {
      setLogLevel(LOG_LEVEL.DEBUG);
    }
  }

  private getBalanceBucket(totalBalance: string) {
    const balance = Number(totalBalance);
    if (balance < 10) {
      return '$0-$10';
    }
    if (balance < 100) {
      return '$10-$100';
    }
    if (balance < 1000) {
      return '$100-$1K';
    }
    if (balance < 10_000) {
      return '$1K-$10K';
    }
    if (balance < 100_000) {
      return '$10K-$100K';
    }
    return '$100K+';
  }

  protected _createBridgeHandler = (input: BridgeParams, options?: OnEventParam) => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const params = createBridgeParams(input, this.chainList);
    this.universeCheck(params.dstChain);

    const bridgeHandler = new BridgeHandler(params, {
      chainList: this.chainList,
      cosmos: this.#cosmos!,
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
    // Track wallet disconnection before cleanup
    if (this._analytics && this._evm) {
      this._analytics.track(NexusAnalyticsEvents.WALLET_DISCONNECTED, {
        walletType: getWalletType(this._evm.provider),
      });
    }

    this.#cosmos = undefined;

    if (this._evm) {
      this._evm.provider.removeListener('accountsChanged', this._onAccountsChanged);
    }

    if (this._refundInterval) {
      clearInterval(this._refundInterval);
      this._refundInterval = undefined;
    }

    this._initStatus = INIT_STATUS.CREATED;
  };

  protected _getMyIntents = async (page = 1) => {
    const { wallet } = await this._getCosmosWallet();
    const address = (await wallet.getAccounts())[0].address;
    const rffList = await fetchMyIntents(address, this._networkConfig.GRPC_URL, page);
    return intentTransform(rffList, this._networkConfig.EXPLORER_URL, this.chainList);
  };

  protected _getUnifiedBalances = async (includeSwappableBalances = false) => {
    if (!this._evm || this._initStatus !== INIT_STATUS.DONE) {
      throw Errors.sdkNotInitialized();
    }

    // Track if this is a refresh (subsequent call) or initial fetch
    const isRefresh = this._balancesFetched || false;

    try {
      // Track balance fetch started
      if (this._analytics) {
        this._analytics.track(NexusAnalyticsEvents.BALANCES_FETCH_STARTED, {
          includeSwappableBalances,
          isRefresh,
        });
      }

      const { assets } = await getBalances({
        networkHint: this._networkConfig.NETWORK_HINT,
        evmAddress: (await this._evm.client.requestAddresses())[0],
        chainList: this.chainList,
        filter: false,
        isCA: includeSwappableBalances === false,
        vscDomain: this._networkConfig.VSC_DOMAIN,
        tronAddress: this._tron?.address,
      });

      // Extract balance statistics for analytics
      const stats = extractBreakdownStats(assets);

      // Track success
      if (this._analytics) {
        const balanceBucket = this.getBalanceBucket(assets.reduce((agg, asset) => agg.add(asset.balanceInFiat), new Decimal(0)).toFixed())
        if (isRefresh) {
          this._analytics.track(NexusAnalyticsEvents.BALANCES_REFRESHED, {
            ...stats,
            includeSwappableBalances,
            balanceBucket,
          });
        } else {
          this._analytics.track(NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS, {
            ...stats,
            includeSwappableBalances,
            balanceBucket,
          });
        }
      }

      // Mark that balances have been fetched at least once
      this._balancesFetched = true;

      return assets;
    } catch (error) {
      // Track failure
      if (this._analytics) {
        this._analytics.trackError('balanceFetch', error, {
          includeSwappableBalances,
          isRefresh,
        });
      }
      throw error;
    }
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

  protected _swapWithExactIn = async (input: ExactInSwapInput, options?: OnEventParam) => {
    return swap(
      {
        mode: SwapMode.EXACT_IN,
        data: input,
      },
      await this._getSwapOptions(options),
    );
  };

  protected _swapWithExactOut = async (input: ExactOutSwapInput, options?: OnEventParam) => {
    return swap(
      {
        mode: SwapMode.EXACT_OUT,
        data: input,
      },
      await this._getSwapOptions(options),
    );
  };

  private _getSwapOptions = async (options?: OnEventParam): Promise<SwapParams> => {
    return {
      onSwapIntent: this._hooks.onSwapIntent,
      onEvent: options?.onEvent,
      chainList: this.chainList,
      address: {
        cosmos: this.#cosmos!.address,
        eoa: (await this._evm!.client.getAddresses())[0],
        ephemeral: this.#ephemeralWallet!.address,
      },
      wallet: {
        cosmos: this.#cosmos!.client,
        ephemeral: this.#ephemeralWallet!,
        eoa: this._evm!.client,
      },
      networkConfig: this._networkConfig,
      ...options,
    };
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
        setLoggerProvider(this._networkConfig);
        this._setProviderHooks();
        this.#cosmos = await this._createCosmosWallet();
        this._checkPendingRefunds();
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
      const newChainId = parseInt(chainId, 16);

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

  protected _checkPendingRefunds = async () => {
    await this._init();
    const evmAddress = await this._getEVMAddress();
    try {
      await refundExpiredIntents({
        evmAddress,
        address: this.#cosmos!.address,
        client: this.#cosmos!.client,
        analytics: this._analytics,
      });

      this._refundInterval = window.setInterval(async () => {
        await refundExpiredIntents({
          evmAddress,
          address: this.#cosmos!.address,
          client: this.#cosmos!.client,
          analytics: this._analytics,
        });
      }, minutesToMs(10));
    } catch (e) {
      logger.error('Error checking pending refunds', e, { cause: 'REFUND_CHECK_ERROR' });
    }
  };

  protected _createCosmosWallet = async () => {
    let sig = retrieveSIWESignatureFromLocalStorage(this._evm!.address, this._siweChain);
    if (!sig) {
      sig = await this._signatureForLogin();
      storeSIWESignatureToLocalStorage(this._evm!.address, this._siweChain, sig);
    }

    const pvtKey = keyDerivation.getPrivateKeyFromEthSignature(sig);
    const wallet = await createCosmosWallet(`0x${pvtKey.padStart(64, '0')}`);

    this.#ephemeralWallet = privateKeyToAccount(`0x${pvtKey.padStart(64, '0')}`);

    const address = (await wallet.getAccounts())[0].address;
    await cosmosFeeGrant(this._networkConfig.COSMOS_URL, this._networkConfig.VSC_DOMAIN, address);

    const client = await createCosmosClient(
      wallet,
      getCosmosURL(this._networkConfig.COSMOS_URL, 'rpc'),
      { broadcastPollIntervalMs: 250 },
    );

    return { wallet, address, client };
  };

  protected _getCosmosWallet = async () => {
    if (!this.#cosmos) {
      this.#cosmos = await this._createCosmosWallet();
    }
    return this.#cosmos;
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

  protected _signatureForLogin = async () => {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    const chain = this.chainList.getChainByID(this._siweChain);
    if (!chain) {
      throw Errors.chainNotFound(this._siweChain);
    }

    const scheme = window.location.protocol.slice(0, -1);
    const domain = window.location.host;
    const origin = window.location.origin;
    const address = await this._getEVMAddress();
    const message = createSiweMessage({
      address,
      chainId: chain.id,
      domain,
      issuedAt: new Date('2024-12-16T12:17:43.182Z'), // this remains same to arrive at same pvt key
      nonce: 'iLjYWC6s8frYt4l8w', // maybe this can be shortened hash of address
      scheme,
      statement: SIWE_STATEMENT,
      uri: origin,
      version: '1',
    });
    const currentChain = await this._evm.client.getChainId();
    try {
      await switchChain(this._evm.client, chain);
      const res = await this._evm.client
        .signMessage({
          account: address,
          message,
        })
        .catch((e) => {
          if (e instanceof UserRejectedRequestError) {
            throw Errors.userRejectedSIWESignature();
          }
          throw e;
        });
      return res;
    } finally {
      await this._evm.client.switchChain({ id: currentChain });
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
