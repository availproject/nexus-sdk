import type { Quote } from './aggregators/types';

export type ExactInAmountBasis = 'expected' | 'minimum';

export const resolveExactInAmountBasis = (
  basis: ExactInAmountBasis | undefined
): ExactInAmountBasis => basis ?? 'minimum';

/** Select the one forward-sizing/display amount while leaving executable quote fields untouched. */
export const selectExactInQuoteOutput = (
  quote: Quote,
  basis: ExactInAmountBasis
): Quote['output'] | Quote['expectedOutput'] =>
  // Normalized SDK quotes require expectedOutput. Keep the runtime check only for untyped custom
  // aggregators or stale JavaScript objects crossing the boundary; it does not weaken Quote's type.
  basis === 'expected' && quote.expectedOutput ? quote.expectedOutput : quote.output;
