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

export const DST_BUFFER_PCT = 0.05;
export const DST_BUFFER_MAX_USD = 1;
export const SRC_BUFFER_PCT = 0.02;
export const SRC_BUFFER_MAX_USD = 1;
export const STABLE_SRC_BUFFER_PCT = 0.005;
export const STABLE_SRC_BUFFER_MAX_USD = 0.25;
export const MAX_SWAP_HAIRCUT_PCT = DST_BUFFER_PCT + SRC_BUFFER_PCT;
export const MAX_SWAP_HAIRCUT_MIN_USDC = DST_BUFFER_MAX_USD + SRC_BUFFER_MAX_USD;

// EXACT_OUT's start-of-route provider check surveys bridged source value with a rough
// greedy walk over priority-ordered holdings; this overshoot fraction makes it count a
// little past the destination requirement so the threshold gate isn't starved by the
// difference between the survey and the real `autoSelectSources` pick.
export const EXACT_OUT_PROVIDER_BUFFER = 0.01;

// ---------------------------------------------------------------------------
// Stable settlement families
// ---------------------------------------------------------------------------

// General routing may settle through USDC or USDT, whichever requires fewer swap legs. ETH remains
// eligible for same-token bridging but is deliberately excluded as a general settlement token.
export const STABLE_SETTLEMENT_CURRENCY_IDS: ReadonlySet<CurrencyID> = new Set([
  CurrencyID.USDC,
  CurrencyID.USDT,
]);
