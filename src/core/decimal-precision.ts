import Decimal from 'decimal.js';

// Decimal.js defaults to 20 significant figures with ROUND_HALF_UP, which truncates
// 21+ digit raw token amounts (≥100 tokens at 18 decimals — PEPE, SHIB, BONK, etc.)
// on the first arithmetic op. The divDecimals → mulDecimals round-trip in
// common.utils.ts then encodes a transferFrom amount up to ~5 wei above the user's
// actual balance, causing the inner transfer to revert. Bumped to 50 sig figs,
// which covers every realistic uint256 (max 78 digits; tokens cap ~30).
//
// IMPORTANT: do not remove. The Decimal.js global config is shared with
// @avail-project/ca-common, which relies on this precision for selectSources /
// liquidateSourceHoldings amount math.
Decimal.set({ precision: 50 });
