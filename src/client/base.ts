import { createWalletClient, custom, type Hex, type WalletClient } from 'viem';
import type { AnalyticsManager } from '../analytics/AnalyticsManager';
import { NexusAnalyticsEvents } from '../analytics/events';
import type { DevTimingConfig } from '../analytics/types';
import { getWalletType } from '../analytics/utils';
import type {
  ChainListType,
  EthereumProvider,
  ExecuteParams,
  ListIntentsParams,
  NexusNetwork,
  OnEventParam,
} from '../domain';
import { LOG_LEVEL, setLogLevel, ZERO_ADDRESS } from '../domain';
import { Errors, formatUnknownError } from '../domain/errors';
import { addressString, parseInput } from '../domain/validation';
import {
  execute as flowExecute,
  simulateExecute as flowSimulateExecute,
  prepareExecuteFunding,
  priceExecuteFunding,
} from '../execute/execute';
import {
  createIntentCatalog,
  type IntentCatalog,
  intentNetworkEnabled,
  mergeSupportedChains,
} from '../intent/catalog';
import {
  calculateIntentFunding,
  filterFundingBalances,
  formatFundingAmount,
} from '../intent/funding';
import type { MiddlewareClient } from '../intent/middleware';
import { createMiddlewareClient } from '../intent/middleware';
import { assertIntentQuoteFresh, runIntent } from '../intent/orchestrator';
import type {
  SwapAndExecuteParams,
  SwapExactInParams,
  SwapExactOutParams,
} from '../intent/swap-types';
import type { IntentReporting } from '../intent/telemetry';
import type {
  IntentChainMetadata,
  IntentEvent,
  IntentHistoryResult,
  IntentQuoteRequest,
  IntentResult,
  IntentSource,
  IntentTokenQuery,
  SwapAndExecuteIntent,
  SwapAndExecuteIntentResult,
  TokenRef,
} from '../intent/types';
import { createIntentWallet } from '../intent/wallet';
import { isNativeAddress } from '../services/addresses';
import { createChainList } from '../services/chain-list';
import { getNetworkConfig } from '../services/network-config';
import { runNonBlocking } from '../services/non-blocking';
import { equalFold } from '../services/strings';
import { setLoggerProvider } from '../services/telemetry';
import { trackWalletConnect } from './operation-boundary';
import type { SwapAndExecuteOptions, SwapOperationOptions } from './types';

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

