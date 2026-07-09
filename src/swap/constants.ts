import { CurrencyID } from './cot';

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export { EADDRESS } from '../domain/constants/addresses';
export const SWEEPER_ADDRESS = '0x0000000000296e7a886f40f7bc60D2E3653216a6' as const;
export const CALIBUR_ADDRESS = '0x00000000557A0daF2659cbb6A45f2beB6081e6AE' as const;
export const CANONICAL_MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
export const ZERO_BYTES_32 = new Uint8Array(32);

// ---------------------------------------------------------------------------
// EIP-712 domain (verifyingContract set per-call to ephemeralAddress)
// ---------------------------------------------------------------------------

export const CALIBUR_EIP712_BASE = {
  name: 'Calibur',
  version: '1.0.0',
  // salt = pad(CALIBUR_ADDRESS, 32) — computed at call site
} as const;

// ---------------------------------------------------------------------------
// Timing & thresholds
// ---------------------------------------------------------------------------

export const SBC_DEADLINE_MINUTES = 15n;
export const SLIPPAGE_DEFAULT = 0.005;
export const RATE_GUARD_THRESHOLD = 0.995;
export const REQUOTE_THRESHOLD_SECONDS = 24;
export const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

export const DST_BUFFER_PCT = 0.1;
export const DST_BUFFER_MAX_USD = 2;
export const SRC_BUFFER_PCT = 0.02;
export const SRC_BUFFER_MAX_USD = 1;
// EXACT_IN dst reclaim: when the destination swap is re-sized from the COT that actually landed
// at the wrapper, shave this off as a safety margin (raw rounding + the swap's own input-side
// behaviour) so the sized input can never exceed the on-chain balance.
// ponytail: fixed 1bp margin — real-world calibration knob, not a derived constant. Too small →
// occasional insufficient-balance reverts; too large → yield left on the table. Upgrade path:
// derive from the quote's own slippage + a dust floor.
export const DST_RECLAIM_DEDUCTION_PCT = 0.0001;
export const MAX_SWAP_HAIRCUT_PCT = 0.03;
export const MAX_SWAP_HAIRCUT_MIN_USDC = 3;
export const GAS_TO_COT_BUFFER = 1.02;

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

// ---------------------------------------------------------------------------
// Token symbol normalization
// ---------------------------------------------------------------------------

export const normalizeSymbol = (symbol: string): string => {
  const upper = symbol.toUpperCase();
  if (['USD$', 'USD$0', 'USDT'].includes(upper) || symbol === 'USDt') return 'USDT';
  return symbol;
};
