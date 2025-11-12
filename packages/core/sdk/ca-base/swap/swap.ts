import {
  Aggregator,
  BebopAggregator,
  CurrencyID,
  LiFiAggregator,
  Universe,
} from '@avail-project/ca-common';

import {
  SwapMode,
  type SwapData,
  type SwapParams,
  SuccessfulSwapResult,
  NEXUS_EVENTS,
  SWAP_STEPS,
  SwapStepType,
} from '@nexus/commons';

import { getLogger } from '@nexus/commons';
import { divDecimals } from '../utils';
import { BEBOP_API_KEY, LIFI_API_KEY, ZERO_BYTES_32 } from './constants';
import { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler } from './ob';
import { determineSwapRoute } from './route';
import {
  Cache,
  convertMetadataToSwapResult,
  convertTo32Bytes,
  createSwapIntent,
  getTokenInfo,
  postSwap,
  PublicClientList,
  SwapMetadata,
} from './utils';
import { Errors } from '../errors';

const logger = getLogger();

const ErrorUserDeniedIntent = new Error('User denied swap');

export const swap = async (
  input: SwapData,
  options: SwapParams,
  COT = CurrencyID.USDC,
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
    // new ZeroExAggregator(ZERO_X_API_KEY),
  ];

  const swapRouteParams = { ...options, aggregators, cotCurrencyID: COT };

  const [swapRoute, dstTokenInfo] = await Promise.all([
    determineSwapRoute(input, swapRouteParams),
    getTokenInfo(input.data.toTokenAddress, publicClientList.get(input.data.toChainId), dstChain),
  ]);

  logger.debug('initial-swap-route', {
    dstTokenInfo,
    swapRoute,
  });

  let { source, destination, bridge, extras } = swapRoute;

  logger.debug('initial-swap-route', {
    source,
    destination,
    bridge,
    extras,
    dstTokenInfo,
    swapRoute,
  });

  emitter.emit(SWAP_STEPS.DETERMINING_SWAP(true));
  performance.mark('determine-swaps-end');

  performance.mark('xcs-ops-start');

  // Swap Intent hook handling
  {
    const destinationTokenDetails = {
      amount: divDecimals(
        input.mode === SwapMode.EXACT_OUT ? input.data.toAmount : destination.swap.outputAmount,
        dstTokenInfo.decimals,
      ).toFixed(),
      chainID: input.data.toChainId,
      contractAddress: input.data.toTokenAddress,
      decimals: dstTokenInfo.decimals,
      symbol: dstTokenInfo.symbol,
    };

    let accepted = false;

    const refresh = async () => {
      if (accepted) {
        logger.warn('Swap Intent refresh called after acceptance');
        return createSwapIntent(extras.assetsUsed, destinationTokenDetails, options.chainList);
      }

      const swapRouteResponse = await determineSwapRoute(input, swapRouteParams);

      source = swapRouteResponse.source;
      extras = swapRouteResponse.extras;
      destination = swapRouteResponse.destination;
      bridge = swapRouteResponse.bridge;
      logger.debug('refresh-swap-route', {
        dstTokenInfo,
        swapRoute: swapRouteResponse,
      });
      return createSwapIntent(extras.assetsUsed, destinationTokenDetails, options.chainList);
    };
    // wait for intent acceptance hook
    await new Promise((resolve, reject) => {
      const allow = () => {
        accepted = true;
        return resolve('User allowed intent');
      };

      const deny = () => {
        return reject(ErrorUserDeniedIntent);
      };

      options.onSwapIntent({
        allow,
        deny,
        intent: createSwapIntent(extras.assetsUsed, destinationTokenDetails, options.chainList),
        refresh,
      });
    });
  }

  const metadata: SwapMetadata = {
    dst: {
      chid: convertTo32Bytes(input.data.toChainId),
      swaps: [],
      tx_hash: ZERO_BYTES_32,
      univ: Universe.ETHEREUM,
    },
    has_xcs: true,
    rff_id: 0n,
    src: [],
  };

  const opt = {
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
    networkConfig: options.networkConfig,
    publicClientList,
    slippage: 0.005,
    wallet: options.wallet,
  };

  const srcSwapsHandler = new SourceSwapsHandler(source, opt);
  const bridgeHandler = new BridgeHandler(bridge, opt);
  const dstSwapHandler = new DestinationSwapHandler(
    destination,
    dstTokenInfo,
    {
      chainID: input.data.toChainId,
      token: input.data.toTokenAddress,
      amount:
        input.mode === SwapMode.EXACT_OUT ? input.data.toAmount : destination.swap.outputAmount,
    },
    opt,
  );

  performance.mark('allowance-cache-start');
  await cache.process();
  performance.mark('allowance-cache-end');

  // 0.5: Destination swap: create permit
  await dstSwapHandler.createPermit();

  // 1: Source swap
  const assets = await srcSwapsHandler.process(metadata);

  // 2: Bridge, takes source swap output as input so bridge assets are adjusted accordingly
  // wait for RFF Fill (if RFF required)
  await bridgeHandler.process(metadata, assets);

  // 3: Destination swap
  await dstSwapHandler.process(metadata);

  const result = convertMetadataToSwapResult(metadata, options.networkConfig.EXPLORER_URL);

  performance.mark('swap-end');
  try {
    const id = await postSwap({
      metadata,
      wallet: options.wallet.ephemeral,
    });
    logger.debug('SwapID', { id });
  } catch (e) {
    logger.error('postSwap', e);
  }

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
        'allowance-cache-end',
      ),
      performance.measure(
        'determine-swaps-duration',
        'determine-swaps-start',
        'determine-swaps-end',
      ),
    );

    const entries = performance.getEntries();

    if (entries.find((entry) => entry.name === 'source-swap-tx-start')) {
      measures.push(
        performance.measure(
          'source-swap-tx-duration',
          'source-swap-tx-start',
          'source-swap-tx-end',
        ),
        performance.measure(
          'source-swap-mining-duration',
          'source-swap-mining-start',
          'source-swap-mining-end',
        ),
      );
    }

    measures.push(
      performance.measure('fill-wait-duration', 'fill-wait-start', 'fill-wait-end'),
      performance.measure(
        'destination-swap-tx-duration',
        'destination-swap-start',
        'destination-swap-end',
      ),
      performance.measure(
        'destination-swap-mining-duration',
        'destination-swap-mining-start',
        'destination-swap-mining-end',
      ),
    );

    console.log('Timings for XCS:');
    measures.forEach((measure) => {
      console.log(`${measure.name}: ${measure.duration}`);
    });
  } catch (e) {
    logger.error('calculatePerformance', e);
  } finally {
    performance.clearMarks();
    performance.clearMeasures();
  }
};
