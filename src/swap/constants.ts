import { CurrencyID } from './cot';

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export { EADDRESS } from '../domain/constants/addresses';
export const SWEEPER_ADDRESS = '0x0000000000296e7a886f40f7bc60D2E3653216a6' as const;

// ---------------------------------------------------------------------------
// Timing & thresholds
// ---------------------------------------------------------------------------

export const SLIPPAGE_DEFAULT = 0.005;
export const DIRECT_DST_QUOTE_TTL_MS = 45_000;

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

export const DST_BUFFER_PCT = 0.1;
export const DST_BUFFER_MAX_USD = 2;
export const SRC_BUFFER_PCT = 0.02;
export const SRC_BUFFER_MAX_USD = 1;
export const MAX_SWAP_HAIRCUT_PCT = 0.03;
export const MAX_SWAP_HAIRCUT_MIN_USDC = 3;

// EXACT_OUT's start-of-route provider check surveys bridged source value with a rough
// greedy walk over priority-ordered holdings; this overshoot fraction makes it count a
// little past the destination requirement so the threshold gate isn't starved by the
// difference between the survey and the real `autoSelectSources` pick.
export const EXACT_OUT_PROVIDER_BUFFER = 0.01;

// ---------------------------------------------------------------------------
// Fast-path settlement families
// ---------------------------------------------------------------------------

// B2 dynamic-COT selection re-settles a swap through whichever STABLE family ALL its sources already
// hold (USDC or USDT), skipping the input↔USDC round-trip when the sources are USDT-everywhere, etc.
// ETH is deliberately excluded: its volatility makes it a poor common settlement token for a route
// that isn't already ETH-shaped (B1 same-token still bridges ETH↔ETH directly).
export const B2_STABLE_CURRENCY_IDS: ReadonlySet<CurrencyID> = new Set([
  CurrencyID.USDC,
  CurrencyID.USDT,
]);
