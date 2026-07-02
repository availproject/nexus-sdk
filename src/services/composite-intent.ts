import Decimal from 'decimal.js';
import { formatUnits, type Hex } from 'viem';
import type {
  AvailableBalances,
  BridgeAndExecuteIntent,
  BridgeIntent,
  Chain,
  ChainListType,
  ExecuteRequirement,
  OraclePriceResponse,
  Shortfall,
  SwapAndExecuteIntent,
  TokenInfo,
} from '../domain';
import { ZERO_ADDRESS } from '../domain';
import { Errors } from '../domain/errors';
import type { SwapIntent } from '../swap/types';
import { isNativeAddress } from './addresses';
import { equalFold } from './strings';

export type PriceDatum = {
  chainId: number;
  tokenAddress: Hex;
  amount: Decimal;
  valueUsd: Decimal;
};

type ShortfallInput = {
  tokenAmountRaw: bigint;
  gasAmountRaw: bigint;
};

type CompositeIntentBase = {
  executeRequirement: ExecuteRequirement;
  available: AvailableBalances;
  chain: Chain;
  executeToken: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
  shortfall: ShortfallInput;
};

const getNormalizedTokenAddress = (
  chainId: number,
  tokenAddress: Hex,
  chainList: ChainListType
): string => {
  const nativeToken = chainList.getNativeToken(chainId);

  if (isNativeAddress(tokenAddress) || equalFold(tokenAddress, nativeToken.contractAddress)) {
    return nativeToken.contractAddress.toLowerCase();
  }

  return tokenAddress.toLowerCase();
};

const createPriceKey = (chainId: number, tokenAddress: string) => `${chainId}:${tokenAddress}`;

const formatRawAmount = (amountRaw: bigint, decimals: number): string =>
  formatUnits(amountRaw, decimals);

const formatUsdValue = (amountRaw: bigint, decimals: number, unitPrice: Decimal): string =>
  new Decimal(formatRawAmount(amountRaw, decimals)).mul(unitPrice).toFixed(2);

const createShortfall = (input: {
  chain: Chain;
  executeToken: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  shortfall: ShortfallInput;
  priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
}): Shortfall => ({
  token: {
    amount: formatRawAmount(input.shortfall.tokenAmountRaw, input.executeToken.decimals),
    amountRaw: input.shortfall.tokenAmountRaw,
    value: formatUsdValue(
      input.shortfall.tokenAmountRaw,
      input.executeToken.decimals,
      input.priceLookup(input.chain.id, input.executeToken.contractAddress)
    ),
  },
  gas: {
    amount: formatRawAmount(input.shortfall.gasAmountRaw, input.chain.nativeCurrency.decimals),
    amountRaw: input.shortfall.gasAmountRaw,
    value: formatUsdValue(
      input.shortfall.gasAmountRaw,
      input.chain.nativeCurrency.decimals,
      input.priceLookup(input.chain.id, ZERO_ADDRESS)
    ),
  },
});

export const createPriceLookup = (
  priceData: PriceDatum[],
  oraclePrices: OraclePriceResponse,
  chainList: ChainListType
): ((chainId: number, tokenAddress: Hex) => Decimal) => {
  const balancePrices = new Map<string, Decimal>();
  const oraclePriceMap = new Map<string, Decimal>();

  for (const datum of priceData) {
    if (datum.amount.lte(0) || datum.valueUsd.lte(0)) {
      continue;
    }

    balancePrices.set(
      createPriceKey(
        datum.chainId,
        getNormalizedTokenAddress(datum.chainId, datum.tokenAddress, chainList)
      ),
      datum.valueUsd.div(datum.amount)
    );
  }

  for (const datum of oraclePrices) {
    if (datum.priceUsd.lte(0)) {
      continue;
    }

    oraclePriceMap.set(
      createPriceKey(
        datum.chainId,
        getNormalizedTokenAddress(datum.chainId, datum.tokenAddress, chainList)
      ),
      datum.priceUsd
    );
  }

  return (chainId: number, tokenAddress: Hex) => {
    const key = createPriceKey(
      chainId,
      getNormalizedTokenAddress(chainId, tokenAddress, chainList)
    );
    return balancePrices.get(key) ?? oraclePriceMap.get(key) ?? new Decimal(0);
  };
};

