import { getLogger, type SwapPlan } from '../domain';
import { getIntentExplorerUrl } from '../services/explorer';
import { withTimingSpan } from '../services/timing';
import { SLIPPAGE_DEFAULT } from '../swap/constants';
import { executeSwapBridge } from '../swap/execution/bridge';
import { executeDirectDestinationExactOut } from '../swap/execution/direct-destination';
import { executeDestinationSwap } from '../swap/execution/destination-swap';
import {
  cleanupStrandedCot,
  resolveFailureSweepCurrencyId,
} from '../swap/execution/failure-cleanup';
import { executeSourceSwaps } from '../swap/execution/source-swaps';
import { createSwapIntent } from '../swap/intent';
import { buildSwapPreflight, type SwapPreflight } from '../swap/preflight';
import { prepareSwapExecution } from '../swap/prepare';
import { createSwapProgressEmitter } from '../swap/progress';
import type { RouteOptions } from '../swap/route';
import { determineSwapRoute } from '../swap/route';
import { createSwapPlan } from '../swap/swap-steps-builder';
import type {
  BridgeAsset,
  Source,
  SwapData,
  SwapIntent,
  SwapMetadata,
  SwapParams,
  SwapResult,
  SwapRoute,
} from '../swap/types';
import { SwapMode } from '../swap/types';
import { SwapCache } from '../swap/wallet/cache';
import type { SwapDeps } from './deps';

const logger = getLogger();

export type SwapFlowOptions = {
  onIntent?: SwapParams['onIntent'];
  onEvent?: SwapParams['emit'];
  slippageTolerance?: number;
  preloadedBalances?: SwapParams['preloadedBalances'];
  preloadedDstTokenInfo?: SwapPreflight['dstTokenInfo'];
};

type SwapPreviewContext = {
  chainList: SwapDeps['chainList'];
  eoaAddress: SwapDeps['evm']['address'];
  ephemeralWallet: SwapDeps['swap']['ephemeralWallet'];
  cotCurrencyId: SwapDeps['swap']['cotCurrencyId'];
  middlewareClient: SwapDeps['middlewareClient'];
  forceMayan: SwapDeps['forceMayan'];
  preflight: SwapPreflight;
};

// Bridge funding always flows through the ephemeral identity, so executed swap output is the
// authoritative ephemeralBalance and planned eoaBalance carries direct-COT holdings into the
// merge.
const mergeBridgeAssets = (
  plannedAssets: BridgeAsset[],
  executedAssets: BridgeAsset[]
): BridgeAsset[] => {
  const plannedByKey = new Map(
    plannedAssets.map((asset) => [
      `${asset.chainID}:${asset.contractAddress.toLowerCase()}:${asset.decimals}`,
      asset,
    ])
  );
  const executedByKey = new Map(
    executedAssets.map((asset) => [
      `${asset.chainID}:${asset.contractAddress.toLowerCase()}:${asset.decimals}`,
      asset,
    ])
  );

  const keys = new Set([...plannedByKey.keys(), ...executedByKey.keys()]);
  const merged: BridgeAsset[] = [];

  for (const key of keys) {
    const planned = plannedByKey.get(key);
    const executed = executedByKey.get(key);

    if (!planned) {
      // key came from executedByKey since plannedByKey doesn't have it
      if (executed) merged.push(executed);
      continue;
    }
    if (!executed) {
      merged.push(planned);
      continue;
    }
    merged.push({
      ...executed,
      eoaBalance: planned.eoaBalance,
      ephemeralBalance: executed.ephemeralBalance,
    });
  }

  return merged.sort((left, right) => left.chainID - right.chainID);
};

const createRouteOptions = (
  context: Pick<
    SwapPreviewContext,
    | 'cotCurrencyId'
    | 'chainList'
    | 'eoaAddress'
    | 'ephemeralWallet'
    | 'middlewareClient'
    | 'forceMayan'
  >,
  preflight: SwapPreflight
): RouteOptions => ({
  aggregators: preflight.aggregators,
  bridgeQuoteResponse: preflight.bridgeQuoteResponse,
  chainList: context.chainList,
  middlewareClient: context.middlewareClient,
  publicClientList: preflight.publicClientList,
  oraclePrices: preflight.oraclePrices,
  dstTokenInfo: preflight.dstTokenInfo,
  eoaAddress: context.eoaAddress,
  ephemeralAddress: context.ephemeralWallet.address,
  cotCurrencyId: context.cotCurrencyId,
  balances: preflight.balances,
  walletPathHints: preflight.walletPathHints,
  quoteAddressHints: new Map(
    [...preflight.walletPathHints.entries()].map(([chainId, walletPath]) => [
      chainId,
      walletPath === 'ephemeral' ? context.ephemeralWallet.address : context.eoaAddress,
    ])
  ),
  forceMayan: context.forceMayan,
});

