import type { Hex } from 'viem';
import type { FlatBalance } from '../types';
import { sortSourcesByPriority } from './sort';

// ---------------------------------------------------------------------------
// selectSwapSources
// ---------------------------------------------------------------------------

/**
 * Selects source balances for swap routing:
 *
 * 1. Drop zero/negative balances (natives whose reserve is fully consumed land here as '0')
 * 2. Sort by the 11-level source priority system
 *
 * The native gas reserve is deducted upstream (in `buildSwapPreflight`) before these are
 * selected, so the router never sizes a swap against gas it needs to execute.
 */
export const selectSwapSources = (
  balances: FlatBalance[],
  dstChainId: number,
  dstTokenAddress: Hex
): FlatBalance[] => {
  const filtered = balances.filter((b) => {
    const s = b.amount;
    if (s === '0' || s === '0.' || s.startsWith('-')) return false;
    // Check at least one non-zero digit exists
    return /[1-9]/.test(s);
  });

  return sortSourcesByPriority(filtered, dstChainId, dstTokenAddress);
};