export const computeShortfall = (
  requirement: { token: bigint; gas: bigint; nativeValue: bigint },
  available: { token: bigint; gas: bigint },
  tokenIsNative: boolean
): {
  skipFunding: boolean;
  tokenShortfall: bigint;
  tokenReserve: bigint;
  gasShortfall: bigint;
  gasReserve: bigint;
} => {
  if (tokenIsNative) {
    const totalRequired = requirement.token + requirement.gas + requirement.nativeValue;
    const totalShortfall = totalRequired > available.gas ? totalRequired - available.gas : 0n;
    const tokenShortfall =
      requirement.token > available.token ? requirement.token - available.token : 0n;
    const gasShortfall = totalShortfall > tokenShortfall ? totalShortfall - tokenShortfall : 0n;

    // Native toToken: balance is shared with gas; reservation rides on gasReserve / the
    // toNativeAmountRaw sentinel, so tokenReserve stays 0.
    return {
      skipFunding: tokenShortfall === 0n && gasShortfall === 0n,
      tokenShortfall,
      tokenReserve: 0n,
      gasShortfall,
      gasReserve: 0n,
    };
  }

  const tokenShortfall =
    requirement.token > available.token ? requirement.token - available.token : 0n;
  // When no shortfall, the user already has at least `requirement.token` on dst. Reserve
  // that amount so the funding swap (which still runs for the gas side) doesn't consume
  // it as a source. Any surplus above the reserve stays usable as a swap source.
  const tokenReserve = tokenShortfall === 0n ? requirement.token : 0n;
  const nativeRequired = requirement.gas + requirement.nativeValue;
  const gasShortfall = nativeRequired > available.gas ? nativeRequired - available.gas : 0n;
  const gasReserve = gasShortfall === 0n ? nativeRequired : 0n;

  return {
    skipFunding: tokenShortfall === 0n && gasShortfall === 0n,
    tokenShortfall,
    tokenReserve,
    gasShortfall,
    gasReserve,
  };
};

export const createExecuteRequirement = (input: {
  chain: Chain;
  executeToken: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  executeAmountRaw: bigint;
  to: Hex;
  gasEstimate: {
    gasToken: TokenInfo;
    amountRaw: bigint;
    estimatedGasUnits: bigint;
    feeParams: import('../domain').ExecuteFeeParams;
    l1Fee: bigint;
    priceTier: 'low' | 'medium' | 'high';
  };
  nativeValueRaw: bigint;
  tokenApproval: {
    token: Pick<TokenInfo, 'contractAddress' | 'symbol' | 'decimals'>;
    amountRaw: bigint;
    spender: Hex;
  } | null;
  priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
}): ExecuteRequirement => ({
  chain: {
    id: input.chain.id,
    name: input.chain.name,
    logo: input.chain.custom.icon,
  },
  to: input.to,
  token: {
    address: input.executeToken.contractAddress,
    symbol: input.executeToken.symbol,
    decimals: input.executeToken.decimals,
    amount: formatRawAmount(input.executeAmountRaw, input.executeToken.decimals),
    amountRaw: input.executeAmountRaw,
    value: formatUsdValue(
      input.executeAmountRaw,
      input.executeToken.decimals,
      input.priceLookup(input.chain.id, input.executeToken.contractAddress)
    ),
  },
  gas: {
    address: input.gasEstimate.gasToken.contractAddress,
    symbol: input.gasEstimate.gasToken.symbol,
    decimals: input.gasEstimate.gasToken.decimals,
    amount: formatRawAmount(input.gasEstimate.amountRaw, input.gasEstimate.gasToken.decimals),
    amountRaw: input.gasEstimate.amountRaw,
    value: formatUsdValue(
      input.gasEstimate.amountRaw,
      input.gasEstimate.gasToken.decimals,
      input.priceLookup(input.chain.id, input.gasEstimate.gasToken.contractAddress)
    ),
    estimatedGasUnits: input.gasEstimate.estimatedGasUnits.toString(),
    feeParams: input.gasEstimate.feeParams,
    l1Fee: input.gasEstimate.l1Fee.toString(),
    priceTier: input.gasEstimate.priceTier,
  },
  nativeValue:
    input.nativeValueRaw === 0n
      ? null
      : {
          amount: formatRawAmount(input.nativeValueRaw, input.chain.nativeCurrency.decimals),
          amountRaw: input.nativeValueRaw,
          value: formatUsdValue(
            input.nativeValueRaw,
            input.chain.nativeCurrency.decimals,
            input.priceLookup(input.chain.id, input.gasEstimate.gasToken.contractAddress)
          ),
        },
  tokenApproval: input.tokenApproval
    ? {
        token: {
          address: input.tokenApproval.token.contractAddress,
          symbol: input.tokenApproval.token.symbol,
          decimals: input.tokenApproval.token.decimals,
        },
        amount: formatRawAmount(input.tokenApproval.amountRaw, input.tokenApproval.token.decimals),
        amountRaw: input.tokenApproval.amountRaw,
        spender: input.tokenApproval.spender,
      }
    : null,
});

