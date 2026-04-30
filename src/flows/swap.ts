import {
  type Aggregator,
  BebopAggregator,
  CurrencyID,
  FibrousAggregator,
  LiFiAggregator,
  Universe,
} from '@avail-project/ca-common';
import type { Hex } from 'viem';
import {
  getLogger,
  NEXUS_EVENTS,
  type SourceExecution,
  type SuccessfulSwapResult,
  SWAP_STEPS,
  type SwapData,
  SwapMode,
  type SwapParams,
  type SwapStepType,
} from '../commons';
import { Errors } from '../core/errors';
import { BEBOP_API_KEY, LIFI_API_KEY, ZERO_BYTES_32 } from '../swap/constants';
import { createSwapIntent } from '../swap/intent';
import { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler } from '../swap/ob';
import { determineSwapRoute, type SwapRoute } from '../swap/route';
import {
  Cache,
  convertMetadataToSwapResult,
  convertTo32Bytes,
  PublicClientList,
  type SwapMetadata,
} from '../swap/utils';

const logger = getLogger();

const ErrorUserDeniedIntent = new Error('User denied swap');

export const swap = async (
  input: SwapData,
  options: SwapParams,
  COT = CurrencyID.USDC
): Promise<SuccessfulSwapResult> => {
  performance.clearMarks();
  performance.clearMeasures();

  const publicClientList = new PublicClientList(options.chainList);
  const cache = new Cache(publicClientList);
  const dstChain = options.chainList.getChainByID(input.data.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.data.toChainId);
  }

  performance.mark('swap-start');
  const emitter = {
    emit: (step: SwapStepType) => {
      if (options.onEvent) {
        options.onEvent({ name: NEXUS_EVENTS.SWAP_STEP_COMPLETE, args: step });
      }
    },
  };

  emitter.emit(SWAP_STEPS.SWAP_START);

  logger.debug('swapBegin', { options, input });

  performance.mark('determine-swaps-start');

  emitter.emit(SWAP_STEPS.DETERMINING_SWAP());

  const aggregators: Aggregator[] = [
    new LiFiAggregator(LIFI_API_KEY),
    new BebopAggregator(BEBOP_API_KEY),
    new FibrousAggregator(),
  ];

  const swapRouteParams = { ...options, publicClientList, aggregators, cotCurrencyID: COT };

  let swapRoute = await determineSwapRoute(input, swapRouteParams);
  let { source, destination, bridge, extras } = swapRoute;

  logger.debug('initial-swap-route', {
    source,
    destination,
    bridge,
    extras,
    swapRoute,
  });

  emitter.emit(SWAP_STEPS.DETERMINING_SWAP(true));
  performance.mark('determine-swaps-end');

  performance.mark('xcs-ops-start');

  swapRoute = await waitForIntentApproval(swapRoute, {
    input,
    swapRouteParams,
    onSwapIntent: options.onSwapIntent,
    chainList: options.chainList,
  });

  ({ source, destination, bridge, extras } = swapRoute);

  const metadata = createMetadata(input);
  const opt = createSwapHandlerOptions({
    options,
    aggregators,
    cache,
    COT,
    input,
    emitter,
    publicClientList,
  });

  const srcSwapsHandler = new SourceSwapsHandler(swapRoute, opt);
  const bridgeHandler = new BridgeHandler(bridge, opt, source.executions);
  const dstSwapHandler = new DestinationSwapHandler(swapRoute, opt);

  performance.mark('allowance-cache-start');
  await cache.process();
  performance.mark('allowance-cache-end');

  await ensureCaliburAccountsBeforeExecution({
    bridgeHandler,
    destinationChainID: destination.chainId,
    destinationExecution: destination.execution,
    options,
    sourceExecutions: source.executions,
    sourceHandler: srcSwapsHandler,
  });

  // 0.5: Destination swap: create permit
  await dstSwapHandler.createPermit();

  // 1: Source swap
  const assets = await srcSwapsHandler.process(metadata);

  // 2: Bridge, takes source swap output as input so bridge assets are adjusted accordingly
  // wait for RFF Fill (if RFF required)
  await bridgeHandler.process(metadata, assets);

  // 3: Destination swap
  await dstSwapHandler.process(metadata);

  const result = convertMetadataToSwapResult(metadata, options.intentExplorerUrl);
  result.swapRoute = swapRoute;

  performance.mark('swap-end');

  calculatePerformance();

  return result;
};

const calculatePerformance = () => {
  try {
    const measures: PerformanceMeasure[] = [];
    measures.push(
      performance.measure('xcs-total-duration', 'swap-start', 'swap-end'),
      performance.measure('xcs-ops-duration', 'xcs-ops-start', 'xcs-ops-end'),
      performance.measure(
        'allowance-calls-duration',
        'allowance-cache-start',
        'allowance-cache-end'
      ),
      performance.measure(
        'determine-swaps-duration',
        'determine-swaps-start',
        'determine-swaps-end'
      )
    );

    const entries = performance.getEntries();

    if (entries.some((entry) => entry.name === 'source-swap-tx-start')) {
      measures.push(
        performance.measure(
          'source-swap-tx-duration',
          'source-swap-tx-start',
          'source-swap-tx-end'
        ),
        performance.measure(
          'source-swap-mining-duration',
          'source-swap-mining-start',
          'source-swap-mining-end'
        )
      );
    }

    measures.push(
      performance.measure('fill-wait-duration', 'fill-wait-start', 'fill-wait-end'),
      performance.measure(
        'destination-swap-tx-duration',
        'destination-swap-start',
        'destination-swap-end'
      ),
      performance.measure(
        'destination-swap-mining-duration',
        'destination-swap-mining-start',
        'destination-swap-mining-end'
      )
    );

    console.log('Timings for XCS:');
    for (const measure of measures) {
      console.log(`${measure.name}: ${measure.duration}`);
    }
  } catch (e) {
    logger.error('calculatePerformance', e);
  } finally {
    performance.clearMarks();
    performance.clearMeasures();
  }
};

