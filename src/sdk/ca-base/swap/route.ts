import {
  type Aggregator,
  autoSelectSourcesV2,
  ChaindataMap,
  CurrencyID,
  destinationSwapWithExactIn,
  determineDestinationSwaps,
  liquidateInputHoldings,
  OmniversalChainID,
  type QuoteResponse,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { uniqBy } from 'es-toolkit';
import { type Hex, toBytes } from 'viem';
import {
  type BridgeAsset,
  type ExactInSwapInput,
  type ExactOutSwapInput,
  getLogger,
  type OraclePriceResponse,
  type Source,
  type SwapData,
  SwapMode,
  type SwapParams,
} from '../../../commons';
import { ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';
import {
  calculateMaxBridgeFee,
  convertGasToToken,
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  getBalancesForSwap,
  getFeeStore,
  mulDecimals,
} from '../utils';
import { EADDRESS, EADDRESS_32_BYTES } from './constants';
import type { FlatBalance } from './data';
import { createIntent, estimateCollectionFee } from './rff';
import {
  calculateValue,
  convertTo32Bytes,
  convertToEVMAddress,
  getTokenInfo,
  type PublicClientList,
  sortSourcesByPriority,
} from './utils';

const logger = getLogger();

export const determineSwapRoute = async (
  input: SwapData,
  options: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  }
): Promise<SwapRoute> => {
  logger.debug('determineSwapRoute', {
    input,
    options,
  });
  console.time('swap-route-time');
  const response = await (input.mode === SwapMode.EXACT_OUT
    ? _exactOutRoute(input.data, options)
    : _exactInRoute(input.data, options));
  console.timeEnd('swap-route-time');

  return response;
};

export const applyBuffer = (amount: Decimal, bufferPercent: number): Decimal =>
  amount.mul(1 + bufferPercent / 100);

const applyBufferWithCap = (
  amount: Decimal,
  bufferPercent: number,
  cap: number
): { amountWithBuffer: Decimal; buffer: Decimal } => {
  const cappedBuffer = Decimal.min(amount.mul(bufferPercent / 100), cap);

  return { amountWithBuffer: amount.plus(cappedBuffer), buffer: cappedBuffer };
};

/*
Exact out:
sF = solver Fee
cF = collection Fee
fF = fulfilment Fee

Destination Swap:
min: 1 USDC
max: 1.05 USDC (5% buffer)

Source Swap:
bFee = 0.07 USDC (cF + fF) (sF should be covered by buffer in source swap)
output: max + 1% max + bFee = 1.05 + 0.01 + 0.07 = 1.08 USDC

Bridge:
use max as output

source amount will be like max + (s1 + s2)sF + (s1 + s2)cF + fF
                                -------------  -----------------
                                  covered by    already included
                                    buffer      during calculation
*/

// COT = currency of transfer
// DEF: The common currency which is supported by bridge on every supported chain and acts as a transient currency for swaps.
// FLOW: Source tokens get converted to COT, COT is bridged across chains to a destination chain,
// COT is then changed to desired destination token
// Currently COT is USDC.

enum BUFFER_EXACT_OUT {
  DESTINATION_SWAP_BUFFER_PCT = 5,
  DESTINATION_SWAP_MAX_IN_USD = 2, // <-- magic number ???
  SOURCE_SWAP_BUFFER_PCT = 2,
  SOURCE_SWAP_MAX_IN_USD = 1, // <-- another magic
}

const getCOTForChainId = (chainId: number | bigint, cotCurrencyID = CurrencyID.USDC) => {
  const chainData = ChaindataMap.get(new OmniversalChainID(Universe.ETHEREUM, chainId));
  if (!chainData) {
    throw Errors.internal(`chain data not found for chain ${chainId}`);
  }

  const cot = chainData.Currencies.find((c) => c.currencyID === cotCurrencyID);
  if (!cot) {
    throw Errors.internal(`COT not found for chain ${chainId}`);
  }

  return { cot, address: convertToEVMAddress(cot.tokenAddress) };
};

// Helper to normalize token addresses for comparison (preserves EADDRESS vs ZERO_ADDRESS handling)
const normalizeToComparisonAddr = (tokenHex: Hex) =>
  convertTo32BytesHex(equalFold(tokenHex, ZERO_ADDRESS) ? EADDRESS : tokenHex);

// --- shared route helpers ---

/** Merges a source swap's output into the bridgeAssets accumulator (mutates in place). */
const accumulateSwapIntoBridgeAssets = (bridgeAssets: BridgeAsset[], swap: QuoteResponse): void => {
  const existing = bridgeAssets.find(
    (ba) =>
      ba.chainID === Number(swap.chainID) &&
      equalFold(ba.contractAddress, swap.quote.output.contractAddress)
  );
  if (existing) {
    existing.ephemeralBalance = existing.ephemeralBalance.add(swap.quote.output.amount);
  } else {
    bridgeAssets.push({
      chainID: Number(swap.chainID),
      contractAddress: swap.quote.output.contractAddress as Hex,
      decimals: swap.quote.output.decimals,
      eoaBalance: new Decimal(0),
      ephemeralBalance: new Decimal(swap.quote.output.amount),
    });
  }
};

/** Maps FlatBalance[] to the common input shape expected by aggregator calls. */
const toAggregatorInputs = (balances: FlatBalance[]) =>
  balances.map((b) => ({
    amountRaw: mulDecimals(b.amount, b.decimals),
    chainID: new OmniversalChainID(b.universe, b.chainID),
    tokenAddress: toBytes(b.tokenAddress),
    value: b.value,
  }));

/** Maps BridgeAsset[] to the shape expected by createIntent / calculateMaxBridgeFee. */
const toBridgeAssetInputs = (bridgeAssets: BridgeAsset[]) =>
  bridgeAssets.map((b) => ({
    ...b,
    chainId: b.chainID,
    balance: b.eoaBalance.add(b.ephemeralBalance).toFixed(),
    universe: Universe.ETHEREUM,
  }));

/** Creates a blank destination object seeded with the given inputAmount for both min and max. */
const createDestination = (chainId: number, inputAmount: Decimal): SwapRoute['destination'] => ({
  chainId,
  eoaToEphemeral: null,
  getDstSwap: async () => null,
  swap: { creationTime: Date.now(), tokenSwap: null, gasSwap: null },
  inputAmount: { min: inputAmount, max: inputAmount },
});

/**
 * Resolves the user-specified from[] entries against available balances.
 * Returns the source FlatBalance entries to use and the assetsUsed list for the intent.
 * When from[] is empty, all available balances are used as sources.
 */
const resolveSourceBalances = (
  from: ExactInSwapInput['from'],
  balances: FlatBalance[]
): { srcBalances: FlatBalance[]; assetsUsed: AssetUsed } => {
  const assetsUsed: AssetUsed = [];
  let srcBalances: FlatBalance[] = [];

  if (from.length > 0) {
    for (const f of from) {
      const comparison = normalizeToComparisonAddr(f.tokenAddress);
      const srcBalance = balances.find(
        (b) => equalFold(b.tokenAddress, comparison) && f.chainId === b.chainID
      );
      if (!srcBalance) {
        logger.error('ExactIN: no src balance found', {
          token: f.tokenAddress,
          chainId: f.chainId,
        });
        throw Errors.insufficientBalance(
          `available: 0, required: ${f.amount?.toString() ?? 'max'}`
        );
      }

      if (f.amount !== undefined) {
        const requiredBalance = divDecimals(f.amount, srcBalance.decimals);
        if (requiredBalance.gt(srcBalance.amount)) {
          throw Errors.insufficientBalance(
            `available: ${srcBalance.amount} ${srcBalance.symbol}, required: ${requiredBalance.toFixed()} ${srcBalance.symbol}`
          );
        }
        srcBalances.push({
          ...srcBalance,
          amount: requiredBalance.toFixed(),
          value: calculateValue(srcBalance.amount, srcBalance.value, f.amount).toNumber(),
        });
        assetsUsed.push({
          amount: requiredBalance.toFixed(),
          chainID: srcBalance.chainID,
          contractAddress: srcBalance.tokenAddress,
          decimals: srcBalance.decimals,
          symbol: srcBalance.symbol,
        });
      } else {
        // No amount specified — use full available balance
        srcBalances.push(srcBalance);
        assetsUsed.push({
          amount: srcBalance.amount,
          chainID: srcBalance.chainID,
          contractAddress: srcBalance.tokenAddress,
          decimals: srcBalance.decimals,
          symbol: srcBalance.symbol,
        });
      }
    }
  } else {
    srcBalances = balances.slice();
    for (const b of srcBalances) {
      assetsUsed.push({
        amount: b.amount,
        chainID: b.chainID,
        contractAddress: b.tokenAddress,
        decimals: b.decimals,
        symbol: b.symbol,
      });
    }
  }

  return { srcBalances, assetsUsed };
};

const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  }
): Promise<SwapRoute> => {
  const dstChain = params.chainList.getChainByID(input.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.toChainId);
  }

  const removeSources: Source[] = [
    {
      chainId: input.toChainId,
      tokenAddress: input.toTokenAddress,
    },
  ];
  // 1) Required: 1 KAITO and 0.0004 ETH, Have: 0.2 KAITO and 0.0002 ETH => toNativeAmount = 0.0002 * 10**18
  // 2) Required: 1 KAITO and 0.0004 ETH, Have: 0.2 KAITO and 0.0006 ETH => toNativeAmount = -(0.0004 * 10**18) - this signifies not to touch that amount during source selection (skipped & combined with 3)
  // 3) Required: 1 KAITO and 0.0004 ETH, Have: 0.2 KAITO and 0.0004 ETH => toNativeAmount = -1 => signifying not to touch native currency, just remove from the list of sources
  if (input.toNativeAmount === -1n || (input.toNativeAmount && input.toNativeAmount > 0n)) {
    removeSources.push({
      chainId: input.toChainId,
      tokenAddress: ZERO_ADDRESS,
    });
  }

  const oraclePricesPromise = params.cosmosQueryClient.fetchPriceOracle();

  const [feeStore, rawBalances, oraclePrices, dstTokenInfo] = await Promise.all([
    getFeeStore(params.cosmosQueryClient),
    params.preloadedBalances
      ? Promise.resolve(params.preloadedBalances)
      : getBalancesForSwap({
          evmAddress: params.address.eoa,
          chainList: params.chainList,
          filterWithSupportedTokens: false,
          allowedSources: input.fromSources,
          removeSources,
          oraclePrices: oraclePricesPromise,
        }).then((r) => r.balances),
    oraclePricesPromise,
    getTokenInfo(input.toTokenAddress, params.publicClientList.get(input.toChainId), dstChain),
  ]);

  // When using preloaded balances, apply the allowedSources/removeSources filters inline.
  // FlatBalance.tokenAddress is 32-byte hex, so normalize the filter addresses to match.
  let balances = rawBalances;
  if (params.preloadedBalances) {
    if (input.fromSources?.length) {
      balances = balances.filter((b) =>
        input.fromSources!.some(
          (s) =>
            s.chainId === b.chainID &&
            equalFold(b.tokenAddress, convertTo32BytesHex(s.tokenAddress))
        )
      );
    }
    balances = balances.filter(
      (b) =>
        !removeSources.some(
          (s) =>
            s.chainId === b.chainID &&
            equalFold(b.tokenAddress, convertTo32BytesHex(s.tokenAddress))
        )
    );
  }

  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  logger.debug('exact-out: fetched balances', { balances, input });

  const { cot: dstChainCOT, address: dstChainCOTAddress } = getCOTForChainId(
    input.toChainId,
    params.cotCurrencyID
  );

  let gasInCOT = new Decimal(0);
  if (input.toNativeAmount && input.toNativeAmount > 0n) {
    // Convert to COT
    gasInCOT = convertGasToToken(
      {
        contractAddress: dstChainCOTAddress,
        decimals: dstChainCOT.decimals,
      },
      oraclePrices,
      dstChain.id,
      dstChain.universe,
      divDecimals(input.toNativeAmount ?? 0n, dstChain.nativeCurrency.decimals)
    ).mul(1.02);
  }

  let buffer = new Decimal(0);

  const dstAmount = divDecimals(input.toAmount, dstTokenInfo.decimals).add(gasInCOT);
  const destination = createDestination(input.toChainId, dstAmount);

  // Since its exact out, we start with desired destination amount and work our
  // way backward from there
  let originalMax: Decimal | null = null;
  const getDstSwap = async (): Promise<DestinationSwap> => {
    let tokenSwap = null;
    let gasSwap = null;

    const dstTokenIsCOT = equalFold(input.toTokenAddress, dstChainCOTAddress);
    const dstGasRequired = !gasInCOT.isZero();

    const isDstSwapRequired = !dstTokenIsCOT || dstGasRequired;

    if (isDstSwapRequired) {
      const promises = [];
      if (!dstTokenIsCOT) {
        promises.push(
          determineDestinationSwaps(
            userAddressInBytes,
            {
              chainID: dstOmniversalChainID,
              amountRaw: BigInt(input.toAmount),
              tokenAddress: convertTo32Bytes(input.toTokenAddress),
            },
            params.aggregators
          ).then((q) => {
            tokenSwap = q;
          })
        );
      }

      if (dstGasRequired) {
        promises.push(
          destinationSwapWithExactIn(
            userAddressInBytes,
            dstOmniversalChainID,
            mulDecimals(gasInCOT, dstChainCOT.decimals),
            EADDRESS_32_BYTES,
            params.aggregators
          ).then((q) => {
            gasSwap = q;
          })
        );
      }

      // Only when dst token/gas exists, then we apply buffer
      if (promises.length) {
        await Promise.all(promises);
        // Apply min(5%, 2 USD) buffer to destination input amount - any leftover is sent back in COT.
        const { amountWithBuffer, buffer: dstBuffer } = applyBufferWithCap(
          destination.inputAmount.min,
          BUFFER_EXACT_OUT.DESTINATION_SWAP_BUFFER_PCT,
          BUFFER_EXACT_OUT.DESTINATION_SWAP_MAX_IN_USD
        );
        const rounded = amountWithBuffer.toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL);

        if (originalMax === null) {
          // First call: lock in the COT budget
          originalMax = rounded;
        } else if (rounded.gt(originalMax)) {
          // Requote: new COT requirement exceeds original budget — rates moved against us
          throw Errors.ratesChangedBeyondTolerance(
            Number(rounded.toFixed()),
            `max budget: ${originalMax.toFixed()}`
          );
        }

        destination.inputAmount.max = rounded;
        buffer = buffer.add(dstBuffer);
      }
    }
    return {
      creationTime: Date.now(),
      tokenSwap,
      gasSwap,
    };
  };

  destination.swap = await getDstSwap();
  destination.getDstSwap = getDstSwap;

  logger.debug('destination swaps', destination.swap);

  // Collection Fee needs to be calculated on cot
  const estimatedCollectionFee = estimateCollectionFee(
    uniqBy(
      balances.filter((b) => new Decimal(b.amount).gt(0)),
      (b) => b.chainID
    ).map((b) => {
      const { cot: chainCOT, address: cotAddress } = getCOTForChainId(
        b.chainID,
        params.cotCurrencyID
      );

      // value - usd value, chainID - remains same, contractAddress & decimals - taken from cot
      return {
        value: b.value,
        chainID: b.chainID,
        contractAddress: cotAddress,
        decimals: chainCOT.decimals,
      };
    }),
    destination.inputAmount.max,
    feeStore
  );

  const estimatedBridgeFees = feeStore
    .calculateFulfilmentFee({
      decimals: dstChainCOT.decimals,
      destinationChainID: Number(input.toChainId),
      destinationTokenAddress: dstChainCOTAddress,
    })
    .add(estimatedCollectionFee);

  const bridgeOutput = destination.inputAmount.max;
  const bridgeOutputWithFees = bridgeOutput.add(estimatedBridgeFees);

  const { amountWithBuffer: sourceSwapOutputRequired, buffer: srcBuffer } = applyBufferWithCap(
    bridgeOutputWithFees,
    BUFFER_EXACT_OUT.SOURCE_SWAP_BUFFER_PCT,
    BUFFER_EXACT_OUT.SOURCE_SWAP_MAX_IN_USD
  );

  buffer = buffer.add(srcBuffer);

  logger.debug('exact-out: source swap requirements', {
    dstChainCOTAddress,
    srcBuffer: srcBuffer.toFixed(),
    buffer: buffer.toFixed(),
    estimatedBridgeFees: estimatedBridgeFees.toFixed(),
    bridgeOutput: bridgeOutput.toFixed(),
    sourceSwapOutputRequired: sourceSwapOutputRequired.toFixed(),
  });

  const sortedBalances = sortSourcesByPriority(balances, {
    tokenAddress: input.toTokenAddress,
    symbol: dstTokenInfo.symbol,
    chainID: dstChain.id,
  });

  const { quoteResponses: sourceSwapQuotes, usedCOTs } = await autoSelectSourcesV2(
    userAddressInBytes,
    toAggregatorInputs(sortedBalances),
    sourceSwapOutputRequired,
    params.aggregators
  ).catch((e) => {
    if (e instanceof Error && e.message === 'NOT_ENOUGH_SWAP_FOR_REQUIREMENT') {
      throw Errors.quoteError();
    }
    throw e;
  });

  logger.debug('sourceSwap', {
    sourceSwapQuotes,
  });

  const sourceSwapCreationTime = Date.now();

  let bridgeInput: PendingBridgeInput | null = null;

  // If every source swap and cot used is not on destination chain then bridge is required
  const isBridgeRequired = !(
    sourceSwapQuotes.every((q) => q.chainID === input.toChainId) &&
    usedCOTs.every((q) => Number(q.originalHolding.chainID.chainID) === input.toChainId)
  );

  let dstEOAToEphTx: { amount: bigint; contractAddress: Hex } | null = null;

  // Check if used cot list has destination chain
  const dstChainExistingCOT = usedCOTs.find(
    (c) => Number(c.originalHolding.chainID.chainID) === input.toChainId
  );
  if (dstChainExistingCOT) {
    dstEOAToEphTx = {
      amount: mulDecimals(dstChainExistingCOT.amountUsed, dstChainExistingCOT.cur.decimals),
      contractAddress: convertToEVMAddress(dstChainExistingCOT.originalHolding.tokenAddress),
    };
  }

  const assetsUsed: AssetUsed = [];
  const bridgeAssets: BridgeAsset[] = [];

  // Tracks existing COT + COT after swap, since that shouldn't be involved in swap
  let dstTotalCOTAmount = new Decimal(
    dstEOAToEphTx ? divDecimals(dstEOAToEphTx.amount, dstChainCOT.decimals) : 0
  );

  for (const cot of usedCOTs) {
    assetsUsed.push({
      amount: cot.amountUsed.toFixed(),
      chainID: Number(cot.originalHolding.chainID.chainID),
      contractAddress: convertToEVMAddress(cot.originalHolding.tokenAddress),
      decimals: cot.cur.decimals,
      symbol: CurrencyID[cot.cur.currencyID],
    });

    if (Number(cot.originalHolding.chainID.chainID) === input.toChainId) {
      continue;
    }

    bridgeAssets.push({
      chainID: Number(cot.originalHolding.chainID.chainID),
      contractAddress: convertToEVMAddress(cot.originalHolding.tokenAddress),
      decimals: cot.cur.decimals,
      eoaBalance: cot.amountUsed,
      ephemeralBalance: new Decimal(0),
    });
  }

  for (const swap of sourceSwapQuotes) {
    assetsUsed.push({
      amount: swap.quote.input.amount,
      chainID: swap.chainID,
      contractAddress: swap.quote.input.contractAddress as Hex,
      decimals: swap.quote.input.decimals,
      symbol: swap.quote.input.symbol,
    });

    // If swap happens to COT on destination chain then that amount doesn't needs to be in RFF
    if (swap.chainID === input.toChainId) {
      dstTotalCOTAmount = dstTotalCOTAmount.plus(swap.quote.output.amount);
      continue;
    }

    accumulateSwapIntoBridgeAssets(bridgeAssets, swap);

    logger.debug('exact-out: source swap quote', {
      input: swap.quote.input,
      output: swap.quote.output,
    });
  }

  // Bridge should not involve existing dst cot + any swap to cot on dst chain
  const bridgeAmountWithoutDstCOT = bridgeOutput.minus(dstTotalCOTAmount);

  logger.debug('exact-out: before bridge set', {
    bridgeAmountWithoutDstCOT: bridgeAmountWithoutDstCOT.toFixed(),
    bridgeAssets,
    assetsUsed,
    dstEOAToEphTx,
    isBridgeRequired,
  });

  if (isBridgeRequired) {
    bridgeInput = {
      amount: bridgeAmountWithoutDstCOT,
      assets: bridgeAssets,
      chainID: input.toChainId,
      decimals: dstChainCOT.decimals,
      tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
    };
  }

  const createIntentResponse = bridgeInput
    ? createIntent({
        assets: bridgeAssets,
        feeStore,
        output: bridgeInput,
        address: params.address.ephemeral,
      })
    : null;
  logger.debug('exact-out: bridge intent', { bridgeAssets, bridgeInput, createIntentResponse });

  return {
    source: {
      swaps: sourceSwapQuotes,
      creationTime: sourceSwapCreationTime,
    },
    bridge:
      createIntentResponse && bridgeInput
        ? { ...bridgeInput, estimatedFees: createIntentResponse.intent.fees }
        : null,
    type: 'EXACT_OUT',
    destination,
    buffer: {
      amount: buffer.toFixed(),
    },
    dstTokenInfo,
    extras: {
      aggregators: params.aggregators,
      oraclePrices,
      balances,
      assetsUsed,
    },
  };
};

