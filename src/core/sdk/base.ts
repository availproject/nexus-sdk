import { createWalletClient, custom, type Hex, type WalletClient } from 'viem';
import type { AnalyticsManager } from '../../analytics/AnalyticsManager';
import type { DevTimingConfig } from '../../analytics/types';
import { getWalletType } from '../../analytics/utils';
import type {
  BridgeAndExecuteParams,
  BridgeParams,
  ChainListType,
  EthereumProvider,
  ExecuteParams,
  ListIntentsParams,
  NexusNetwork,
  OnEventParam,
  TransferParams,
} from '../../domain';
import { LOG_LEVEL, setLogLevel, ZERO_ADDRESS } from '../../domain';
import { Errors, formatUnknownError } from '../../domain/errors';
import {
  execute as flowExecute,
  simulateExecute as flowSimulateExecute,
} from '../../flows/execute';
import {
  createIntentCatalog,
  type IntentCatalog,
  intentNetworkEnabled,
  mergeSupportedChains,
} from '../../intent/catalog';
import { calculateIntentFunding } from '../../intent/funding';
import { runIntent } from '../../intent/orchestrator';
import type {
  BridgeAndExecuteIntentResult,
  IntentBalance,
  IntentChain,
  IntentHistoryResult,
  IntentQuote,
  IntentQuoteRequest,
  IntentResult,
  IntentSource,
  IntentTokenCatalogEntry,
  SwapAndExecuteIntentResult,
} from '../../intent/types';
import { createIntentWallet } from '../../intent/wallet';
import { mulDecimals } from '../../services/math';
import { getNetworkConfig } from '../../services/network-config';
import { setLoggerProvider } from '../../services/telemetry';
import type { SwapAndExecuteParams, SwapExactInParams, SwapExactOutParams } from '../../swap/types';
import type { MiddlewareClient } from '../../transport';
import { createMiddlewareClient } from '../../transport';
import type {
  BridgeAndExecuteOptions,
  BridgeOperationOptions,
  SwapAndExecuteOptions,
  SwapOperationOptions,
} from '../types';
import { trackWalletConnect } from './operation-boundary';

const DEFAULT_INTENTS_PAGE_SIZE = 20;
const DEFAULT_SLIPPAGE_BPS = 50;

type BaseState = {
  chainList: ChainListType | null;
  intentCatalog: IntentCatalog | null;
  middlewareClient: MiddlewareClient;
  evm?: { client: WalletClient; provider: EthereumProvider; address: Hex };
  analytics?: AnalyticsManager;
  networkConfig: ReturnType<typeof getNetworkConfig>;
};

const chainRef = (chainId: number) => `EVM_${chainId}`;
const positiveAmount = (amount: bigint, label: string) => {
  if (amount <= 0n) throw Errors.invalidInput(`${label} must be greater than zero`);
};
const nonNegativeAmount = (amount: bigint | undefined, label: string) => {
  if (amount !== undefined && amount < 0n) {
    throw Errors.invalidInput(`${label} must be greater than or equal to zero`);
  }
};

