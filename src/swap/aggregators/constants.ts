// Shared target slippage for aggregator adapters that accept a tolerance. Defined once in basis
// points and exposed in each provider's native unit so their protected quotes stay comparable in
// aggregateAggregators.
export const SLIPPAGE_BPS = 30; // 0.3%
export const SLIPPAGE_BPS_STRING = String(SLIPPAGE_BPS); // '30' — 0x `slippageBps`, Relay `slippageTolerance`
export const SLIPPAGE_FRACTION = (SLIPPAGE_BPS / 10_000).toString(); // '0.003' — LiFi `slippage`