type DestinationSwap = {
  creationTime: number;
  tokenSwap: QuoteResponse | null;
  gasSwap: QuoteResponse | null;
};

export type SwapRoute = {
  type: 'EXACT_IN' | 'EXACT_OUT';
  source: {
    swaps: QuoteResponse[];
    creationTime: number;
  };
  bridge: BridgeInput;
  destination: {
    chainId: number;
    eoaToEphemeral: {
      amount: bigint;
      contractAddress: Hex;
    } | null;
    inputAmount: { min: Decimal; max: Decimal }; // This is input of tokenSwap + gasSwap + buffer
    swap: DestinationSwap;
    getDstSwap: () => Promise<DestinationSwap | null>;
  };
  buffer: {
    amount: string;
  };
  dstTokenInfo: Awaited<ReturnType<typeof getTokenInfo>>;
  extras: {
    assetsUsed: {
      amount: string;
      chainID: number;
      contractAddress: Hex;
      decimals: number;
      symbol: string;
    }[];
    aggregators: Aggregator[];
    oraclePrices: OraclePriceResponse;
    balances: FlatBalance[];
  };
};

type AssetUsed = {
  amount: string;
  chainID: number;
  contractAddress: Hex;
  decimals: number;
  symbol: string;
}[];

type PendingBridgeInput = {
  amount: Decimal;
  assets: BridgeAsset[];
  chainID: number;
  decimals: number;
  tokenAddress: `0x${string}`;
};

