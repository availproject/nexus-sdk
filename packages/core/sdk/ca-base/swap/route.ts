import {
  Aggregator,
  autoSelectSources,
  BebopAggregator,
  ChaindataMap,
  CurrencyID,
  determineDestinationSwaps,
  LiFiAggregator,
  liquidateInputHoldings,
  OmniversalChainID,
  swapWithExactIn,
  Universe,
  ZeroExAggregator,
} from '@arcana/ca-common';
import Decimal from 'decimal.js';
import { Hex, toBytes, toHex } from 'viem';

import { getLogger } from '../logger';
import { ChainListType, NetworkConfig } from '@nexus/commons';
import {
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  fetchPriceOracle,
  getFeeStore,
  mulDecimals,
} from '../utils';
import { filterSupportedTokens, getTokenDecimals } from './data';
import { createIntent } from './rff';
import { BridgeAsset, SwapInput } from '@nexus/commons';
import {
  balancesToAssets,
  convertTo32Bytes,
  convertToEVMAddress,
  getAnkrBalances,
  toFlatBalance,
} from './utils';

const logger = getLogger();

export const getBalances = async (
  address: `0x${string}`,
  chainList: ChainListType,
  removeTransferFee = false,
  chainID?: number,
  token?: `0x${string}`,
) => {
  const assets = balancesToAssets(
    await getAnkrBalances(address, chainList, removeTransferFee),
    chainList,
  );
  const flatBalances = toFlatBalance(assets, chainID, token);
  const balances = filterSupportedTokens(flatBalances);

  logger.debug('getBalances', {
    assets,
    balances,
    flatBalances,
    removeTransferFee,
  });

  return { assets, balances };
};

const LIFI_API_KEY = 'bcb7981d-ea26-4adf-8926-95d3adf4c001.23bcc0d7-7df7-4c86-bb37-ae9ffc25bb95';
const BEBOP_API_KEY = 'ae262dbf-e4d0-4b66-aaec-57a1b4581440';
const ZERO_X_API_KEY = '';

export type SwapRouteInput = ExactInInput | ExactOutInput;

type commonInputParams = {
  address: `0x${string}`;
  chainID: number;
  chainList: ChainListType;
  COT: CurrencyID;
  eAddress: `0x${string}`;
  networkConfig: NetworkConfig;
  outputToken: Hex;
  universe: Universe;
};

type ExactInInput = {
  mode: 'EXACT_IN';
  source?: SwapInput['source'];
} & commonInputParams;

type ExactOutInput = {
  mode: 'EXACT_OUT';
  outputAmount: bigint;
} & commonInputParams;

export const determineSwapRoute = async (input: SwapRouteInput) => {
  const aggregators: Aggregator[] = [
    new LiFiAggregator(LIFI_API_KEY),
    new BebopAggregator(BEBOP_API_KEY),
    // new ZeroExAggregator(ZERO_X_API_KEY),
  ];
  if (input.mode === 'EXACT_OUT') {
    return _exactOutRoute(input, aggregators);
  } else {
    return input.source ? _singleSourceSwap(input, aggregators) : _exactInRoute(input, aggregators);
  }
};

