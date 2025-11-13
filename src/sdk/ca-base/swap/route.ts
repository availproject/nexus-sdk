import {
  Aggregator,
  autoSelectSources,
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
import { getLogger, OraclePriceResponse } from '../../../commons';
import {
  ExactInSwapInput,
  ExactOutSwapInput,
  SwapData,
  SwapMode,
  SwapParams,
} from '../../../commons';
import {
  calculateMaxBridgeFees,
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  fetchPriceOracle,
  getFeeStore,
  mulDecimals,
  getBalances,
} from '../utils';
import { EADDRESS } from './constants';
import { FlatBalance } from './data';
import {
  ErrorChainDataNotFound,
  ErrorCOTNotFound,
  ErrorInsufficientBalance,
  ErrorTokenNotFound,
} from './errors';
import { createIntent } from './rff';
import { calculateValue, convertTo32Bytes, convertToEVMAddress } from './utils';
import { BridgeAsset } from '../../../commons';
import { Errors } from '../errors';

const logger = getLogger();

export const determineSwapRoute = async (
  input: SwapData,
  options: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
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

// COT = currency of transfer
// DEF: The common currency which is supported by bridge on every supported chain and acts as a transient currency for swaps.
// FLOW: Source tokens get converted to COT, COT is bridged across chains to a destination chain,
// COT is then changed to desired destination token
// Currently COT is USDC.

const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
): Promise<SwapRoute> => {
  const [feeStore, { assets, balances }, oraclePrices] = await Promise.all([
    getFeeStore(params.networkConfig.GRPC_URL),
    getBalances({
      networkHint: params.networkConfig.NETWORK_HINT,
      evmAddress: params.address.eoa,
      chainList: params.chainList,
      removeTransferFee: true,
      filter: true,
      vscDomain: params.networkConfig.VSC_DOMAIN,
    }),
    fetchPriceOracle(params.networkConfig.GRPC_URL),
  ]);

  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  logger.debug('determineSwapRoute', { assets, balances, input });

  logger.debug('determineSwapRoute:destinationSwapInput', {
    dstOmniversalChainID,
    s: {
      amount: BigInt(input.toAmount),
      tokenAddress: toBytes(input.toTokenAddress),
    },
    userAddressInBytes,
  });

  // ------------------------------
  // 2. Fetch chain & COT information
  // ------------------------------
  const dstChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!dstChainDataMap) {
    throw ErrorChainDataNotFound;
  }

  const cotSymbol = CurrencyID[params.cotCurrencyID];

  const dstChainCOT = dstChainDataMap.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
  if (!dstChainCOT) {
    throw ErrorCOTNotFound(input.toChainId);
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);

  const dstChainCOTBalance = balances.find(
    (b) =>
      b.chainID === Number(input.toChainId) &&
      equalFold(convertToEVMAddress(b.tokenAddress), dstChainCOTAddress),
  );

  // Track any existing COT that must be moved to ephemeral for swaps
  let dstEOAToEphTx: { amount: bigint; contractAddress: Hex } | null = null;

  // Since its exact out, we start with desired destination amount and work our
  // way backward from there
  const fetchDestinationSwapDetails = async (): Promise<DestinationSwap> => {
    let destinationSwap: Awaited<ReturnType<typeof determineDestinationSwaps>> = {
      aggregator: params.aggregators[0],
      inputAmount: divDecimals(input.toAmount, dstChainCOT.decimals),
      outputAmount: 0n,
      quote: null,
    };

    // If output token is not COT, calculate the actual destination swap
    if (!equalFold(input.toTokenAddress, dstChainCOTAddress)) {
      destinationSwap = await determineDestinationSwaps(
        userAddressInBytes,
        dstOmniversalChainID,
        {
          amount: BigInt(input.toAmount),
          tokenAddress: convertTo32Bytes(input.toTokenAddress),
        },
        params.aggregators,
      );
    }

    const createdAt = Date.now();

    // If user has existing COT on destination chain, it must be moved to ephemeral
    if (new Decimal(dstChainCOTBalance?.amount ?? 0).gt(0)) {
      dstEOAToEphTx = {
        amount: mulDecimals(dstChainCOTBalance?.amount ?? 0, dstChainCOTBalance?.decimals ?? 0),
        contractAddress: dstChainCOTAddress,
      };
    }

    // Use min but perform everything as max - for buffer of (max - min)
    const min = destinationSwap.inputAmount;
    // Apply 2% buffer to destination input amount
    const max = applyBuffer(destinationSwap.inputAmount, 2).toDP(
      dstChainCOT.decimals,
      Decimal.ROUND_CEIL,
    );

    return {
      ...destinationSwap,
      originalHolding: {
        chainID: dstOmniversalChainID,
        tokenAddress: dstChainCOT.tokenAddress,
        amount: mulDecimals(destinationSwap.inputAmount, dstChainCOT.decimals),
        value: 0,
        decimals: dstChainCOT.decimals,
        symbol: CurrencyID[dstChainCOT.currencyID],
      },
      creationTime: createdAt,
      dstChainCOT: dstChainCOT,
      dstEOAToEphTx,
      inputAmount: {
        min,
        max,
      },
      req: {
        chain: dstOmniversalChainID,
        inputToken: dstChainCOT.tokenAddress,
        outputToken: toBytes(input.toTokenAddress),
      },
    };
  };

  const destinationSwap = await fetchDestinationSwapDetails();

  logger.debug('destination swaps', destinationSwap);

  // ------------------------------
  // 4. Compute source availability
  // ------------------------------

  const cotAsset = assets.find((asset) => {
    return asset.abstracted && equalFold(asset.symbol, cotSymbol);
  });
  const dstSwapInputAmountInDecimal = destinationSwap.inputAmount.max;
  const cotTotalBalance = new Decimal(cotAsset?.balance ?? '0');
  const fees = feeStore.calculateFulfilmentFee({
    decimals: dstChainCOT.decimals,
    destinationChainID: Number(input.toChainId),
    destinationTokenAddress: dstChainCOTAddress,
  });

  logger.debug('exact-out:3', {
    cotAsset,
    dstChainCOTAddress,
    dstChainCOTBalance,
    cotTotalBalance: cotTotalBalance.toFixed(),
    diff: fees.toFixed(),
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  console.log({ cotAsset, dstChainCOTBalance });

  // ------------------------------
  // 5. Determine if source swaps are required
  // ------------------------------

  let sourceSwaps: QuoteResponse = [];
  const sourceSwapsRequired =
    !dstChainCOTBalance ||
    !cotAsset ||
    new Decimal(cotAsset.balance).lt(dstSwapInputAmountInDecimal);

  if (sourceSwapsRequired) {
    sourceSwaps = (
      await autoSelectSources(
        userAddressInBytes,
        balances.map((balance) => ({
          amount: mulDecimals(balance.amount, balance.decimals),
          chainID: new OmniversalChainID(balance.universe, balance.chainID),
          tokenAddress: toBytes(balance.tokenAddress),
          value: balance.value,
        })),
        applyBuffer(dstSwapInputAmountInDecimal.add(fees), 1).minus(cotAsset?.balance ?? '0'),
        params.aggregators,
        feeStore.data.fee.collection.map((f) => ({
          ...f,
          chainID: convertTo32Bytes(Number(f.chainID)),
          fee: convertTo32Bytes(BigInt(f.fee)),
          tokenAddress: convertTo32Bytes(f.tokenAddress as Hex),
        })),
      )
    ).map((v) => {
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
  }
  const sourceSwapCreationTime = Date.now();

  logger.debug('exact-out:4', {
    dstChainCOTBalance,
    inequality: new Decimal(dstChainCOTBalance?.amount ?? 0).lt(
      dstSwapInputAmountInDecimal.add(fees),
    ),
  });

  // ------------------------------
  // 6. Bridge input calculation (account for already existing COT + COT from swaps)
  // ------------------------------
  let bridgeInput: {
    amount: Decimal;
    assets: BridgeAsset[];
    chainID: number;
    decimals: number;
    tokenAddress: `0x${string}`;
  } | null = null;

  const bridgeAssets: BridgeAsset[] =
    cotAsset?.breakdown.map((b) => ({
      chainID: b.chain.id,
      contractAddress: b.contractAddress,
      decimals: b.decimals,
      eoaBalance: new Decimal(b.balance),
      ephemeralBalance: new Decimal(0),
    })) ?? [];

  if (new Decimal(dstChainCOTBalance?.amount ?? 0n).lt(dstSwapInputAmountInDecimal.add(fees))) {
    // If swap happens to COT on destination chain
    // then that amount doesn't needs to be in RFF
    let dstCOTSwapAmount = new Decimal(0);

    for (const swap of sourceSwaps) {
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
        throw ErrorTokenNotFound(
          convertToEVMAddress(swap.req.outputToken),
          Number(swap.req.chain.chainID),
        );
      }

      const outputAmount = swap.quote.outputAmountMinimum;

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

      if (Number(swap.req.chain.chainID) === input.toChainId) {
        dstCOTSwapAmount = dstCOTSwapAmount.plus(divDecimals(outputAmount, token.decimals));
      }

      logger.debug('determineSwapRoute:sourceSwap', {
        outputAmountLikely: swap.quote.outputAmountLikely ?? 0,
        outputAmountMinimum: swap.quote.outputAmountMinimum ?? 0,
        swap,
      });
    }

    // If COT from source swap at destination chain + existing COT accounts
    // for requirement then RFF shouldn't be created
    if (
      new Decimal(dstChainCOTBalance?.amount ?? 0)
        .plus(dstCOTSwapAmount)
        .lt(dstSwapInputAmountInDecimal)
    ) {
      bridgeInput = {
        amount: dstSwapInputAmountInDecimal
          .minus(dstChainCOTBalance?.amount ?? 0)
          .minus(dstCOTSwapAmount),
        assets: bridgeAssets,
        chainID: input.toChainId,
        decimals: dstChainCOT.decimals,
        tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
      };
    }
  }

  // ------------------------------
  // 7. Prepare assets used to show in intent
  // ------------------------------

  const assetsUsed: {
    amount: string;
    chainID: number;
    contractAddress: Hex;
    decimals: number;
    symbol: string;
  }[] = [];

  for (const swap of sourceSwaps) {
    assetsUsed.push({
      amount: divDecimals(swap.quote.inputAmount, swap.originalHolding.decimals).toFixed(),
      chainID: Number(swap.req.chain.chainID),
      contractAddress: convertToEVMAddress(swap.req.inputToken),
      decimals: swap.originalHolding.decimals,
      symbol: swap.originalHolding.symbol,
    });
  }

  if (bridgeInput) {
    const { eoaToEphemeralCalls } = createIntent({
      assets: bridgeAssets,
      feeStore,
      output: bridgeInput,
      address: params.address.ephemeral,
    });

    for (const chain in eoaToEphemeralCalls) {
      assetsUsed.push({
        amount: divDecimals(
          eoaToEphemeralCalls[chain].amount,
          eoaToEphemeralCalls[chain].decimals,
        ).toFixed(),
        chainID: Number(chain),
        contractAddress: eoaToEphemeralCalls[chain].tokenAddress,
        decimals: eoaToEphemeralCalls[chain].decimals,
        symbol: cotSymbol,
      });
    }
  }
  return {
    source: {
      swaps: sourceSwaps,
      creationTime: sourceSwapCreationTime,
    },
    bridge: bridgeInput,
    destination: {
      swap: destinationSwap,
      fetchDestinationSwapDetails,
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
  dstEOAToEphTx: {
    amount: bigint;
    contractAddress: Hex;
  } | null;
  inputAmount: { min: Decimal; max: Decimal };
  req: {
    chain: OmniversalChainID;
    inputToken: Buffer<ArrayBufferLike>;
    outputToken: ByteArray;
  };
  quote: Quote | null;
  aggregator: Aggregator;
  originalHolding: Holding & { symbol: string; decimals: number };
  outputAmount: bigint;
};

export type SwapRoute = {
  source: {
    swaps: ({
      req: QuoteRequestExactInput;
      cfee: bigint;
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
    getFeeStore(params.networkConfig.GRPC_URL),
    getBalances({
      networkHint: params.networkConfig.NETWORK_HINT,
      evmAddress: params.address.eoa,
      chainList: params.chainList,
      removeTransferFee: true,
      filter: false,
      vscDomain: params.networkConfig.VSC_DOMAIN,
    }),
    fetchPriceOracle(params.networkConfig.GRPC_URL),
  ]).catch((e) => {
    throw new Error('Error fetching fee, balance or oracle', { cause: e });
  });

  if (balanceResponse.balances.length === 0) {
    throw new Error('no balances returned for user');
  }

  let { balances } = balanceResponse;

  logger.debug('ExactIN:1', {
    balances,
  });

  const assetsUsed: AssetUsed = [];
  let srcBalances: FlatBalance[] = [];

  if (input.from && input.from.length > 0) {
    // Filter out sources user requested to be used
    for (const f of input.from) {
      if (typeof f.amount !== 'bigint') {
        throw new Error('input.from.amount must be bigint');
      }

      const comparison = normalizeToComparisonAddr(f.tokenAddress);

      const srcBalance = balances.find(
        (b) => equalFold(b.tokenAddress, comparison) && f.chainId === b.chainID,
      );
      if (!srcBalance) {
        logger.error('ExactIN: no src balance found', {
          token: f.tokenAddress,
          chainId: f.chainId,
        });
        throw ErrorInsufficientBalance('0', f.amount.toString());
      }

      const requiredBalance = divDecimals(f.amount, srcBalance.decimals);
      if (requiredBalance.gt(srcBalance.amount)) {
        throw ErrorInsufficientBalance(srcBalance.amount, requiredBalance.toFixed());
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
    throw new Error(`chaindata map not found for chain ${input.toChainId}`);
  }

  const cotSymbol = CurrencyID[params.cotCurrencyID];
  const dstChainCOT = dstChainDataMap.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
  if (!dstChainCOT) {
    throw ErrorCOTNotFound(input.toChainId);
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
      throw new Error('source swap returned no quotes');
    }

    sourceSwaps = response.quotes.map((oq) => {
      const balance = balances.find((b) =>
        equalFold(b.tokenAddress, convertTo32BytesHex(oq.req.inputToken)),
      );
      if (!balance) {
        logger.error('ExactIN: failed to map quote originalHolding to balance', {
          quoteReq: oq.req,
        });
        throw new Error('internal mapping error: balance for quote input not found');
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
      throw ErrorTokenNotFound(outputTokenAddress, Number(swap.req.chain.chainID));
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
    const maxFee = calculateMaxBridgeFees({
      assets: bridgeAssets,
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
      throw new Error('bridge fees exceeds source amount');
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
    }

    // const createdAt = Date.now();
    let dstEOAToEphTx: {
      amount: bigint;
      contractAddress: Hex;
    } | null = null;

    const hasDstChainCOTInInput = cotSources.find((c) =>
      equalFold(convertToEVMAddress(c.tokenAddress), dstChainCOTAddress),
    );
    if (hasDstChainCOTInInput) {
      dstEOAToEphTx = {
        amount: mulDecimals(hasDstChainCOTInInput.amount, hasDstChainCOTInInput.decimals),
        contractAddress: dstChainCOTAddress,
      };
    }

    logger.debug('ExactIN: getDDS: SingleSrcSwap: After', {
      destinationSwap,
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });
    return {
      ...destinationSwap,
      originalHolding: {
        chainID: dstOmniversalChainID,
        tokenAddress: dstChainCOT.tokenAddress,
        amount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
        value: 0,
        decimals: dstChainCOT.decimals,
        symbol: CurrencyID[dstChainCOT.currencyID],
      },
      dstChainCOT: dstChainCOT,
      dstEOAToEphTx,
      inputAmount: { min: dstSwapInputAmountInDecimal, max: dstSwapInputAmountInDecimal },
      req: {
        chain: dstOmniversalChainID,
        inputToken: dstChainCOT.tokenAddress,
        outputToken: toBytes(input.toTokenAddress),
      },
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
      swap: destinationSwap,
      fetchDestinationSwapDetails,
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