type BridgeInput =
  | (PendingBridgeInput & {
      estimatedFees: {
        caGas: string;
        gasSupplied: string;
        protocol: string;
        solver: string;
        // total: string;
      };
    })
  | null;

const _exactInRoute = async (
  input: ExactInSwapInput,
  params: SwapParams & {
    aggregators: Aggregator[];
    publicClientList: PublicClientList;
    cotCurrencyID: CurrencyID;
  }
): Promise<SwapRoute> => {
  logger.debug('exactInRoute', {
    input,
    params,
  });

  const dstChain = params.chainList.getChainByID(input.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.toChainId);
  }

  const oraclePricesPromise = params.cosmosQueryClient.fetchPriceOracle();

  const [feeStore, balanceResponse, oraclePrices, dstTokenInfo] = await Promise.all([
    getFeeStore(params.cosmosQueryClient),
    params.preloadedBalances
      ? Promise.resolve({ balances: params.preloadedBalances })
      : getBalancesForSwap({
          evmAddress: params.address.eoa,
          chainList: params.chainList,
          filterWithSupportedTokens: false,
          oraclePrices: oraclePricesPromise,
        }),
    oraclePricesPromise,
    getTokenInfo(input.toTokenAddress, params.publicClientList.get(input.toChainId), dstChain),
  ]).catch((e) => {
    throw Errors.internal('Error fetching fee, balance or oracle', { cause: e });
  });

  if (balanceResponse.balances.length === 0) {
    throw Errors.noBalanceForAddress(params.address.eoa);
  }

  const { balances } = balanceResponse;

  logger.debug('exact-in: fetched balances', {
    balances,
  });

  const { srcBalances, assetsUsed } = resolveSourceBalances(input.from, balances);

  const { cot: dstChainCOT, address: dstChainCOTAddress } = getCOTForChainId(
    input.toChainId,
    params.cotCurrencyID
  );

  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);
  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);

  const bridgeAssets: BridgeAsset[] = [];

  // Filter out COT's in sources
  const cotSources: FlatBalance[] = [];
  let cotCombinedBalance = new Decimal(0);

  for (const source of srcBalances) {
    const { address: cotAddress } = getCOTForChainId(source.chainID, params.cotCurrencyID);
    if (equalFold(convertToEVMAddress(source.tokenAddress), cotAddress)) {
      cotSources.push(source);
      cotCombinedBalance = cotCombinedBalance.add(source.amount);

      bridgeAssets.push({
        chainID: source.chainID,
        contractAddress: convertToEVMAddress(source.tokenAddress),
        decimals: source.decimals,
        eoaBalance: new Decimal(source.amount),
        ephemeralBalance: new Decimal(0),
      });
    }
  }

  logger.debug('exact-in: cot sources', {
    cotCombinedBalance,
    cotSources,
    bridgeAssets,
  });

  // Check if source swap is required (if all source balances are not COT currencyID)
  const isSrcSwapRequired = cotSources.length !== srcBalances.length;
  // Check if bridge is required (if all source balances are not on destination chain)
  const isBridgeRequired = !srcBalances.every((b) => b.chainID === input.toChainId);

  logger.debug('exact-in: swap flags', {
    isSrcSwapRequired,
    isBridgeRequired,
  });

  let sourceSwaps: QuoteResponse[] = [];
  if (isSrcSwapRequired) {
    const response = await liquidateInputHoldings(
      userAddressInBytes,
      toAggregatorInputs(srcBalances),
      params.aggregators
    );

    if (!response.length) {
      throw Errors.quoteFailed('source swap returned no quotes');
    }

    sourceSwaps = response;
  }
  const sourceSwapCreationTime = Date.now();

  let swapCombinedBalance = new Decimal(0);
  for (const swap of sourceSwaps) {
    accumulateSwapIntoBridgeAssets(bridgeAssets, swap);
    swapCombinedBalance = swapCombinedBalance.add(swap.quote.output.amount);
  }

  let dstSwapInputAmountInDecimal = Decimal.add(cotCombinedBalance, swapCombinedBalance);

  logger.debug('exact-in: combined cot after source swaps', {
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    bridgeAssets,
  });

  let bridgeInput: BridgeInput = null;
  if (isBridgeRequired) {
    const { fee: maxFee } = await calculateMaxBridgeFee({
      assets: toBridgeAssetInputs(bridgeAssets),
      dst: {
        chainId: input.toChainId,
        tokenAddress: dstChainCOTAddress,
        decimals: dstChainCOT.decimals,
      },
      feeStore,
      chainList: params.chainList,
    });

    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.minus(maxFee);
    logger.debug('exact-in: after bridge fee deduction', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
      maxFee: maxFee.toFixed(),
    });
    if (dstSwapInputAmountInDecimal.isNegative()) {
      throw Errors.internal('bridge fees exceeds source amount');
    }

    bridgeInput = {
      amount: dstSwapInputAmountInDecimal,
      assets: bridgeAssets,
      chainID: input.toChainId,
      decimals: dstChainCOT.decimals,
      tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
      estimatedFees: createIntent({
        assets: toBridgeAssetInputs(bridgeAssets),
        feeStore,
        output: {
          chainID: input.toChainId,
          tokenAddress: dstChainCOTAddress,
          decimals: dstChainCOT.decimals,
          amount: new Decimal(0),
        },
        address: params.address.ephemeral,
      }).intent.fees,
    };
  }

  logger.debug('exact-in: before destination swap', {
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.toDP(
    dstChainCOT.decimals,
    Decimal.ROUND_FLOOR
  );

  const destination = createDestination(input.toChainId, dstSwapInputAmountInDecimal);

  const getDstSwap = async () => {
    let tokenSwap = null;
    // If toTokenAddress is not same as cot then create dstSwap
    if (!equalFold(input.toTokenAddress, dstChainCOTAddress)) {
      tokenSwap = await destinationSwapWithExactIn(
        userAddressInBytes,
        dstOmniversalChainID,
        mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
        convertTo32Bytes(input.toTokenAddress),
        params.aggregators,
        dstChainCOT.currencyID
      );

      // Rate guard on requote: check output didn't drop beyond 0.5% tolerance
      if (destination.swap.tokenSwap) {
        const prevAmountRaw = destination.swap.tokenSwap.quote.output.amountRaw;
        const newAmountRaw = tokenSwap.quote.output.amountRaw;
        if (newAmountRaw < (prevAmountRaw * 995n) / 1000n) {
          throw Errors.ratesChangedBeyondTolerance(newAmountRaw, '0.5%');
        }
      }

      const hasDstChainCOTInInput = cotSources.find((c) =>
        equalFold(convertToEVMAddress(c.tokenAddress), dstChainCOTAddress)
      );

      if (hasDstChainCOTInInput) {
        destination.eoaToEphemeral = {
          amount: mulDecimals(hasDstChainCOTInInput.amount, hasDstChainCOTInInput.decimals),
          contractAddress: dstChainCOTAddress,
        };
      }
    }

    return {
      gasSwap: null,
      tokenSwap,
      creationTime: Date.now(),
    };
  };

  destination.swap = await getDstSwap();
  destination.getDstSwap = getDstSwap;

  return {
    source: {
      swaps: sourceSwaps,
      creationTime: sourceSwapCreationTime,
    },
    bridge: bridgeInput,
    type: 'EXACT_IN',
    destination,
    dstTokenInfo,
    extras: {
      assetsUsed,
      aggregators: params.aggregators,
      oraclePrices,
      balances,
    },
    buffer: {
      amount: '0',
    },
  };
};
