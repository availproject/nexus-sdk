import {
  Aggregator,
  autoSelectSources,
  ChaindataMap,
  CurrencyID,
  destinationSwapWithExactIn,
  determineDestinationSwaps,
  liquidateInputHoldings,
  OmniversalChainID,
  Universe,
  // ZeroExAggregator,
} from '@arcana/ca-common';
import Decimal from 'decimal.js';
import { Hex, toBytes, toHex } from 'viem';
import { ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import {
  ExactInSwapInput,
  ExactOutSwapInput,
  SwapData,
  SwapMode,
  SwapParams,
} from '@nexus/commons';
import {
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  fetchPriceOracle,
  getFeeStore,
  mulDecimals,
} from '../utils';
import { EADDRESS } from './constants';
import { filterSupportedTokens, getTokenDecimals } from './data';
import {
  ErrorChainDataNotFound,
  ErrorCOTNotFound,
  ErrorInsufficientBalance,
  ErrorSingleSourceHasNoSource,
  ErrorTokenNotFound,
} from './errors';
import { createIntent } from './rff';
import {
  balancesToAssets,
  calculateValue,
  convertTo32Bytes,
  convertToEVMAddress,
  getAnkrBalances,
  toFlatBalance,
} from './utils';
import { ChainListType, BridgeAsset } from '@nexus/commons';

const logger = getLogger();

export const getBalances = async (
  address: `0x${string}`,
  chainList: ChainListType,
  removeTransferFee = false,
  filter = true,
) => {
  const assets = balancesToAssets(
    await getAnkrBalances(address, chainList, removeTransferFee),
    chainList,
  );
  let balances = toFlatBalance(assets);
  if (filter) {
    balances = filterSupportedTokens(balances);
  }

  logger.debug('getBalances', {
    assets,
    balances,
    removeTransferFee,
  });

  return { assets, balances };
};

export const determineSwapRoute = async (
  input: SwapData,
  options: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
) => {
  logger.debug('determineSwapRoute', {
    input,
    options,
  });
  if (input.mode === SwapMode.EXACT_OUT) {
    return _exactOutRoute(input.data, options);
  } else {
    return input.data.from?.length === 1
      ? _singleSourceSwap(input.data, options)
      : _exactInRoute(input.data, options);
  }
};

const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
) => {
  const [feeStore, { assets, balances }, oraclePrices] = await Promise.all([
    getFeeStore(params.networkConfig.GRPC_URL),
    getBalances(params.address.eoa, params.chainList, true),
    fetchPriceOracle(params.networkConfig.GRPC_URL),
  ]);

  // Any existing COT balance on dst chain
  let dstEOAToEphTx: {
    amount: bigint;
    contractAddress: Hex;
  } | null = null;
  logger.debug('determineSwapRoute', { assets, balances, input });

  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  logger.debug('determineSwapRoute:destinationSwapInput', {
    dstOmniversalChainID,
    s: {
      amount: BigInt(input.toAmount),
      tokenAddress: toBytes(input.toTokenAddress),
    },
    userAddressInBytes,
  });

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

  const getDDS = async () => {
    let dds: Awaited<ReturnType<typeof determineDestinationSwaps>> = {
      aggregator: params.aggregators[0],
      inputAmount: divDecimals(input.toAmount, dstChainCOT.decimals),
      outputAmount: 0n,
      quote: null,
    };

    // If output token is not COT then only destination swap should exist
    if (!equalFold(input.toTokenAddress, dstChainCOTAddress)) {
      dds = await determineDestinationSwaps(
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

    // If destination has COT then need to send it to ephemeral so that it can be used in swap
    if (new Decimal(dstChainCOTBalance?.amount ?? 0).gt(0)) {
      dstEOAToEphTx = {
        amount: mulDecimals(dstChainCOTBalance?.amount ?? 0, dstChainCOTBalance?.decimals ?? 0),
        contractAddress: dstChainCOTAddress,
      };
    }
    return {
      ...dds,
      createdAt,
      dstChainCOT: dstChainCOT,
      dstEOAToEphTx,
      inputAmountWithBuffer: dds.inputAmount
        .mul(1.02)
        .toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL),
      req: {
        chain: dstOmniversalChainID,
        inputToken: dstChainCOT.tokenAddress,
        outputToken: toBytes(input.toTokenAddress),
      },
    };
  };

  const destinationSwap = await getDDS();

  logger.debug('destination swaps', destinationSwap);

  const cotAsset = assets.find((asset) => {
    return asset.abstracted && equalFold(asset.symbol, cotSymbol);
  });

  const dstSwapInputAmountInDecimal = destinationSwap.inputAmount
    .mul(1.02)
    .toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL);

  logger.debug('determineSwapRoute:3', {
    cotAsset,
    dstChainCOTAddress,
    dstChainCOTBalance,
  });

  const cotTotalBalance = new Decimal(cotAsset?.balance ?? '0');

  const fulfilmentFee = feeStore.calculateFulfilmentFee({
    decimals: dstChainCOT.decimals,
    destinationChainID: Number(input.toChainId),
    destinationTokenAddress: dstChainCOTAddress,
  });

  const fees = fulfilmentFee;

  logger.debug('determineSwapRoute:4', {
    cotAsset,
    cotTotalBalance: cotTotalBalance.toFixed(),
    diff: fees.toFixed(),
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  console.log({ cotAsset, dstChainCOTBalance });

  let sourceSwaps: Awaited<ReturnType<typeof autoSelectSources>> = [];
  let sourceSwapsRequired = false;
  if (!dstChainCOTBalance) {
    sourceSwapsRequired = true;
  }
  if (!cotAsset || new Decimal(cotAsset.balance).lt(dstSwapInputAmountInDecimal)) {
    sourceSwapsRequired = true;
  }

  if (sourceSwapsRequired) {
    sourceSwaps = await autoSelectSources(
      userAddressInBytes,
      balances.map((balance) => ({
        amount: mulDecimals(balance.amount, balance.decimals),
        chainID: new OmniversalChainID(balance.universe, balance.chainID),
        tokenAddress: toBytes(balance.tokenAddress),
        value: balance.value,
      })),
      dstSwapInputAmountInDecimal
        .add(fees)
        .mul(1.01)
        .minus(cotAsset?.balance ?? '0'),
      params.aggregators,
      feeStore.data.fee.collection.map((f) => ({
        ...f,
        chainID: convertTo32Bytes(Number(f.chainID)),
        fee: convertTo32Bytes(BigInt(f.fee)),
        tokenAddress: convertTo32Bytes(f.tokenAddress as Hex),
      })),
    );
  }
  const sourceSwapCreationTime = Date.now();

  console.log({
    dstChainCOTBalance,
    inequality: new Decimal(dstChainCOTBalance?.amount ?? 0).lt(
      dstSwapInputAmountInDecimal.add(fees),
    ),
  });

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

  const assetsUsed: {
    amount: string;
    chainID: number;
    contractAddress: Hex;
    decimals: number;
    symbol: string;
  }[] = [];

  for (const swap of sourceSwaps) {
    const { decimals, symbol } = getTokenDecimals(
      Number(swap.req.chain.chainID),
      swap.req.inputToken,
    );

    assetsUsed.push({
      amount: divDecimals(swap.quote.inputAmount, decimals).toFixed(),
      chainID: Number(swap.req.chain.chainID),
      contractAddress: convertToEVMAddress(swap.req.inputToken),
      decimals,
      symbol,
    });
  }

  if (bridgeInput) {
    const { eoaToEphemeralCalls } = createIntent({
      assets: bridgeAssets,
      feeStore,
      output: bridgeInput,
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
    aggregators: params.aggregators,
    assetsUsed,
    balances,
    bridgeInput,
    cotSymbol,
    destinationSwap,
    getDDS,
    oraclePrices,
    sourceSwapCreationTime,
    sourceSwaps,
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

const _singleSourceSwap = async (
  input: ExactInSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
) => {
  logger.debug('In single source swap route', { input });
  if (!input.from) {
    throw ErrorSingleSourceHasNoSource;
  }

  const source = input.from[0];
  const [feeStore, balanceResponse, oraclePrices] = await Promise.all([
    getFeeStore(params.networkConfig.GRPC_URL),
    getBalances(params.address.eoa, params.chainList, true, false),
    fetchPriceOracle(params.networkConfig.GRPC_URL),
  ]);

  const { balances } = balanceResponse;

  const srcBalance = balances.find((b) => {
    logger.debug('input.src', {
      a: b.tokenAddress,
      b: convertTo32BytesHex(source.tokenAddress),
    });

    if (equalFold(source.tokenAddress, ZERO_ADDRESS)) {
      source.tokenAddress = EADDRESS;
    }
    return (
      equalFold(b.tokenAddress, convertTo32BytesHex(source.tokenAddress)) &&
      source.chainId === b.chainID &&
      new Decimal(b.amount).gte(divDecimals(source.amount, b.decimals))
    );
  });

  if (!srcBalance) {
    throw ErrorInsufficientBalance;
  }

  const amount = divDecimals(source.amount, srcBalance.decimals);
  const value = calculateValue(srcBalance.amount, srcBalance.value, amount);
  const balance = {
    ...srcBalance,
    amount: amount.toFixed(),
    value: value.toNumber(),
  };

  logger.debug('singleSourceSwap', {
    balance,
    'input.source': input.from,
    srcBalance,
  });

  const userAddressInBytes = convertTo32Bytes(params.address.ephemeral);
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  const dstChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!dstChainDataMap) {
    throw new Error('chaindataMap not found');
  }

  const cotSymbol = CurrencyID[params.cotCurrencyID];

  const dstChainCOT = dstChainDataMap.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
  if (!dstChainCOT) {
    throw ErrorCOTNotFound(input.toChainId);
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);
  const srcChainDataMap = ChaindataMap.get(
    new OmniversalChainID(Universe.ETHEREUM, balance.chainID),
  );
  if (!srcChainDataMap) {
    throw ErrorChainDataNotFound;
  }

  const srcChainCOT = srcChainDataMap.Currencies.find((c) => c.currencyID === params.cotCurrencyID);
  if (!srcChainCOT) {
    throw ErrorCOTNotFound(balance.chainID);
  }

  const assetsUsed: AssetUsed = [
    {
      amount: balance.amount,
      chainID: balance.chainID,
      contractAddress: balance.tokenAddress,
      decimals: balance.decimals,
      symbol: balance.symbol,
    },
  ];

  let total = new Decimal(balance.amount);
  let sourceSwaps: Awaited<ReturnType<typeof liquidateInputHoldings>>['quotes'] = [];
  const bridgeAssets: BridgeAsset[] = [];

  // If source token is not COT then source swap to convert to COT
  if (!equalFold(toHex(srcChainCOT.tokenAddress), balance.tokenAddress)) {
    const response = await liquidateInputHoldings(
      userAddressInBytes,
      [balance].map((b) => ({
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

    sourceSwaps = response.quotes;
    total = response.total;

    const swap = sourceSwaps[0];
    const outputAmount = swap.quote.outputAmountMinimum;

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

    bridgeAssets.push({
      chainID: Number(swap.req.chain.chainID),
      contractAddress: convertToEVMAddress(swap.req.outputToken),
      decimals: token.decimals,
      eoaBalance: new Decimal(0),
      ephemeralBalance: divDecimals(outputAmount, token.decimals),
    });
  } else {
    bridgeAssets.push({
      chainID: srcBalance.chainID,
      contractAddress: convertToEVMAddress(srcBalance.tokenAddress),
      decimals: srcBalance.decimals,
      eoaBalance: new Decimal(srcBalance.amount),
      ephemeralBalance: new Decimal(0),
    });
  }
  const sourceSwapCreationTime = Date.now();

  let dstSwapInputAmountInDecimal = total;

  let bridgeInput: BridgeInput = null;

  // `src` chain is not same as `dst` chain so bridge
  const isBridgeRequired = srcBalance.chainID !== input.toChainId;

  if (isBridgeRequired) {
    const fulfilmentFee = feeStore.calculateFulfilmentFee({
      decimals: balance.decimals,
      destinationChainID: input.toChainId,
      destinationTokenAddress: input.toTokenAddress,
    });

    const protocolFee = feeStore.calculateProtocolFee(new Decimal(srcBalance.amount));

    const maxSolverFee = feeStore.calculateSolverFee({
      borrowAmount: new Decimal(srcBalance.amount),
      decimals: srcChainCOT.decimals,
      destinationChainID: input.toChainId,
      destinationTokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
      sourceChainID: srcBalance.chainID,
      sourceTokenAddress: convertToEVMAddress(srcChainCOT.tokenAddress),
    });

    dstSwapInputAmountInDecimal = total
      .mul(0.98) // Do we need this now?
      .minus(Decimal.sum(maxSolverFee, fulfilmentFee, protocolFee));

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

  const getDDS = async (inputAmount?: bigint) => {
    let dds: Awaited<ReturnType<typeof destinationSwapWithExactIn>> = {
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
      dds = await destinationSwapWithExactIn(
        userAddressInBytes,
        dstOmniversalChainID,
        inputAmount ?? mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
        convertTo32Bytes(input.toTokenAddress),
        params.aggregators,
        dstChainCOT.currencyID,
      );
    }

    const createdAt = Date.now();
    let dstEOAToEphTx: {
      amount: bigint;
      contractAddress: Hex;
    } | null = null;

    // If input is COT and on destination chain
    // then flow will be eoa(cot) -> ephemeral(cot) -> swap(cot->outputToken) -> eoa(outputToken)
    if (equalFold(source.tokenAddress, dstChainCOTAddress) && source.chainId === input.toChainId) {
      dstEOAToEphTx = {
        amount: source.amount,
        contractAddress: source.tokenAddress,
      };
    }

    logger.debug('getDDS: SingleSrcSwap: After', {
      dds,
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });
    return {
      ...dds,
      createdAt,
      dstChainCOT: dstChainCOT,
      dstEOAToEphTx,
      inputAmountWithBuffer: dstSwapInputAmountInDecimal,
      req: {
        chain: dstOmniversalChainID,
        inputToken: dstChainCOT.tokenAddress,
        outputToken: toBytes(input.toTokenAddress),
      },
    };
  };

  const destinationSwap = await getDDS();

  logger.debug('getSwapRoute: ExactIN: After', {
    destinationSwap,
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });
  return {
    aggregators: params.aggregators,
    assetsUsed,
    balances,
    bridgeInput,
    cotSymbol,
    destinationSwap,
    getDDS,
    oraclePrices,
    sourceSwapCreationTime,
    sourceSwaps,
  };
};

const _exactInRoute = async (
  input: ExactInSwapInput,
  options: SwapParams & { aggregators: Aggregator[] },
) => {
  logger.debug('exactInRoute', {
    input,
    options,
  });
  throw new Error('Not implemented yet!');
  // const [feeStore, balanceResponse, oraclePrices] = await Promise.all([
  //   getFeeStore(input.networkConfig.GRPC_URL),
  //   getBalances(input.eoaAddress, input.chainList, true),
  //   fetchPriceOracle(input.networkConfig.GRPC_URL),
  // ]);

  // let { balances } = balanceResponse;
  // const assets = balanceResponse.assets;

  // logger.debug('ExactIN: 1', {
  //   balances,
  // });
  // if (input.source) {
  //   const inputSource = balances.find((b) => {
  //     logger.debug('input.src', {
  //       a: b.tokenAddress,
  //       b: convertTo32BytesHex(input.source!.token),
  //     });

  //     return (
  //       equalFold(b.tokenAddress, convertTo32BytesHex(input.source!.token)) &&
  //       input.source!.chainID === b.chainID
  //     );
  //   });
  //   if (!inputSource) {
  //     throw new Error('no balance on specified input');
  //   }

  //   const amount = divDecimals(input.source.amount, inputSource.decimals);
  //   const value = calculateValue(inputSource.amount, inputSource.value, amount);
  //   balances = [{ ...inputSource, amount: amount.toFixed(), value: value.toNumber() }];
  // }

  // logger.debug('EXACT_IN', {
  //   balances,
  //   input,
  // });

  // let dstEOAToEphTx: {
  //   amount: bigint;
  //   contractAddress: Hex;
  // } | null = null;
  // logger.debug('determineSwapRoute', { assets, balances, input });

  // const userAddressInBytes = convertTo32Bytes(input.ephemeralAddress);
  // const dstOmniversalChainID = new OmniversalChainID(input.universe, input.dstChainID);

  // logger.debug('determineSwapRoute:destinationSwapInput', {
  //   dstOmniversalChainID,
  //   s: {
  //     tokenAddress: toBytes(input.outputTokenAddress),
  //   },
  //   userAddressInBytes,
  // });

  // const destinationChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  // if (!destinationChainDataMap) {
  //   throw new Error('chaindataMap not found');
  // }

  // const cotSymbol = CurrencyID[input.COT];

  // const dstChainCOT = destinationChainDataMap.Currencies.find((c) => c.currencyID === input.COT);
  // if (!dstChainCOT) {
  //   throw new Error("COT doesn't exist on destination chain. Unable to move forward.");
  // }

  // const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);
  // const dstChainCOTBalance = input.source
  //   ? undefined
  //   : balances.find(
  //       (b) =>
  //         b.chainID === Number(input.dstChainID) &&
  //         equalFold(convertToEVMAddress(b.tokenAddress), dstChainCOTAddress),
  //     );

  // let sourceSwaps: Awaited<ReturnType<typeof liquidateInputHoldings>>['quotes'] = [];
  // let total = new Decimal(0);
  // const skipSourceSwap = false;

  // const response = await liquidateInputHoldings(
  //   userAddressInBytes,
  //   balances.map((balance) => ({
  //     amount: mulDecimals(balance.amount, balance.decimals),
  //     chainID: new OmniversalChainID(balance.universe, balance.chainID),
  //     tokenAddress: toBytes(balance.tokenAddress),
  //     value: balance.value,
  //   })),
  //   aggregators,
  //   feeStore.data.fee.collection.map((f) => ({
  //     ...f,
  //     chainID: convertTo32Bytes(Number(f.chainID)),
  //     fee: convertTo32Bytes(BigInt(f.fee)),
  //     tokenAddress: convertTo32Bytes(f.tokenAddress as Hex),
  //   })),
  // );
  // sourceSwaps = response.quotes;
  // total = response.total;

  // logger.debug('exactIN:sourceSwaps', {
  //   sourceSwaps,
  //   total,
  // });

  // const cotAsset = assets.find((asset) => {
  //   return asset.abstracted && equalFold(asset.symbol, cotSymbol);
  // });

  // let dstSwapInputAmountInDecimal = total.mul(0.98).toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL);

  // logger.debug('determineSwapRoute:3', {
  //   cotAsset,
  //   dstChainCOTAddress,
  //   dstChainCOTBalance,
  // });

  // const cotTotalBalance = new Decimal(input.source ? 0 : (cotAsset?.balance ?? '0'));

  // const fulfilmentFee = feeStore.calculateFulfilmentFee({
  //   decimals: dstChainCOT.decimals,
  //   destinationChainID: Number(input.dstChainID),
  //   destinationTokenAddress: dstChainCOTAddress,
  // });

  // const fees = fulfilmentFee;

  // logger.debug('determineSwapRoute:4', {
  //   cotAsset,
  //   cotTotalBalance: cotTotalBalance.toFixed(),
  //   diff: fees.toFixed(),
  //   dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  // });

  // console.log({ cotAsset, dstChainCOTBalance });

  // const sourceSwapCreationTime = Date.now();

  // console.log({
  //   dstChainCOTBalance,
  //   inequality: new Decimal(dstChainCOTBalance?.amount ?? 0).lt(
  //     dstSwapInputAmountInDecimal.add(fees),
  //   ),
  // });

  // let bridgeInput: {
  //   amount: Decimal;
  //   assets: BridgeAsset[];
  //   chainID: number;
  //   decimals: number;
  //   tokenAddress: `0x${string}`;
  // } | null = null;

  // const bridgeAssets: BridgeAsset[] = input.source
  //   ? []
  //   : (cotAsset?.breakdown.map((b) => ({
  //       chainID: b.chain.id,
  //       contractAddress: b.contractAddress,
  //       decimals: b.decimals,
  //       eoaBalance: new Decimal(b.balance),
  //       ephemeralBalance: new Decimal(0),
  //     })) ?? []);

  // if (skipSourceSwap && input.source) {
  //   const src = balances[0];
  //   bridgeAssets.push({
  //     chainID: src.chainID,
  //     contractAddress: convertToEVMAddress(src.tokenAddress),
  //     decimals: src.decimals,
  //     eoaBalance: new Decimal(src.amount),
  //     ephemeralBalance: new Decimal(0),
  //   });
  // }

  // logger.debug('bridgeAssets', {
  //   bridgeAssets,
  // });
  // if (new Decimal(dstChainCOTBalance?.amount ?? 0n).lt(dstSwapInputAmountInDecimal.add(fees))) {
  //   // If swap happens to COT on destination chain
  //   // then that amount doesn't needs to be in RFF
  //   let dstCOTSwapAmount = new Decimal(0);

  //   for (const swap of sourceSwaps) {
  //     const bAsset = bridgeAssets.find((ba) => {
  //       return (
  //         ba.chainID === Number(swap.req.chain.chainID) &&
  //         equalFold(ba.contractAddress, convertToEVMAddress(swap.req.outputToken))
  //       );
  //     });

  //     const token = input.chainList.getTokenByAddress(
  //       Number(swap.req.chain.chainID),
  //       convertToEVMAddress(swap.req.outputToken),
  //     );
  //     if (!token) {
  //       throw new Error('Token not found on chain');
  //     }

  //     const outputAmount = swap.quote!.outputAmountMinimum;

  //     if (bAsset) {
  //       bAsset.ephemeralBalance = Decimal.add(
  //         bAsset.ephemeralBalance,
  //         divDecimals(outputAmount, token.decimals),
  //       );
  //     } else {
  //       bridgeAssets.push({
  //         chainID: Number(swap.req.chain.chainID),
  //         contractAddress: convertToEVMAddress(swap.req.outputToken),
  //         decimals: token.decimals,
  //         eoaBalance: new Decimal(0),
  //         ephemeralBalance: divDecimals(outputAmount, token.decimals),
  //       });
  //     }

  //     if (Number(swap.req.chain.chainID) === input.dstChainID) {
  //       dstCOTSwapAmount = dstCOTSwapAmount.plus(divDecimals(outputAmount, token.decimals));
  //     }

  //     logger.debug('determineSwapRoute:sourceSwap', {
  //       outputAmountLikely: swap.quote!.outputAmountLikely ?? 0,
  //       outputAmountMinimum: swap.quote!.outputAmountMinimum ?? 0,
  //       swap,
  //     });
  //   }

  //   // If COT from source swap at destination chain + existing COT accounts
  //   // for requirement then RFF shouldn't be created
  //   if (
  //     new Decimal(dstChainCOTBalance?.amount ?? 0)
  //       .plus(dstCOTSwapAmount)
  //       .lt(dstSwapInputAmountInDecimal)
  //   ) {
  //     bridgeInput = {
  //       amount: dstSwapInputAmountInDecimal
  //         .minus(dstChainCOTBalance?.amount ?? 0)
  //         .minus(dstCOTSwapAmount),
  //       assets: bridgeAssets,
  //       chainID: input.dstChainID,
  //       decimals: dstChainCOT.decimals,
  //       tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
  //     };
  //   }
  // }

  // const assetsUsed: {
  //   amount: string;
  //   chainID: number;
  //   contractAddress: Hex;
  //   decimals: number;
  //   symbol: string;
  // }[] = [];

  // for (const swap of sourceSwaps) {
  //   const { decimals, symbol } = getTokenDecimals(
  //     Number(swap.req.chain.chainID),
  //     swap.req.inputToken,
  //   );

  //   assetsUsed.push({
  //     amount: divDecimals(swap.quote!.inputAmount, decimals).toFixed(),
  //     chainID: Number(swap.req.chain.chainID),
  //     contractAddress: convertToEVMAddress(swap.req.inputToken),
  //     decimals,
  //     symbol,
  //   });
  // }

  // if (bridgeInput) {
  //   const { eoaToEphemeralCalls } = createIntent({
  //     assets: bridgeAssets,
  //     feeStore,
  //     output: bridgeInput,
  //   });

  //   for (const chain in eoaToEphemeralCalls) {
  //     assetsUsed.push({
  //       amount: divDecimals(
  //         eoaToEphemeralCalls[chain].amount,
  //         eoaToEphemeralCalls[chain].decimals,
  //       ).toFixed(),
  //       chainID: Number(chain),
  //       contractAddress: eoaToEphemeralCalls[chain].tokenAddress,
  //       decimals: eoaToEphemeralCalls[chain].decimals,
  //       symbol: cotSymbol,
  //     });
  //   }
  // }

  // logger.debug('beforeDDS: ExactIN', {
  //   dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  // });
  // dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.toDP(
  //   dstChainCOT.decimals,
  //   Decimal.ROUND_FLOOR,
  // );

  // const getDDS = async () => {
  //   let dds: Awaited<ReturnType<typeof destinationSwapWithExactIn>> = {
  //     aggregator: aggregators[1],
  //     inputAmount: dstSwapInputAmountInDecimal,
  //     outputAmount: 0n,
  //     quote: null,
  //   };

  //   logger.debug('getDDS: ExactIN: Before', {
  //     dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  //   });

  //   if (!equalFold(input.outputTokenAddress, dstChainCOTAddress)) {
  //     dds = await destinationSwapWithExactIn(
  //       userAddressInBytes,
  //       dstOmniversalChainID,
  //       mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
  //       convertTo32Bytes(input.outputTokenAddress),
  //       aggregators,
  //       dstChainCOT.currencyID,
  //     );
  //   }

  //   const createdAt = Date.now();

  //   if (new Decimal(dstChainCOTBalance?.amount ?? 0).gt(0)) {
  //     dstEOAToEphTx = {
  //       amount: mulDecimals(dstChainCOTBalance?.amount ?? 0, dstChainCOTBalance?.decimals ?? 0),
  //       contractAddress: dstChainCOTAddress,
  //     };
  //   }

  //   logger.debug('getDDS: ExactIN: After', {
  //     dds,
  //     dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  //   });
  //   return {
  //     ...dds,
  //     createdAt,
  //     dstChainCOT: dstChainCOT,
  //     dstEOAToEphTx,
  //     inputAmountWithBuffer: dstSwapInputAmountInDecimal,
  //     req: {
  //       chain: dstOmniversalChainID,
  //       inputToken: dstChainCOT.tokenAddress,
  //       outputToken: toBytes(input.outputTokenAddress),
  //     },
  //   };
  // };

  // const destinationSwap = await getDDS();

  // logger.debug('getSwapRoute: ExactIN: After', {
  //   destinationSwap,
  //   dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  // });
  // return {
  //   aggregators,
  //   assetsUsed,
  //   balances,
  //   bridgeInput,
  //   cotSymbol,
  //   destinationSwap,
  //   getDDS,
  //   oraclePrices,
  //   sourceSwapCreationTime,
  //   sourceSwaps,
  // };
};
