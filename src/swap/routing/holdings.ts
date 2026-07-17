import Decimal from 'decimal.js';
import { parseUnits, type Hex } from 'viem';
import type { ChainListType } from '../../domain';
import { Errors } from '../../domain/errors';
import { logger } from '../../domain/utils';
import { divDecimals } from '../../services/math';
import { equalFold } from '../../services/strings';
import { EADDRESS, EXACT_OUT_PROVIDER_BUFFER } from '../constants';
import type { FlatBalance, OraclePriceResponse, Source } from '../types';
import { filterMayanSourcesByChain } from '../algorithms/mayan-floor';

// Drop selected source chains whose aggregate bridged USD can't clear Mayan's per-leg quote floor.
// Mayan-only — Nexus has no per-leg minimum, so this runs only inside the `bridgeProvider==='mayan'`
// branch. It aggregates over the SELECTED holdings (prorated to the chosen amount via `holdingUsd`),
// NOT the wallet's full balances — so only a chain that actually carries a selected source can be
// dropped, and a partial selection is judged on what really bridges. EXACT_IN's source-selection
// (`liquidateInputHoldings`) only sees non-COT holdings, so the COT+non-COT per-chain constraint is
// enforced here, before COT splitting.
export const dropSubFloorMayanChains = <H extends SelectedHolding>(
  holdings: H[],
  balances: FlatBalance[],
  oraclePrices: OraclePriceResponse,
  minOutputUsdPerSource: Decimal
): { holdings: H[]; droppedMayanChains: { chainID: number; valueUsd: Decimal }[] } => {
  const result = filterMayanSourcesByChain(holdings, minOutputUsdPerSource, (holding) =>
    holdingUsd(holding, balances, oraclePrices)
  );
  return {
    holdings: result.holdings,
    droppedMayanChains: result.droppedChains,
  };
};

export const throwMayanRouteShortfall = (
  droppedChains: { chainID: number; valueUsd: Decimal }[],
  chainList: ChainListType,
  remaining: Decimal,
  outputRequired: Decimal,
  minOutputUsdPerSource: Decimal
): never => {
  const sorted = [...droppedChains].sort((a, b) => b.valueUsd.comparedTo(a.valueUsd));
  const list = sorted
    .map((entry) => {
      const name = chainList.getChainByID(entry.chainID)?.name ?? `chain ${entry.chainID}`;
      return `${name}: $${entry.valueUsd.toFixed(2)}`;
    })
    .join(', ');
  const tail =
    remaining.gt(0) && outputRequired.gt(0)
      ? ` Eligible liquidity ($${outputRequired.minus(remaining).toFixed(2)}) is below required ($${outputRequired.toFixed(2)}).`
      : ' No Mayan-eligible source chains remain.';
  throw Errors.insufficientBalance(
    `Mayan bridge requires ≥ $${minOutputUsdPerSource.toFixed(2)} USD per source. ` +
      `Chains [${list}] were excluded.${tail}`
  );
};

type SelectedHolding = { chainID: number; tokenAddress: Hex; amountRaw: bigint; decimals: number };

// USD value of a single selected holding. Prefers the precomputed FlatBalance.value (prorated when
// the holding spends only part of the balance), falls back to oracle price, and is 0 when neither
// is available — which understates the value and biases to Nexus (the safe default).
const holdingUsd = (
  holding: SelectedHolding,
  balances: FlatBalance[],
  oraclePrices: OraclePriceResponse
): Decimal => {
  const balance = balances.find(
    (b) => b.chainID === holding.chainID && equalFold(b.tokenAddress, holding.tokenAddress)
  );
  if (balance) {
    const availableRaw = parseUnits(balance.amount, balance.decimals);
    if (availableRaw > 0n) {
      const ratio = new Decimal(holding.amountRaw.toString()).div(availableRaw.toString());
      return new Decimal(balance.value).mul(ratio);
    }
  }
  const oracle = oraclePrices.find(
    (price) =>
      price.chainId === holding.chainID && equalFold(price.tokenAddress, holding.tokenAddress)
  );
  if (oracle) {
    return divDecimals(holding.amountRaw, holding.decimals).mul(oracle.priceUsd);
  }
  return new Decimal(0);
};

// USD value of a set of holdings, used to size the EXACT_IN provider-check amount.
export const sumHoldingsUsd = (
  holdings: SelectedHolding[],
  balances: FlatBalance[],
  oraclePrices: OraclePriceResponse
): Decimal =>
  holdings.reduce(
    (sum, holding) => sum.plus(holdingUsd(holding, balances, oraclePrices)),
    new Decimal(0)
  );

// Greedy leading prefix of `holdings` (already priority-ordered) whose cumulative USD value first
// reaches `targetUsd`. Includes the holding that tips the running total over the target; reads only
// `value`, so it preserves H.
export const greedyUsdPrefix = <H extends { value: number }>(
  holdings: H[],
  targetUsd: Decimal
): H[] => {
  const prefix: H[] = [];
  let accumulated = new Decimal(0);
  for (const holding of holdings) {
    if (accumulated.gte(targetUsd)) break;
    accumulated = accumulated.plus(holding.value);
    prefix.push(holding);
  }
  return prefix;
};

// RES — Roughly Estimated Sources. EXACT_OUT fast-path gating can't see explicit sources, so it
// estimates them: the greedy priority-ordered prefix that covers the destination requirement (× a
// small headroom), KEEPING dst-chain members (unlike the provider survey below, which drops them).
// `sortSourcesByPriority` puts dst-chain holdings first, so RES is structurally biased toward Path A
// firing, and the prefix ≈ what `autoSelectSources` would pick. It is ONLY the gate population;
// funding walks use the full holding sets so RES headroom never starves buffers/fees.
export const selectRoughEligibleSources = <H extends { value: number }>(
  holdings: H[],
  dstUsd: Decimal,
  headroom: number = EXACT_OUT_PROVIDER_BUFFER
): H[] => greedyUsdPrefix(holdings, dstUsd.mul(1 + headroom));

