import { CurrencyID, Universe } from '@arcana/ca-common';

import { getLogger } from '../logger';
import { divDecimals } from '../utils';
import { ZERO_BYTES_32 } from './constants';
import { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler } from './ob';
import { determineSwapRoute } from './route';
import { DETERMINING_SWAP, SWAP_START, SwapStep } from './steps';
import type { SwapInput, SwapOptionalParams } from '@nexus/commons';
import {
  Cache,
  convertTo32Bytes,
  createSwapIntent,
  getERC20TokenInfo,
  postSwap,
  PublicClientList,
  SwapMetadata,
} from './utils';

const logger = getLogger();

const ErrorUserDeniedIntent = new Error('User denied swap');

export const swap = async (
  input: SwapInput,
  options: SwapOptionalParams,
  COT = CurrencyID.USDC,
): Promise<void> => {
  performance.clearMarks();
  performance.clearMeasures();

  const publicClientList = new PublicClientList(input.chainList);
  const cache = new Cache(publicClientList);
  const destinationChain = input.chainList.getChainByID(input.destination.chainID);

  if (!destinationChain) {
    throw new Error('destination chain not supported');
  }

  performance.mark('swap-start');

  const ephemeralAddress = input.ephemeralWallet.address;
  const actualAddress = (await input.actualWallet.getAddresses())[0];
  const emitter = {
    emit: (step: SwapStep) => {
      options.emit('swap_step', step);
    },
  };

  emitter.emit(SWAP_START);

  logger.debug('swapBegin', { actualAddress, ephemeralAddress, input });

  performance.mark('determine-swaps-start');

  emitter.emit(DETERMINING_SWAP());

  const params = {
    address: actualAddress,
    chainID: input.destination.chainID,
    chainList: input.chainList,
    COT,
    eAddress: ephemeralAddress,
    networkConfig: input.networkConfig,
    outputToken: input.destination.token,
    universe: Universe.ETHEREUM,
  };

  const [swapRoute, dstTokenInfo] = await Promise.all([
    determineSwapRoute(
      input.destination.amount == undefined
        ? { ...params, mode: 'EXACT_IN', source: input.source }
        : {
            ...params,
            mode: 'EXACT_OUT',
            outputAmount: input.destination.amount,
          },
    ),
    getERC20TokenInfo(input.destination.token, publicClientList.get(input.destination.chainID)),
  ]);

  logger.debug('initial-swap-route', {
    dstTokenInfo,
    swapRoute,
  });

  let { assetsUsed, bridgeInput, destinationSwap, sourceSwaps } = swapRoute;

  emitter.emit(DETERMINING_SWAP(true));
  performance.mark('determine-swaps-end');

  performance.mark('xcs-ops-start');

  // Swap Intent hook handling
  {
    if (options?.swapIntentHook) {
      const hook = options?.swapIntentHook;

      const destination = {
        amount: divDecimals(
          input.destination.amount ?? destinationSwap.outputAmount,
          dstTokenInfo.decimals,
        ).toFixed(),
        chainID: input.destination.chainID,
        contractAddress: input.destination.token,
        decimals: dstTokenInfo.decimals,
        symbol: dstTokenInfo.symbol,
      };

      let accepted = false;

      const refresh = async () => {
        if (accepted) {
          logger.warn('Swap Intent refresh called after acceptance');
          return createSwapIntent(assetsUsed, destination, input.chainList);
        }

        const swapRouteResponse = await determineSwapRoute(
          input.destination.amount == undefined
            ? { ...params, mode: 'EXACT_IN' }
            : {
                ...params,
                mode: 'EXACT_OUT',
                outputAmount: input.destination.amount,
              },
        );

        sourceSwaps = swapRouteResponse.sourceSwaps;
        assetsUsed = swapRouteResponse.assetsUsed;
        destinationSwap = swapRouteResponse.destinationSwap;
        bridgeInput = swapRouteResponse.bridgeInput;
        logger.debug('refresh-swap-route', {
          dstTokenInfo,
          swapRoute: swapRouteResponse,
        });
        return createSwapIntent(assetsUsed, destination, input.chainList);
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

        hook({
          allow,
          deny,
          intent: createSwapIntent(assetsUsed, destination, input.chainList),
          refresh,
        });
      });
    }
  }

  const metadata: SwapMetadata = {
    dst: {
      chid: convertTo32Bytes(input.destination.chainID),
      swaps: [],
      tx_hash: ZERO_BYTES_32,
      univ: Universe.ETHEREUM,
    },
    has_xcs: true,
    rff_id: 0n,
    src: [],
  };

  const opt = {
    address: {
      cosmos: input.cosmos.address,
      eoa: actualAddress,
      ephemeral: ephemeralAddress,
    },
    cache,
    chainList: input.chainList,
    cot: {
      currencyID: COT,
      symbol: CurrencyID[COT],
    },
    destinationChainID: input.destination.chainID,
    emitter,
    networkConfig: input.networkConfig,
    publicClientList,
    wallet: {
      cosmos: input.cosmos.wallet,
      eoa: input.actualWallet,
      ephemeral: input.ephemeralWallet,
    },
  };

  const srcSwapsHandler = new SourceSwapsHandler(sourceSwaps, opt);
  const bridgeHandler = new BridgeHandler(bridgeInput, opt);
  const dstSwapHandler = new DestinationSwapHandler(
    { ...destinationSwap, getDDS: swapRoute.getDDS },
    dstTokenInfo,
    input.destination,
    opt,
  );

  // Creates RFF, sets eoaToEphCalls & rffDepositCalls on srcSwapsHandler
  // Also caches
  performance.mark('allowance-cache-start');
  await Promise.all([bridgeHandler.preprocess(srcSwapsHandler), cache.process()]);
  performance.mark('allowance-cache-end');

  // 0.5: Destination swap: create permit
  await dstSwapHandler.createPermit();

  // 1: Source swap
  await srcSwapsHandler.process(metadata);

  // 2: Bridge, Wait for RFF Fill (if RFF required)
  await bridgeHandler.process(metadata);

  // await new Promise((resolve) => setTimeout(resolve, 4000));

  // 3: Destination swap
  await dstSwapHandler.process(metadata);

  performance.mark('swap-end');
  try {
    const id = await postSwap({
      metadata,
      wallet: input.ephemeralWallet,
    });
    logger.debug('SwapID', { id });
  } catch (e) {
    logger.error('postSwap', e);
  }

  calculatePerformance();
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