const _exactOutRoute = async (input: ExactOutInput, aggregators: Aggregator[]) => {
  const [feeStore, { assets, balances }, oraclePrices] = await Promise.all([
    getFeeStore(input.networkConfig.GRPC_URL),
    getBalances(input.address, input.chainList, true),
    fetchPriceOracle(input.networkConfig.GRPC_URL),
  ]);

  let dstEOAToEphTx: {
    amount: bigint;
    contractAddress: Hex;
  } | null = null;
  logger.debug('determineSwapRoute', { assets, balances, input });

  const userAddressInBytes = convertTo32Bytes(input.eAddress);
  const dstOmniversalChainID = new OmniversalChainID(input.universe, input.chainID);

  logger.debug('determineSwapRoute:destinationSwapInput', {
    dstOmniversalChainID,
    s: {
      amount: BigInt(input.outputAmount),
      tokenAddress: toBytes(input.outputToken),
    },
    userAddressInBytes,
  });

  const destinationChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!destinationChainDataMap) {
    throw new Error('chaindataMap not found');
  }

  const cotSymbol = CurrencyID[input.COT];

  const dstChainCOT = destinationChainDataMap.Currencies.find((c) => c.currencyID === input.COT);
  if (!dstChainCOT) {
    throw new Error("COT doesn't exist on destination chain. Unable to move forward.");
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);
  const dstChainCOTBalance = balances.find(
    (b) =>
      b.chain_id === Number(input.chainID) &&
      equalFold(convertToEVMAddress(b.token_address), dstChainCOTAddress),
  );

  const getDDS = async () => {
    let dds: Awaited<ReturnType<typeof determineDestinationSwaps>> = {
      aggregator: aggregators[1],
      inputAmount: divDecimals(input.outputAmount, dstChainCOT.decimals),
      outputAmount: 0n,
      quote: null,
    };

    if (!equalFold(input.outputToken, dstChainCOTAddress)) {
      dds = await determineDestinationSwaps(
        userAddressInBytes,
        dstOmniversalChainID,
        {
          amount: BigInt(input.outputAmount),
          tokenAddress: convertTo32Bytes(input.outputToken),
        },
        aggregators,
      );
    }

    const createdAt = Date.now();

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
        outputToken: toBytes(input.outputToken),
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
    destinationChainID: Number(input.chainID),
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

  if (
    !dstChainCOTBalance ||
    !cotAsset ||
    new Decimal(cotAsset.balance).lt(dstSwapInputAmountInDecimal)
  ) {
    sourceSwaps = await autoSelectSources(
      userAddressInBytes,
      balances.map((balance) => ({
        amount: mulDecimals(balance.amount, balance.decimals),
        chainID: new OmniversalChainID(balance.universe, balance.chain_id),
        tokenAddress: toBytes(balance.token_address),
        value: balance.value,
      })),
      dstSwapInputAmountInDecimal
        .add(fees)
        .mul(1.01)
        .minus(cotAsset?.balance ?? '0'),
      aggregators,
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

      const token = input.chainList.getTokenByAddress(
        Number(swap.req.chain.chainID),
        convertToEVMAddress(swap.req.outputToken),
      );
      if (!token) {
        throw new Error('Token not found on chain');
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

      if (Number(swap.req.chain.chainID) === input.chainID) {
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
        chainID: input.chainID,
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
    aggregators,
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

const calculateValue = (amount: Decimal.Value, value: Decimal.Value, newAmount: Decimal.Value) => {
  return Decimal.div(value, amount).mul(newAmount);
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

const _singleSourceSwap = async (input: ExactInInput, aggregators: Aggregator[]) => {
  logger.debug('In single source swap route');
  if (!input.source) {
    throw new Error('single source swap has no input.source');
  }

  const [feeStore, balanceResponse, oraclePrices] = await Promise.all([
    getFeeStore(input.networkConfig.GRPC_URL),
    getBalances(input.address, input.chainList, true),
    fetchPriceOracle(input.networkConfig.GRPC_URL),
  ]);

  const { balances } = balanceResponse;

  const source = input.source;

  const fromBalance = balances.find((b) => {
    logger.debug('input.src', {
      a: b.token_address,
      b: convertTo32BytesHex(input.source!.token),
    });

    return (
      equalFold(b.token_address, convertTo32BytesHex(source.token)) && source.chainID === b.chain_id
    );
  });

  if (!fromBalance) {
    throw new Error('no balance on specified input');
  }

  const amount = divDecimals(input.source.amount, fromBalance.decimals);
  const value = calculateValue(fromBalance.amount, fromBalance.value, amount);
  const balance = {
    ...fromBalance,
    amount: amount.toFixed(),
    value: value.toNumber(),
  };

  logger.debug('singleSourceSwap', {
    balance,
    fromBalance,
    'input.source': input.source,
  });

  const userAddressInBytes = convertTo32Bytes(input.eAddress);
  const dstOmniversalChainID = new OmniversalChainID(input.universe, input.chainID);

  const dstChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!dstChainDataMap) {
    throw new Error('chaindataMap not found');
  }

  const cotSymbol = CurrencyID[input.COT];

  const dstChainCOT = dstChainDataMap.Currencies.find((c) => c.currencyID === input.COT);
  if (!dstChainCOT) {
    throw new Error("COT doesn't exist on destination chain. Unable to move forward.");
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);
  const srcChainDataMap = ChaindataMap.get(
    new OmniversalChainID(Universe.ETHEREUM, balance.chain_id),
  );
  if (!srcChainDataMap) {
    throw new Error(`chain data not found: ${balance.chain_id}`);
  }

  const srcChainCOT = srcChainDataMap.Currencies.find((c) => c.currencyID === input.COT);
  if (!srcChainCOT) {
    throw new Error(`cot not found on chain: ${balance.chain_id}`);
  }

  const assetsUsed: AssetUsed = [
    {
      amount: balance.amount,
      chainID: balance.chain_id,
      contractAddress: balance.token_address,
      decimals: balance.decimals,
      symbol: balance.symbol,
    },
  ];

  let total = new Decimal(balance.amount);
  let sourceSwaps: Awaited<ReturnType<typeof liquidateInputHoldings>>['quotes'] = [];
  const bridgeAssets: BridgeAsset[] = [];

  // If source token is not COT then source swap to convert to COT
  if (!equalFold(toHex(srcChainCOT.tokenAddress), balance.token_address)) {
    const response = await liquidateInputHoldings(
      userAddressInBytes,
      [balance].map((b) => ({
        amount: mulDecimals(b.amount, b.decimals),
        chainID: new OmniversalChainID(b.universe, b.chain_id),
        tokenAddress: toBytes(b.token_address),
        value: b.value,
      })),
      aggregators,
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
    const outputAmount = swap.quote!.outputAmountMinimum;
    const token = input.chainList.getTokenByAddress(
      Number(swap.req.chain.chainID),
      convertToEVMAddress(swap.req.outputToken),
    );
    if (!token) {
      throw new Error(
        `output token from swap not found in chain data as cot: ${convertToEVMAddress(swap.req.outputToken)}`,
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
      chainID: fromBalance.chain_id,
      contractAddress: convertToEVMAddress(fromBalance.token_address),
      decimals: fromBalance.decimals,
      eoaBalance: new Decimal(fromBalance.amount),
      ephemeralBalance: new Decimal(0),
    });
  }
  const sourceSwapCreationTime = Date.now();

  // createIntent({
  //   assets: bridgeAssets,
  //   feeStore,
  //   output: {}
  // })

  const fulfilmentFee = feeStore.calculateFulfilmentFee({
    decimals: balance.decimals,
    destinationChainID: input.chainID,
    destinationTokenAddress: input.outputToken,
  });

  // FIXME: reverse the intent creation to find solver, protocol fee and swap input
  const dstSwapInputAmountInDecimal = total.minus(fulfilmentFee).mul(0.98);

  // From chain is not same as to chain so bridge
  const bridgeInput: BridgeInput =
    fromBalance.chain_id !== input.chainID
      ? {
          amount: dstSwapInputAmountInDecimal,
          assets: bridgeAssets,
          chainID: input.chainID,
          decimals: dstChainCOT.decimals,
          tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
        }
      : null;

  logger.debug('beforeDDS: ExactIN', {
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  const getDDS = async () => {
    let dds: Awaited<ReturnType<typeof swapWithExactIn>> = {
      aggregator: aggregators[1],
      inputAmount: dstSwapInputAmountInDecimal,
      outputAmount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
      quote: null,
    };

    logger.debug('getDDS: ExactIN: Before', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });

    // If toTokenAddress is not same as cot then create dstSwap
    if (!equalFold(input.outputToken, dstChainCOTAddress)) {
      dds = await swapWithExactIn(
        userAddressInBytes,
        dstOmniversalChainID,
        {
          amount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
          tokenAddress: convertTo32Bytes(input.outputToken),
        },
        aggregators,
      );
    }

    const createdAt = Date.now();

    logger.debug('getDDS: ExactIN: After', {
      dds,
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });
    return {
      ...dds,
      createdAt,
      dstChainCOT: dstChainCOT,
      dstEOAToEphTx: null,
      inputAmountWithBuffer: dstSwapInputAmountInDecimal,
      req: {
        chain: dstOmniversalChainID,
        inputToken: dstChainCOT.tokenAddress,
        outputToken: toBytes(input.outputToken),
      },
    };
  };

  const destinationSwap = await getDDS();

  logger.debug('getSwapRoute: ExactIN: After', {
    destinationSwap,
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });
  return {
    aggregators,
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

const _exactInRoute = async (input: ExactInInput, aggregators: Aggregator[]) => {
  const [feeStore, balanceResponse, oraclePrices] = await Promise.all([
    getFeeStore(input.networkConfig.GRPC_URL),
    getBalances(input.address, input.chainList, true),
    fetchPriceOracle(input.networkConfig.GRPC_URL),
  ]);

  let { balances } = balanceResponse;
  const assets = balanceResponse.assets;

  logger.debug('ExactIN: 1', {
    balances,
  });
  if (input.source) {
    const inputSource = balances.find((b) => {
      logger.debug('input.src', {
        a: b.token_address,
        b: convertTo32BytesHex(input.source!.token),
      });

      return (
        equalFold(b.token_address, convertTo32BytesHex(input.source!.token)) &&
        input.source!.chainID === b.chain_id
      );
      // ||
      // (equalFold(input.source!.token, ZERO_ADDRESS) &&
      //   equalFold(b.token_address, convertTo32BytesHex(EADDRESS)))
    });
    if (!inputSource) {
      throw new Error('no balance on specified input');
    }
    const amount = divDecimals(input.source.amount, inputSource.decimals);
    const value = calculateValue(inputSource.amount, inputSource.value, amount);
    balances = [{ ...inputSource, amount: amount.toFixed(), value: value.toNumber() }];
  }

  logger.debug('EXACT_IN', {
    balances,
    input,
  });

  let dstEOAToEphTx: {
    amount: bigint;
    contractAddress: Hex;
  } | null = null;
  logger.debug('determineSwapRoute', { assets, balances, input });

  const userAddressInBytes = convertTo32Bytes(input.eAddress);
  const dstOmniversalChainID = new OmniversalChainID(input.universe, input.chainID);

  logger.debug('determineSwapRoute:destinationSwapInput', {
    dstOmniversalChainID,
    s: {
      tokenAddress: toBytes(input.outputToken),
    },
    userAddressInBytes,
  });

  const destinationChainDataMap = ChaindataMap.get(dstOmniversalChainID);
  if (!destinationChainDataMap) {
    throw new Error('chaindataMap not found');
  }

  const cotSymbol = CurrencyID[input.COT];

  const dstChainCOT = destinationChainDataMap.Currencies.find((c) => c.currencyID === input.COT);
  if (!dstChainCOT) {
    throw new Error("COT doesn't exist on destination chain. Unable to move forward.");
  }

  const dstChainCOTAddress = convertToEVMAddress(dstChainCOT.tokenAddress);
  const dstChainCOTBalance = input.source
    ? undefined
    : balances.find(
        (b) =>
          b.chain_id === Number(input.chainID) &&
          equalFold(convertToEVMAddress(b.token_address), dstChainCOTAddress),
      );

  let sourceSwaps: Awaited<ReturnType<typeof liquidateInputHoldings>>['quotes'] = [];
  let total = new Decimal(0);
  let skipSourceSwap = false;

  if (input.source) {
    const src = balances[0];
    const chainData = ChaindataMap.get(new OmniversalChainID(Universe.ETHEREUM, src.chain_id));
    if (!chainData) {
      throw new Error(`chain data not found: ${src.chain_id}`);
    }

    const currency = chainData.Currencies.find((c) => c.currencyID === input.COT);
    if (!currency) {
      throw new Error(`cot not found on chain: ${src.chain_id}`);
    }

    if (equalFold(toHex(currency.tokenAddress), src.token_address)) {
      skipSourceSwap = true;
    }

    total = new Decimal(src.amount);
  }

  if (!skipSourceSwap) {
    const response = await liquidateInputHoldings(
      userAddressInBytes,
      balances.map((balance) => ({
        amount: mulDecimals(balance.amount, balance.decimals),
        chainID: new OmniversalChainID(balance.universe, balance.chain_id),
        tokenAddress: toBytes(balance.token_address),
        value: balance.value,
      })),
      aggregators,
      feeStore.data.fee.collection.map((f) => ({
        ...f,
        chainID: convertTo32Bytes(Number(f.chainID)),
        fee: convertTo32Bytes(BigInt(f.fee)),
        tokenAddress: convertTo32Bytes(f.tokenAddress as Hex),
      })),
    );
    sourceSwaps = response.quotes;
    total = response.total;
  }

  logger.debug('exactIN:sourceSwaps', {
    sourceSwaps,
    total,
  });

  const cotAsset = assets.find((asset) => {
    return asset.abstracted && equalFold(asset.symbol, cotSymbol);
  });

  const dstSwapInputAmountInDecimal = total
    .mul(0.98)
    .toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL);

  logger.debug('determineSwapRoute:3', {
    cotAsset,
    dstChainCOTAddress,
    dstChainCOTBalance,
  });

  const cotTotalBalance = new Decimal(input.source ? 0 : (cotAsset?.balance ?? '0'));

  const fulfilmentFee = feeStore.calculateFulfilmentFee({
    decimals: dstChainCOT.decimals,
    destinationChainID: Number(input.chainID),
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

  const bridgeAssets: BridgeAsset[] = input.source
    ? []
    : (cotAsset?.breakdown.map((b) => ({
        chainID: b.chain.id,
        contractAddress: b.contractAddress,
        decimals: b.decimals,
        eoaBalance: new Decimal(b.balance),
        ephemeralBalance: new Decimal(0),
      })) ?? []);

  if (skipSourceSwap && input.source) {
    const src = balances[0];
    bridgeAssets.push({
      chainID: src.chain_id,
      contractAddress: convertToEVMAddress(src.token_address),
      decimals: src.decimals,
      eoaBalance: new Decimal(src.amount),
      ephemeralBalance: new Decimal(0),
    });
  }

  logger.debug('bridgeAssets', {
    bridgeAssets,
  });
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

      const token = input.chainList.getTokenByAddress(
        Number(swap.req.chain.chainID),
        convertToEVMAddress(swap.req.outputToken),
      );
      if (!token) {
        throw new Error('Token not found on chain');
      }

      const outputAmount = swap.quote!.outputAmountMinimum;

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

      if (Number(swap.req.chain.chainID) === input.chainID) {
        dstCOTSwapAmount = dstCOTSwapAmount.plus(divDecimals(outputAmount, token.decimals));
      }

      logger.debug('determineSwapRoute:sourceSwap', {
        outputAmountLikely: swap.quote!.outputAmountLikely ?? 0,
        outputAmountMinimum: swap.quote!.outputAmountMinimum ?? 0,
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
        chainID: input.chainID,
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
      amount: divDecimals(swap.quote!.inputAmount, decimals).toFixed(),
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

  logger.debug('beforeDDS: ExactIN', {
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });

  const getDDS = async () => {
    let dds: Awaited<ReturnType<typeof swapWithExactIn>> = {
      aggregator: aggregators[1],
      inputAmount: dstSwapInputAmountInDecimal,
      outputAmount: 0n,
      quote: null,
    };

    logger.debug('getDDS: ExactIN: Before', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });

    if (!equalFold(input.outputToken, dstChainCOTAddress)) {
      dds = await swapWithExactIn(
        userAddressInBytes,
        dstOmniversalChainID,
        {
          amount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
          tokenAddress: convertTo32Bytes(input.outputToken),
        },
        aggregators,
      );
    }

    const createdAt = Date.now();

    if (new Decimal(dstChainCOTBalance?.amount ?? 0).gt(0)) {
      dstEOAToEphTx = {
        amount: mulDecimals(dstChainCOTBalance?.amount ?? 0, dstChainCOTBalance?.decimals ?? 0),
        contractAddress: dstChainCOTAddress,
      };
    }

    logger.debug('getDDS: ExactIN: After', {
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
        outputToken: toBytes(input.outputToken),
      },
    };
  };

  const destinationSwap = await getDDS();

  logger.debug('getSwapRoute: ExactIN: After', {
    destinationSwap,
    dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
  });
  return {
    aggregators,
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
