import {
  Aggregator,
  autoSelectSourcesV2,
  ChaindataMap,
  Currency,
  CurrencyID,
  destinationSwapWithExactIn,
  determineDestinationSwaps,
  Holding,
  liquidateInputHoldings,
  OmniversalChainID,
  Quote,
  QuoteRequestExactInput,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { ByteArray, Hex, toBytes } from 'viem';
import { ZERO_ADDRESS } from '../constants';
import {
  getLogger,
  OraclePriceResponse,
  ExactInSwapInput,
  ExactOutSwapInput,
  SwapData,
  SwapMode,
  SwapParams,
  BridgeAsset,
  Source,
} from '../../../commons';

import {
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  getFeeStore,
  mulDecimals,
  calculateMaxBridgeFee,
  getBalancesForSwap,
  convertGasToToken,
} from '../utils';
import { EADDRESS, EADDRESS_32_BYTES } from './constants';
import { FlatBalance } from './data';
import { createIntent, estimateCollectionFee } from './rff';
import {
  calculateValue,
  convertTo32Bytes,
  convertToEVMAddress,
  getTokenInfo,
  PublicClientList,
  sortSourcesByPriority,
} from './utils';
import { Errors } from '../errors';
import { uniqBy } from 'es-toolkit';

const logger = getLogger();

export const determineSwapRoute = async (
  input: SwapData,
  options: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  },
): Promise<SwapRoute> => {
  logger.debug('determineSwapRoute', {
    input,
    options,
  });
  return input.mode === SwapMode.EXACT_OUT
    ? _exactOutRoute(input.data, options)
    : _exactInRoute(input.data, options);
};

export const applyBuffer = (amount: Decimal, bufferPercent: number): Decimal =>
  amount.mul(1 + bufferPercent / 100);

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
  DESTINATION_SWAP = 5,
  SOURCE_SWAP = 2,
}