export const createBase = (config: {
  clientId: string;
  network?: NexusNetwork;
  debug?: boolean;
  devTiming?: DevTimingConfig;
  internal?: { middlewareClient?: MiddlewareClient };
}) => {
  const networkConfig = getNetworkConfig(config?.network);
  const state: BaseState = {
    chainList: null,
    intentCatalog: null,
    middlewareClient:
      config?.internal?.middlewareClient ??
      createMiddlewareClient(networkConfig.MIDDLEWARE_HTTP_URL, { clientId: config.clientId }),
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
  const setIntentCatalog = (chains: IntentChainMetadata[]) => {
    state.intentCatalog = createIntentCatalog(chains, state.middlewareClient.getIntentTokens);
  };
  const getChainList = () => {
    if (!state.chainList) throw Errors.sdkNotInitialized();
    return state.chainList;
  };
  const getCatalog = () => {
    if (!state.intentCatalog) throw Errors.sdkNotInitialized();
    return state.intentCatalog;
  };
  const getIntentCatalog = () => {
    if (!intentNetworkEnabled(networkConfig.NETWORK_HINT)) {
      throw Errors.environmentNotSupported(networkConfig.NETWORK_HINT);
    }
    return getCatalog();
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

  const intentRuntime = (attemptId?: string) => {
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
      confirmApproval: wallet.confirmTransaction,
      sign: (...args: Parameters<typeof wallet.sign>) => withWallet(() => wallet.sign(...args)),
      sendNative: (...args: Parameters<typeof wallet.sendNative>) =>
        withWallet(() => wallet.sendNative(...args)),
      submit: (request: Parameters<MiddlewareClient['submitIntent']>[0]) =>
        state.middlewareClient.submitIntent(request, attemptId),
      getStatus: (id: Hex) => state.middlewareClient.getIntentStatus(id, attemptId),
    };
  };

  const slippageBps = (options?: SwapOperationOptions) => {
    const value = options?.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    if (value !== 'auto' && (!Number.isInteger(value) || value < 0 || value > 10_000)) {
      throw Errors.invalidInput('slippageBps must be an integer from 0 to 10000, or auto');
    }
    return value;
  };

  const exactOutRequest = async (
    input: SwapExactOutParams,
    options?: SwapOperationOptions,
    refreshedSources?: IntentSource[]
  ): Promise<IntentQuoteRequest> => {
    positiveAmount(input.toAmountRaw, 'toAmountRaw');
    nonNegativeAmount(input.toNativeAmountRaw, 'toNativeAmountRaw');
    const catalog = getIntentCatalog();
    const destinationToken = await catalog.getToken(input.toChainId, input.toTokenAddress);
    const selected = refreshedSources ?? input.sources;
    const sources = await catalog.getExactOutputSources(destinationToken, selected);
    return {
      sender: getEvm().address.toLowerCase() as Hex,
      tradeType: 'exactOutput',
      output: {
        chainId: chainRef(input.toChainId),
        token: destinationToken.address,
        amount: input.toAmountRaw.toString(),
      },
      ...(sources
        ? { sources: sources.map((source) => ({ ...source, chainId: chainRef(source.chainId) })) }
        : {}),
      slippageBps: slippageBps(options),
      ...(input.toNativeAmountRaw && input.toNativeAmountRaw > 0n
        ? { gasDrop: { amount: input.toNativeAmountRaw.toString() } }
        : {}),
    };
  };

  const exactInRequest = async (
    input: SwapExactInParams,
    options?: SwapOperationOptions,
    refreshedSources?: IntentSource[]
  ): Promise<IntentQuoteRequest> => {
    const catalog = getIntentCatalog();
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
      return {
        chainId: chainRef(source.chainId),
        token: source.tokenAddress,
        amount: source.amountRaw.toString(),
      };
    });
    const [destinationToken, ...sourceTokens] = await Promise.all([
      catalog.getToken(input.toChainId, input.toTokenAddress),
      ...selected.map((source) => catalog.getToken(source.chainId, source.tokenAddress as Hex)),
    ]);
    catalog.validateExactInput(sourceTokens, destinationToken);
    return {
      sender: getEvm().address.toLowerCase() as Hex,
      tradeType: 'exactInput',
      input: sources,
      output: { chainId: chainRef(input.toChainId), token: input.toTokenAddress },
      slippageBps: slippageBps(options),
    };
  };

  const executeIntent = (
    request: (sources?: IntentSource[]) => Promise<IntentQuoteRequest>,
    options?: SwapOperationOptions,
    reporting?: IntentReporting
  ): Promise<IntentResult> =>
    runIntent(
      {
        requestQuote: async () =>
          state.middlewareClient.getIntentQuote(await request(), reporting?.attemptId),
        refreshQuote: async (sources) =>
          state.middlewareClient.getIntentQuote(await request(sources), reporting?.attemptId),
        reporting,
        onIntent: options?.hooks?.onIntent,
        onEvent: options?.onEvent,
        pollingIntervalMs: options?.pollingIntervalMs,
        timeoutMs: (options?.fillTimeoutMinutes ?? 2) * 60_000,
      },
      intentRuntime(reporting?.attemptId)
    );

  const swapWithExactIn = (
    input: SwapExactInParams,
    options?: SwapOperationOptions,
    reporting?: IntentReporting
  ) => executeIntent((sources) => exactInRequest(input, options, sources), options, reporting);

  const swapWithExactOut = (
    input: SwapExactOutParams,
    options?: SwapOperationOptions,
    reporting?: IntentReporting
  ) => executeIntent((sources) => exactOutRequest(input, options, sources), options, reporting);

  const getIntentBalances = () =>
    state.middlewareClient.getIntentBalances(getEvm().address, { refresh: false });

  const loadExecuteToken = async (params: ExecuteParams) => {
    if (!params.tokenApproval) return;
    const chain = getChainList().getChainByID(params.toChainId);
    const address = parseInput(addressString, params.tokenApproval.toTokenAddress);
    if (
      isNativeAddress(address) ||
      chain.custom.knownTokens.some((token) => equalFold(token.contractAddress, address))
    )
      return;
    const catalog = getCatalog();
    const token = await catalog.getToken(params.toChainId, address);
    const resolved = createChainList([
      { ...catalog.getChain(params.toChainId), tokens: [token] },
    ]).getTokenByAddress(params.toChainId, token.address);
    if (
      !chain.custom.knownTokens.some((entry) =>
        equalFold(entry.contractAddress, resolved.contractAddress)
      )
    ) {
      chain.custom.knownTokens.push(resolved);
    }
  };

  const execute = async (params: ExecuteParams, _options?: OnEventParam, parentSpanId?: string) => {
    getEvm();
    await loadExecuteToken(params);
    return flowExecute(params, {
      chainList: getChainList(),
      evm: { walletClient: getEvm().client, address: getEvm().address },
      timing: state.analytics?.scopedTimingHooks(parentSpanId),
    });
  };

  const simulateExecute = async (params: ExecuteParams) => {
    getEvm();
    await loadExecuteToken(params);
    return flowSimulateExecute(params, {
      chainList: getChainList(),
      evm: { walletClient: getEvm().client, address: getEvm().address },
      timing: state.analytics?.scopedTimingHooks(),
    });
  };

  const swapAndExecute = async (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions,
    reporting?: IntentReporting
  ): Promise<SwapAndExecuteIntentResult> => {
    if (typeof input.execute.gas !== 'bigint' || input.execute.gas <= 0n) {
      throw Errors.invalidInput('execute.gas must be a positive bigint');
    }
    positiveAmount(input.toAmountRaw, 'toAmountRaw');
    const evm = getEvm();
    const executeParams = { ...input.execute, toChainId: input.toChainId };
    const deps = {
      chainList: getChainList(),
      evm: { walletClient: evm.client, address: evm.address },
      timing: state.analytics?.scopedTimingHooks(reporting?.attemptId),
    };
    await loadExecuteToken(executeParams);
    const [prepared, snapshot, token] = await Promise.all([
      prepareExecuteFunding(executeParams, deps),
      state.middlewareClient.getIntentBalances(evm.address, {
        refresh: true,
        ...(reporting ? { attemptId: reporting.attemptId } : {}),
      }),
      getIntentCatalog().getToken(input.toChainId, input.toTokenAddress),
    ]);
    if (snapshot.errored) {
      state.analytics?.reportEvent(NexusAnalyticsEvents.BALANCES_FETCH_PARTIAL, {
        ...reporting?.properties(),
        'balances.partial': true,
        'balances.count': snapshot.balances.length,
      });
    }
    const outputIsNative = token.isNative || isNativeAddress(token.address);
    const native = prepared.dstChain.nativeCurrency;
    const buildPreview = async (sources?: IntentSource[]) => {
      const selected = sources?.map((source) => ({ ...source }));
      const balances = filterFundingBalances(snapshot.balances, selected);
      const tokenEntry = balances.find(
        (entry) =>
          entry.chainId === input.toChainId &&
          (outputIsNative ? entry.isNative : equalFold(entry.tokenAddress, token.address))
      );
      const nativeEntry = balances.find(
        (entry) => entry.chainId === input.toChainId && entry.isNative
      );
      const tokenBalance = tokenEntry?.balanceRaw ?? 0n;
      const nativeBalance = nativeEntry?.balanceRaw ?? 0n;
      const priced = await priceExecuteFunding(prepared);
      const funding = calculateIntentFunding({
        outputIsNative,
        outputAmountRaw: input.toAmountRaw,
        outputBalanceRaw: tokenBalance,
        executeValueRaw: executeParams.value ?? 0n,
        estimatedGasCostRaw: priced.estimatedTotalCost,
        nativeBalanceRaw: nativeBalance,
      });
      const executable =
        funding.outputAmountRaw === 0n && funding.gasDropRaw === 0n
          ? undefined
          : await state.middlewareClient.getIntentQuote(
              await exactOutRequest(
                {
                  toChainId: input.toChainId,
                  toTokenAddress: token.address,
                  toAmountRaw: funding.outputAmountRaw,
                  toNativeAmountRaw: funding.gasDropRaw,
                  sources: selected,
                },
                { slippageBps: options?.slippageBps }
              ),
              reporting?.attemptId
            );
      if (executable) assertIntentQuoteFresh(executable, Date.now());
      const tokenReference =
        tokenEntry?.valueUsd != null && tokenBalance > 0n
          ? { amountRaw: tokenBalance, valueUsd: String(tokenEntry.valueUsd) }
          : executable && {
              amountRaw: executable.quote.output.amountRaw,
              valueUsd: executable.quote.output.amountUsd,
            };
      const nativeReference = outputIsNative
        ? tokenReference
        : nativeEntry && {
            amountRaw: nativeBalance,
            valueUsd: nativeEntry.valueUsd == null ? undefined : String(nativeEntry.valueUsd),
          };
      const tokenAmount = (raw: bigint) => formatFundingAmount(raw, token.decimals, tokenReference);
      const nativeAmount = (raw: bigint) =>
        formatFundingAmount(raw, native.decimals, nativeReference);
      const tokenShortfall =
        input.toAmountRaw > tokenBalance ? input.toAmountRaw - tokenBalance : 0n;
      const gasShortfall = outputIsNative
        ? funding.outputAmountRaw - tokenShortfall
        : funding.gasDropRaw;
      const approval = priced.approvalContext;
      const intent: SwapAndExecuteIntent = {
        executeRequirement: {
          chain: {
            id: prepared.dstChain.id,
            name: prepared.dstChain.name,
            logo: prepared.dstChain.custom.icon,
          },
          to: executeParams.to,
          token: {
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
            ...tokenAmount(input.toAmountRaw),
          },
          gas: {
            address: ZERO_ADDRESS,
            symbol: native.symbol,
            decimals: native.decimals,
            ...nativeAmount(priced.estimatedTotalCost),
            estimatedGasUnits: priced.tx.gas,
            approvalGasUnits: priced.approvalTx?.gas ?? 0n,
            feeParams: priced.feeParams,
            l1FeeRaw: priced.l1Fee,
            priceTier: prepared.priceTier,
          },
          nativeValue: executeParams.value ? nativeAmount(executeParams.value) : null,
          tokenApproval: approval
            ? {
                token: {
                  address: approval.token.contractAddress,
                  symbol: approval.token.symbol,
                  decimals: approval.token.decimals,
                },
                ...formatFundingAmount(approval.amount, approval.token.decimals),
                spender: approval.spender,
              }
            : null,
        },
        available: { token: tokenAmount(tokenBalance), gas: nativeAmount(nativeBalance) },
        shortfall: { token: tokenAmount(tokenShortfall), gas: nativeAmount(gasShortfall) },
        ...(executable ? { swapRequired: true, quote: executable.quote } : { swapRequired: false }),
      };
      return { intent, executable, priced, sources: selected };
    };
    const emitQuote = (preview: Awaited<ReturnType<typeof buildPreview>>) => {
      if (!preview.executable) return;
      const event: IntentEvent = { type: 'quote', quote: preview.executable.quote };
      reporting?.observe(event);
      runNonBlocking('IntentEventEmitFailed', () => options?.onEvent?.(event), {
        eventType: event.type,
      });
    };
    let current = await buildPreview(input.sources);
    emitQuote(current);
    const onIntent = options?.hooks?.onIntent;
    if (onIntent) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let accepting = false;
        let pending = Promise.resolve();
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        const allow = () => {
          if (settled || accepting) return;
          accepting = true;
          void pending.then(() => {
            if (settled) return;
            settled = true;
            resolve();
          });
        };
        const refresh = (sources?: IntentSource[]) => {
          if (settled || accepting) return Promise.resolve(current.intent);
          const selected = sources?.map((source) => ({ ...source }));
          const next = pending.then(async () => {
            if (settled) return current.intent;
            try {
              const updated = await buildPreview(selected ?? current.sources);
              if (!settled) {
                current = updated;
                emitQuote(current);
              }
              return current.intent;
            } catch (error) {
              reporting?.refreshFailed(error);
              throw error;
            }
          });
          pending = next.then(
            () => undefined,
            () => undefined
          );
          return next;
        };
        try {
          Promise.resolve(
            onIntent({
              intent: current.intent,
              allow,
              deny: () => fail(Errors.userDeniedIntent()),
              refresh,
              ...(reporting ? { attemptId: reporting.attemptId } : {}),
            })
          ).catch(fail);
        } catch (error) {
          fail(error);
        }
      });
    }
    const acceptedQuote = current.executable;
    const swapResult = acceptedQuote
      ? await runIntent(
          {
            requestQuote: async () => acceptedQuote,
            quoteAlreadyEmitted: true,
            reporting,
            onEvent: options?.onEvent,
            pollingIntervalMs: options?.pollingIntervalMs,
            timeoutMs: (options?.fillTimeoutMinutes ?? 2) * 60_000,
          },
          intentRuntime(reporting?.attemptId)
        )
      : undefined;
    if (!swapResult) reporting?.skip();
    const finalParams = {
      ...executeParams,
      gas: current.priced.tx.gas,
      ...(await options?.beforeExecute?.()),
    };
    const executed = await flowExecute(finalParams, deps, current.priced);
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
        explorerUrl: `${networkConfig.INTENT_EXPLORER_URL.replace(/\/$/, '')}/rff/${intent.id}`,
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
    swapWithExactIn,
    swapWithExactOut,
    swapAndExecute,
    execute,
    simulateExecute,
    listIntents,
    getBalancesForSwap: getIntentBalances,
    getSupportedChains: () =>
      mergeSupportedChains(
        intentNetworkEnabled(networkConfig.NETWORK_HINT) ? (state.intentCatalog?.chains ?? []) : [],
        getChainList().chains
      ),
    getTokens: async (query?: IntentTokenQuery) => getIntentCatalog().getTokens(query),
    getToken: async ({ chainId, tokenAddress }: TokenRef) =>
      getIntentCatalog().getToken(chainId, tokenAddress),
    getTokensByChain: async (chainId: number, query?: Omit<IntentTokenQuery, 'chainId'>) =>
      getIntentCatalog().getTokens({ ...query, chainId }),
    getAvailableSourceTokens: async (
      destination: TokenRef,
      selectedSources?: TokenRef[],
      query?: IntentTokenQuery
    ) => getIntentCatalog().getAvailableSourceTokens(destination, selectedSources, query),
    getAvailableDestinationTokens: async (sources: TokenRef[], query?: IntentTokenQuery) =>
      getIntentCatalog().getAvailableDestinationTokens(sources, query),
    confirmRouteExists: async (sources: TokenRef[], destination: TokenRef) =>
      getIntentCatalog().confirmRouteExists(sources, destination),
    getSupportedChainsForRoute: (constraints: import('../intent/types').IntentRouteConstraints) => {
      getIntentCatalog();
      return state.middlewareClient.getIntentChains(constraints);
    },
    hasEvmProvider: () => Boolean(state.evm),
    getMiddlewareClient: () => state.middlewareClient,
    networkConfig,
  };
};
