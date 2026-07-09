import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { Errors } from '../../domain/errors';
import type { ChainListType } from '../../domain/types';
import { divDecimals, mulDecimals } from '../../services/math';
import { equalFold } from '../../services/strings';
import {
  AggregateMode,
  type Aggregator,
  aggregateAggregators,
  type Holding,
  type Quote,
  type QuoteResponse,
  QuoteSeriousness,
  QuoteType,
} from '../aggregators';
import type { CurrencyID } from '../cot';
import type { BridgeQuoteResponse } from '../types';
import { logger } from '../../domain/utils';
import { convergeExactIn, firstSuccess, timedCandidate, tryExactOutDirect } from './convergence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UsedCOT = {
  holding: Holding;
  amountUsed: Decimal;
  idx: number;
};

type AutoSelectResult = {
  quoteResponses: QuoteResponse[];
  usedCOTs: UsedCOT[];
};

// A source holding plus its USD value. `value` lets the selector size an initial survey
// prefix instead of quoting every non-COT holding upfront — only the priority-ordered
// prefix whose cumulative value covers `outputRequired × prefixHeadroom` is quoted first;
// the batch extends to the remaining non-COT holdings only if that prefix under-delivers.
export type SourceHolding = Holding & { value: number };

type AutoSelectInput = {
  holdings: SourceHolding[];
  outputRequired: Decimal;
  aggregators: Aggregator[];
  chainList: ChainListType;
  cotCurrencyId: CurrencyID;
  dstChainId?: number;
  bridgeQuoteResponse?: BridgeQuoteResponse | null;
  userAddressByChain: Map<number, `0x${string}`>;
  recipientAddressByChain: Map<number, Hex>;
  // Set when the bridge will go through Mayan: each source chain's aggregate
  // USD value must clear this floor or the chain is dropped from selection.
  // Mayan rejects quotes for legs below ~$1.10 USD output.
  minOutputUsdPerSource?: Decimal;
  // Path A (direct destination): select toward a FIXED destination token on every chain instead of
  // the per-chain COT. Holdings already in this token become identities (used directly, not swapped);
  // all quotes/convergence target it. `maxConvergenceExtraRaw` caps convergence input growth in this
  // token's raw units (default: 0.5 whole tokens). Absent ⇒ the default per-chain COT selection.
  outputToken?: { contractAddress: Hex; decimals: number; maxConvergenceExtraRaw?: Decimal };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Survey-prefix sizing: quote the smallest priority-ordered prefix whose cumulative USD
// value covers `outputRequired × PREFIX_HEADROOM`, leaving headroom for swap slippage
// before falling back to quoting the remaining non-COT holdings.
const PREFIX_HEADROOM = new Decimal('1.25');

/**
 * Resolve the per-chain taker (executor) and receiver for a quote request. Both are looked
 * up from required maps and must be present — there is no fallback to a single address or
 * the zero address, so a misconfigured route fails loudly rather than misdirecting output.
 */
export function requireRequestAddresses(
  chainId: number,
  userAddressByChain: Map<number, Hex>,
  recipientAddressByChain: Map<number, Hex>
): { userAddress: Hex; recipientAddress: Hex } {
  const userAddress = userAddressByChain.get(chainId);
  const recipientAddress = recipientAddressByChain.get(chainId);
  if (!userAddress || !recipientAddress) {
    throw Errors.internal(`Missing taker/receiver address for chain ${chainId}`);
  }
  return { userAddress, recipientAddress };
}

// Drop chains whose aggregate USD value falls below the Mayan per-leg floor.
// When `minOutputUsdPerSource` is unset, returns the holdings untouched.
const filterChainsByMinOutputUsd = (
  holdings: SourceHolding[],
  minOutputUsdPerSource: Decimal | undefined
): { holdings: SourceHolding[]; droppedChains: { chainID: number; valueUsd: Decimal }[] } => {
  if (!minOutputUsdPerSource) return { holdings, droppedChains: [] };

  const valueByChain = new Map<number, Decimal>();
  for (const h of holdings) {
    valueByChain.set(h.chainID, (valueByChain.get(h.chainID) ?? new Decimal(0)).plus(h.value));
  }

  const droppedChains: { chainID: number; valueUsd: Decimal }[] = [];
  for (const [chainID, total] of valueByChain) {
    if (total.lt(minOutputUsdPerSource)) {
      droppedChains.push({ chainID, valueUsd: total });
    }
  }
  const droppedSet = new Set(droppedChains.map((entry) => entry.chainID));
  return {
    holdings: holdings.filter((h) => !droppedSet.has(h.chainID)),
    droppedChains,
  };
};

const throwMayanShortfall = (
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
  const covered = outputRequired.minus(remaining);
  throw Errors.insufficientBalance(
    `Mayan bridge requires ≥ $${minOutputUsdPerSource.toFixed(2)} USD per source. ` +
      `Chains [${list}] were excluded; eligible liquidity ($${covered.toFixed(2)}) ` +
      `is below required ($${outputRequired.toFixed(2)}).`
  );
};

function lookupChainCollectionFee(
  chainId: number,
  quoteResponse: BridgeQuoteResponse,
  chainList: ChainListType,
  cotCurrencyId: CurrencyID
): Decimal {
  const cot = chainList.getTokenByCurrencyId(chainId, cotCurrencyId);
  const match = quoteResponse.sources.find(
    (source) => source.chainId === chainId && equalFold(source.tokenAddress, cot.contractAddress)
  );
  if (!match) {
    throw Errors.internal(
      `Quote response missing deposit fee for chain ${chainId} token ${cot.contractAddress}`
    );
  }
  return divDecimals(match.depositFeeToken, cot.decimals);
}

// ---------------------------------------------------------------------------
// autoSelectSourcesV2
// ---------------------------------------------------------------------------

/**
 * Selects source holdings to cover the required COT output amount.
 *
 * Algorithm:
 * 1. Separate holdings into COT vs non-COT
 * 2. Early exit if consecutive COTs from start cover requirement
 * 3. Process queue in order: COT used directly, non-COT quoted
 * 4. For partial non-COT: convergence loop to find right input amount
 */
export const autoSelectSources = async (input: AutoSelectInput): Promise<AutoSelectResult> => {
  const { outputRequired, aggregators, userAddressByChain, recipientAddressByChain } = input;
  const { holdings, droppedChains } = filterChainsByMinOutputUsd(
    input.holdings,
    input.minOutputUsdPerSource
  );
  // Bridge collection fees only applied on the legacy EOA-direct funding path. The smart-
  // account-only model never charges per-source collection fees, so the per-chain fee gating
  // collapses to "never apply" — feeApplies stays false even when bridgeQuoteResponse is set.
  const feeApplies = false;

  const getRequestAddresses = (chainId: number) =>
    requireRequestAddresses(chainId, userAddressByChain, recipientAddressByChain);

  // The token each holding is selected toward: a fixed destination token (Path A) or the chain's COT.
  const targetTokenFor = (chainID: number): { contractAddress: Hex; decimals: number } => {
    if (input.outputToken) {
      return { contractAddress: input.outputToken.contractAddress, decimals: input.outputToken.decimals };
    }
    const cot = input.chainList.getTokenByCurrencyId(chainID, input.cotCurrencyId);
    return { contractAddress: cot.contractAddress as Hex, decimals: cot.decimals };
  };

  if (outputRequired.lte(0)) {
    return { quoteResponses: [], usedCOTs: [] };
  }

  // Phase 1: Classify holdings as target-token (identity, used directly) vs swappable
  const items: QueueItem[] = holdings.map((h, idx) => {
    const target = targetTokenFor(h.chainID);
    const isCOT = equalFold(h.tokenAddress, target.contractAddress);
    const amount = divDecimals(h.amountRaw, h.decimals);
    return { holding: h, idx, isCOT, amount, value: h.value };
  });

  // Phase 2: Early exit — check if leading COTs cover requirement
  let earlySum = new Decimal(0);
  let allLeadingCOT = true;
  const earlyFeeSecured = new Map<number, boolean>();
  for (const item of items) {
    if (!item.isCOT) {
      allLeadingCOT = false;
      break;
    }
    const chainId = item.holding.chainID;
    let effective = item.amount;
    if (
      feeApplies &&
      chainId !== input.dstChainId &&
      !earlyFeeSecured.get(chainId) &&
      input.bridgeQuoteResponse
    ) {
      const fee = lookupChainCollectionFee(
        chainId,
        input.bridgeQuoteResponse,
        input.chainList,
        input.cotCurrencyId
      );
      effective = effective.minus(fee);
      if (effective.gt(0)) {
        earlyFeeSecured.set(chainId, true);
      }
    }
    earlySum = earlySum.plus(Decimal.max(effective, new Decimal(0)));
    if (earlySum.gte(outputRequired)) break;
  }

  if (allLeadingCOT && earlySum.gte(outputRequired)) {
    // Use COTs directly
    const usedCOTs: UsedCOT[] = [];
    let remaining = outputRequired;
    const collectionFeeSecured = new Map<number, boolean>();
    for (const item of items) {
      if (remaining.lte(0)) break;
      const chainId = item.holding.chainID;
      let chainFee = new Decimal(0);
      const needsFee =
        feeApplies &&
        chainId !== input.dstChainId &&
        !collectionFeeSecured.get(chainId) &&
        input.bridgeQuoteResponse;
      if (needsFee && input.bridgeQuoteResponse) {
        chainFee = lookupChainCollectionFee(
          chainId,
          input.bridgeQuoteResponse,
          input.chainList,
          input.cotCurrencyId
        );
      }
      const use = Decimal.min(item.amount, remaining.plus(chainFee));
      const effective = use.minus(chainFee);
      if (effective.lte(0)) continue;
      if (needsFee) {
        collectionFeeSecured.set(chainId, true);
      }
      usedCOTs.push({ holding: item.holding, amountUsed: use, idx: item.idx });
      remaining = remaining.minus(effective);
    }
    if (remaining.gt(0) && droppedChains.length > 0 && input.minOutputUsdPerSource) {
      throwMayanShortfall(
        droppedChains,
        input.chainList,
        remaining,
        outputRequired,
        input.minOutputUsdPerSource
      );
    }
    return { quoteResponses: [], usedCOTs };
  }

  // Phase 3: quote the value-prefix of non-COT holdings. Only the smallest priority-ordered
  // prefix whose cumulative value covers `outputRequired × PREFIX_HEADROOM` is quoted up front;
  // Phase 4 extends to the remaining non-COT holdings only if that prefix under-delivers.
  const nonCOTItems = items.filter((i) => !i.isCOT);
  const indicativeQuotes: Map<number, { quote: Quote; aggregator: Aggregator }> = new Map();
  const quotedIdxs = new Set<number>();

  const quoteBatch = async (batch: QueueItem[]): Promise<void> => {
    if (batch.length === 0) return;
    const requests = batch.map((item) => {
      const target = targetTokenFor(item.holding.chainID);
      const addresses = getRequestAddresses(item.holding.chainID);
      return {
        userAddress: addresses.userAddress,
        recipientAddress: addresses.recipientAddress,
        chainId: item.holding.chainID,
        inputToken: item.holding.tokenAddress,
        outputToken: target.contractAddress,
        seriousness: QuoteSeriousness.PRICE_SURVEY,
        type: QuoteType.EXACT_IN as const,
        inputAmount: item.holding.amountRaw,
      };
    });
    const results = await aggregateAggregators(requests, aggregators, AggregateMode.MaximizeOutput);
    for (let i = 0; i < batch.length; i++) {
      quotedIdxs.add(batch[i].idx);
      const r = results[i];
      if (r.quote) {
        indicativeQuotes.set(batch[i].idx, { quote: r.quote, aggregator: r.aggregator });
      }
    }
  };

  const target = outputRequired.mul(PREFIX_HEADROOM);
  let prefixCumulative = new Decimal(0);
  let prefixCutoffIdx: number | null = null;
  for (const item of items) {
    prefixCumulative = prefixCumulative.plus(item.isCOT ? item.amount : new Decimal(item.value));
    if (prefixCumulative.gte(target)) {
      prefixCutoffIdx = item.idx;
      break;
    }
  }

  const cutoff = prefixCutoffIdx;
  const initialBatch = cutoff == null ? nonCOTItems : nonCOTItems.filter((i) => i.idx <= cutoff);
  await quoteBatch(initialBatch);

  // Phase 4: Process queue until requirement met
  let remaining = outputRequired;
  const usedCOTs: UsedCOT[] = [];
  const quoteResponses: QuoteResponse[] = [];
  const collectionFeeSecured = new Map<number, boolean>();

  for (const item of items) {
    if (remaining.lte(0)) break;
    const chainId = item.holding.chainID;
    let chainFee = new Decimal(0);
    const needsFee =
      feeApplies &&
      chainId !== input.dstChainId &&
      !collectionFeeSecured.get(chainId) &&
      input.bridgeQuoteResponse;
    if (needsFee && input.bridgeQuoteResponse) {
      chainFee = lookupChainCollectionFee(
        chainId,
        input.bridgeQuoteResponse,
        input.chainList,
        input.cotCurrencyId
      );
    }

    if (item.isCOT) {
      const use = Decimal.min(item.amount, remaining.plus(chainFee));
      const effective = use.minus(chainFee);
      if (effective.lte(0)) continue;
      if (needsFee) {
        collectionFeeSecured.set(chainId, true);
      }
      usedCOTs.push({ holding: item.holding, amountUsed: use, idx: item.idx });
      remaining = remaining.minus(effective);
      continue;
    }

    // Non-COT: use indicative quote. If this holding sits beyond the surveyed prefix, the
    // prefix under-delivered — quote every remaining non-COT holding before consuming it.
    if (!quotedIdxs.has(item.idx)) {
      await quoteBatch(nonCOTItems.filter((i) => !quotedIdxs.has(i.idx)));
    }
    const indicative = indicativeQuotes.get(item.idx);
    if (!indicative) continue;

    const outputAmount = new Decimal(indicative.quote.output.amount);
    const effective = outputAmount.minus(chainFee);
    if (effective.lte(0)) continue;

    if (needsFee) {
      collectionFeeSecured.set(chainId, true);
    }

    if (effective.lte(remaining)) {
      // Use full holding — indicative quote output covers partially or fully
      quoteResponses.push({
        chainID: item.holding.chainID,
        quote: indicative.quote,
        holding: item.holding,
        aggregator: indicative.aggregator,
      });
      remaining = remaining.minus(effective);
    } else {
      // Partial: we need less than full output — convergence loop.
      // For Mayan, lift the target to the per-leg floor so a partial fill
      // never produces a leg that the bridge would later reject. COT is USDC,
      // so $1.10 USD ≈ 1.10 USDC; we treat the floor as a COT-unit value.
      const naturalTarget = remaining.plus(chainFee);
      const convergenceTarget = input.minOutputUsdPerSource
        ? Decimal.max(naturalTarget, input.minOutputUsdPerSource.plus(chainFee))
        : naturalTarget;
      const serious = await convergenceQuote(
        item,
        convergenceTarget,
        indicative,
        aggregators,
        targetTokenFor(item.holding.chainID),
        input.outputToken?.maxConvergenceExtraRaw,
        userAddressByChain,
        recipientAddressByChain
      );
      quoteResponses.push(serious);
      const seriousOutput = new Decimal(serious.quote.output.amount);
      remaining = remaining.minus(seriousOutput.minus(chainFee));
    }
  }

  if (remaining.gt(0) && droppedChains.length > 0 && input.minOutputUsdPerSource) {
    throwMayanShortfall(
      droppedChains,
      input.chainList,
      remaining,
      outputRequired,
      input.minOutputUsdPerSource
    );
  }

  return { quoteResponses, usedCOTs };
};

// ---------------------------------------------------------------------------
// Convergence loop for partial non-COT
// ---------------------------------------------------------------------------

async function convergenceQuote(
  item: QueueItem,
  needed: Decimal,
  indicative: { quote: Quote; aggregator: Aggregator },
  aggregators: Aggregator[],
  target: { contractAddress: Hex; decimals: number },
  maxConvergenceExtraRaw: Decimal | undefined,
  userAddressByChain: Map<number, `0x${string}`>,
  recipientAddressByChain: Map<number, Hex>
): Promise<QuoteResponse> {
  const indicativeInputHuman = new Decimal(indicative.quote.input.amount);
  const indicativeOutputHuman = new Decimal(indicative.quote.output.amount);

  if (indicativeOutputHuman.lte(0)) {
    throw new Error('Source selection failed to converge: indicative output is zero');
  }

  const addresses = requireRequestAddresses(
    item.holding.chainID,
    userAddressByChain,
    recipientAddressByChain
  );

  // Estimate input from indicative price in raw units, then cap below at holding balance.
  const priceRatio = indicativeInputHuman.div(indicativeOutputHuman);
  const initialInputAmountRaw = mulDecimals(
    needed.mul(priceRatio),
    indicative.quote.input.decimals
  );
  const initialInputDecimal = new Decimal(initialInputAmountRaw.toString());
  const holdingBalanceDecimal = new Decimal(item.holding.amountRaw.toString());
  // Cap the extra input in output-token terms, converted back to source-token raw via the indicative
  // price ratio. Mirrors v1's inputRawForOutputRaw(indicative, 0.5 COT). Path A can pass a USD-derived
  // cap (≈$0.50 of the destination token); default is 0.5 whole output tokens.
  const extraOutputRaw =
    maxConvergenceExtraRaw ?? new Decimal('0.5').mul(Decimal.pow(10, target.decimals));
  const maxExtraInputAmountRaw = extraOutputRaw
    .mul(new Decimal(indicative.quote.input.amountRaw.toString()))
    .div(new Decimal(indicative.quote.output.amountRaw.toString()));
  const requiredOutputAmountRaw = BigInt(
    needed.mul(Decimal.pow(10, indicative.quote.output.decimals)).toFixed(0, Decimal.ROUND_CEIL)
  );

  const exactOutPromise = tryExactOutDirect({
    request: {
      userAddress: addresses.userAddress,
      recipientAddress: addresses.recipientAddress,
      chainId: item.holding.chainID,
      inputToken: item.holding.tokenAddress,
      outputToken: target.contractAddress,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_OUT,
      outputAmount: requiredOutputAmountRaw,
    },
    aggregators,
    requiredOutputAmountRaw,
    maxInputAmountRaw: item.holding.amountRaw,
  });

  const convergedPromise = convergeExactIn({
    initialInputAmountRaw: initialInputDecimal,
    requiredOutputAmountRaw,
    maxExtraInputAmountRaw,
    maxInputAmountRaw: holdingBalanceDecimal,
    aggregators,
    makeRequest: (inputAmountRaw) => ({
      userAddress: addresses.userAddress,
      recipientAddress: addresses.recipientAddress,
      chainId: item.holding.chainID,
      inputToken: item.holding.tokenAddress,
      outputToken: target.contractAddress,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_IN,
      inputAmount: inputAmountRaw,
    }),
  });

  const raceStartedAt = Date.now();
  const raceContext = { chainId: item.holding.chainID, side: 'source' };
  const winner = await firstSuccess([
    timedCandidate('race.exact_out', raceContext, exactOutPromise),
    timedCandidate('race.convergence', raceContext, convergedPromise),
  ]);
  logger.debug('swap:timing', {
    op: 'source_convergence_race',
    chainId: item.holding.chainID,
    tokenAddress: item.holding.tokenAddress,
    hit: winner != null,
    ms: Date.now() - raceStartedAt,
  });

  if (!winner) {
    throw new Error(
      `Source selection failed to converge for holding ${item.holding.chainID}:${item.holding.tokenAddress} and needed output ${needed.toString()}`
    );
  }

  return {
    chainID: item.holding.chainID,
    quote: winner.quote,
    holding: { ...item.holding, amountRaw: winner.quote.input.amountRaw },
    aggregator: winner.aggregator,
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type QueueItem = {
  holding: SourceHolding;
  idx: number;
  isCOT: boolean;
  amount: Decimal;
  value: number;
};