export type SwapPreviewState = {
  route: SwapRoute;
  intent: SwapIntent;
  plan: SwapPlan;
};

const createSwapPreviewStateFromRoute = (
  route: SwapRoute,
  input: SwapData,
  chainList: SwapDeps['chainList']
): SwapPreviewState => {
  const intent = createSwapIntent(route, input, chainList);

  return {
    route,
    intent,
    plan: createSwapPlan(route, chainList),
  };
};

export const buildSwapPreviewState = async (
  input: SwapData,
  context: SwapPreviewContext
): Promise<SwapPreviewState> => {
  const route = await determineSwapRoute(input, createRouteOptions(context, context.preflight));
  return createSwapPreviewStateFromRoute(route, input, context.chainList);
};

const waitForIntentApproval = (
  onIntent: NonNullable<SwapFlowOptions['onIntent']>,
  initialPreviewState: SwapPreviewState,
  input: SwapData,
  deps: SwapDeps,
  onPreviewStateUpdated?: (nextPreviewState: SwapPreviewState) => void
): Promise<SwapPreviewState> => {
  return new Promise<SwapPreviewState>((resolve, reject) => {
    let accepted = false;
    let currentPreviewState = initialPreviewState;

    const refresh = async (sources?: Source[]): Promise<SwapIntent> => {
      if (accepted) {
        return currentPreviewState.intent;
      }

      const refreshedInput: SwapData =
        sources && input.mode === SwapMode.EXACT_OUT
          ? {
              mode: SwapMode.EXACT_OUT,
              data: {
                ...input.data,
                sources,
              },
            }
          : input;

      logger.debug('SwapFlow:refresh', {
        mode: refreshedInput.mode,
        toChainId: refreshedInput.data.toChainId,
      });

      const preflight = await buildSwapPreflight(refreshedInput, {
        chainList: deps.chainList,
        cotCurrencyId: deps.swap.cotCurrencyId,
        eoaAddress: deps.evm.address,
        middlewareClient: deps.middlewareClient,
      });

      currentPreviewState = await buildSwapPreviewState(refreshedInput, {
        chainList: deps.chainList,
        eoaAddress: deps.evm.address,
        ephemeralWallet: deps.swap.ephemeralWallet,
        cotCurrencyId: deps.swap.cotCurrencyId,
        middlewareClient: deps.middlewareClient,
        forceMayan: deps.forceMayan,
        preflight,
      });
      onPreviewStateUpdated?.(currentPreviewState);
      return currentPreviewState.intent;
    };

    try {
      onIntent({
        intent: currentPreviewState.intent,
        allow: () => {
          accepted = true;
          resolve(currentPreviewState);
        },
        deny: () => {
          accepted = true;
          reject(new Error('User denied swap intent'));
        },
        refresh,
      });
    } catch (error) {
      reject(error);
    }
  });
};

