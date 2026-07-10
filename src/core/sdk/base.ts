import { createWalletClient, custom, type Hex, type WalletClient } from 'viem';
import type { AnalyticsManager } from '../../analytics/AnalyticsManager';
import { getWalletType } from '../../analytics/utils';
import { resolveHooks } from '../../bridge/hooks/defaults';
import { calculateMaxForBridge as flowCalculateMaxForBridge } from '../../bridge/max';
import { createBridgeParams, validateBridgeMax } from '../../bridge/params';
import type {
  BridgeExecutionResult,
  BridgeFlowParams,
  BridgeMaxParams,
  BridgeMaxResult,
} from '../../bridge/types';
import type {
  BridgeAndExecuteParams,
  BridgeParams,
  Chain,
  ChainListType,
  DevTimingConfig,
  EthereumProvider,
  ExecuteParams,
  ListIntentsParams,
  ListIntentsResult,
  NexusNetwork,
  OnEventParam,
  TokenBalance,
  TransferParams,
} from '../../domain';
import { DEFAULT_FILL_TIMEOUT_MINUTES, getLogger, LOG_LEVEL, setLogLevel } from '../../domain';
import { Universe } from '../../domain/chain-abstraction';
import { Errors, formatUnknownError, NexusError } from '../../domain/errors';
import {
  createBridgeAndTransferParams,
  bridgeAndExecute as flowBridgeAndExecute,
  execute as flowExecute,
  simulateBridgeAndExecute as flowSimulateBridgeAndExecute,
  simulateExecute as flowSimulateExecute,
} from '../../flows';
import {
  executeBridge as flowExecuteBridge,
  simulateBridge as flowSimulateBridge,
} from '../../flows/bridge';
import { swap } from '../../flows/swap';
import { swapAndExecute as flowSwapAndExecute } from '../../flows/swap-and-execute';
import {
  validateSwapAndExecute,
  validateSwapExactIn,
  validateSwapExactOut,
  validateSwapMax,
} from '../../flows/swap-params';
import {
  getBalancesForBridge as serviceGetBalancesForBridge,
  getBalancesForSwap as serviceGetBalancesForSwap,
} from '../../services/balances';
import { toIntentRecord } from '../../services/intent-records';
import { mulDecimals } from '../../services/math';
import { getNetworkConfig } from '../../services/network-config';
import { locationHost } from '../../services/platform';
import { setLoggerProvider } from '../../services/telemetry';
import { DEFAULT_CURRENCY_ID } from '../../swap/cot';
import { calculateMaxForSwap as flowCalculateMaxForSwap } from '../../swap/max';
import type {
  SwapAndExecuteParams,
  SwapAndExecuteResult,
  SwapExactInParams,
  SwapExactOutParams,
  SwapMaxParams,
  SwapMaxResult,
  SwapResult,
} from '../../swap/types';
import { type SwapData, SwapMode } from '../../swap/types';
import { createEphemeralSession } from '../../swap/wallet/ephemeral-session';
import { createPublicClientList } from '../../swap/wallet/public-client-list';
import type { MiddlewareClient } from '../../transport';
import { createMiddlewareClient } from '../../transport';
import { adaptBridgeAndExecuteEventToBridgeEvent } from '../event-adapters';
import type {
  BridgeAndExecuteOptions,
  BridgeOperationOptions,
  SwapAndExecuteOptions,
  SwapOperationOptions,
} from '../types';
import { createInitSweepController } from './init-sweep-controller';
import { trackWalletConnect } from './operation-boundary';

const DEFAULT_INTENTS_PAGE_SIZE = 20;

const logger = getLogger();

type ConfigurableTimingMiddlewareClient = MiddlewareClient & {
  configureTiming?: (options?: {
    timing?: {
      startSpan: AnalyticsManager['startSpan'];
      endSpan: AnalyticsManager['endSpan'];
      withSpan: AnalyticsManager['withSpan'];
    };
    captureNetworkTiming?: boolean;
  }) => void;
};

type BaseState = {
  chainList: ChainListType | null;
  middlewareClient: ConfigurableTimingMiddlewareClient;
  evm?: {
    client: WalletClient;
    provider: EthereumProvider;
    address: Hex;
  };
  analytics?: AnalyticsManager;
  networkConfig: ReturnType<typeof getNetworkConfig>;
};

