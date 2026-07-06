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
import type { Aggregator, Quote, QuoteRequest } from './types';
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
  new LiFiAggregator(mw.getLiFiQuote),
  new BebopAggregator(mw.getBebopQuote),
  new FibrousAggregator(mw.getFibrousQuote),
  new ZeroExAggregator(mw.getZeroExQuote),
  new MysticAggregator(mw.postMystic),
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

  // Get quotes from all aggregators in parallel
  const allResults = await Promise.all(
    aggregators.map(async (agg) => {
      try {
        return await agg.getQuotes(normalized);
      } catch {
        // On aggregator failure, fill with nulls
        return normalized.map(() => null);
      }
    })
  );

  // Per request, pick the best quote, then backfill any fields the winning aggregator can't report
  // (0x has no decimals/symbol/price) from a sibling that quoted the same token.
  return normalized.map((req, reqIdx) => {
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
      ? backfillFromSiblings(bestQuote, bestAgg, allResults, reqIdx, bestAggIdx)
      : null;

    // Per-request selection trace (debug only): every candidate's metric + the winner, so a
    // surprising route can be diffed against what each aggregator actually offered.
    logger.debug('swap:aggregator-selection', {
      chainId: req.chainId,
      type: req.type,
      inputToken: req.inputToken,
      outputToken: req.outputToken,
      mode,
      metric: mode === AggregateMode.MaximizeOutput ? 'output.amountRaw' : 'input.amountRaw',
      candidates: aggregators.map((agg, i) => {
        const candidate = allResults[i][reqIdx];
        return {
          aggregator: aggregatorService(agg),
          output: candidate ? candidate.output.amountRaw.toString() : null,
          input: candidate ? candidate.input.amountRaw.toString() : null,
        };
      }),
      selected: bestQuote
        ? {
            aggregator: aggregatorService(bestAgg),
            output: bestQuote.output.amountRaw.toString(),
            input: bestQuote.input.amountRaw.toString(),
            // 0x can win on amount yet be dropped if no sibling supplied decimals (§7 backfill).
            droppedNoSibling: quote === null,
          }
        : null,
    });

    return { quote, aggregator: bestAgg };
  });
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

export { BebopAggregator } from './bebop';
export { FibrousAggregator } from './fibrous';
export { LiFiAggregator } from './lifi';
export { MysticAggregator } from './mystic';
export { RelayAggregator } from './relay';
// Re-exports
export type { Aggregator, Holding, Quote, QuoteRequest, QuoteResponse } from './types';
export { QuoteSeriousness, QuoteType } from './types';
export { ZeroExAggregator } from './zerox';
