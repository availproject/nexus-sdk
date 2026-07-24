// Shared target slippage for aggregator adapters that accept a tolerance. Defined once in basis
// points and exposed in each provider's native unit so their protected quotes stay comparable in
// aggregateAggregators.
export const SLIPPAGE_BPS = 25; // 0.25%
export const SLIPPAGE_BPS_STRING = String(SLIPPAGE_BPS); // '50' — 0x `slippageBps`, Relay `slippageTolerance`
export const SLIPPAGE_FRACTION = (SLIPPAGE_BPS / 10_000).toString(); // '0.005' — LiFi `slippage`
export const SLIPPAGE_PERCENT = (SLIPPAGE_BPS / 100).toString(); // '0.5' — Fibrous `slippage`