const createMetadata = (input: SwapData): SwapMetadata => ({
  dst: {
    chid: convertTo32Bytes(input.data.toChainId),
    swaps: [],
    tx_hash: ZERO_BYTES_32,
    univ: Universe.ETHEREUM,
  },
  has_xcs: true,
  rff_id: 0n,
  src: [],
});

type SwapHandlerOptionsContext = {
  options: SwapParams;
  aggregators: Aggregator[];
  cache: Cache;
  COT: CurrencyID;
  input: SwapData;
  emitter: { emit: (step: SwapStepType) => void };
  publicClientList: PublicClientList;
};

const createSwapHandlerOptions = ({
  options,
  aggregators,
  cache,
  COT,
  input,
  emitter,
  publicClientList,
}: SwapHandlerOptionsContext) => ({
  address: options.address,
  aggregators,
  cache,
  chainList: options.chainList,
  cot: {
    currencyID: COT,
    symbol: CurrencyID[COT],
  },
  destinationChainID: input.data.toChainId,
  emitter,
  publicClientList,
  slippage: 0.005,
  wallet: options.wallet,
  cosmosQueryClient: options.cosmosQueryClient,
  vscClient: options.vscClient,
});

const ensureCaliburAccountsBeforeExecution = async ({
  bridgeHandler,
  destinationChainID,
  destinationExecution,
  options,
  sourceExecutions,
  sourceHandler,
}: {
  bridgeHandler: BridgeHandler;
  destinationChainID: number;
  destinationExecution: SwapRoute['destination']['execution'];
  options: SwapParams;
  sourceExecutions: Record<number, SourceExecution>;
  sourceHandler: SourceSwapsHandler;
}) => {
  const executionsByChain = new Map<number, SourceExecution | typeof destinationExecution>();
  const addExecution = (
    chainID: number,
    execution: SourceExecution | typeof destinationExecution | undefined
  ) => {
    if (!execution || execution.mode !== 'calibur_account') {
      return;
    }
    if (!execution.entryPoint) {
      throw Errors.internal(`Calibur entrypoint not configured for chain ${chainID}`);
    }
    executionsByChain.set(chainID, execution);
  };

  for (const chainID of sourceHandler.getPlannedCaliburChains()) {
    addExecution(chainID, sourceExecutions[chainID]);
  }
  for (const chainID of bridgeHandler.getPlannedCaliburDepositChains()) {
    addExecution(chainID, sourceExecutions[chainID]);
  }
  addExecution(destinationChainID, destinationExecution);

  await Promise.all(
    [...executionsByChain.entries()].map(([chainID, execution]) =>
      options.vscClient.vscEnsureCaliburAccount({
        chainId: chainID,
        entryPoint: execution.entryPoint!,
        keys: [
          {
            keyType: 2,
            publicKey: convertTo32Bytes(options.address.eoa),
            settings: convertTo32Bytes(1n << 200n),
          },
          {
            keyType: 2,
            publicKey: convertTo32Bytes(options.address.ephemeral),
            settings: convertTo32Bytes(1n << 200n),
          },
        ],
        owner: options.address.eoa,
      })
    )
  );
};

type IntentApprovalContext = {
  input: SwapData;
  swapRouteParams: Parameters<typeof determineSwapRoute>[1];
} & Pick<SwapParams, 'onSwapIntent' | 'chainList'>;

const waitForIntentApproval = async (
  initialRoute: SwapRoute,
  ctx: IntentApprovalContext
): Promise<SwapRoute> => {
  let currentRoute = initialRoute;
  let accepted = false;

  const refresh = async (fromSources?: { chainId: number; tokenAddress: Hex }[]) => {
    if (accepted) {
      logger.warn('Swap Intent refresh called after acceptance');
      return createSwapIntent(currentRoute, ctx.input, ctx.chainList);
    }

    const updatedInput = { ...ctx.input };
    // Can only update sources in exact out. Update only if sources are sent in refresh.
    if (updatedInput.mode === SwapMode.EXACT_OUT && fromSources && fromSources.length > 0) {
      updatedInput.data.fromSources = fromSources;
    }

    currentRoute = await determineSwapRoute(updatedInput, ctx.swapRouteParams);
    logger.debug('refresh-swap-route', { swapRoute: currentRoute });

    const swapIntent = createSwapIntent(currentRoute, ctx.input, ctx.chainList);
    logger.debug('onIntentHook:refresh', { swapIntent });
    return swapIntent;
  };

  await new Promise<void>((resolve, reject) => {
    const allow = () => {
      accepted = true;
      resolve();
    };
    const deny = () => reject(ErrorUserDeniedIntent);

    const swapIntent = createSwapIntent(currentRoute, ctx.input, ctx.chainList);
    logger.debug('onIntentHook', { swapIntent });
    ctx.onSwapIntent({ allow, deny, intent: swapIntent, refresh });
  });

  return currentRoute;
};
