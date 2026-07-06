// Common target slippage for every aggregator quote. Defined once in basis points and converted to
// each aggregator's native unit at the call site, so all adapters floor the output at the same
// tolerance and their quotes stay comparable in aggregateAggregators.
export const SLIPPAGE_BPS = 25; // 0.25%
export const SLIPPAGE_BPS_STRING = String(SLIPPAGE_BPS); // '25' — 0x `slippageBps`, Relay `slippageTolerance`
export const SLIPPAGE_FRACTION = (SLIPPAGE_BPS / 10_000).toString(); // '0.0025' — LiFi `slippage`
export const SLIPPAGE_PERCENT = (SLIPPAGE_BPS / 100).toString(); // '0.25' — Fibrous `slippage`
