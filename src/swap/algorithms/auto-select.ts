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
import { logger } from '../../domain/utils';
import { convergeExactIn, firstSuccess, timedCandidate, tryExactOutDirect } from './convergence';
import { filterMayanSourcesByChain } from './mayan-floor';

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
  userAddressByChain: Map<number, `0x${string}`>;
  recipientAddressByChain: Map<number, Hex>;
  // Set when the bridge will go through Mayan: each source chain's aggregate
  // USD value must clear this floor or the chain is dropped from selection.
  // Mayan rejects quotes for legs below ~$1.10 USD output.
  minOutputUsdPerSource?: Decimal;
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
  const { holdings, droppedChains } = input.minOutputUsdPerSource
    ? filterMayanSourcesByChain(
        input.holdings,
        input.minOutputUsdPerSource,
        (holding) => new Decimal(holding.value)
      )
    : { holdings: input.holdings, droppedChains: [] };

  const getRequestAddresses = (chainId: number) =>
    requireRequestAddresses(chainId, userAddressByChain, recipientAddressByChain);

  // The COT each holding is liquidated toward (per-chain). Path A's fixed-destination selection lives
  // in selectDirectDestinationSwaps, not here.
  const targetTokenFor = (chainID: number): { contractAddress: Hex; decimals: number } => {
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
  for (const item of items) {
    if (!item.isCOT) {
      allLeadingCOT = false;
      break;
    }
    earlySum = earlySum.plus(Decimal.max(item.amount, new Decimal(0)));
    if (earlySum.gte(outputRequired)) break;
  }

  if (allLeadingCOT && earlySum.gte(outputRequired)) {
    // Use COTs directly
    const usedCOTs: UsedCOT[] = [];
    let remaining = outputRequired;
    for (const item of items) {
      if (remaining.lte(0)) break;
      const use = Decimal.min(item.amount, remaining);
      if (use.lte(0)) continue;
      usedCOTs.push({ holding: item.holding, amountUsed: use, idx: item.idx });
      remaining = remaining.minus(use);
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

  for (const item of items) {
    if (remaining.lte(0)) break;

    if (item.isCOT) {
      const use = Decimal.min(item.amount, remaining);
      if (use.lte(0)) continue;
      usedCOTs.push({ holding: item.holding, amountUsed: use, idx: item.idx });
      remaining = remaining.minus(use);
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
    if (outputAmount.lte(0)) continue;

    if (outputAmount.lte(remaining)) {
      // Use full holding — indicative quote output covers partially or fully
      quoteResponses.push({
        chainID: item.holding.chainID,
        quote: indicative.quote,
        holding: item.holding,
        aggregator: indicative.aggregator,
      });
      remaining = remaining.minus(outputAmount);
    } else {
      // Partial: we need less than full output — convergence loop.
      // For Mayan, lift the target to the per-leg floor so a partial fill
      // never produces a leg that the bridge would later reject. COT is USDC,
      // so $1.10 USD ≈ 1.10 USDC; we treat the floor as a COT-unit value.
      const convergenceTarget = input.minOutputUsdPerSource
        ? Decimal.max(remaining, input.minOutputUsdPerSource)
        : remaining;
      const serious = await convergenceQuote(
        item,
        convergenceTarget,
        indicative,
        aggregators,
        targetTokenFor(item.holding.chainID),
        undefined,
        userAddressByChain,
        recipientAddressByChain
      );
      quoteResponses.push(serious);
      const seriousOutput = new Decimal(serious.quote.output.amount);
      remaining = remaining.minus(seriousOutput);
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
// Path A — direct destination selection
// ---------------------------------------------------------------------------

export type DirectSelectInput = {
  holdings: SourceHolding[];
  // In the target token's units (toToken or native gas), NOT USD.
  outputRequired: Decimal;
  target: { contractAddress: Hex; decimals: number };
  aggregators: Aggregator[];
  userAddressByChain: Map<number, `0x${string}`>;
  recipientAddressByChain: Map<number, Hex>;
  // Caps convergence input growth in the target token's raw units (Path A passes ≈$0.50 via oracle;
  // absent ⇒ convergenceQuote's default of 0.5 whole output tokens).
  maxConvergenceExtraRaw?: Decimal;
};

/**
 * Path A (direct destination-chain swap) source selection — the standalone twin of autoSelectSources'
 * COT round-trip. Every holding is selected toward one FIXED target token (the toToken or native gas)
 * on the dst chain, with none of the bridge machinery (no Mayan floor, collection fees, COT resolution,
 * or USD-value prefix survey). Holdings already in the target token are used directly (identities); the
 * rest are quoted input→target via the shared EXACT_OUT-direct vs EXACT_IN convergence race.
 *
 * Path A's holdings are dst-chain-only (a handful), so every swappable holding is quoted up front —
 * there is no value-prefix survey, which would compare USD `value` against a token-denominated target
 * and mis-batch. Partial coverage returns without throwing; the builder enforces the buffered target
 * and falls back on a shortfall.
 */
export const selectDirectDestinationSwaps = async (
  input: DirectSelectInput
): Promise<AutoSelectResult> => {
  const { outputRequired, target, aggregators, userAddressByChain, recipientAddressByChain } =
    input;
  if (outputRequired.lte(0)) return { quoteResponses: [], usedCOTs: [] };

  // Classify: identity (already the target token) vs swappable.
  const items: QueueItem[] = input.holdings.map((h, idx) => ({
    holding: h,
    idx,
    isCOT: equalFold(h.tokenAddress, target.contractAddress),
    amount: divDecimals(h.amountRaw, h.decimals),
    value: h.value,
  }));

  // Quote every swappable holding up front (no prefix survey — see the docblock).
  const swappable = items.filter((item) => !item.isCOT);
  const indicativeByIdx = new Map<number, { quote: Quote; aggregator: Aggregator }>();
  if (swappable.length > 0) {
    const requests = swappable.map((item) => {
      const addresses = requireRequestAddresses(
        item.holding.chainID,
        userAddressByChain,
        recipientAddressByChain
      );
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
    swappable.forEach((item, i) => {
      const r = results[i];
      if (r?.quote) indicativeByIdx.set(item.idx, { quote: r.quote, aggregator: r.aggregator });
    });
  }

  // Walk in priority order: identities used directly; swappable consumed full (indicative survey quote)
  // or partial (convergence race), until the target is covered.
  let remaining = outputRequired;
  const usedCOTs: UsedCOT[] = [];
  const quoteResponses: QuoteResponse[] = [];
  for (const item of items) {
    if (remaining.lte(0)) break;
    if (item.isCOT) {
      const use = Decimal.min(item.amount, remaining);
      if (use.lte(0)) continue;
      usedCOTs.push({ holding: item.holding, amountUsed: use, idx: item.idx });
      remaining = remaining.minus(use);
      continue;
    }
    const indicative = indicativeByIdx.get(item.idx);
    if (!indicative) continue;
    const outputAmount = new Decimal(indicative.quote.output.amount);
    if (outputAmount.lte(0)) continue;
    if (outputAmount.lte(remaining)) {
      quoteResponses.push({
        chainID: item.holding.chainID,
        quote: indicative.quote,
        holding: item.holding,
        aggregator: indicative.aggregator,
      });
      remaining = remaining.minus(outputAmount);
    } else {
      const serious = await convergenceQuote(
        item,
        remaining,
        indicative,
        aggregators,
        target,
        input.maxConvergenceExtraRaw,
        userAddressByChain,
        recipientAddressByChain
      );
      quoteResponses.push(serious);
      remaining = remaining.minus(new Decimal(serious.quote.output.amount));
    }
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
  logger.debug('swap.route.source_selection.convergence_race.completed', {
    operation: 'source_convergence_race',
    chainId: item.holding.chainID,
    tokenAddress: item.holding.tokenAddress,
    hit: winner != null,
    durationMs: Date.now() - raceStartedAt,
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
