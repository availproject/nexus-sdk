import Decimal from 'decimal.js';
import type { ExternalServiceService } from '../../domain/errors';
import { logger } from '../../domain/utils';
import { isNativeAddress } from '../../services/addresses';
import { divDecimals } from '../../services/math';
import type { MiddlewareAggregatorQuoteClient } from '../../transport';
import { EADDRESS } from '../constants';
import { BebopAggregator } from './bebop';
import { FibrousAggregator } from './fibrous';
import { LiFiAggregator } from './lifi';
import { MysticAggregator } from './mystic';
import { RelayAggregator } from './relay';
import type { Aggregator, Quote, QuoteRequest, TokenInfoProvider } from './types';
import { ZeroExAggregator } from './zerox';

/**
 * Map an Aggregator instance to its `error.service` value so categorized errors thrown from
 * the swap path can report the correct upstream aggregator. Returns `'lifi'` as a safe
 * default for unknown implementations — better to coalesce into an existing bucket than
 * widen `ExternalServiceService` for every new aggregator without explicit handling.
 */
export const aggregatorService = (aggregator: Aggregator): ExternalServiceService => {
  if (aggregator instanceof BebopAggregator) return 'bebop';
  if (aggregator instanceof FibrousAggregator) return 'fibrous';
  if (aggregator instanceof ZeroExAggregator) return 'zerox';
  if (aggregator instanceof MysticAggregator) return 'mystic';
  if (aggregator instanceof RelayAggregator) return 'relay';
  if (aggregator instanceof LiFiAggregator) return 'lifi';
  return 'lifi';
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createAggregators = (mw: MiddlewareAggregatorQuoteClient): Aggregator[] => [
  new LiFiAggregator(mw.getLiFiQuote, mw.getLiFiToken),
  new BebopAggregator(mw.getBebopQuote),
  new FibrousAggregator(mw.getFibrousQuote, mw.getFibrousRoute),
  new ZeroExAggregator(mw.getZeroExPrice, mw.getZeroExQuote),
  new MysticAggregator(mw.postMystic, mw.getMysticToken),
  new RelayAggregator(mw.getRelayQuote),
];

// ---------------------------------------------------------------------------
// Aggregate Mode
// ---------------------------------------------------------------------------

export enum AggregateMode {
  MaximizeOutput = 'MaximizeOutput',
  MinimizeInput = 'MinimizeInput',
}

// ---------------------------------------------------------------------------
// Per-chain tiered selection
// ---------------------------------------------------------------------------

// Tier-1 adapters quote fast; tier 2 only tops the pool up to the competition cap.
// Array order is priority order within a tier.
const TIER_1 = [RelayAggregator, BebopAggregator, FibrousAggregator, MysticAggregator];
const TIER_2 = [ZeroExAggregator, LiFiAggregator];
const MAX_AGGREGATORS_PER_REQUEST = 2;

const tierRank = (aggregator: Aggregator): number => {
  const t1 = TIER_1.findIndex((cls) => aggregator instanceof cls);
  if (t1 >= 0) return t1;
  const t2 = TIER_2.findIndex((cls) => aggregator instanceof cls);
  if (t2 >= 0) return TIER_1.length + t2;
  return 0; // unknown implementations (tests, future adapters) compete as tier 1
};

// Pick the ≤2 aggregators that quote this chain: tier-1 supporters first, topped up from tier 2.
// Selection is chain-only on purpose — request-type quirks (e.g. Fibrous nulling EXACT_OUT) resolve
// locally in the adapter for free. A lone metadata-less pick (0x/Mystic) is kept: aggregateAggregators
// enriches it from a token-info endpoint rather than dropping it.
const selectForChain = (aggregators: Aggregator[], chainId: number): number[] => {
  const supporters = aggregators
    .map((agg, idx) => ({ agg, idx }))
    .filter(({ agg }) => agg.supportsChain(chainId));
  // No adapter claims the chain: the static lists are stale for it — fall back to full
  // fan-out. Gated adapters still null locally without HTTP; only ungated Relay probes live.
  if (supporters.length === 0) return aggregators.map((_, idx) => idx);

  return supporters
    .map(({ agg, idx }) => ({ idx, rank: tierRank(agg) }))
    .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
    .slice(0, MAX_AGGREGATORS_PER_REQUEST)
    .map(({ idx }) => idx);
};

// The supporters NOT already chosen by selectForChain, in tier-priority order, capped at
// MAX_AGGREGATORS_PER_REQUEST — the fallback pool aggregateAggregators quotes when the primary
// selection all returns null/error.
const remainingForChain = (
  aggregators: Aggregator[],
  chainId: number,
  selected: number[]
): number[] => {
  const chosen = new Set(selected);
  return aggregators
    .map((agg, idx) => ({ idx, rank: tierRank(agg) }))
    .filter(({ idx }) => aggregators[idx].supportsChain(chainId) && !chosen.has(idx))
    .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
    .slice(0, MAX_AGGREGATORS_PER_REQUEST)
    .map((s) => s.idx);
};

// ---------------------------------------------------------------------------
// aggregateAggregators
// ---------------------------------------------------------------------------

/**
 * Calls `getQuotes()` on all aggregators in parallel.
 * Per request, picks the best quote across all aggregators.
 *
 * - MaximizeOutput: pick largest `output.amountRaw`
 * - MinimizeInput: pick smallest `input.amountRaw`
 * - On tie: first aggregator wins
 * - On aggregator failure: fill with null for all requests
 */
export const aggregateAggregators = async (
  requests: QuoteRequest[],
  aggregators: Aggregator[],
  mode: AggregateMode
): Promise<{ quote: Quote | null; aggregator: Aggregator }[]> => {
  // Native is canonically EADDRESS for the aggregators (the gas swap already quotes it that way).
  // A caller may pass it as ZERO_ADDRESS (e.g. a user's native toTokenAddress); normalize here so
  // every aggregator recognizes native — otherwise only LiFi accepts the zero address and the rest
  // silently drop out, leaving a worse single-source quote.
  const normalized = requests.map(normalizeNativeTokens);

  // Per-request selection with fallback: quote the primary selection (selectForChain — ≤2, tier-1
  // first, topped up from tier 2) first; only where every selected adapter returns null/error do we
  // quote the remaining supporters. Each round inverts its selection into per-aggregator request
  // subsets (one getQuotes call per aggregator per round) and scatters results back into the full
  // aggregators × requests matrix, so the pick loop, sibling backfill and tie-break below are
  // untouched (uncalled cells stay null).
  const primarySelection = normalized.map((req) => selectForChain(aggregators, req.chainId));
  const allResults: (Quote | null)[][] = aggregators.map(() => normalized.map(() => null));
  const aggregateStartedAt = Date.now();

  const quoteRound = async (selectionPerRequest: number[][]): Promise<void> => {
    const reqIdxsPerAgg: number[][] = aggregators.map(() => []);
    selectionPerRequest.forEach((selected, reqIdx) => {
      for (const aggIdx of selected) reqIdxsPerAgg[aggIdx].push(reqIdx);
    });
    await Promise.all(
      aggregators.map(async (agg, aggIdx) => {
        const reqIdxs = reqIdxsPerAgg[aggIdx];
        if (reqIdxs.length === 0) return;
        const startedAt = Date.now();
        let failed = false;
        let quoted = 0;
        try {
          const quotes = await agg.getQuotes(reqIdxs.map((reqIdx) => normalized[reqIdx]));
          reqIdxs.forEach((reqIdx, k) => {
            allResults[aggIdx][reqIdx] = quotes[k] ?? null;
            if (quotes[k]) quoted++;
          });
        } catch {
          // On aggregator failure, its row stays all-null
          failed = true;
        }
        // Per-adapter wall time — the primary "which aggregator is slow" signal.
        logger.debug('swap.route.aggregator.quote_round.completed', {
          op: 'aggregator.getQuotes',
          aggregator: aggregatorService(agg),
          requestCount: reqIdxs.length,
          quoted,
          failed,
          chainIds: [...new Set(reqIdxs.map((reqIdx) => normalized[reqIdx].chainId))],
          types: [...new Set(reqIdxs.map((reqIdx) => normalized[reqIdx].type))],
          seriousness: [...new Set(reqIdxs.map((reqIdx) => normalized[reqIdx].seriousness))],
          durationMs: Date.now() - startedAt,
        });
      })
    );
  };

  // Round 1 — primary selection.
  await quoteRound(primarySelection);
  // Round 2 — the remaining supporters, only for requests where every primary adapter came back
  // null/error.
  const needsFallback = normalized.map((_req, reqIdx) =>
    primarySelection[reqIdx].every((aggIdx) => allResults[aggIdx][reqIdx] == null)
  );
  const fallbackSelection = normalized.map((_req, reqIdx) =>
    needsFallback[reqIdx]
      ? remainingForChain(aggregators, normalized[reqIdx].chainId, primarySelection[reqIdx])
      : []
  );
  await quoteRound(fallbackSelection);
  logger.debug('swap.route.aggregator.aggregate.completed', {
    op: 'aggregate_total',
    requestCount: normalized.length,
    mode,
    durationMs: Date.now() - aggregateStartedAt,
  });

  // The selection that supplied each request's quotes — the candidate set for the trace below.
  const selectedPerRequest = normalized.map((_req, reqIdx) =>
    needsFallback[reqIdx] ? fallbackSelection[reqIdx] : primarySelection[reqIdx]
  );

  // Per request, pick the best quote, then backfill any fields the winning aggregator can't report
  // (0x has no decimals/symbol/price) from a sibling that quoted the same token.
  return Promise.all(
    normalized.map(async (req, reqIdx) => {
      let bestQuote: Quote | null = null;
      let bestAgg: Aggregator = aggregators[0];
      let bestAggIdx = 0;

      for (let aggIdx = 0; aggIdx < aggregators.length; aggIdx++) {
        const quote = allResults[aggIdx][reqIdx];
        if (!quote) continue;

        const isBetter =
          !bestQuote ||
          (mode === AggregateMode.MaximizeOutput
            ? quote.output.amountRaw > bestQuote.output.amountRaw
            : quote.input.amountRaw < bestQuote.input.amountRaw);

        if (isBetter) {
          bestQuote = quote;
          bestAgg = aggregators[aggIdx];
          bestAggIdx = aggIdx;
        }
      }

      const quote = bestQuote
        ? await enrichWinner(bestQuote, bestAgg, allResults, reqIdx, bestAggIdx, aggregators, req)
        : null;

      // Per-request selection trace (debug only): every candidate's metric + the winner, so a
      // surprising route can be diffed against what each aggregator actually offered.
      logger.debug('swap.route.aggregator.selection.completed', {
        chainId: req.chainId,
        type: req.type,
        inputToken: req.inputToken,
        outputToken: req.outputToken,
        mode,
        metric: mode === AggregateMode.MaximizeOutput ? 'output.amountRaw' : 'input.amountRaw',
        candidates: selectedPerRequest[reqIdx].map((aggIdx) => {
          const candidate = allResults[aggIdx][reqIdx];
          return {
            aggregator: aggregatorService(aggregators[aggIdx]),
            outputAmountRaw: candidate ? candidate.output.amountRaw.toString() : null,
            inputAmountRaw: candidate ? candidate.input.amountRaw.toString() : null,
          };
        }),
        selected: bestQuote
          ? {
              aggregator: aggregatorService(bestAgg),
              outputAmountRaw: bestQuote.output.amountRaw.toString(),
              inputAmountRaw: bestQuote.input.amountRaw.toString(),
              // 0x/Mystic can win on amount yet be dropped only if neither a sibling nor the
              // token-info provider supplied decimals (§7 backfill/enrich).
              droppedNoSibling: quote === null,
            }
          : null,
      });

      return { quote, aggregator: bestAgg };
    })
  );
};

// Rewrite native token addresses (e.g. ZERO_ADDRESS) to the aggregator-canonical EADDRESS.
// Returns the same object when nothing changes so non-native requests are untouched.
const normalizeNativeTokens = (req: QuoteRequest): QuoteRequest => {
  const inputToken = isNativeAddress(req.inputToken) ? EADDRESS : req.inputToken;
  const outputToken = isNativeAddress(req.outputToken) ? EADDRESS : req.outputToken;
  if (inputToken === req.inputToken && outputToken === req.outputToken) return req;
  return { ...req, inputToken, outputToken };
};

// 0x returns amounts + tx only — no decimals, symbol or USD price. Borrow them from a sibling that
// quoted the SAME request (same token ⇒ exact decimals; price ≈ equal). The USD borrow also fixes
// any aggregator that reports no price (e.g. Bebop with a missing priceUsd → value 0). A leg only 0x
// quoted has no sibling for decimals and is dropped (null → falls back to today's no-0x coverage).
// ponytail: sibling-borrow over threading decimals through every QuoteRequest call site; thread them
// onto QuoteRequest if 0x-only legs ever need coverage.
const backfillFromSiblings = (
  quote: Quote,
  aggregator: Aggregator,
  allResults: (Quote | null)[][],
  reqIdx: number,
  selfIdx: number
): Quote | null => {
  const needsDecimals =
    aggregator instanceof ZeroExAggregator || aggregator instanceof MysticAggregator;
  for (const side of ['input', 'output'] as const) {
    const leg = quote[side];
    if (needsDecimals) {
      const decimals = siblingField(allResults, reqIdx, selfIdx, side, 'decimals');
      if (typeof decimals !== 'number') return null; // no sibling → can't form a human amount
      leg.decimals = decimals;
      leg.amount = divDecimals(leg.amountRaw, decimals).toFixed();
      const symbol = siblingField(allResults, reqIdx, selfIdx, side, 'symbol');
      if (typeof symbol === 'string') leg.symbol = symbol;
    }
    if (leg.priceUsd === undefined) {
      const priceUsd = siblingField(allResults, reqIdx, selfIdx, side, 'priceUsd');
      if (typeof priceUsd === 'number')
        leg.value = new Decimal(leg.amount).mul(priceUsd).toNumber();
    }
  }
  return quote;
};

// First non-nullish value of `field` on `side` among the sibling results (skips the winner itself,
// whose placeholders we're replacing).
const siblingField = (
  allResults: (Quote | null)[][],
  reqIdx: number,
  selfIdx: number,
  side: 'input' | 'output',
  field: 'decimals' | 'symbol' | 'priceUsd'
): number | string | undefined => {
  for (let i = 0; i < allResults.length; i++) {
    if (i === selfIdx) continue;
    const value = allResults[i][reqIdx]?.[side][field];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

// Enrich the winning quote's token metadata. Sibling backfill first (free, in-round); if the winner
// is metadata-less (0x/Mystic) with no sibling to supply decimals, fetch from a token-info provider —
// 0x → LiFi (non-Citrea, includes a USD price), Mystic → itself (Citrea; no price → value 0). Returns
// null (dropping the quote) only when no provider is present or the lookup yields no decimals.
const enrichWinner = async (
  quote: Quote,
  aggregator: Aggregator,
  allResults: (Quote | null)[][],
  reqIdx: number,
  selfIdx: number,
  aggregators: Aggregator[],
  req: QuoteRequest
): Promise<Quote | null> => {
  const backfilled = backfillFromSiblings(quote, aggregator, allResults, reqIdx, selfIdx);
  if (backfilled) return backfilled;

  const provider: TokenInfoProvider | undefined =
    aggregator instanceof MysticAggregator
      ? aggregator
      : aggregator instanceof ZeroExAggregator
        ? aggregators.find((a): a is LiFiAggregator => a instanceof LiFiAggregator)
        : undefined;
  if (!provider) return null;

  for (const side of ['input', 'output'] as const) {
    const leg = quote[side];
    const info = await provider.getTokenInfo(req.chainId, leg.contractAddress);
    if (!info) return null; // provider couldn't resolve the token → drop, as before
    leg.decimals = info.decimals;
    leg.symbol = info.symbol;
    leg.amount = divDecimals(leg.amountRaw, info.decimals).toFixed();
    if (typeof info.priceUsd === 'number') {
      leg.priceUsd = info.priceUsd;
      leg.value = new Decimal(leg.amount).mul(info.priceUsd).toNumber();
    } else {
      leg.value = 0;
    }
  }
  return quote;
};

export { BebopAggregator } from './bebop';
export { FibrousAggregator } from './fibrous';
export { LiFiAggregator } from './lifi';
export { MysticAggregator } from './mystic';
export { RelayAggregator } from './relay';
// Re-exports
export type { Aggregator, Holding, Quote, QuoteRequest, QuoteResponse } from './types';
export { QuoteSeriousness, QuoteType } from './types';
export { ZeroExAggregator } from './zerox';