export const createBase = (config?: {
  network?: NexusNetwork;
  debug?: boolean;
  devTiming?: DevTimingConfig;
  forceMayan?: boolean;
  internal?: { middlewareClient?: MiddlewareClient };
}) => {
  const networkConfig = getNetworkConfig(config?.network);
  const state: BaseState = {
    chainList: null,
    intentCatalog: null,
    middlewareClient:
      config?.internal?.middlewareClient ??
      createMiddlewareClient(networkConfig.MIDDLEWARE_HTTP_URL),
    networkConfig,
  };
  let walletQueue: Promise<unknown> = Promise.resolve();

  if (config?.debug) setLogLevel(LOG_LEVEL.DEBUG);

  const setAnalytics = (analytics?: AnalyticsManager) => {
    state.analytics = analytics;
    state.middlewareClient.configureTiming({
      timing: analytics?.scopedTimingHooks(),
      captureNetworkTiming:
        analytics?.isDevTimingEnabled() === true &&
        config?.devTiming?.captureNetworkTiming !== false,
    });
  };

  const setChainList = (chainList: ChainListType) => {
    state.chainList = chainList;
  };
  const setIntentCatalog = (chains: IntentChain[], tokens: IntentTokenCatalogEntry[]) => {
    state.intentCatalog = createIntentCatalog(chains, tokens);
  };
  const getChainList = () => {
    if (!state.chainList) throw Errors.sdkNotInitialized();
    return state.chainList;
  };
  const getIntentCatalog = () => {
    if (!intentNetworkEnabled(networkConfig.NETWORK_HINT)) {
      throw Errors.environmentNotSupported(networkConfig.NETWORK_HINT);
    }
    if (!state.intentCatalog) throw Errors.sdkNotInitialized();
    return state.intentCatalog;
  };
  const getEvm = () => {
    if (!state.evm) throw Errors.walletNotConnected('evm');
    return state.evm;
  };

  const setEvmProvider = async (provider: EthereumProvider) => {
    if (state.evm?.provider === provider) return;
    await setLoggerProvider(networkConfig);
    const connect = async () => {
      const client = createWalletClient({
        transport: custom({ ...provider, request: provider.request.bind(provider) }),
      });
      try {
        const address = (await client.getAddresses())[0];
        if (!address) throw new Error('wallet returned no account');
        const chainId = await client.getChainId();
        state.evm = { client, provider, address };
        return { address, chainId };
      } catch (error) {
        throw Errors.execution(
          `Failed to initialize wallet provider: ${formatUnknownError(error)}`,
          {
            service: 'wallet',
            operation: 'setEVMProvider',
            details: { walletType: getWalletType(provider) },
          }
        );
      }
    };

    const connected = state.analytics
      ? await trackWalletConnect(state.analytics, provider, connect)
      : await connect();
    state.analytics?.alias(connected.address);
    state.analytics?.identify(connected.address, {
      walletType: getWalletType(provider),
      chainId: connected.chainId,
    });
  };

  const withWallet = <T>(run: () => Promise<T>): Promise<T> => {
    const next = walletQueue.then(run, run);
    walletQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const intentRuntime = () => {
    const evm = getEvm();
    const wallet = createIntentWallet({
      address: evm.address,
      provider: evm.provider,
      walletClient: evm.client as never,
      chainList: getChainList(),
    });
    return {
      explorerUrl: networkConfig.INTENT_EXPLORER_URL,
      approve: (...args: Parameters<typeof wallet.approve>) =>
        withWallet(() => wallet.approve(...args)),
      sign: (...args: Parameters<typeof wallet.sign>) => withWallet(() => wallet.sign(...args)),
      sendNative: (...args: Parameters<typeof wallet.sendNative>) =>
        withWallet(() => wallet.sendNative(...args)),
      submit: state.middlewareClient.submitIntent,
      getStatus: state.middlewareClient.getIntentStatus,
    };
  };

  const slippageBps = (options?: BridgeOperationOptions | SwapOperationOptions) => {
    const value = options?.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    if (value !== 'auto' && (!Number.isInteger(value) || value < 0 || value > 10_000)) {
      throw Errors.invalidInput('slippageBps must be an integer from 0 to 10000, or auto');
    }
    return value;
  };

  const preferredProviders = () => (config?.forceMayan ? ['mayan' as const] : undefined);

  const balanceOptions = (refresh = false) => ({
    refresh,
    ...(preferredProviders() ? { providers: preferredProviders() } : {}),
  });

  const bridgeRequest = (
    input: BridgeParams,
    options?: BridgeOperationOptions,
    refreshedSources?: IntentSource[]
  ): IntentQuoteRequest => {
    positiveAmount(input.toAmountRaw, 'toAmountRaw');
    nonNegativeAmount(input.toNativeAmountRaw, 'toNativeAmountRaw');
    const catalog = getIntentCatalog();
    const destinationToken = catalog.getTokenBySymbol(input.toChainId, input.toTokenSymbol);
    const selectedSourceChains = refreshedSources
      ? refreshedSources.map((source) => source.chainId)
      : input.sources;
    const sources = catalog.bridgeSources(
      input.toChainId,
      destinationToken.address,
      selectedSourceChains
    );
    if (sources.length === 0) {
      throw Errors.invalidInput('bridge requires at least one source chain');
    }
    return {
      sender: getEvm().address.toLowerCase() as Hex,
      ...(input.recipient ? { recipient: input.recipient } : {}),
      tradeType: 'exactOutput',
      output: {
        chainId: chainRef(input.toChainId),
        token: destinationToken.address,
        amount: input.toAmountRaw.toString(),
      },
      sources,
      ...(preferredProviders() ? { preferredProviders: preferredProviders() } : {}),
      slippageBps: slippageBps(options),
      ...(input.toNativeAmountRaw && input.toNativeAmountRaw > 0n
        ? { gasDrop: { amount: input.toNativeAmountRaw.toString() } }
        : {}),
    };
  };

  const exactOutRequest = (
    input: SwapExactOutParams,
    options?: SwapOperationOptions,
    refreshedSources?: IntentSource[]
  ): IntentQuoteRequest => {
    positiveAmount(input.toAmountRaw, 'toAmountRaw');
    nonNegativeAmount(input.toNativeAmountRaw, 'toNativeAmountRaw');
    const catalog = getIntentCatalog();
    const destinationToken = catalog.getToken(input.toChainId, input.toTokenAddress);
    const selected = refreshedSources ?? input.sources;
    return {
      sender: getEvm().address.toLowerCase() as Hex,
      tradeType: 'exactOutput',
      output: {
        chainId: chainRef(input.toChainId),
        token: destinationToken.address,
        amount: input.toAmountRaw.toString(),
      },
      ...(selected?.length
        ? {
            sources: selected.map((source) => ({
              chainId: chainRef(source.chainId),
              tokens: source.tokenAddress ? [source.tokenAddress] : undefined,
            })),
          }
        : {}),
      ...(preferredProviders() ? { preferredProviders: preferredProviders() } : {}),
      slippageBps: slippageBps(options),
      ...(input.toNativeAmountRaw && input.toNativeAmountRaw > 0n
        ? { gasDrop: { amount: input.toNativeAmountRaw.toString() } }
        : {}),
    };
  };

  const exactInRequest = (
    input: SwapExactInParams,
    options?: SwapOperationOptions,
    refreshedSources?: IntentSource[]
  ): IntentQuoteRequest => {
    const catalog = getIntentCatalog();
    catalog.getToken(input.toChainId, input.toTokenAddress);
    const selected = refreshedSources ?? input.sources;
    if (!selected?.length) throw Errors.invalidInput('exact-input swap requires sources');
    const sources = selected.map((source) => {
      if (source.amountRaw === undefined) {
        throw Errors.invalidInput('exact-input swap requires amountRaw on every source');
      }
      positiveAmount(source.amountRaw, 'source amountRaw');
      if (!source.tokenAddress) {
        throw Errors.invalidInput('exact-input swap requires tokenAddress on every source');
      }
      catalog.getToken(source.chainId, source.tokenAddress);
      return {
        chainId: chainRef(source.chainId),
        token: source.tokenAddress,
        amount: source.amountRaw.toString(),
      };
    });
    return {
      sender: getEvm().address.toLowerCase() as Hex,
      tradeType: 'exactInput',
      input: sources,
      output: { chainId: chainRef(input.toChainId), token: input.toTokenAddress },
      ...(preferredProviders() ? { preferredProviders: preferredProviders() } : {}),
      slippageBps: slippageBps(options),
    };
  };

  const executeIntent = (
    request: (sources?: IntentSource[]) => IntentQuoteRequest,
    options?: BridgeOperationOptions | SwapOperationOptions,
    allowanceHook = false
  ): Promise<IntentResult> =>
    runIntent(
      {
        requestQuote: () => state.middlewareClient.getIntentQuote(request()),
        refreshQuote: (sources) => state.middlewareClient.getIntentQuote(request(sources)),
        onIntent: options?.hooks?.onIntent,
        onAllowance:
          allowanceHook && options && 'hooks' in options
            ? (options.hooks as BridgeOperationOptions['hooks'])?.onAllowance
            : undefined,
        onEvent: options?.onEvent,
        pollingIntervalMs: options?.pollingIntervalMs,
        timeoutMs: (options?.fillTimeoutMinutes ?? 2) * 60_000,
      },
      intentRuntime()
    );

  const quoteIntent = async (request: IntentQuoteRequest): Promise<IntentQuote> =>
    (await state.middlewareClient.getIntentQuote(request)).quote;

  const executeBridge = (input: BridgeParams, options?: BridgeOperationOptions) =>
    executeIntent((sources) => bridgeRequest(input, options, sources), options, true);

  const simulateBridge = (input: BridgeParams, options?: BridgeOperationOptions) =>
    quoteIntent(bridgeRequest(input, options));

  const bridgeAndTransfer = (input: TransferParams, options?: BridgeOperationOptions) =>
    executeBridge({ ...input, recipient: input.recipient }, options);

  const simulateBridgeAndTransfer = (input: TransferParams, options?: BridgeOperationOptions) =>
    simulateBridge({ ...input, recipient: input.recipient }, options);

  const swapWithExactIn = (input: SwapExactInParams, options?: SwapOperationOptions) =>
    executeIntent((sources) => exactInRequest(input, options, sources), options);

  const swapWithExactOut = (input: SwapExactOutParams, options?: SwapOperationOptions) =>
    executeIntent((sources) => exactOutRequest(input, options, sources), options);

  const getIntentBalances = async (): Promise<IntentBalance[]> =>
    state.middlewareClient
      .getIntentBalances(getEvm().address, balanceOptions())
      .then((result) => result.balances);

  const execute = (params: ExecuteParams, _options?: OnEventParam, parentSpanId?: string) =>
    flowExecute(params, {
      chainList: getChainList(),
      evm: { walletClient: getEvm().client, address: getEvm().address },
      timing: state.analytics?.scopedTimingHooks(parentSpanId),
    });

  const simulateExecute = (params: ExecuteParams) =>
    flowSimulateExecute(params, {
      chainList: getChainList(),
      evm: { walletClient: getEvm().client, address: getEvm().address },
      timing: state.analytics?.scopedTimingHooks(),
    });

  const swapExecuteParams = (input: SwapAndExecuteParams): ExecuteParams => ({
    ...input.execute,
    toChainId: input.toChainId,
    tokenApproval: input.execute.tokenApproval
      ? {
          toTokenSymbol: getIntentCatalog().getToken(
            input.toChainId,
            input.execute.tokenApproval.toTokenAddress
          ).symbol,
          amount: input.execute.tokenApproval.amount,
          spender: input.execute.tokenApproval.spender,
        }
      : undefined,
  });

  const destinationFunding = async (
    chainId: number,
    tokenAddress: Hex,
    tokenAmountRaw: bigint,
    executeParams: ExecuteParams
  ) => {
    const [balances, executeSimulation] = await Promise.all([
      state.middlewareClient.getIntentBalances(getEvm().address, balanceOptions(true)),
      simulateExecute(executeParams),
    ]);
    const token = getIntentCatalog().getToken(chainId, tokenAddress);
    const tokenBalance =
      balances.balances.find(
        (entry) =>
          entry.chainId === chainId &&
          entry.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      )?.balanceRaw ?? 0n;
    const nativeBalance =
      balances.balances.find((entry) => entry.chainId === chainId && entry.isNative)?.balanceRaw ??
      0n;
    return {
      ...calculateIntentFunding({
        outputIsNative: token.isNative || tokenAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase(),
        outputAmountRaw: tokenAmountRaw,
        outputBalanceRaw: tokenBalance,
        executeValueRaw: executeParams.value ?? 0n,
        estimatedGasCostRaw: executeSimulation.estimatedTotalCost,
        nativeBalanceRaw: nativeBalance,
      }),
      executeSimulation,
    };
  };

  const applyBeforeExecute = async (
    params: ExecuteParams,
    options?: { beforeExecute?: () => Promise<{ value?: bigint; data?: Hex; gas?: bigint }> }
  ): Promise<ExecuteParams> => ({ ...params, ...(await options?.beforeExecute?.()) });

  const bridgeAndExecute = async (
    input: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions
  ): Promise<BridgeAndExecuteIntentResult> => {
    const token = getIntentCatalog().getTokenBySymbol(input.toChainId, input.toTokenSymbol);
    const executeParams: ExecuteParams = { ...input.execute, toChainId: input.toChainId };
    const funding = await destinationFunding(
      input.toChainId,
      token.address,
      input.toAmountRaw,
      executeParams
    );
    const bridgeResult =
      funding.outputAmountRaw === 0n && funding.gasDropRaw === 0n
        ? undefined
        : await executeBridge(
            {
              toChainId: input.toChainId,
              toTokenSymbol: input.toTokenSymbol,
              toAmountRaw: funding.outputAmountRaw,
              toNativeAmountRaw: funding.gasDropRaw,
              sources: input.sources,
            },
            options
          );
    const executed = await execute(await applyBeforeExecute(executeParams, options));
    return bridgeResult
      ? {
          bridgeSkipped: false,
          bridgeResult,
          approval: executed.approval,
          execute: executed.execute,
        }
      : { bridgeSkipped: true, approval: executed.approval, execute: executed.execute };
  };

  const simulateBridgeAndExecute = async (
    input: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions
  ) => {
    const token = getIntentCatalog().getTokenBySymbol(input.toChainId, input.toTokenSymbol);
    const executeParams: ExecuteParams = { ...input.execute, toChainId: input.toChainId };
    const funding = await destinationFunding(
      input.toChainId,
      token.address,
      input.toAmountRaw,
      executeParams
    );
    const intentQuote =
      funding.outputAmountRaw === 0n && funding.gasDropRaw === 0n
        ? null
        : await simulateBridge(
            {
              toChainId: input.toChainId,
              toTokenSymbol: input.toTokenSymbol,
              toAmountRaw: funding.outputAmountRaw,
              toNativeAmountRaw: funding.gasDropRaw,
              sources: input.sources,
            },
            options
          );
    return { intentQuote, executeSimulation: funding.executeSimulation };
  };

  const swapAndExecute = async (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions
  ): Promise<SwapAndExecuteIntentResult> => {
    const executeParams = swapExecuteParams(input);
    const funding = await destinationFunding(
      input.toChainId,
      input.toTokenAddress,
      input.toAmountRaw,
      executeParams
    );
    const swapResult =
      funding.outputAmountRaw === 0n && funding.gasDropRaw === 0n
        ? undefined
        : await swapWithExactOut(
            {
              toChainId: input.toChainId,
              toTokenAddress: input.toTokenAddress,
              toAmountRaw: funding.outputAmountRaw,
              toNativeAmountRaw: funding.gasDropRaw,
              sources: input.sources,
            },
            options
          );
    const executed = await execute(await applyBeforeExecute(executeParams, options));
    return swapResult
      ? { swapSkipped: false, swapResult, approval: executed.approval, execute: executed.execute }
      : { swapSkipped: true, approval: executed.approval, execute: executed.execute };
  };

  const listIntents = async (params?: ListIntentsParams): Promise<IntentHistoryResult> => {
    const page = params?.page ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      throw Errors.invalidInput('page must be an integer greater than or equal to 1');
    }
    const result = await state.middlewareClient.listIntentHistory({
      user: getEvm().address.toLowerCase() as Hex,
      status: params?.status,
      limit: DEFAULT_INTENTS_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_INTENTS_PAGE_SIZE,
    });
    return {
      intents: result.intents.map((intent) => ({
        ...intent,
        explorerUrl: `${networkConfig.INTENT_EXPLORER_URL.replace(/\/$/, '')}/explore/${intent.id}`,
      })),
      total: result.total,
    };
  };

  return {
    getChainList,
    peekChainList: () => state.chainList,
    setChainList,
    setIntentCatalog,
    setAnalytics,
    setEvmProvider,
    executeBridge,
    simulateBridge,
    bridgeAndTransfer,
    simulateBridgeAndTransfer,
    swapWithExactIn,
    swapWithExactOut,
    bridgeAndExecute,
    simulateBridgeAndExecute,
    swapAndExecute,
    execute,
    simulateExecute,
    listIntents,
    getBalancesForBridge: getIntentBalances,
    getBalancesForSwap: getIntentBalances,
    getSupportedChains: () =>
      mergeSupportedChains(state.intentCatalog?.chains ?? [], getChainList().chains),
    convertTokenReadableAmountToBigInt: (amount: string, tokenSymbol: string, chainId: number) =>
      mulDecimals(amount, getChainList().getTokenInfoBySymbol(chainId, tokenSymbol).decimals),
    hasEvmProvider: () => Boolean(state.evm),
    getMiddlewareClient: () => state.middlewareClient,
    networkConfig,
  };
};