const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  },
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

  const [feeStore, { balances }, oraclePrices, dstTokenInfo] = await Promise.all([
    getFeeStore(params.cosmosQueryClient),
    getBalancesForSwap({
      evmAddress: params.address.eoa,
      chainList: params.chainList,
      // Use only stable and native coins for exact out.
      filterWithSupportedTokens: true,
      allowedSources: input.fromSources,
      removeSources,
    }),
    params.cosmosQueryClient.fetchPriceOracle(),
    getTokenInfo(input.toTokenAddress, params.publicClientList.get(input.toChainId), dstChain),
  ]);

  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  logger.debug('determineSwapRoute', { balances, input });

  const dstChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!dstChainDataMap) {
    throw Errors.internal(`chain data not found for chain ${input.toChainId}`);
  }

  const cotSymbol = CurrencyID[params.cotCurrencyID];

  const dstChainCOT = dstChainDataMap.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
  if (!dstChainCOT) {
    throw Errors.internal(`COT not found for chain ${input.toChainId}`);
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);

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
      divDecimals(input.toNativeAmount ?? 0n, dstChain.nativeCurrency.decimals),
    ).mul(1.02);
  }

  // Since its exact out, we start with desired destination amount and work our
  // way backward from there
  const fetchDestinationSwapDetails = async (): Promise<DestinationSwap> => {
    let destinationSwap: Awaited<ReturnType<typeof determineDestinationSwaps>> = {
      aggregator: params.aggregators[0],
      inputAmount: divDecimals(input.toAmount, dstChainCOT.decimals),
      outputAmount: 0n,
      quote: null,
    };

    let gasSwap = null;

    // If output token is not COT, calculate the actual destination swap
    if (!equalFold(input.toTokenAddress, dstChainCOTAddress)) {
      const [ds, dgs] = await Promise.all([
        determineDestinationSwaps(
          userAddressInBytes,
          dstOmniversalChainID,
          {
            amount: BigInt(input.toAmount),
            tokenAddress: convertTo32Bytes(input.toTokenAddress),
          },
          params.aggregators,
        ),
        !gasInCOT.isZero()
          ? destinationSwapWithExactIn(
              userAddressInBytes,
              dstOmniversalChainID,
              mulDecimals(gasInCOT, dstChainCOT.decimals),
              EADDRESS_32_BYTES,
              params.aggregators,
            )
          : null,
      ]);

      destinationSwap = ds;

      if (dgs) {
        gasSwap = {
          quote: dgs.quote,
          aggregator: dgs.aggregator,
          originalHolding: {
            chainID: dstOmniversalChainID,
            tokenAddress: dstChainCOT.tokenAddress,
            amount: mulDecimals(destinationSwap.inputAmount, dstChainCOT.decimals),
            value: 0,
            decimals: dstChainCOT.decimals,
            symbol: CurrencyID[dstChainCOT.currencyID],
          },
        };
      }
    }

    const createdAt = Date.now();

    // min is what is actually needed for dst swap, we add 1% for bridge related fees and 1% buffer for source swaps.
    // We also add gasInCOT to it because we need to be able to swap to Gas
    // so we are charging min + 5% from the user, we add the buffer so the swap definitely happens and any pending amounts are sent back to the user.
    const min = destinationSwap.inputAmount.add(gasInCOT);
    // Apply 5% buffer to destination input amount - any leftover is sent back in COT.
    const max = applyBuffer(min, BUFFER_EXACT_OUT.DESTINATION_SWAP).toDP(
      dstChainCOT.decimals,
      Decimal.ROUND_CEIL,
    );

    return {
      creationTime: createdAt,
      dstChainCOT: dstChainCOT,
      inputAmount: {
        min,
        max,
      },
      inputToken: dstChainCOT.tokenAddress,
      tokenSwap: {
        ...destinationSwap,
        originalHolding: {
          chainID: dstOmniversalChainID,
          tokenAddress: dstChainCOT.tokenAddress,
          amount: mulDecimals(destinationSwap.inputAmount, dstChainCOT.decimals),
          value: 0,
          decimals: dstChainCOT.decimals,
          symbol: CurrencyID[dstChainCOT.currencyID],
        },
        req: {
          chain: dstOmniversalChainID,
          outputToken: toBytes(input.toTokenAddress),
        },
      },
      gasSwap,
    };
  };

  const destinationSwap = await fetchDestinationSwapDetails();

  logger.debug('destination swaps', destinationSwap);

  // Collection Fee needs to be calculated on cot
  const estimatedCollectionFee = estimateCollectionFee(
    uniqBy(balances, (b) => b.chainID).map((b) => {
      const cdm = ChaindataMap.get(new OmniversalChainID(Universe.ETHEREUM, b.chainID));
      if (!cdm) {
        throw Errors.internal(`chain data not found for chain ${input.toChainId}`);
      }

      const chainCOT = cdm.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
      if (!chainCOT) {
        throw Errors.internal(`COT not found for chain ${input.toChainId}`);
      }
      return {
        value: b.value,
        chainID: b.chainID,
        contractAddress: convertToEVMAddress(chainCOT.tokenAddress),
        decimals: b.decimals,
      };
    }),
    destinationSwap.inputAmount.max,
    feeStore,
  );

  const estimatedBridgeFees = feeStore
    .calculateFulfilmentFee({
      decimals: dstChainCOT.decimals,
      destinationChainID: Number(input.toChainId),
      destinationTokenAddress: dstChainCOTAddress,
    })
    .add(estimatedCollectionFee);

  const bridgeOutput = destinationSwap.inputAmount.max;

  const sourceSwapOutputRequired = applyBuffer(
    bridgeOutput.add(estimatedBridgeFees),
    BUFFER_EXACT_OUT.SOURCE_SWAP,
  );

  logger.debug('exact-out:3', {
    dstChainCOTAddress,
    estimatedBridgeFees: estimatedBridgeFees.toFixed(),
    bridgeOutput: bridgeOutput.toFixed(),
    sourceSwapOutputRequired: sourceSwapOutputRequired.toFixed(),
  });

  const sortedBalances = sortSourcesByPriority(balances, {
    tokenAddress: input.toTokenAddress,
    symbol: dstTokenInfo.symbol,
    chainID: dstChain.id,
  });

  const { quotes: sourceSwapQuotes, usedCOTs } = await autoSelectSourcesV2(
    userAddressInBytes,
    sortedBalances.map((balance) => ({
      amount: mulDecimals(balance.amount, balance.decimals),
      chainID: new OmniversalChainID(balance.universe, balance.chainID),
      tokenAddress: toBytes(balance.tokenAddress),
      value: balance.value,
    })),
    sourceSwapOutputRequired,
    params.aggregators,
  );

  const sourceSwaps = sourceSwapQuotes.map((v) => {
    const balance = balances.find((b) =>
      equalFold(b.tokenAddress, convertTo32BytesHex(v.req.inputToken)),
    );
    if (!balance) {
      throw Errors.internal('mapping error: balance for quote input not found');
    }
    return {
      ...v,
      originalHolding: {
        ...v.originalHolding,
        decimals: balance.decimals,
        symbol: balance.symbol,
      },
    };
  });

  const sourceSwapCreationTime = Date.now();

  let bridgeInput: {
    amount: Decimal;
    assets: BridgeAsset[];
    chainID: number;
    decimals: number;
    tokenAddress: `0x${string}`;
  } | null = null;

  // If every source swap and cot used is not on destination chain then bridge is required
  const isBridgeRequired = !(
    sourceSwapQuotes.every((q) => Number(q.originalHolding.chainID.chainID) === input.toChainId) &&
    usedCOTs.every((q) => Number(q.originalHolding.chainID.chainID) === input.toChainId)
  );

  let dstEOAToEphTx: { amount: bigint; contractAddress: Hex } | null = null;

  // Check if used cot list has destination chain
  const dstChainExistingCOT = usedCOTs.find(
    (c) => Number(c.originalHolding.chainID.chainID) === input.toChainId,
  );
  if (dstChainExistingCOT) {
    dstEOAToEphTx = {
      amount: mulDecimals(dstChainExistingCOT.amountUsed, dstChainExistingCOT.cur.decimals),
      contractAddress: convertToEVMAddress(dstChainExistingCOT.originalHolding.tokenAddress),
    };
  }

  const assetsUsed: {
    amount: string;
    chainID: number;
    contractAddress: Hex;
    decimals: number;
    symbol: string;
  }[] = [];
  const bridgeAssets: BridgeAsset[] = [];

  // Tracks existing COT + COT after swap, since that shouldn't be involved in swap
  let dstTotalCOTAmount = new Decimal(
    dstEOAToEphTx ? divDecimals(dstEOAToEphTx.amount, dstChainCOT.decimals) : 0,
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

  for (const swap of sourceSwaps) {
    assetsUsed.push({
      amount: divDecimals(swap.quote.inputAmount, swap.originalHolding.decimals).toFixed(),
      chainID: Number(swap.req.chain.chainID),
      contractAddress: convertToEVMAddress(swap.req.inputToken),
      decimals: swap.originalHolding.decimals,
      symbol: swap.originalHolding.symbol,
    });

    const outputAmount = swap.quote.outputAmountMinimum;

    // If swap happens to COT on destination chain then that amount doesn't needs to be in RFF
    if (Number(swap.originalHolding.chainID.chainID) === input.toChainId) {
      dstTotalCOTAmount = dstTotalCOTAmount.plus(divDecimals(outputAmount, swap.cur.decimals));
      continue;
    }

    const bAsset = bridgeAssets.find((ba) => {
      return (
        ba.chainID === Number(swap.req.chain.chainID) &&
        equalFold(ba.contractAddress, convertToEVMAddress(swap.req.outputToken))
      );
    });

    const token = params.chainList.getTokenByAddress(
      Number(swap.req.chain.chainID),
      convertToEVMAddress(swap.req.outputToken),
    );
    if (!token) {
      throw Errors.tokenNotFound(
        convertToEVMAddress(swap.req.outputToken),
        Number(swap.req.chain.chainID),
      );
    }

    if (bAsset) {
      bAsset.ephemeralBalance = Decimal.add(
        bAsset.ephemeralBalance,
        divDecimals(outputAmount, token.decimals),
      );
    } else {
      bridgeAssets.push({
        chainID: Number(swap.req.chain.chainID),
        contractAddress: convertToEVMAddress(swap.req.outputToken),
        decimals: token.decimals,
        eoaBalance: new Decimal(0),
        ephemeralBalance: divDecimals(outputAmount, token.decimals),
      });
    }

    logger.debug('determineSwapRoute:sourceSwap', {
      outputAmountLikely: swap.quote.outputAmountLikely ?? 0,
      outputAmountMinimum: swap.quote.outputAmountMinimum ?? 0,
      swap,
    });
  }

  // Bridge should not involve existing dst cot + any swap to cot on dst chain
  const bridgeAmountWithoutDstCOT = bridgeOutput.minus(dstTotalCOTAmount);

  logger.debug('exactOut:BeforeBridgeSet', {
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

  if (bridgeInput) {
    const createIntentResponse = createIntent({
      assets: bridgeAssets,
      feeStore,
      output: bridgeInput,
      address: params.address.ephemeral,
    });

    logger.debug('ExactOut: createIntent', { bridgeAssets, bridgeInput, createIntentResponse });
  }
  return {
    source: {
      swaps: sourceSwaps,
      creationTime: sourceSwapCreationTime,
    },
    bridge: bridgeInput,
    destination: {
      type: 'EXACT_OUT',
      swap: destinationSwap,
      fetchDestinationSwapDetails,
      dstEOAToEphTx,
    },
    extras: {
      aggregators: params.aggregators,
      oraclePrices,
      balances,
      assetsUsed,
      cotSymbol,
    },
  };
};

type DestinationSwap = {
  creationTime: number;
  dstChainCOT: Currency;
  inputAmount: { min: Decimal; max: Decimal }; // This is input of tokenSwap + gasSwap + buffer
  inputToken: ByteArray; // COT
  tokenSwap: {
    req: {
      chain: OmniversalChainID;
      outputToken: ByteArray;
    };
    quote: Quote | null;
    originalHolding: Holding & { symbol: string; decimals: number };
    aggregator: Aggregator;
    outputAmount: bigint;
  };
  gasSwap: {
    quote: Quote | null;
    originalHolding: Holding & { symbol: string; decimals: number };
    aggregator: Aggregator;
  } | null;
};

export type SwapRoute = {
  source: {
    swaps: ({
      req: QuoteRequestExactInput;
      originalHolding: Holding & { decimals: number; symbol: string };
      cur: Currency;
    } & {
      quote: Quote;
      agg: Aggregator;
    })[];
    creationTime: number;
  };
  bridge: BridgeInput;
  destination: {
    type: 'EXACT_IN' | 'EXACT_OUT';
    dstEOAToEphTx: {
      amount: bigint;
      contractAddress: Hex;
    } | null;
    swap: DestinationSwap;
    fetchDestinationSwapDetails: () => Promise<DestinationSwap>;
  };
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
    cotSymbol: string;
  };
};

type AssetUsed = {
  amount: string;
  chainID: number;
  contractAddress: Hex;
  decimals: number;
  symbol: string;
}[];

type BridgeInput = {
  amount: Decimal;
  assets: BridgeAsset[];
  chainID: number;
  decimals: number;
  tokenAddress: `0x${string}`;
} | null;

type QuoteResponse = {
  agg: Aggregator;
  quote: Quote;
  req: QuoteRequestExactInput;
  cfee: bigint;
  originalHolding: Holding & { decimals: number; symbol: string };
  cur: Currency;
}[];

// Helper to normalize token comparison tokens (preserve EADDRESS vs ZERO_ADDRESS handling)
const normalizeToComparisonAddr = (tokenHex: Hex) =>
  convertTo32BytesHex(equalFold(tokenHex, ZERO_ADDRESS) ? EADDRESS : tokenHex);

const _exactInRoute = async (
  input: ExactInSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
): Promise<SwapRoute> => {
  logger.debug('exactInRoute', {
    input,
    params,
  });

  const [feeStore, balanceResponse, oraclePrices] = await Promise.all([
    getFeeStore(params.cosmosQueryClient),
    getBalancesForSwap({
      evmAddress: params.address.eoa,
      chainList: params.chainList,
      filterWithSupportedTokens: false,
    }),
    params.cosmosQueryClient.fetchPriceOracle(),
  ]).catch((e) => {
    throw Errors.internal('Error fetching fee, balance or oracle', { cause: e });
  });

  if (balanceResponse.balances.length === 0) {
    throw Errors.noBalanceForAddress(params.address.eoa);
  }

  let { balances } = balanceResponse;

  logger.debug('ExactIN:1', {
    balances,
  });

  const assetsUsed: AssetUsed = [];
  let srcBalances: FlatBalance[] = [];

  if (input.from.length > 0) {
    // Filter out sources user requested to be used
    for (const f of input.from) {
      if (typeof f.amount !== 'bigint') {
        throw new TypeError('input.from.amount must be bigint');
      }

      const comparison = normalizeToComparisonAddr(f.tokenAddress);

      const srcBalance = balances.find((b) => {
        logger.debug('ExactIn: from comparison', {
          balanceTokenAddress: b.tokenAddress,
          inputTokenAddress: f.tokenAddress,
          comparisonTokenAddress: comparison,
        });
        return equalFold(b.tokenAddress, comparison) && f.chainId === b.chainID;
      });
      if (!srcBalance) {
        logger.error('ExactIN: no src balance found', {
          token: f.tokenAddress,
          chainId: f.chainId,
        });
        throw Errors.insufficientBalance(`available: 0, required: ${f.amount.toString()}`);
      }

      const requiredBalance = divDecimals(f.amount, srcBalance.decimals);
      if (requiredBalance.gt(srcBalance.amount)) {
        throw Errors.insufficientBalance(
          `available: ${srcBalance.amount} ${
            srcBalance.symbol
          }, required: ${requiredBalance.toFixed()} ${srcBalance.symbol}`,
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
    }
  } else {
    srcBalances = balances.slice();
  }

  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  const dstChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!dstChainDataMap) {
    throw Errors.internal(`chain data not found for chain ${input.toChainId}`);
  }

  const cotSymbol = CurrencyID[params.cotCurrencyID];
  const dstChainCOT = dstChainDataMap.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
  if (!dstChainCOT) {
    throw Errors.internal(`COT not found for chain ${input.toChainId}`);
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);
  const bridgeAssets: BridgeAsset[] = [];

  // Filter out COT's in sources
  const cotSources: FlatBalance[] = [];
  let cotCombinedBalance = new Decimal(0);

  for (const source of srcBalances) {
    const cot = ChaindataMap.get(
      new OmniversalChainID(Universe.ETHEREUM, source.chainID),
    )?.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
    if (
      cot &&
      equalFold(convertToEVMAddress(source.tokenAddress), convertToEVMAddress(cot.tokenAddress))
    ) {
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

  logger.debug('ExactIN:4', {
    cotCombinedBalance,
    cotSources,
    bridgeAssets,
  });
  // Add COT's to bridge asset eoaBalance

  // Check if source swap is required (if all source balances are not COT currencyID)
  const isSrcSwapRequired = cotSources.length !== srcBalances.length;
  // Check if bridge is required (if all source balances are not on destination chain)
  const isBridgeRequired = !srcBalances.every((b) => b.chainID === input.toChainId);

  logger.debug('ExactIN:5', {
    isSrcSwapRequired,
    isBridgeRequired,
  });

  let sourceSwaps: QuoteResponse = [];
  if (isSrcSwapRequired) {
    const response = await liquidateInputHoldings(
      userAddressInBytes,
      srcBalances.map((b) => ({
        amount: mulDecimals(b.amount, b.decimals),
        chainID: new OmniversalChainID(b.universe, b.chainID),
        tokenAddress: toBytes(b.tokenAddress),
        value: b.value,
      })),
      params.aggregators,
      feeStore.data.fee.collection.map((f) => ({
        chainID: convertTo32Bytes(Number(f.chainID)),
        fee: convertTo32Bytes(BigInt(f.fee)),
        tokenAddress: convertTo32Bytes(f.tokenAddress as Hex),
        universe: f.universe,
      })),
    );

    if (!response.quotes.length) {
      throw Errors.quoteFailed('source swap returned no quotes');
    }

    sourceSwaps = response.quotes.map((oq) => {
      const balance = balances.find((b) =>
        equalFold(b.tokenAddress, convertTo32BytesHex(oq.req.inputToken)),
      );
      if (!balance) {
        logger.error('ExactIN: failed to map quote originalHolding to balance', {
          quoteReq: oq.req,
        });
        throw Errors.internal('mapping error: balance for quote input not found');
      }
      return {
        ...oq,
        originalHolding: {
          ...oq.originalHolding,
          decimals: balance.decimals,
          symbol: balance.symbol,
        },
      };
    });
  }
  const sourceSwapCreationTime = Date.now();

  let swapCombinedBalance = new Decimal(0);
  for (const swap of sourceSwaps) {
    const outputTokenAddress = convertToEVMAddress(swap.req.outputToken);
    const token = params.chainList.getTokenByAddress(
      Number(swap.req.chain.chainID),
      outputTokenAddress,
    );
    if (!token) {
      throw Errors.tokenNotFound(outputTokenAddress, Number(swap.req.chain.chainID));
    }
    const bridgeAsset = bridgeAssets.find((b) => equalFold(b.contractAddress, outputTokenAddress));
    const outputAmountInDecimal = divDecimals(swap.quote.outputAmountMinimum, token.decimals);
    if (bridgeAsset) {
      bridgeAsset.ephemeralBalance = bridgeAsset.ephemeralBalance.add(outputAmountInDecimal);
    } else {
      bridgeAssets.push({
        chainID: Number(swap.req.chain.chainID),
        contractAddress: outputTokenAddress,
        decimals: token.decimals,
        eoaBalance: new Decimal(0),
        ephemeralBalance: outputAmountInDecimal,
      });
    }

    swapCombinedBalance = swapCombinedBalance.add(outputAmountInDecimal);
  }

  let dstSwapInputAmountInDecimal = Decimal.add(cotCombinedBalance, swapCombinedBalance);

  logger.debug('ExactIN:6', {
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    bridgeAssets,
  });

  let bridgeInput: BridgeInput = null;
  if (isBridgeRequired) {
    const { fee: maxFee } = calculateMaxBridgeFee({
      assets: bridgeAssets.map((b) => ({ ...b, balance: b.eoaBalance.add(b.ephemeralBalance) })),
      dst: {
        chainId: input.toChainId,
        tokenAddress: dstChainCOTAddress,
        decimals: dstChainCOT.decimals,
      },
      feeStore,
    });

    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.minus(maxFee);
    logger.debug('ExactIN:7', {
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
    };
  }

  logger.debug('beforeDDS: ExactIN', {
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  let dstEOAToEphTx: {
    amount: bigint;
    contractAddress: Hex;
  } | null = null;

  const fetchDestinationSwapDetails = async () => {
    let destinationSwap: Awaited<ReturnType<typeof destinationSwapWithExactIn>> = {
      aggregator: params.aggregators[0],
      inputAmount: dstSwapInputAmountInDecimal,
      outputAmount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
      quote: null,
    };

    logger.debug('getDDS: ExactIN: Before', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });

    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.toDP(
      dstChainCOT.decimals,
      Decimal.ROUND_FLOOR,
    );

    // If toTokenAddress is not same as cot then create dstSwap
    if (!equalFold(input.toTokenAddress, dstChainCOTAddress)) {
      destinationSwap = await destinationSwapWithExactIn(
        userAddressInBytes,
        dstOmniversalChainID,
        mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
        convertTo32Bytes(input.toTokenAddress),
        params.aggregators,
        dstChainCOT.currencyID,
      );

      const hasDstChainCOTInInput = cotSources.find((c) =>
        equalFold(convertToEVMAddress(c.tokenAddress), dstChainCOTAddress),
      );
      if (hasDstChainCOTInInput) {
        dstEOAToEphTx = {
          amount: mulDecimals(hasDstChainCOTInInput.amount, hasDstChainCOTInInput.decimals),
          contractAddress: dstChainCOTAddress,
        };
      }
    }

    logger.debug('ExactIN: getDDS: SingleSrcSwap: After', {
      destinationSwap,
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });
    return {
      tokenSwap: {
        ...destinationSwap,
        originalHolding: {
          chainID: dstOmniversalChainID,
          tokenAddress: dstChainCOT.tokenAddress,
          amount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
          value: 0,
          decimals: dstChainCOT.decimals,
          symbol: CurrencyID[dstChainCOT.currencyID],
        },
        req: {
          chain: dstOmniversalChainID,
          outputToken: toBytes(input.toTokenAddress),
        },
      },
      dstChainCOT: dstChainCOT,
      inputAmount: { min: dstSwapInputAmountInDecimal, max: dstSwapInputAmountInDecimal },
      inputToken: dstChainCOT.tokenAddress,
      gasSwap: null,

      creationTime: Date.now(),
    };
  };

  const destinationSwap = await fetchDestinationSwapDetails();

  logger.debug('getSwapRoute: ExactIN: After', {
    destinationSwap,
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  return {
    source: {
      swaps: sourceSwaps,
      creationTime: sourceSwapCreationTime,
    },
    bridge: bridgeInput,
    destination: {
      type: 'EXACT_IN',
      swap: destinationSwap,
      fetchDestinationSwapDetails,
      dstEOAToEphTx,
    },
    extras: {
      assetsUsed,
      aggregators: params.aggregators,
      oraclePrices,
      balances,
      cotSymbol,
    },
  };
};
