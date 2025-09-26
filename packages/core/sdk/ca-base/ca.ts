import { createCosmosWallet } from '@arcana/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { keyDerivation } from '@starkware-industries/starkware-crypto-utils';
import {
  Account,
  CHAIN_IDS,
  FuelConnector,
  FuelConnectorSendTxParams,
  Provider,
  TransactionRequestLike,
  TransactionResponse,
} from 'fuels';
import {
  createWalletClient,
  custom,
  WalletActions,
  publicActions,
  type PublicActions,
  Client,
  CustomTransport,
} from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { ChainList } from './chains';
import { getNetworkConfig } from './config';
import { FUEL_NETWORK_URL } from './constants';
import { getLogger, LOG_LEVEL, setLogLevel } from './logger';
import { AllowanceQuery, BridgeQuery, TransferQuery } from './query';
import { fixTx } from './requestHandlers/fuel/common';
import { getFuelProvider } from './requestHandlers/fuel/provider';
import { createHandler } from './requestHandlers/router';
import {
  BridgeQueryInput,
  ChainListType,
  EthereumProvider,
  EVMTransaction,
  ExactInSwapInput,
  ExactOutSwapInput,
  NetworkConfig,
  NexusNetwork,
  OnAllowanceHook,
  OnIntentHook,
  RequestArguments,
  SDKConfig,
  SwapInputOptionalParams,
  SwapMode,
  SwapParams,
  SwapSupportedChainsResult,
  TransferQueryInput,
  TxOptions,
} from '@nexus/commons';
import {
  cosmosFeeGrant,
  equalFold,
  fetchMyIntents,
  getSDKConfig,
  getSupportedChains,
  getTxOptions,
  isArcanaWallet,
  isEVMTx,
  minutesToMs,
  refundExpiredIntents,
  switchChain,
} from './utils';
import { swap } from './swap/swap';
import { getBalances } from './swap/route';
import { getSwapSupportedChains } from './swap/utils';

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
  protected _caEvents = new SafeEventEmitter();
  #cosmosWallet?: DirectSecp256k1Wallet;
  #ephemeralWallet?: PrivateKeyAccount;
  public chainList: ChainListType;
  protected _config: Required<SDKConfig>;
  protected _evm?: {
    client: Client<CustomTransport, undefined, undefined, undefined, WalletActions & PublicActions>;
    modProvider: EthereumProvider;
    provider: EthereumProvider;
  };
  protected _fuel?: {
    account: Account;
    address: string;
    connector: FuelConnector;
    modConnector: FuelConnector;
    modProvider: Provider;
    provider: Provider;
  };
  protected _hooks: {
    onAllowance: OnAllowanceHook;
    onIntent: OnIntentHook;
  } = {
    onAllowance: (data) => data.allow(data.sources.map(() => 'max')),
    onIntent: (data) => data.allow(),
  };
  protected _initPromises: (() => void)[] = [];
  protected _initStatus = INIT_STATUS.CREATED;
  protected _isArcanaProvider = false;
  protected _networkConfig: NetworkConfig;
  protected _refundInterval: number | undefined;
  protected constructor(
    config: { network?: NexusNetwork; debug?: boolean } = { debug: false, network: 'testnet' },
  ) {
    this._config = getSDKConfig(config);
    this._networkConfig = getNetworkConfig(this._config.network);
    this.chainList = new ChainList(this._networkConfig.NETWORK_HINT);
    if (this._config.debug) {
      setLogLevel(LOG_LEVEL.DEBUG);
    }
  }

  protected _allowance() {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }

    return new AllowanceQuery(this._evm.client, this._networkConfig, this.chainList);
  }

  protected async _bridge(input: BridgeQueryInput) {
    const bq = new BridgeQuery(
      input,
      this._init,
      this._changeChain.bind(this),
      this._createEVMHandler.bind(this),
      this._createFuelHandler.bind(this),
      await this._getEVMAddress(),
      this.chainList,
      this._fuel?.account,
    );

    await bq.initHandler();
    return { exec: bq.exec, simulate: bq.simulate };
  }

  protected _deinit = () => {
    this.#cosmosWallet = undefined;
    if (this._evm) {
      this._evm.provider.removeListener('accountsChanged', this.onAccountsChanged);
    }
    if (this._refundInterval) {
      clearInterval(this._refundInterval);
      this._refundInterval = undefined;
    }
    this._initStatus = INIT_STATUS.CREATED;
  };

  protected _getEVMProviderWithCA = () => {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }

    return this._evm.modProvider;
  };

  protected async _getFuelWithCA() {
    if (!this._fuel) {
      throw new Error('Fuel connector is not set.');
    }

    return {
      connector: this._fuel.modConnector,
      provider: this._fuel.modProvider,
    };
  }

  protected async _getMyIntents(page = 1) {
    const wallet = await this._getCosmosWallet();
    const address = (await wallet.getAccounts())[0].address;
    return fetchMyIntents(address, this._networkConfig.GRPC_URL, page);
  }

  protected async _getUnifiedBalance(symbol: string) {
    const balances = await this._getUnifiedBalances();

    return balances.find((s) => equalFold(s.symbol, symbol));
  }

  protected async _getUnifiedBalances() {
    if (!this._evm) {
      throw new Error('CA not initialized');
    }
    const { assets } = await getBalances({
      networkHint: this._networkConfig.NETWORK_HINT,
      evmAddress: (await this._evm.client.requestAddresses())[0],
      chainList: this.chainList,
      filter: false,
      vscDomain: this._networkConfig.VSC_DOMAIN,
      fuelAddress: this._fuel?.address,
    });
    return assets;
  }

  protected _isInitialized() {
    return this._initStatus === INIT_STATUS.DONE;
  }

  protected async _swapWithExactIn(input: ExactInSwapInput, options?: SwapInputOptionalParams) {
    return swap(
      {
        mode: SwapMode.EXACT_IN,
        data: input,
      },
      await this.getCommonSwapParams(options),
    );
  }
  protected async _swapWithExactOut(input: ExactOutSwapInput, options?: SwapInputOptionalParams) {
    return swap(
      {
        mode: SwapMode.EXACT_OUT,
        data: input,
      },
      await this.getCommonSwapParams(options),
    );
  }

  private async getCommonSwapParams(options?: SwapInputOptionalParams): Promise<SwapParams> {
    return {
      emit: this._caEvents.emit.bind(this._caEvents),
      chainList: this.chainList,
      address: {
        cosmos: (await this.#cosmosWallet!.getAccounts())[0].address,
        eoa: (await this._evm!.client.getAddresses())[0],
        ephemeral: this.#ephemeralWallet!.address,
      },
      wallet: {
        cosmos: this.#cosmosWallet!,
        ephemeral: this.#ephemeralWallet!,
        eoa: this._evm!.client,
      },
      networkConfig: this._networkConfig,
      ...options,
    };
  }

  protected async _handleEVMTx(args: RequestArguments, options: Partial<TxOptions> = {}) {
    const response = await this._createEVMHandler(
      (args.params as EVMTransaction[])[0],
      getTxOptions(options),
    );

    if (response) {
      await response.handler?.process();
      return response.processTx();
    }
    return;
  }

  protected _init = async () => {
    if (!this._evm) {
      throw new Error('use setEVMProvider before calling init()');
    }
    if (this._initStatus === INIT_STATUS.CREATED) {
      this._initStatus = INIT_STATUS.RUNNING;
      try {
        const address = await this._getEVMAddress();
        this._setProviderHooks();

        if (!this._isArcanaProvider) {
          this.#cosmosWallet = await this._createCosmosWallet();
          this._checkPendingRefunds();
        }

        this._initStatus = INIT_STATUS.DONE;
        this._resolveInitPromises();
        this._caEvents.emit('accountsChanged', [address]);
      } catch (e) {
        this._initStatus = INIT_STATUS.CREATED;
        logger.error('Error initializing CA', e);
        throw new Error('Error initializing CA');
      }
    } else if (this._initStatus === INIT_STATUS.RUNNING) {
      return await this._waitForInit();
    }
  };

  protected onAccountsChanged = (accounts: Array<`0x${string}`>) => {
    this._deinit();
    if (accounts.length !== 0) {
      this._init();
    }
  };

  async _setEVMProvider(provider: EthereumProvider) {
    if (this._evm?.provider === provider) {
      return;
    }

    this._evm = {
      client: createWalletClient({
        transport: custom(provider),
      }).extend(publicActions),
      modProvider: Object.assign({}, provider, {
        request: async (args: RequestArguments): Promise<unknown> => {
          if (args.method === 'eth_sendTransaction') {
            if (!this._isArcanaProvider) {
              return this._handleEVMTx(args);
            }
          }
          return provider.request(args);
        },
      }),
      provider,
    };

    this._isArcanaProvider = isArcanaWallet(provider);
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

    const modProvider = getFuelProvider(
      this._getUnifiedBalances.bind(this),
      address,
      this.chainList.getChainByID(CHAIN_IDS.fuel.mainnet)!,
    );

    const provider = new Provider(FUEL_NETWORK_URL, {
      resourceCacheTTL: -1,
    });

    const clone: FuelConnector = Object.create(connector);
    clone.sendTransaction = async (
      _address: string,
      _transaction: TransactionRequestLike,
      _params?: FuelConnectorSendTxParams,
    ): Promise<string | TransactionResponse> => {
      logger.debug('fuelClone:sendTransaction:1', {
        _address,
        _params,
        _transaction,
      });
      const handlerResponse = await this._createFuelHandler(_transaction, {
        bridge: false,
        gas: 0n,
      });

      if (handlerResponse) {
        await handlerResponse.handler?.process();
      }

      logger.debug('fuelClone:sendTransaction:2', {
        request: Object.assign(
          {
            inputs: [],
          },
          _transaction,
        ),
      });

      const tx = await fixTx(_address, _transaction, provider);

      return connector.sendTransaction(_address, tx, _params);
    };

    this._fuel = {
      account: new Account(address, modProvider, connector),
      address,
      connector: connector,
      modConnector: clone,
      modProvider,
      provider,
    };
  }

  protected _setOnAllowanceHook(hook: OnAllowanceHook) {
    this._hooks.onAllowance = hook;
  }

  protected _setOnIntentHook(hook: OnIntentHook) {
    this._hooks.onIntent = hook;
  }

  protected async _transfer(input: TransferQueryInput) {
    const tq = new TransferQuery(
      input,
      this._init,
      this._changeChain.bind(this),
      this._createEVMHandler.bind(this),
      this._createFuelHandler.bind(this),
      await this._getEVMAddress(),
      this.chainList,
      this._fuel?.account,
    );
    await tq.initHandler();
    return { exec: tq.exec, simulate: tq.simulate };
  }

  protected _changeChain(chainID: number) {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }
    const chain = this.chainList.getChainByID(chainID);
    if (!chain) {
      throw new Error('chain not supported');
    }

    return switchChain(this._evm.client, chain);
  }

  protected async _checkPendingRefunds() {
    await this._init();
    const account = await this._getEVMAddress();
    try {
      await refundExpiredIntents(account, this._networkConfig.COSMOS_URL, this.#cosmosWallet!);

      this._refundInterval = window.setInterval(async () => {
        await refundExpiredIntents(account, this._networkConfig.COSMOS_URL, this.#cosmosWallet!);
      }, minutesToMs(10));
    } catch (e) {
      logger.error('Error checking pending refunds', e);
    }
  }

  protected async _createCosmosWallet() {
    const sig = await this._signatureForLogin();
    const pvtKey = keyDerivation.getPrivateKeyFromEthSignature(sig);

    const cosmosWallet = await createCosmosWallet(`0x${pvtKey.padStart(64, '0')}`);
    this.#ephemeralWallet = privateKeyToAccount(`0x${pvtKey.padStart(64, '0')}`);
    const address = (await cosmosWallet.getAccounts())[0].address;
    await cosmosFeeGrant(this._networkConfig.COSMOS_URL, this._networkConfig.VSC_DOMAIN, address);
    return cosmosWallet;
  }

  protected async _createEVMHandler(tx: EVMTransaction, options: Partial<TxOptions> = {}) {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }

    if (!isEVMTx(tx)) {
      logger.debug('invalid evm tx, returning', { tx });
      return null;
    }

    const opt = getTxOptions(options);

    const chainId = await this._getChainID();
    const chain = this.chainList.getChainByID(chainId);
    if (!chain) {
      logger.info('chain not supported, returning', {
        chainId,
      });
      return null;
    }

    return createHandler({
      chain,
      chainList: this.chainList,
      cosmosWallet: await this._getCosmosWallet(),
      evm: {
        address: await this._getEVMAddress(),
        client: this._evm.client,
        tx,
      },
      fuel: this._fuel,
      hooks: this._hooks,
      options: {
        emit: this._caEvents.emit.bind(this._caEvents),
        networkConfig: this._networkConfig,
        ...opt,
      },
    });
  }

  public getEVMClient() {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }
    return this._evm.client;
  }

  protected async _createFuelHandler(tx: TransactionRequestLike, options: Partial<TxOptions> = {}) {
    const chain = this.chainList.getChainByID(CHAIN_IDS.fuel.mainnet);
    if (!chain) {
      throw new Error(`chain not found: ${CHAIN_IDS.fuel.mainnet}`);
    }

    if (!this._fuel) {
      throw new Error('Fuel provider is not connected');
    }

    const address = await this._fuel.connector.currentAccount();
    if (!address) {
      throw new Error('could not get current account from connector');
    }

    const opt = getTxOptions(options);

    return createHandler({
      chain,
      chainList: this.chainList,
      cosmosWallet: await this._getCosmosWallet(),
      evm: {
        address: await this._getEVMAddress(),
        client: this._evm!.client,
      },
      fuel: {
        address,
        connector: this._fuel.connector,
        provider: this._fuel.provider,
        tx,
      },
      hooks: {
        onAllowance: this._hooks.onAllowance,
        onIntent: this._hooks.onIntent,
      },
      options: {
        emit: this._caEvents.emit.bind(this._caEvents),
        networkConfig: this._networkConfig,
        ...opt,
      },
    });
  }

  protected _getChainID() {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }

    return this._evm.client.getChainId();
  }

  protected async _getCosmosWallet() {
    if (!this.#cosmosWallet) {
      this.#cosmosWallet = await this._createCosmosWallet();
    }
    return this.#cosmosWallet;
  }

  protected async _getEVMAddress() {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }
    return (await this._evm.client.requestAddresses())[0];
  }

  protected _resolveInitPromises() {
    const list = this._initPromises;
    this._initPromises = [];

    for (const r of list) {
      r();
    }
  }

  protected async _setProviderHooks() {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }
    if (this._evm.provider) {
      this._evm.provider.on('accountsChanged', this.onAccountsChanged);
    }
  }

  protected async _signatureForLogin() {
    if (!this._evm) {
      throw new Error('EVM provider is not set');
    }
    const scheme = window.location.protocol.slice(0, -1);
    const domain = window.location.host;
    const origin = window.location.origin;
    const address = await this._getEVMAddress();
    const message = createSiweMessage({
      address,
      chainId: 1,
      domain,
      issuedAt: new Date('2024-12-16T12:17:43.182Z'), // this remains same to arrive at same pvt key
      nonce: 'iLjYWC6s8frYt4l8w', // maybe this can be shortened hash of address
      scheme,
      statement: SIWE_STATEMENT,
      uri: origin,
      version: '1',
    });
    const currentChain = await this._getChainID();
    try {
      await this._evm.client.switchChain({ id: 1 });
      const res = await this._evm.client.signMessage({
        account: address,
        message,
      });
      return res;
    } finally {
      await this._evm.client.switchChain({ id: currentChain });
    }
  }

  protected async _waitForInit(): Promise<void> {
    const promise = new Promise<void>((resolve) => {
      this._initPromises.push(resolve);
    });
    return await promise;
  }

  protected _getSwapSupportedChainsAndTokens(): SwapSupportedChainsResult {
    return getSwapSupportedChains(this.chainList);
  }
}
