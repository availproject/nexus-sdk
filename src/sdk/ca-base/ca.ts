import { createCosmosWallet, Universe } from '@avail-project/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import { Account, FuelConnector, Provider } from 'fuels';
import {
  createWalletClient,
  custom,
  WalletActions,
  publicActions,
  type PublicActions,
  Client,
  CustomTransport,
  Hex,
  UserRejectedRequestError,
} from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { ChainList } from './chains';
import { getNetworkConfig } from './config';
import { FUEL_NETWORK_URL } from './constants';
import {
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
} from '../../commons';
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

setLogLevel(LOG_LEVEL.NOLOGS);
const logger = getLogger();

enum INIT_STATUS {
  CREATED,
  RUNNING,
  DONE,
}

const SIWE_STATEMENT = 'Sign in to enable Nexus';

export class CA {
  static getSupportedChains = getSupportedChains;
  #cosmos?: {
    wallet: DirectSecp256k1Wallet;
    address: string;
  };
  #ephemeralWallet?: PrivateKeyAccount;
  public chainList: ChainListType;
  private _siweChain = 1;
  protected _evm?: {
    client: Client<CustomTransport, undefined, undefined, undefined, WalletActions & PublicActions>;
    provider: EthereumProvider;
    address: Hex;
  };
  protected _fuel?: {
    account: Account;
    address: string;
    connector: FuelConnector;
    provider: Provider;
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

    if (config.siweChain) {
      this._siweChain = config.siweChain;
    }

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

    const bridgeHandler = new BridgeHandler(params, {
      chainList: this.chainList,
      cosmos: this.#cosmos!,
      fuel: this._fuel,
      evm: this._evm,
      hooks: this._hooks,
      tron: this._tron,
      networkConfig: this._networkConfig,
      emit: options?.onEvent,
    });

    return bridgeHandler;
  };

  protected async _calculateMaxForBridge(params: Omit<BridgeParams, 'amount' | 'recipient'>) {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }

    return getMaxValueForBridge(params, {
      chainList: this.chainList,
      fuel: this._fuel,
      evm: this._evm,
      tron: this._tron,
      networkConfig: this._networkConfig,
    });
  }

  protected _deinit = () => {
    this.#cosmos = undefined;
    if (this._evm) {
      this._evm.provider.removeListener('accountsChanged', this.onAccountsChanged);
    }

    if (this._refundInterval) {
      clearInterval(this._refundInterval);
      this._refundInterval = undefined;
    }

    this._initStatus = INIT_STATUS.CREATED;
  };

  protected async _getMyIntents(page = 1) {
    const { wallet } = await this._getCosmosWallet();
    const address = (await wallet.getAccounts())[0].address;
    const rffList = await fetchMyIntents(address, this._networkConfig.GRPC_URL, page);
    return intentTransform(rffList, this.chainList);
  }

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
      fuelAddress: this._fuel?.address,
      tronAddress: this._tron?.address,
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

  protected _isInitialized() {
    return this._initStatus === INIT_STATUS.DONE;
  }

  protected async _swapWithExactIn(input: ExactInSwapInput, options?: OnEventParam) {
    return swap(
      {
        mode: SwapMode.EXACT_IN,
        data: input,
      },
      await this.getSwapOptions(options),
    );
  }
  protected async _swapWithExactOut(input: ExactOutSwapInput, options?: OnEventParam) {
    return swap(
      {
        mode: SwapMode.EXACT_OUT,
        data: input,
      },
      await this.getSwapOptions(options),
    );
  }

  private async getSwapOptions(options?: OnEventParam): Promise<SwapParams> {
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
        cosmos: this.#cosmos!.wallet,
        ephemeral: this.#ephemeralWallet!,
        eoa: this._evm!.client,
      },
      networkConfig: this._networkConfig,
      ...options,
    };
  }

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
      throw new Error(`Unexpected init state: ${this._initStatus}`);
    }

    this._initStatus = INIT_STATUS.RUNNING;

    this._initPromise = (async () => {
      try {
        this._setProviderHooks();
        this.#cosmos = await this._createCosmosWallet();
        this._checkPendingRefunds();
        this._initStatus = INIT_STATUS.DONE;
      } catch (e) {
        this._initStatus = INIT_STATUS.CREATED;
        logger.error('Error initializing CA', e);
        throw e;
      }
    })();

    return this._initPromise;
  };

  protected onAccountsChanged = (accounts: Array<`0x${string}`>) => {
    this._deinit();
    if (accounts.length !== 0) {
      if (this._evm) {
        this._evm.address = accounts[0];
      }
      this._init();
    }
  };

  async _setEVMProvider(provider: EthereumProvider) {
    if (this._evm?.provider === provider) {
      return;
    }
    const client = createWalletClient({
      transport: custom(provider),
    }).extend(publicActions);

    const address = (await client.getAddresses())[0];

    this._evm = {
      client,
      provider,
      address,
    };
  }

  public async _setTronAdapter(adapter: TronAdapter) {
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
  }

  protected async _setFuelConnector(connector: FuelConnector) {
    if (this._fuel?.connector === connector) {
      return;
    }

    logger.debug('setFuelConnector', {
      connected: connector.connected,
      connector: connector,
    });

    if (!(await connector.isConnected())) {
      await connector.connect();
    }

    const address = await connector.currentAccount();
    if (!address) {
      throw new Error('could not get current account from connector');
    }

    const provider = new Provider(FUEL_NETWORK_URL, {
      resourceCacheTTL: -1,
    });

    this._fuel = {
      account: new Account(address, provider, connector),
      address,
      connector,
      provider,
    };
  }

  protected _setOnAllowanceHook(hook: OnAllowanceHook) {
    this._hooks.onAllowance = hook;
  }

  protected _setOnIntentHook(hook: OnIntentHook) {
    this._hooks.onIntent = hook;
  }

  protected _setOnSwapIntentHook(hook: OnSwapIntentHook) {
    this._hooks.onSwapIntent = hook;
  }

  protected async _bridgeAndTransfer(input: TransferParams, options?: OnEventParam) {
    const params = createBridgeAndTransferParams(input, this.chainList);
    return this._bridgeAndExecute(params, options);
  }

  protected async _simulateBridgeAndTransfer(input: TransferParams) {
    const params = createBridgeAndTransferParams(input, this.chainList);
    return this._simulateBridgeAndExecute(params);
  }

  protected _changeChain(chainID: number) {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }
    const chain = this.chainList.getChainByID(chainID);
    if (!chain) {
      throw Errors.chainNotFound(chainID);
    }

    return switchChain(this._evm.client, chain);
  }

  protected async _checkPendingRefunds() {
    await this._init();
    const account = await this._getEVMAddress();
    try {
      await refundExpiredIntents(account, this._networkConfig.COSMOS_URL, this.#cosmos!.wallet);

      this._refundInterval = window.setInterval(async () => {
        await refundExpiredIntents(account, this._networkConfig.COSMOS_URL, this.#cosmos!.wallet);
      }, minutesToMs(10));
    } catch (e) {
      logger.error('Error checking pending refunds', e);
    }
  }

  protected async _createCosmosWallet() {
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
    return { wallet, address };
  }

  protected async _getCosmosWallet() {
    if (!this.#cosmos) {
      this.#cosmos = await this._createCosmosWallet();
    }
    return this.#cosmos;
  }

  protected async _getEVMAddress() {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }
    return (await this._evm.client.requestAddresses())[0];
  }

  protected async _setProviderHooks() {
    if (!this._evm) {
      throw Errors.sdkNotInitialized();
    }
    if (this._evm.provider) {
      this._evm.provider.on('accountsChanged', this.onAccountsChanged);
    }
  }

  protected async _signatureForLogin() {
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
  }

  protected _getSwapSupportedChains() {
    return getSwapSupportedChains(this.chainList);
  }

  protected _simulateBridgeAndExecute(params: BridgeAndExecuteParams) {
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
  }

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

  protected async _execute(params: ExecuteParams, options?: OnEventParam) {
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
  }

  protected async _simulateExecute(params: ExecuteParams) {
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
  }

  private universeCheck = (dstChain: Chain) => {
    if (dstChain.universe === Universe.FUEL && !this._fuel) {
      throw Errors.walletNotConnected('Fuel');
    }

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
