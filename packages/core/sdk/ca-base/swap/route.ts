import {
  Aggregator,
  autoSelectSources,
  ChaindataMap,
  CurrencyID,
  destinationSwapWithExactIn,
  determineDestinationSwaps,
  Environment,
  liquidateInputHoldings,
  OmniversalChainID,
  Universe,
  // ZeroExAggregator,
} from '@arcana/ca-common';
import Decimal from 'decimal.js';
import { Hex, toBytes } from 'viem';
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
  FeeStore,
  fetchPriceOracle,
  getEVMBalancesForAddress,
  getFeeStore,
  getFuelBalancesForAddress,
  mulDecimals,
} from '../utils';
import { EADDRESS } from './constants';
import { filterSupportedTokens, FlatBalance, getTokenDecimals } from './data';
import {
  ErrorChainDataNotFound,
  ErrorCOTNotFound,
  ErrorInsufficientBalance,
  // ErrorInsufficientBalance,
  // ErrorSingleSourceHasNoSource,
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

export const getBalances = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  removeTransferFee?: boolean;
  filter?: boolean;
  fuelAddress?: string;
  isCA?: boolean;
  vscDomain: string;
  networkHint: Environment;
}) => {
  const isCA = input.isCA ?? false;
  const removeTransferFee = input.removeTransferFee ?? false;
  const filter = input.filter ?? true;
  const [ankrBalances, evmBalances, fuelBalances] = await Promise.all([
    input.networkHint === Environment.FOLLY
      ? Promise.resolve([])
      : getAnkrBalances(input.evmAddress, input.chainList, removeTransferFee),
    getEVMBalancesForAddress(input.vscDomain, input.evmAddress),
    input.fuelAddress
      ? getFuelBalancesForAddress(input.vscDomain, input.fuelAddress as `0x${string}`)
      : Promise.resolve([]),
  ]);
  const assets = balancesToAssets(ankrBalances, evmBalances, fuelBalances, input.chainList, isCA);
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
    return _exactInRoute(input.data, options);
  }
};

const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
) => {
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
        null,
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

const calculateMaxBridgeFees = ({
  assets,
  feeStore,
  dst,
}: {
  dst: {
    chainId: number;
    tokenAddress: Hex;
    decimals: number;
  };
  assets: BridgeAsset[];
  feeStore: FeeStore;
}) => {
  const borrow = assets.reduce((accumulator, asset) => {
    return accumulator.add(Decimal.add(asset.eoaBalance, asset.ephemeralBalance));
  }, new Decimal(0));

  const protocolFee = feeStore.calculateProtocolFee(new Decimal(borrow));
  let borrowWithFee = borrow.add(protocolFee);

  const fulfilmentFee = feeStore.calculateFulfilmentFee({
    decimals: dst.decimals,
    destinationChainID: dst.chainId,
    destinationTokenAddress: dst.tokenAddress,
  });
  borrowWithFee = borrowWithFee.add(fulfilmentFee);

  logger.debug('calculateMaxBridgeFees:1', {
    borrow: borrow.toFixed(),
    protocolFee: protocolFee.toFixed(),
    fulfilmentFee: fulfilmentFee.toFixed(),
    borrowWithFee: borrowWithFee.toFixed(),
  });

  for (const asset of assets) {
    const solverFee = feeStore.calculateSolverFee({
      borrowAmount: Decimal.add(asset.eoaBalance, asset.ephemeralBalance),
      decimals: asset.decimals,
      destinationChainID: dst.chainId,
      destinationTokenAddress: dst.tokenAddress,
      sourceChainID: asset.chainID,
      sourceTokenAddress: convertToEVMAddress(asset.contractAddress),
    });

    borrowWithFee = borrowWithFee.add(solverFee);
    logger.debug('calculateMaxBridgeFees:2', {
      borrow: borrow.toFixed(),
      borrowWithFee: borrowWithFee.toFixed(),
      solverFee: solverFee.toFixed(),
    });
  }

  return borrowWithFee.minus(borrow);
};

const _exactInRoute = async (
  input: ExactInSwapInput,
  params: SwapParams & { aggregators: Aggregator[]; cotCurrencyID: CurrencyID },
) => {
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
      vscDomain: params.networkConfig.VSC_DOMAIN,
    }),
    fetchPriceOracle(params.networkConfig.GRPC_URL),
  ]);

  let { balances } = balanceResponse;

  logger.debug('ExactIN:1', {
    balances,
  });

  const assetsUsed: AssetUsed = [];
  let srcBalances: FlatBalance[] = [];
  if (input.from) {
    for (const f of input.from) {
      const srcBalance = balances.find((b) => {
        logger.debug('ExactIN:2:input.src', {
          a: b.tokenAddress,
          b: convertTo32BytesHex(f.tokenAddress),
        });

        // We are keeping ZERO_ADDRESS as EAddress so have to make the comparisonAddr like this
        let comparisonTokenAddress = convertTo32BytesHex(f.tokenAddress);
        if (equalFold(comparisonTokenAddress, ZERO_ADDRESS)) {
          comparisonTokenAddress = EADDRESS;
        }

        return equalFold(b.tokenAddress, comparisonTokenAddress) && f.chainId === b.chainID;
      });
      if (!srcBalance) {
        throw ErrorInsufficientBalance(f.amount.toString(), '0');
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
    // } else {
    //   throw new Error('should have gone to single source swap route');
    // }
  } else {
    srcBalances = balances;
  }

  logger.debug('ExactIN:3', {
    srcBalances,
    assetsUsed,
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

  let sourceSwaps: Awaited<ReturnType<typeof liquidateInputHoldings>>['quotes'] = [];
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

    sourceSwaps = response.quotes;
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

    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.minus(maxFee).mul(0.98);
    logger.debug('ExactIN:7', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
      maxFee: maxFee.toFixed(),
    });
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

  const getDDS = async () => {
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
        mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
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
