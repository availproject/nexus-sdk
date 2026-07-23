import type { BridgeProvider } from '@avail-project/nexus-types';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type {
  AllowanceHookSource,
  BridgeIntentDraft,
  ChainListType,
  OraclePriceResponse,
  TokenBalance,
  TokenInfo,
  Universe,
} from '../../domain';
import { getLogger } from '../../domain';
import { isNativeAddress } from '../../services/addresses';
import { buildAllowanceKey } from '../../services/allowance-utils';
import {
  createUserAssets,
  getBalancesForBridge,
  type UserAssetsInstance,
} from '../../services/balances';
import { convertGasToToken } from '../../services/intent';
import { divDecimals } from '../../services/math';
import { equalFold } from '../../services/strings';
import type { MiddlewareBridgeClient, QuoteResponse } from '../../transport';
import {
  assertMayanSupportedDestination,
  buildBridgeProviderRequest,
  buildQuoteRequest,
  resolveBridgeProvider,
} from './quote-request';

type CreateIntentInput = {
  amount: Decimal;
  assets: UserAssetsInstance;
  gas: Decimal;
  gasInToken: Decimal;
  resolveUsdValue: (input: {
    amount: Decimal;
    chainId: number;
    tokenAddress: Hex;
    symbol?: string;
  }) => Decimal;
  sourceChains: number[];
  token: TokenInfo;
  provider: BridgeProvider;
  quoteResponse: QuoteResponse;
};

type BuildBridgeIntentInput = {
  tokenAmount: bigint;
  dstToken: TokenInfo;
  nativeAmount: bigint;
  dstChainId: number;
  dstChainUniverse: Universe;
  dstChainNativeDecimals: number;
  sourceChains?: number[];
  forceMayan: boolean;
  deps: {
    chainList: ChainListType;
    middlewareClient: MiddlewareBridgeClient;
    evm: {
      address: Hex;
    };
  };
  createIntent: (input: CreateIntentInput) => Promise<BridgeIntentDraft>;
};

const logger = getLogger();

const createUsdResolver = (input: {
  assets: TokenBalance[];
  oraclePrices: OraclePriceResponse;
}) => {
  const breakdownPrices = new Map<string, Decimal>();

  for (const asset of input.assets) {
    for (const breakdown of asset.chainBalances) {
      if (new Decimal(breakdown.balance).gt(0) && new Decimal(breakdown.value).gt(0)) {
        breakdownPrices.set(
          `${breakdown.chain.id}:${breakdown.contractAddress.toLowerCase()}`,
          new Decimal(breakdown.value).div(breakdown.balance)
        );
      }
    }
  }

  return (params: { amount: Decimal; chainId: number; tokenAddress: Hex; symbol?: string }) => {
    const breakdownPrice = breakdownPrices.get(
      `${params.chainId}:${params.tokenAddress.toLowerCase()}`
    );
    if (breakdownPrice) {
      return params.amount.mul(breakdownPrice);
    }

    const oraclePrice = input.oraclePrices.find(
      (rate) => rate.chainId === params.chainId && equalFold(rate.tokenAddress, params.tokenAddress)
    )?.priceUsd;
    if (oraclePrice) {
      return params.amount.mul(oraclePrice);
    }

    return new Decimal(0);
  };
};

export const buildBridgeIntent = async (
  input: BuildBridgeIntentInput
): Promise<BridgeIntentDraft> => {
  const sourceChains = input.sourceChains ?? [];
  const { deps } = input;

  if (input.forceMayan) {
    assertMayanSupportedDestination(
      deps.chainList,
      input.dstChainId,
      input.dstToken.contractAddress
    );
  }

  const bridgeProviderRequest = buildBridgeProviderRequest(
    input.dstToken,
    input.dstChainId,
    input.tokenAmount
  );

  const [assets, oraclePrices, provider] = await Promise.all([
    getBalancesForBridge({
      middlewareClient: deps.middlewareClient,
      evmAddress: deps.evm.address,
      chainList: deps.chainList,
    }),
    deps.middlewareClient.getOraclePrices(),
    resolveBridgeProvider(deps.middlewareClient, bridgeProviderRequest, input.forceMayan),
  ]);

  logger.debug('Step 0: BuildIntent', {
    assets,
    provider,
  });

  const userAssets = createUserAssets(assets);
  const quoteSourceChainIds =
    sourceChains.length > 0
      ? sourceChains
      : (
          await userAssets
            .find({
              currencyId: input.dstToken.currencyId,
              symbol: input.dstToken.symbol,
            })
            .iterate(deps.chainList)
        )
          .filter((entry) => entry.chain.id !== input.dstChainId && entry.balance.gt(0))
          .map((entry) => entry.chain.id);
  const quoteResponse = await deps.middlewareClient.getQuote(
    buildQuoteRequest(deps.chainList, input.dstToken, input.dstChainId, quoteSourceChainIds)
  );

  const tokenAmountInDecimal = divDecimals(input.tokenAmount, input.dstToken.decimals);
  const gasInNativeToken = divDecimals(input.nativeAmount, input.dstChainNativeDecimals);
  const gasInToken = convertGasToToken(
    {
      contractAddress: input.dstToken.contractAddress,
      decimals: input.dstToken.decimals,
    },
    oraclePrices,
    input.dstChainId,
    input.dstChainUniverse,
    gasInNativeToken
  );
  const resolveUsdValue = createUsdResolver({
    assets,
    oraclePrices,
  });

  const intent = await input.createIntent({
    amount: tokenAmountInDecimal,
    assets: userAssets,
    gas: gasInNativeToken,
    gasInToken,
    resolveUsdValue,
    sourceChains,
    token: input.dstToken,
    provider,
    quoteResponse,
  });

  return intent;
};

export const findInsufficientAllowanceSources = (input: {
  intent: BridgeIntentDraft;
  allowances: Record<string, bigint>;
  chainList: ChainListType;
}): AllowanceHookSource[] => {
  const { intent, allowances } = input;
  const sources: AllowanceHookSource[] = [];

  for (const s of intent.selectedSources) {
    if (s.chain.id === intent.destination.chain.id || isNativeAddress(s.token.contractAddress)) {
      continue;
    }

    const totalRequired = Decimal.add(s.amount, s.depositFee);
    const requiredAllowance = s.amountRaw + s.depositFeeRaw;
    const allowanceKey = buildAllowanceKey(s.chain.id, s.token.contractAddress, s.holderAddress);
    const currentAllowance = allowances[allowanceKey] ?? 0n;

    logger.debug('getUnallowedSources:1', {
      currentAllowance: currentAllowance.toString(),
      requiredAllowance: requiredAllowance.toString(),
      token: s.token,
    });

    if (requiredAllowance > currentAllowance) {
      sources.push({
        allowance: {
          current: divDecimals(currentAllowance, s.token.decimals).toFixed(s.token.decimals),
          currentRaw: currentAllowance,
          minimum: totalRequired.toFixed(s.token.decimals),
          minimumRaw: requiredAllowance,
        },
        chain: {
          id: s.chain.id,
          logo: s.chain.logo,
          name: s.chain.name,
        },
        holderAddress: s.holderAddress,
        token: {
          contractAddress: s.token.contractAddress,
          decimals: s.token.decimals,
          logo: s.token.logo || '',
          name: s.token.name,
          symbol: s.token.symbol,
        },
      });
    }
  }

  return sources;
};