export const createAvailableBalances = (input: {
  chain: Chain;
  executeToken: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  tokenBalanceRaw: bigint;
  gasBalanceRaw: bigint;
  priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
}): AvailableBalances => ({
  token: {
    amount: formatRawAmount(input.tokenBalanceRaw, input.executeToken.decimals),
    amountRaw: input.tokenBalanceRaw,
    value: formatUsdValue(
      input.tokenBalanceRaw,
      input.executeToken.decimals,
      input.priceLookup(input.chain.id, input.executeToken.contractAddress)
    ),
  },
  gas: {
    amount: formatRawAmount(input.gasBalanceRaw, input.chain.nativeCurrency.decimals),
    amountRaw: input.gasBalanceRaw,
    value: formatUsdValue(
      input.gasBalanceRaw,
      input.chain.nativeCurrency.decimals,
      input.priceLookup(input.chain.id, ZERO_ADDRESS)
    ),
  },
});

export const createBridgeAndExecuteIntent = (
  input: CompositeIntentBase & { bridge?: BridgeIntent }
): BridgeAndExecuteIntent => {
  const fundingRequired = input.shortfall.tokenAmountRaw > 0n || input.shortfall.gasAmountRaw > 0n;

  if (!fundingRequired) {
    return {
      executeRequirement: input.executeRequirement,
      available: input.available,
      bridgeRequired: false,
    };
  }

  if (!input.bridge) {
    throw Errors.internal('bridge preview is required when bridge funding is needed');
  }

  return {
    executeRequirement: input.executeRequirement,
    available: input.available,
    bridgeRequired: true,
    shortfall: createShortfall(input),
    bridge: input.bridge,
  };
};

export const createSwapAndExecuteIntent = (
  input: CompositeIntentBase & { swap?: SwapIntent }
): SwapAndExecuteIntent => {
  const fundingRequired = input.shortfall.tokenAmountRaw > 0n || input.shortfall.gasAmountRaw > 0n;

  if (!fundingRequired) {
    return {
      executeRequirement: input.executeRequirement,
      available: input.available,
      swapRequired: false,
    };
  }

  if (!input.swap) {
    throw Errors.internal('swap preview is required when swap funding is needed');
  }

  return {
    executeRequirement: input.executeRequirement,
    available: input.available,
    swapRequired: true,
    shortfall: createShortfall(input),
    swap: input.swap,
  };
};