const runSwapFlow = async (
  input: SwapData,
  deps: SwapDeps,
  options?: SwapFlowOptions
): Promise<SwapResult> => {
  const slippage = options?.slippageTolerance ?? SLIPPAGE_DEFAULT;
  const { emitStatus, emitPlanPreview, emitPlanConfirmed, emitExecutionProgress } =
    createSwapProgressEmitter(options?.onEvent);

  logger.debug('SwapFlow:init', { mode: input.mode, toChainId: input.data.toChainId });

  emitStatus('route_building');
  const preflight = await withTimingSpan(deps.timing, 'flow.swap.preflight', async () =>
    buildSwapPreflight(input, {
      chainList: deps.chainList,
      cotCurrencyId: deps.swap.cotCurrencyId,
      eoaAddress: deps.evm.address,
      middlewareClient: deps.middlewareClient,
      preloadedBalances: options?.preloadedBalances,
      preloadedDstTokenInfo: options?.preloadedDstTokenInfo,
    })
  );

  let route = await withTimingSpan(deps.timing, 'flow.swap.determine_route', async () =>
    determineSwapRoute(
      input,
      createRouteOptions(
        {
          chainList: deps.chainList,
          eoaAddress: deps.evm.address,
          ephemeralWallet: deps.swap.ephemeralWallet,
          cotCurrencyId: deps.swap.cotCurrencyId,
          middlewareClient: deps.middlewareClient,
          forceMayan: deps.forceMayan,
        },
        preflight
      )
    )
  );
  let previewState = await withTimingSpan(deps.timing, 'flow.swap.create_intent', async () =>
    createSwapPreviewStateFromRoute(route, input, deps.chainList)
  );

  emitStatus('route_ready');
  emitPlanPreview(previewState.plan);
  emitStatus('awaiting_approval');

  const onIntent = options?.onIntent;
  const approval = await withTimingSpan(deps.timing, 'flow.swap.hooks', async () =>
    onIntent
      ? waitForIntentApproval(onIntent, previewState, input, deps, (nextPreviewState) => {
          previewState = nextPreviewState;
          route = nextPreviewState.route;
          emitPlanPreview(nextPreviewState.plan);
        })
      : previewState
  );

  previewState = approval;
  route = approval.route;

  emitStatus('approved');
  emitPlanConfirmed(previewState.plan);
  emitStatus('executing');

  const cache = new SwapCache(deps.chainList);
  const metadata: SwapMetadata = {
    src: [],
    dst: null,
    has_xcs: route.bridge !== null,
    intent_request_hash: null,
  };

  const preparedExecution = await withTimingSpan(
    deps.timing,
    'flow.swap.prepare_execution',
    async () =>
      prepareSwapExecution({
        chainList: deps.chainList,
        route,
        source: route.source,
        destination: route.destination,
        eoaAddress: deps.evm.address,
        eoaWallet: deps.evm.walletClient,
        ephemeralWallet: deps.swap.ephemeralWallet,
        publicClientList: preflight.publicClientList,
        cache,
      })
  );

  const executionContext = {
    chainList: deps.chainList,
    sourceExecutionPaths: route.sourceExecutionPaths,
    destinationDirectEoa:
      route.destination.swap.tokenSwap === null && route.destination.swap.gasSwap === null,
    destinationChainId: route.destination.chainId,
    eoaAddress: deps.evm.address,
    ephemeralWallet: deps.swap.ephemeralWallet,
    eoaWallet: deps.evm.walletClient,
    intentExplorerUrl: deps.intentExplorerUrl,
    publicClientList: preflight.publicClientList,
    middlewareClient: deps.middlewareClient,
    bridgeQuoteResponse: preflight.bridgeQuoteResponse ?? undefined,
    cache,
    preparedExecution,
    onProgress: emitExecutionProgress,
    slippage,
  } as const;

  // Source/bridge stages strand the COT on the source chains; once we enter the destination swap
  // it sits on the destination chain. The flag picks which side the cleanup reads.
  let reachedDestinationSwap = false;
  try {
    const executedSourceAssets = await withTimingSpan(
      deps.timing,
      'flow.swap.execute_source',
      async () => {
        if (route.directDestination === true && route.type === SwapMode.EXACT_OUT) {
          await executeDirectDestinationExactOut(route, executionContext, metadata);
          return [];
        }
        return executeSourceSwaps(route.source, executionContext, metadata);
      }
    );

    const bridge = route.bridge;
    if (bridge) {
      const bridgeAssets = mergeBridgeAssets(bridge.assets, executedSourceAssets);
      await withTimingSpan(deps.timing, 'flow.swap.execute_bridge', async () =>
        executeSwapBridge(bridge, bridgeAssets, executionContext, metadata)
      );
    }

    reachedDestinationSwap = true;
    await withTimingSpan(deps.timing, 'flow.swap.execute_destination', async () =>
      executeDestinationSwap(
        route.destination,
        route.type,
        route.dstTokenInfo,
        executionContext,
        metadata
      )
    );
  } catch (error) {
    // Fast same-token Nexus bridges deposit the exact amount directly (nothing strands) → skip.
    // Otherwise sweep the route's settlement currency on just the chains the failure stranded it:
    // the destination chain if the destination swap failed, else the executed source chains.
    const sweepCurrencyId = resolveFailureSweepCurrencyId(route);
    if (sweepCurrencyId !== null) {
      const chainIds = reachedDestinationSwap
        ? [route.destination.chainId]
        : metadata.src.map((entry) => entry.chid);
      await cleanupStrandedCot({ currencyId: sweepCurrencyId, chainIds, ctx: executionContext });
    }
    throw error;
  }

  const sourceSwaps = metadata.src.map((entry) => ({
    chainId: entry.chid,
    swaps: entry.swaps,
    txHash: entry.tx_hash,
  }));
  const destinationSwap = metadata.dst
    ? { chainId: metadata.dst.chid, swaps: metadata.dst.swaps, txHash: metadata.dst.tx_hash }
    : null;

  emitStatus('completed');

  const intentExplorerUrl = metadata.intent_request_hash
    ? getIntentExplorerUrl(deps.intentExplorerUrl, metadata.intent_request_hash)
    : '';

  logger.debug('SwapFlow:complete', {
    sourceChains: sourceSwaps.map((entry) => entry.chainId),
    hasBridge: route.bridge !== null,
    hasDestinationSwap: destinationSwap !== null,
  });

  return {
    sourceSwaps,
    intentExplorerUrl,
    destinationSwap,
    intent: previewState.intent,
  };
};

export const swap = (
  input: SwapData,
  deps: SwapDeps,
  options?: SwapFlowOptions
): Promise<SwapResult> => runSwapFlow(input, deps, options);
