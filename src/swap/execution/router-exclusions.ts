import type { QuoteResponse, RouterExclusions } from '../aggregators/types';

export const addRouterExclusions = (
  exclusions: RouterExclusions,
  quotes: readonly (QuoteResponse | null)[]
) => {
  for (const quote of quotes) {
    const routerId = quote?.quote.routerId;
    if (!routerId) continue;
    const current = exclusions.get(quote.aggregator) ?? [];
    if (!current.includes(routerId)) {
      exclusions.set(quote.aggregator, [...current, routerId]);
    }
  }
};
