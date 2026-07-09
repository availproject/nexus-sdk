import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { ChainListType } from '../domain';
import { isNativeAddress } from '../services/addresses';
import { equalFold } from '../services/strings';
import { type SwapData, type SwapIntent, SwapMode, type SwapRoute } from './types';

// ---------------------------------------------------------------------------
// createSwapIntent
// ---------------------------------------------------------------------------

/**
 * Builds a user-friendly intent object for the onIntent hook.
 * This is used to display swap details before the user approves.
 */
export const createSwapIntent = (
  route: SwapRoute,
  input: SwapData,
  chainList: ChainListType
): SwapIntent => {
  const dstChainData = chainList.getChainByID(route.destination.chainId);

  // Destination amount. A non-positive `toAmountRaw` in EXACT_OUT is the reservation /
  // gas-only sentinel — no tokens are delivered to the user, so the amount is "0" rather
  // than the garbage `formatTokenAmount` would produce from a negative bigint.
  let destinationAmount: string;
  if (input.mode === SwapMode.EXACT_OUT) {
    destinationAmount =
      input.data.toAmountRaw > 0n
        ? formatTokenAmount(input.data.toAmountRaw, route.dstTokenInfo.decimals)
        : '0';
  } else {
    // EXACT_IN: use swap output if available, else inputAmount.min
    if (route.destination.swap.tokenSwap) {
      destinationAmount = route.destination.swap.tokenSwap.quote.output.amount;
    } else {
      destinationAmount = route.destination.inputAmount.min.toString();
    }
  }

  // Destination value (USD) — destination-facing value semantics. When the route runs
  // a destination swap the aggregator reports the USD value; when toToken IS COT there's
  // no swap, so we price the amount via oracle (falling back to the raw amount since
  // COT is USDC, ≈$1). Reservation/gas-only sentinels (toAmountRaw ≤ 0n in EXACT_OUT)
  // deliver no tokens, so the value collapses to "0".
  let destinationValue: string | undefined;
  if (input.mode === SwapMode.EXACT_OUT && (input.data.toAmountRaw ?? 0n) <= 0n) {
    destinationValue = '0';
  } else if (route.destination.swap.tokenSwap) {
    destinationValue = route.destination.swap.tokenSwap.quote.output.value.toString();
  } else {
    const oraclePrice = route.extras.oraclePrices.find(
      (entry) =>
        entry.chainId === route.destination.chainId &&
        equalFold(entry.tokenAddress, route.dstTokenInfo.contractAddress)
    );
    destinationValue = oraclePrice
      ? new Decimal(destinationAmount).mul(oraclePrice.priceUsd).toString()
      : destinationAmount;
  }

  // Gas info — sourced from the destination gas swap's output (native delivered to EOA). Path A has
  // no dst swap; it delivers gas via native-output SOURCE swaps on the dst chain, so fall back to the
  // sum of those legs when `gasSwap` is null.
  const nativeCurrency = dstChainData.nativeCurrency ?? { symbol: 'ETH', decimals: 18 };
  const gasOutputRaw =
    route.destination.swap.gasSwap?.quote.output.amountRaw ??
    route.source.swaps
      .filter(
        (swap) =>
          swap.chainID === route.destination.chainId &&
          isNativeAddress(swap.quote.output.contractAddress)
      )
      .reduce((sum, swap) => sum + swap.quote.output.amountRaw, 0n);
  const gasAmount =
    gasOutputRaw > 0n ? formatTokenAmount(gasOutputRaw, nativeCurrency.decimals) : '0';
  const gasValue = undefined;

  // Bridge fees
  let bridgeFees: SwapIntent['feesAndBuffer']['bridge'] = null;
  if (route.bridge) {
    const fees = route.bridge.estimatedFees;
    const total = fees.caGas.plus(fees.protocol).plus(fees.solver);
    bridgeFees = {
      caGas: fees.caGas.toString(),
      protocol: fees.protocol.toString(),
      solver: fees.solver.toString(),
      total: total.toString(),
    };
  }

  // Sources
  const sources: SwapIntent['sources'] = route.extras.assetsUsed.map((asset) => {
    const chain = chainList.getChainByID(asset.chainID);
    const balance = route.extras.balances.find(
      (entry) =>
        entry.chainID === asset.chainID && equalFold(entry.tokenAddress, asset.tokenAddress)
    );
    const sourceValue =
      balance && new Decimal(balance.amount).gt(0)
        ? new Decimal(asset.amount).div(balance.amount).mul(balance.value).toFixed()
        : undefined;

    return {
      amount: asset.amount,
      value: sourceValue,
      chain: {
        id: asset.chainID,
        logo: chain.custom?.icon ?? '',
        name: chain.name ?? `Chain ${asset.chainID}`,
      },
      token: {
        contractAddress: asset.tokenAddress,
        decimals: asset.decimals,
        symbol: asset.symbol,
      },
    };
  });

  return {
    destination: {
      amount: destinationAmount,
      value: destinationValue,
      chain: {
        id: route.destination.chainId,
        logo: dstChainData.custom?.icon ?? '',
        name: dstChainData.name ?? `Chain ${route.destination.chainId}`,
      },
      token: {
        contractAddress: route.dstTokenInfo.contractAddress,
        decimals: route.dstTokenInfo.decimals,
        symbol: route.dstTokenInfo.symbol,
      },
      gas: {
        amount: gasAmount,
        value: gasValue,
        token: {
          contractAddress: '0x' as Hex, // Native currency uses zero address
          decimals: nativeCurrency.decimals ?? 18,
          symbol: nativeCurrency.symbol ?? 'ETH',
        },
      },
    },
    feesAndBuffer: {
      buffer: route.buffer.amount,
      bridge: bridgeFees,
    },
    bridgeProvider: route.bridge?.provider ?? null,
    sources,
  };
};

function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  if (remainder === 0n) return whole.toString();
  const remainderStr = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${remainderStr}`;
}