/**
 * Build the timing hooks injected into a flow via `deps.timing`. When called
 * inside a public-op invocation we pass the runOp `opId` as `parentSpanId`
 * so the flow's dev-timing spans nest under the public-op span instead of
 * being orphaned siblings (Approach D — opId is the dev-timing root).
 * Unscoped (no parentSpanId) is used for the middleware-client timing wiring
 * which isn't tied to a specific public-op call.
 */
const createTimingHooks = (analytics?: AnalyticsManager, parentSpanId?: string) =>
  analytics ? analytics.scopedTimingHooks(parentSpanId) : undefined;

export const createBase = (config?: {
  network?: NexusNetwork;
  debug?: boolean;
  devTiming?: DevTimingConfig;
  domain?: string;
  forceMayan?: boolean;
  internal?: {
    middlewareClient?: MiddlewareClient;
  };
}) => {
  const networkConfig = getNetworkConfig(config?.network);
  const middlewareClient =
    config?.internal?.middlewareClient ??
    createMiddlewareClient(networkConfig.MIDDLEWARE_HTTP_URL);

  const state: BaseState = {
    chainList: null,
    middlewareClient,
    networkConfig,
  };
  const ephemeralSession = createEphemeralSession({
    resolveDomain: () => config?.domain ?? locationHost(),
  });

  // One-shot refund sweep: on connect, a single best-effort pass that drains bridge-failure
  // refunds (USDC/USDT/ETH) stranded on the ephemeral-controlled account back to the EOA, then
  // stops. `getContext` returns null until a wallet + chain list are wired up, so an early
  // runOnce is a quiet no-op (and doesn't consume the one-shot).
  const sweepController = createInitSweepController({
    getContext: () => {
      if (!state.evm || !state.chainList) return null;
      const ephemeralWallet = ephemeralSession.peek(state.evm.address);
      if (!ephemeralWallet) return null;
      return {
        ctx: {
          chainList: state.chainList,
          middlewareClient: state.middlewareClient,
          publicClientList: createPublicClientList(state.chainList),
          ephemeralWallet,
          eoaAddress: state.evm.address,
          cache: undefined,
        },
      };
    },
  });

  const withSwapMutex = async <T>(run: () => Promise<T>): Promise<T> => {
    sweepController.setSwapRunning(true);
    try {
      return await run();
    } finally {
      sweepController.setSwapRunning(false);
    }
  };

  if (config?.debug) {
    setLogLevel(LOG_LEVEL.DEBUG);
  }

  const setAnalytics = (analytics?: AnalyticsManager) => {
    state.analytics = analytics;
    state.middlewareClient.configureTiming?.({
      timing: createTimingHooks(analytics),
      captureNetworkTiming:
        analytics?.isDevTimingEnabled() === true &&
        config?.devTiming?.captureNetworkTiming !== false,
    });
  };

  const setChainList = (chainList: ChainListType) => {
    state.chainList = chainList;
  };

  const getChainListOrThrow = () => {
    if (!state.chainList) {
      throw Errors.sdkNotInitialized();
    }
    return state.chainList;
  };

  const peekChainList = (): ChainListType | null => state.chainList;

  const ensureEvmUniverse = (dstChain: Chain) => {
    if (dstChain.universe !== Universe.ETHEREUM) {
      throw Errors.universeNotSupported();
    }
  };

  const setEvmProvider = async (provider: EthereumProvider) => {
    if (state.evm?.provider === provider) {
      return;
    }

    // setLoggerProvider is idempotent — also called from initialize(); whichever
    // resolves first provisions the OTel logger so the boundary catch can actually emit.
    await setLoggerProvider(state.networkConfig);

    const run = async (): Promise<{ address: Hex; chainId: number }> => {
      try {
        const client = createWalletClient({
          transport: custom({ ...provider, request: provider.request.bind(provider) }),
        });

        const address = (
          await client.getAddresses().catch((error) => {
            throw Errors.execution(`Failed to read wallet address: ${formatUnknownError(error)}`, {
              service: 'wallet',
              details: { walletType: getWalletType(provider) },
            });
          })
        )[0];
        const chainId = await client.getChainId().catch((error) => {
          throw Errors.execution(`Failed to read wallet chain id: ${formatUnknownError(error)}`, {
            service: 'wallet',
            details: { walletType: getWalletType(provider) },
          });
        });

        state.evm = { client, provider, address };
        return { address, chainId };
      } catch (error) {
        // Always wrap so the boundary error has `operation: 'setEVMProvider'`. The inner
        // ExecutionError's text (from `getAddresses` / `getChainId` catches) is inlined into
        // this message via formatUnknownError — errors are flat, so there's no cause chain.
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

    let eoaAddress: Hex;
    if (state.analytics) {
      const { address, chainId } = await trackWalletConnect(state.analytics, provider, run);
      eoaAddress = address;
      // alias() must precede identify() so the provider can merge prior anonymous
      // events with the wallet-identified user.
      state.analytics.alias(address);
      state.analytics.identify(address, {
        walletType: getWalletType(provider),
        chainId,
      });
      if (typeof window !== 'undefined' && window.location?.host) {
        state.analytics.group('dapp', window.location.host);
      }
      state.analytics.group('chain', String(chainId));
    } else {
      const { address } = await run();
      eoaAddress = address;
    }

    // Eagerly derive the ephemeral key on connect — prompts the wallet to sign the
    // ephemeral-key message (returning addresses reuse the stored signature, so no
    // prompt). Required: a rejection rolls back state.evm and rejects setEVMProvider
    // so the SDK is never left half-connected (wallet attached but no key). Swap
    // functions then read the cached key without prompting, and the one-shot COT
    // refund sweep can run immediately.
    try {
      const ephemeralWallet = await getOrDeriveEphemeralKey();
      logger.debug('ephemeralKey:derived', {
        eoaAddress,
        ephemeralAddress: ephemeralWallet.address,
      });
    } catch (error) {
      state.evm = undefined;
      // Pre-classified NexusErrors (e.g. userRejectedEphemeralKey) pass through;
      // a raw failure (e.g. localStorage denied) wraps to ExecutionError.
      throw error instanceof NexusError
        ? error
        : Errors.execution(`Failed to derive ephemeral key: ${formatUnknownError(error)}`, {
            service: 'wallet',
            operation: 'setEVMProvider',
            details: { walletType: getWalletType(provider) },
          });
    }

    sweepController.runOnce();
  };

  const executeBridge = async (
    input: BridgeParams,
    options?: BridgeOperationOptions,
    parentSpanId?: string
  ): Promise<BridgeExecutionResult> => {
    if (!state.evm) {
      throw Errors.sdkNotInitialized();
    }

    const chainList = getChainListOrThrow();
    const params: BridgeFlowParams = createBridgeParams(input, chainList);
    ensureEvmUniverse(params.dstChain);

    return flowExecuteBridge(params, getBridgeFlowDeps(parentSpanId), {
      hooks: resolveHooks(options),
      emit: options?.onEvent,
      fillTimeoutMinutes: options?.fillTimeoutMinutes ?? DEFAULT_FILL_TIMEOUT_MINUTES,
    });
  };

  const simulateBridge = async (input: BridgeParams) => {
    if (!state.evm) {
      throw Errors.sdkNotInitialized();
    }

    const chainList = getChainListOrThrow();
    const params: BridgeFlowParams = createBridgeParams(input, chainList);
    ensureEvmUniverse(params.dstChain);

    return flowSimulateBridge(params, getBridgeFlowDeps());
  };

  const listIntents = async (params?: ListIntentsParams): Promise<ListIntentsResult> => {
    const chainList = getChainListOrThrow();

    if (!state.evm) {
      throw Errors.walletNotConnected('evm');
    }

    const page = params?.page ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      throw Errors.invalidInput('page must be an integer greater than or equal to 1');
    }

    const result = await state.middlewareClient.listRFFs({
      user: state.evm.address,
      status: params?.status,
      limit: DEFAULT_INTENTS_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_INTENTS_PAGE_SIZE,
    });

    return {
      intents: result.rffs.map((intent) =>
        toIntentRecord(intent, chainList, state.networkConfig.INTENT_EXPLORER_URL)
      ),
      total: result.total,
    };
  };

  const getBalancesForBridge = async (): Promise<TokenBalance[]> => {
    if (!state.evm) {
      throw Errors.sdkNotInitialized();
    }
    const chainList = getChainListOrThrow();
    return serviceGetBalancesForBridge({
      evmAddress: state.evm.address,
      chainList,
      middlewareClient: state.middlewareClient,
    });
  };

  const getBalancesForSwap = async (): Promise<TokenBalance[]> => {
    if (!state.evm) {
      throw Errors.sdkNotInitialized();
    }
    const chainList = getChainListOrThrow();
    return serviceGetBalancesForSwap({
      evmAddress: state.evm.address,
      chainList,
      middlewareClient: state.middlewareClient,
    });
  };

  const getCommonFlowDeps = (parentSpanId?: string) => {
    if (!state.evm) {
      throw Errors.sdkNotInitialized();
    }

    return {
      chainList: getChainListOrThrow(),
      timing: createTimingHooks(state.analytics, parentSpanId),
      intentExplorerUrl: state.networkConfig.INTENT_EXPLORER_URL,
      evm: {
        walletClient: state.evm.client,
        address: state.evm.address,
      },
      forceMayan: config?.forceMayan ?? false,
    } as const;
  };

  const getBridgeFlowDeps = (parentSpanId?: string) => ({
    ...getCommonFlowDeps(parentSpanId),
    middlewareClient: state.middlewareClient,
  });

  const getSwapFlowDeps = (
    ephemeralWallet: Awaited<ReturnType<typeof getOrDeriveEphemeralKey>>,
    parentSpanId?: string
  ) => ({
    ...getCommonFlowDeps(parentSpanId),
    middlewareClient: state.middlewareClient,
    swap: {
      ephemeralWallet,
      cotCurrencyId: DEFAULT_CURRENCY_ID,
    },
  });

  const bridgeAndTransfer = async (
    input: TransferParams,
    options?: BridgeOperationOptions,
    parentSpanId?: string
  ) => {
    const chainList = getChainListOrThrow();
    const params = createBridgeAndTransferParams(input, chainList);
    const adaptedOptions = options
      ? {
          fillTimeoutMinutes: options.fillTimeoutMinutes,
          onEvent: options.onEvent
            ? (event: Parameters<NonNullable<BridgeAndExecuteOptions['onEvent']>>[0]) => {
                const bridgeEvent = adaptBridgeAndExecuteEventToBridgeEvent(event);
                if (bridgeEvent) {
                  options.onEvent?.(bridgeEvent);
                }
              }
            : undefined,
        }
      : undefined;
    return bridgeAndExecute(params, adaptedOptions, parentSpanId);
  };

  const simulateBridgeAndTransfer = async (input: TransferParams) => {
    const chainList = getChainListOrThrow();
    const params = createBridgeAndTransferParams(input, chainList);
    return simulateBridgeAndExecute(params);
  };

  const simulateBridgeAndExecute = (params: BridgeAndExecuteParams) => {
    return flowSimulateBridgeAndExecute(params, getBridgeFlowDeps());
  };

  const bridgeAndExecute = (
    params: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions,
    parentSpanId?: string
  ) => {
    return flowBridgeAndExecute(params, getBridgeFlowDeps(parentSpanId), options);
  };

  const execute = (params: ExecuteParams, _options?: OnEventParam, parentSpanId?: string) => {
    return flowExecute(params, getCommonFlowDeps(parentSpanId));
  };

  const simulateExecute = (params: ExecuteParams) => {
    return flowSimulateExecute(params, getCommonFlowDeps());
  };

  const convertTokenReadableAmountToBigInt = (
    amount: string,
    tokenSymbol: string,
    chainId: number
  ) => {
    const chainList = getChainListOrThrow();
    const token = chainList.getTokenInfoBySymbol(chainId, tokenSymbol);
    return mulDecimals(amount, token.decimals);
  };

  const getOrDeriveEphemeralKey = async () => {
    if (!state.evm) throw Errors.sdkNotInitialized();
    return ephemeralSession.getOrDerive(state.evm.client, state.evm.address);
  };

  // Swap entry points read the key derived eagerly in setEvmProvider — no prompt.
  // A connected SDK always has it; a null peek means the wallet isn't connected.
  const requireEphemeralKey = () => {
    if (!state.evm) throw Errors.sdkNotInitialized();
    const ephemeralWallet = ephemeralSession.peek(state.evm.address);
    if (!ephemeralWallet) throw Errors.sdkNotInitialized();
    return ephemeralWallet;
  };

  const swapWithExactIn = async (
    input: SwapExactInParams,
    options?: SwapOperationOptions,
    parentSpanId?: string
  ): Promise<SwapResult> => {
    const ephemeralWallet = requireEphemeralKey();
    validateSwapExactIn(input);

    const swapData: SwapData = { mode: SwapMode.EXACT_IN, data: input };
    return withSwapMutex(() =>
      swap(swapData, getSwapFlowDeps(ephemeralWallet, parentSpanId), {
        onIntent: options?.hooks?.onIntent,
        onEvent: options?.onEvent,
        slippageTolerance: options?.slippageTolerance,
      })
    );
  };

  const swapWithExactOut = async (
    input: SwapExactOutParams,
    options?: SwapOperationOptions,
    parentSpanId?: string
  ): Promise<SwapResult> => {
    const ephemeralWallet = requireEphemeralKey();
    validateSwapExactOut(input);

    const swapData: SwapData = { mode: SwapMode.EXACT_OUT, data: input };
    return withSwapMutex(() =>
      swap(swapData, getSwapFlowDeps(ephemeralWallet, parentSpanId), {
        onIntent: options?.hooks?.onIntent,
        onEvent: options?.onEvent,
        slippageTolerance: options?.slippageTolerance,
      })
    );
  };

  const calculateMaxForSwap = async (input: SwapMaxParams): Promise<SwapMaxResult> => {
    if (!state.evm) throw Errors.sdkNotInitialized();
    validateSwapMax(input);
    const chainList = getChainListOrThrow();
    const ephemeralAddress = await ephemeralSession.getAddressForEstimation(state.evm.address);

    return flowCalculateMaxForSwap(input, {
      chainList,
      eoaAddress: state.evm.address,
      ephemeralAddress,
      middlewareClient: state.middlewareClient,
      cotCurrencyId: DEFAULT_CURRENCY_ID,
      forceMayan: config?.forceMayan ?? false,
    });
  };

  const calculateMaxForBridge = async (input: BridgeMaxParams): Promise<BridgeMaxResult> => {
    if (!state.evm) throw Errors.sdkNotInitialized();
    validateBridgeMax(input);
    const chainList = getChainListOrThrow();

    return flowCalculateMaxForBridge(input, {
      chainList,
      evmAddress: state.evm.address,
      middlewareClient: state.middlewareClient,
      forceMayan: config?.forceMayan ?? false,
    });
  };

  const swapAndExecute = async (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions,
    parentSpanId?: string
  ): Promise<SwapAndExecuteResult> => {
    const ephemeralWallet = requireEphemeralKey();
    validateSwapAndExecute(input);

    return withSwapMutex(() =>
      flowSwapAndExecute(input, getSwapFlowDeps(ephemeralWallet, parentSpanId), options)
    );
  };

  return {
    getChainList: getChainListOrThrow,
    peekChainList,
    setChainList,
    setAnalytics,
    setEvmProvider,
    executeBridge,
    simulateBridge,
    listIntents,
    getBalancesForBridge,
    getBalancesForSwap,
    bridgeAndTransfer,
    simulateBridgeAndTransfer,
    simulateBridgeAndExecute,
    bridgeAndExecute,
    execute,
    simulateExecute,
    convertTokenReadableAmountToBigInt,
    swapWithExactIn,
    swapWithExactOut,
    swapAndExecute,
    calculateMaxForSwap,
    calculateMaxForBridge,
    hasEvmProvider: () => !!state.evm,
    networkHint: networkConfig.NETWORK_HINT,
    networkConfig,
    getMiddlewareClient: () => state.middlewareClient,
  };
};