function deductReservedBalance(
  balances: FlatBalance[],
  chainId: number,
  tokenAddress: Hex,
  reserveRaw: bigint,
  decimals: number
): FlatBalance[] {
  const reserved = divDecimals(reserveRaw, decimals);
  return balances.map((balance) => {
    if (balance.chainID !== chainId || !equalFold(balance.tokenAddress, tokenAddress)) {
      return balance;
    }

    const remaining = new Decimal(balance.amount).sub(reserved);
    if (remaining.lte(0)) {
      return { ...balance, amount: '0', value: 0 };
    }

    const ratio = remaining.div(balance.amount);
    return {
      ...balance,
      amount: remaining.toString(),
      value: ratio.mul(balance.value).toNumber(),
    };
  });
}

// toAmountRaw / toNativeAmountRaw sentinel semantics (same shape for both, ported from v1):
//   > 0n : shortfall — bridge this much. The dst-chain toToken / native is reserved for
//          the caller's use (swapAndExecute) or for the user receiving "on top" of their
//          existing balance (direct swap), so it must NOT appear as a swap source.
//   < 0n : surplus — reserve abs(value) of the dst-chain toToken / native; any remainder
//          is usable as a source.
// 0n is a no-op for that side.
export function filterExactOutBalances(
  balances: FlatBalance[],
  data: {
    toChainId: number;
    toTokenAddress: Hex;
    toAmountRaw: bigint;
    toNativeAmountRaw?: bigint;
    sources?: Source[];
  },
  destinationChain: { nativeCurrency: { decimals: number } },
  dstTokenDecimals: number
): FlatBalance[] {
  let filtered = balances;

  if (data.sources && data.sources.length > 0) {
    const sources = data.sources;
    filtered = filtered.filter((balance) =>
      sources.some(
        (source) =>
          source.chainId === balance.chainID && equalFold(source.tokenAddress, balance.tokenAddress)
      )
    );
  }

  const removeNativeToken =
    data.toNativeAmountRaw != null && data.toNativeAmountRaw > 0n ? (EADDRESS as Hex) : undefined;
  const removeDstToken = data.toAmountRaw > 0n ? data.toTokenAddress : undefined;

  if (removeDstToken || removeNativeToken) {
    filtered = filtered.filter((balance) => {
      if (balance.chainID !== data.toChainId) return true;
      if (removeDstToken && equalFold(balance.tokenAddress, removeDstToken)) return false;
      if (removeNativeToken && equalFold(balance.tokenAddress, removeNativeToken)) return false;
      return true;
    });
  }

  if (data.toAmountRaw < 0n) {
    filtered = deductReservedBalance(
      filtered,
      data.toChainId,
      data.toTokenAddress,
      -data.toAmountRaw,
      dstTokenDecimals
    );
  }

  if (data.toNativeAmountRaw != null && data.toNativeAmountRaw < 0n) {
    filtered = deductReservedBalance(
      filtered,
      data.toChainId,
      EADDRESS as Hex,
      -data.toNativeAmountRaw,
      destinationChain.nativeCurrency.decimals
    );
  }

  // The sources allowlist + dst-token/native removal + reservation, in vs out — the single line to
  // read when EXACT_OUT seems to ignore (or over-filter) the requested sources.
  logger.debug('swap.route.exact_out.balances.filtered', {
    requestedSourceCount: data.sources?.length ?? 0,
    reservesDestinationToken: data.toAmountRaw < 0n,
    reservesDestinationNative: (data.toNativeAmountRaw ?? 0n) < 0n,
    inputCount: balances.length,
    outputCount: filtered.length,
    inputBalances: balances.map((b) => ({
      chainId: b.chainID,
      tokenAddress: b.tokenAddress,
      symbol: b.symbol,
      amount: b.amount,
    })),
    outputBalances: filtered.map((b) => ({
      chainId: b.chainID,
      tokenAddress: b.tokenAddress,
      symbol: b.symbol,
      amount: b.amount,
    })),
  });

  return filtered;
}

export function resolveExactInHoldings(
  requestedSources: { chainId: number; amountRaw?: bigint; tokenAddress: Hex }[],
  balances: FlatBalance[]
): {
  chainID: number;
  tokenAddress: Hex;
  amountRaw: bigint;
  decimals: number;
  symbol: string;
}[] {
  if (requestedSources.length === 0) {
    return balances
      .filter((balance) => new Decimal(balance.amount).gt(0))
      .map((balance) => ({
        chainID: balance.chainID,
        tokenAddress: balance.tokenAddress,
        amountRaw: parseUnits(balance.amount, balance.decimals),
        decimals: balance.decimals,
        symbol: balance.symbol,
      }));
  }

  return requestedSources.flatMap((source) => {
    const balance = balances.find(
      (entry) =>
        entry.chainID === source.chainId && equalFold(entry.tokenAddress, source.tokenAddress)
    );
    if (!balance || new Decimal(balance.amount).lte(0)) {
      throw Errors.insufficientBalance('Requested source has no usable balance');
    }

    const availableRaw = parseUnits(balance.amount, balance.decimals);
    const amountRaw = source.amountRaw ?? availableRaw;

    if (amountRaw > availableRaw) {
      throw Errors.insufficientBalance('Requested source amount exceeds available balance');
    }

    return amountRaw > 0n
      ? [
          {
            chainID: source.chainId,
            tokenAddress: source.tokenAddress,
            amountRaw,
            decimals: balance.decimals,
            symbol: balance.symbol,
          },
        ]
      : [];
  });
}
