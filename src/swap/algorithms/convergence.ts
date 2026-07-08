import Decimal from 'decimal.js';
import { logger } from '../../domain/utils';
import {
  AggregateMode,
  type Aggregator,
  aggregateAggregators,
  type Quote,
  type QuoteRequest,
  type QuoteType,
} from '../aggregators';

// 0.2% per-iteration step (v1 used 2.5%, then 1%, then 0.1%). Kept tight so the EXACT_IN race
// candidate prices ≈ the true EXACT_OUT input — the seed already rides a slippage-protected
// indicative minimum, so the first attempt usually covers; under-delivery costs extra
// iterations instead of stranded COT. Tunable if quotes start needing too many rounds.
export const SAFETY_MULTIPLIER = new Decimal('1.002');

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
  const startedAt = Date.now();
  const results = await aggregateAggregators(
    [args.request],
    args.aggregators,
    AggregateMode.MinimizeInput
  );
  const best = results[0];
  const hit =
    best?.quote != null &&
    best.quote.output.amountRaw >= args.requiredOutputAmountRaw &&
    (args.maxInputAmountRaw == null || best.quote.input.amountRaw <= args.maxInputAmountRaw);
  logger.debug('swap:timing', {
    op: 'exact_out_direct',
    chainId: args.request.chainId,
    hit,
    ms: Date.now() - startedAt,
  });
  if (!hit || !best?.quote) return null;
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
  const startedAt = Date.now();
  const baseInputAmountRaw = args.initialInputAmountRaw;
  let inputAmountRaw = applyCappedSafetyMargin({
    baseInputAmountRaw,
    inputAmountRaw: baseInputAmountRaw,
    maxExtraInputAmountRaw: args.maxExtraInputAmountRaw,
    maxInputAmountRaw: args.maxInputAmountRaw,
  });
  const maxAttempts = args.maxAttempts ?? MAX_CONVERGENCE_ITERATIONS;
  const logOutcome = (attempts: number, converged: boolean, cappedOut: boolean) =>
    logger.debug('swap:timing', {
      op: 'converge_exact_in',
      attempts,
      converged,
      cappedOut,
      ms: Date.now() - startedAt,
    });

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
      logOutcome(attempt + 1, true, false);
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
      logOutcome(attempt + 1, false, true);
      return null;
    }
    inputAmountRaw = nextInputAmountRaw;
  }

  logOutcome(maxAttempts, false, false);
  return null;
};

/**
 * Resolve with the first candidate to settle non-null; resolve null only once every
 * candidate has settled null (rejections count as null; an empty list resolves null).
 *
 * Used for the EXACT_OUT-direct vs EXACT_IN-convergence race: the convergence seed sits
 * within ~SAFETY_MULTIPLIER of the EXACT_OUT-minimized input (still capped by
 * `maxExtraInputAmountRaw` / the holding balance), so letting whichever settles first win
 * costs at most that sliver of input precision while often returning much sooner —
 * EXACT_IN endpoints are faster and more widely supported than EXACT_OUT.
 */
/**
 * Passthrough that logs a candidate's settle time and hit/miss under `swap:timing` when it
 * eventually settles — including a race LOSER that lands after `firstSuccess` already resolved,
 * so the logs show what racing actually saved. Never affects the candidate's outcome.
 */
export const timedCandidate = <T>(
  op: string,
  context: Record<string, unknown>,
  candidate: Promise<T | null>
): Promise<T | null> => {
  const startedAt = Date.now();
  candidate
    .then((value) =>
      logger.debug('swap:timing', { op, ...context, hit: value != null, ms: Date.now() - startedAt })
    )
    .catch(() =>
      logger.debug('swap:timing', { op, ...context, hit: false, ms: Date.now() - startedAt })
    );
  return candidate;
};

export const firstSuccess = async <T>(candidates: Promise<T | null>[]): Promise<T | null> => {
  try {
    return await Promise.any(
      candidates.map(async (candidate) => {
        const value = await candidate;
        if (value == null) throw new Error('candidate settled null');
        return value;
      })
    );
  } catch {
    return null; // AggregateError: every candidate null/rejected, or no candidates
  }
};

/**
 * 0.5 COT (`MAX_CONVERGENCE_EXTRA_COT`) expressed in raw units for the given COT
 * decimals. Centralised so caller sites don't reach into Decimal math.
 */
export const maxConvergenceExtraAmountRaw = (cotDecimals: number): Decimal =>
  MAX_CONVERGENCE_EXTRA_COT.mul(Decimal.pow(10, cotDecimals));
