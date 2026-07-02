import { parseQuote } from '../../services/quote-parser';
import type { QuoteResponse } from '../aggregators/types';
import type { ParsedQuoteCall } from '../types';

/**
 * Resolve the parsed approval/swap calls for a source or destination leg.
 *
 * Identity-match only: the prepared cache is keyed by quote-object identity, so a re-quote (a NEW
 * quote object) correctly misses and falls through to a fresh `parseQuote`. An earlier field-based
 * fallback re-matched a re-quote back to the stale prepared entry — for an EXACT_IN leg every match
 * field (chain, router `to`, input token, input amount) is invariant across a re-quote — and
 * silently resent the original, expired order instead of the freshly quoted one.
 */
export const getParsedQuote = (
  swap: QuoteResponse,
  parsedQuotes: ParsedQuoteCall[] | undefined
): ParsedQuoteCall =>
  parsedQuotes?.find((entry) => entry.quote === swap.quote) ?? {
    ...parseQuote(swap.quote),
    chainId: swap.chainID,
    quote: swap.quote,
  };
