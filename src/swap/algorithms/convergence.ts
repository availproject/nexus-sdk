import Decimal from 'decimal.js';
import {
  AggregateMode,
  type Aggregator,
  aggregateAggregators,
  type Quote,
  type QuoteRequest,
  type QuoteType,
} from '../aggregators';

// 1% per-iteration step. v1 lowered this from 2.5% so the convergence overshoots
// the actual required input by less, leaving less stranded COT to sweep back.
export const SAFETY_MULTIPLIER = new Decimal('1.01');

// Per-iteration cap (in COT raw units) above the initial input estimate. Stops the
// convergence loop from drifting more than `extra` over the initial reverse-quote
// estimate even if aggregator output keeps under-delivering — protects against
// runaway iterations under volatile rates.
export const MAX_CONVERGENCE_EXTRA_COT = new Decimal('0.5');

export const MAX_CONVERGENCE_ITERATIONS = 10;

export type ExactOutConvergenceArgs = {
  // Build the EXACT_IN convergence request for a given raw input. The convergence
  // loop owns the input sizing — the callback is just the per-iteration request
  // shape.
  makeRequest: (inputAmountRaw: bigint) => QuoteRequest & { type: QuoteType.EXACT_IN };
  // Initial input estimate in raw units (caller is responsible for the reverse
  // quote that produces this).
  initialInputAmountRaw: Decimal;
  requiredOutputAmountRaw: bigint;
  maxExtraInputAmountRaw: Decimal;
  // Optional absolute upper bound (e.g. holding balance for source swaps; no cap
  // for destination swaps where COT is bridged in).
  maxInputAmountRaw?: Decimal;
  aggregators: Aggregator[];
  maxAttempts?: number;
};

export type ExactOutDirectArgs = {
  request: QuoteRequest & { type: QuoteType.EXACT_OUT };
  aggregators: Aggregator[];
  requiredOutputAmountRaw: bigint;
  maxInputAmountRaw?: bigint;
};

/**
 * Clamp `currentInput * SAFETY_MULTIPLIER` to `min(baseInput + maxExtraInput, maxInputAmountRaw)`.
 * Centralising the cap math so caller code doesn't open-code the corner cases.
 */
export const applyCappedSafetyMargin = (args: {
  baseInputAmountRaw: Decimal;
  inputAmountRaw: Decimal;
  maxExtraInputAmountRaw: Decimal;
  maxInputAmountRaw?: Decimal;
}): Decimal => {
  const maxWithExtra = args.baseInputAmountRaw.add(args.maxExtraInputAmountRaw);
  const ceiling =
    args.maxInputAmountRaw == null
      ? maxWithExtra
      : Decimal.min(maxWithExtra, args.maxInputAmountRaw);
  return Decimal.min(args.inputAmountRaw.mul(SAFETY_MULTIPLIER), ceiling);
};

/**
 * Attempt a single EXACT_OUT direct aggregator quote. Returns null if no aggregator
 * supports it, or the returned quote fails the required-output / max-input checks.
 */
export const tryExactOutDirect = async (
  args: ExactOutDirectArgs
): Promise<{ quote: Quote; aggregator: Aggregator } | null> => {
  const results = await aggregateAggregators(
    [args.request],
    args.aggregators,
    AggregateMode.MinimizeInput
  );
  const best = results[0];
  if (!best?.quote) return null;
  if (best.quote.output.amountRaw < args.requiredOutputAmountRaw) return null;
  if (args.maxInputAmountRaw != null && best.quote.input.amountRaw > args.maxInputAmountRaw) {
    return null;
  }
  return { quote: best.quote, aggregator: best.aggregator };
};

/**
 * Iterative EXACT_IN convergence: keep bumping input by `SAFETY_MULTIPLIER` (capped
 * by `maxExtraInputAmountRaw` / `maxInputAmountRaw`) until output covers requirement
 * or the cap pins the input. Returns null if the loop exhausts attempts or hits the
 * cap without finding a covering quote.
 */
export const convergeExactIn = async (
  args: ExactOutConvergenceArgs
): Promise<{ quote: Quote; aggregator: Aggregator } | null> => {
  const baseInputAmountRaw = args.initialInputAmountRaw;
  let inputAmountRaw = applyCappedSafetyMargin({
    baseInputAmountRaw,
    inputAmountRaw: baseInputAmountRaw,
    maxExtraInputAmountRaw: args.maxExtraInputAmountRaw,
    maxInputAmountRaw: args.maxInputAmountRaw,
  });
  const maxAttempts = args.maxAttempts ?? MAX_CONVERGENCE_ITERATIONS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const requestInputRaw = BigInt(inputAmountRaw.toFixed(0, Decimal.ROUND_CEIL));
    const request = args.makeRequest(requestInputRaw);
    const results = await aggregateAggregators(
      [request],
      args.aggregators,
      AggregateMode.MaximizeOutput
    );
    const best = results[0];
    if (best?.quote && best.quote.output.amountRaw >= args.requiredOutputAmountRaw) {
      return { quote: best.quote, aggregator: best.aggregator };
    }

    const nextInputAmountRaw = applyCappedSafetyMargin({
      baseInputAmountRaw,
      inputAmountRaw,
      maxExtraInputAmountRaw: args.maxExtraInputAmountRaw,
      maxInputAmountRaw: args.maxInputAmountRaw,
    });
    if (nextInputAmountRaw.eq(inputAmountRaw)) {
      // Cap pinned — further iterations would request the same input.
      return null;
    }
    inputAmountRaw = nextInputAmountRaw;
  }

  return null;
};

/**
 * Returns the resolved value of `preferred` if it's non-null, otherwise the resolved
 * value of `fallback`. Both promises kick off concurrently before this call (so they
 * race for compute), but `preferred` is always checked first regardless of which
 * actually settles first in time — for the EXACT_OUT-vs-convergence race that means
 * the more precise EXACT_OUT direct quote always wins when supported, even if
 * convergence happens to come back sooner. Encoded as named args so reorganising
 * the call site can never accidentally flip the priority.
 */
export const preferredOrFallback = async <T>(args: {
  preferred: Promise<T | null>;
  fallback: Promise<T | null>;
}): Promise<T | null> => {
  const preferred = await args.preferred;
  if (preferred != null) return preferred;
  return args.fallback;
};

/**
 * 0.5 COT (`MAX_CONVERGENCE_EXTRA_COT`) expressed in raw units for the given COT
 * decimals. Centralised so caller sites don't reach into Decimal math.
 */
export const maxConvergenceExtraAmountRaw = (cotDecimals: number): Decimal =>
  MAX_CONVERGENCE_EXTRA_COT.mul(Decimal.pow(10, cotDecimals));
