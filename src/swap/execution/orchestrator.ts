import { getLogger } from '../../domain';
import { NexusError } from '../../domain/errors';
import { withTimingSpan } from '../../services/timing';
import type { BridgeAsset, ExecutionContext, SwapMetadata, SwapRoute } from '../types';
import { SwapMode } from '../types';
import { executeSwapBridge } from './bridge';
import { executeDestinationSwap } from './destination-swap';
import { executeDirectDestinationExactOut } from './direct-destination';
import { cleanupStrandedCot, resolveFailureSweepCurrencyId } from './failure-cleanup';
import { executeSourceSwaps } from './source-swaps';

const logger = getLogger();

type SwapRouteExecutionContext = ExecutionContext & { destinationChainId: number };

// Bridge funding always flows through the ephemeral identity, so executed swap output is the
// authoritative ephemeralBalance and planned eoaBalance carries direct-COT holdings into the merge.
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

/** Execute the feature-owned source → bridge → destination sequence and clean up failed stages. */
export const executeSwapRoute = async (
  route: SwapRoute,
  context: SwapRouteExecutionContext
): Promise<SwapMetadata> => {
  const metadata: SwapMetadata = {
    src: [],
    dst: null,
    has_xcs: route.bridge !== null,
    intent_request_hash: null,
  };
  const routePath = route.directDestination
    ? 'direct_destination'
    : route.sameTokenBridge
      ? 'same_token'
      : 'cot';

  // Source/bridge stages strand settlement on the source chains. Once destination execution starts,
  // settlement sits on the destination chain; this switch selects the cleanup side on failure.
  let reachedDestinationSwap = false;
  try {
    const executedSourceAssets = await withTimingSpan(
      context.timing,
      'flow.swap.execute_source',
      async () => {
        if (route.directDestination === true && route.type === SwapMode.EXACT_OUT) {
          await executeDirectDestinationExactOut(route, context, metadata);
          return [];
        }
        return executeSourceSwaps(route.source, context, metadata);
      }
    );

    const bridge = route.bridge;
    if (bridge) {
      const bridgeAssets = mergeBridgeAssets(bridge.assets, executedSourceAssets);
      await withTimingSpan(context.timing, 'flow.swap.execute_bridge', async () =>
        executeSwapBridge(bridge, bridgeAssets, context, metadata)
      );
    }

    reachedDestinationSwap = true;
    await withTimingSpan(context.timing, 'flow.swap.execute_destination', async () =>
      executeDestinationSwap(route.destination, route.type, route.dstTokenInfo, context, metadata)
    );
  } catch (error) {
    logger.debug('swap.flow.execution.failed', {
      mode: route.type,
      routePath,
      failureScope: reachedDestinationSwap
        ? 'destination'
        : route.bridge
          ? 'source_or_bridge'
          : 'source',
      errorCode: error instanceof NexusError ? error.code : undefined,
      error: error instanceof Error ? error.message : String(error),
    });

    const sweepCurrencyId = resolveFailureSweepCurrencyId(route);
    if (sweepCurrencyId !== null) {
      const chainIds = reachedDestinationSwap
        ? [route.destination.chainId]
        : metadata.src.map((entry) => entry.chid);
      await withTimingSpan(context.timing, 'flow.swap.execute.cleanup', async () =>
        cleanupStrandedCot({ currencyId: sweepCurrencyId, chainIds, ctx: context })
      );
    }
    throw error;
  }

  return metadata;
};
