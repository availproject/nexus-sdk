import type { Hex } from 'viem';
import type { FlatBalance, Source } from '../types';
import { sortSourcesByPriority } from './sort';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GetBalancesInput = {
  /** Pre-fetched balances (from Ankr or unified balance) */
  balances: FlatBalance[];
  /** Destination chain ID for priority sorting */
  dstChainId: number;
  /** Destination token address for priority sorting */
  dstTokenAddress: Hex;
  /** Only include these sources (whitelist) */
  allowedSources?: Source[];
  /** Exclude these sources (blacklist) */
  removeSources?: Source[];
};

// ---------------------------------------------------------------------------
// getBalancesForSwap
// ---------------------------------------------------------------------------

/**
 * Filters and sorts balances for swap routing.
 *
 * 1. Filter out zero/negative balances
 * 2. Apply allowedSources whitelist (if provided)
 * 3. Apply removeSources blacklist (if provided)
 * 4. Sort by 11-level priority system
 */
export const getBalancesForSwap = async (input: GetBalancesInput): Promise<FlatBalance[]> => {
  const { balances, dstChainId, dstTokenAddress, allowedSources, removeSources } = input;

  let filtered = balances.filter((b) => {
    const s = b.amount;
    if (s === '0' || s === '0.' || s.startsWith('-')) return false;
    // Check at least one non-zero digit exists
    return /[1-9]/.test(s);
  });

  // Whitelist filter
  if (allowedSources && allowedSources.length > 0) {
    const allowSet = new Set(
      allowedSources.map((s) => `${s.chainId}:${s.tokenAddress.toLowerCase()}`)
    );
    filtered = filtered.filter((b) => allowSet.has(`${b.chainID}:${b.tokenAddress.toLowerCase()}`));
  }

  // Blacklist filter
  if (removeSources && removeSources.length > 0) {
    const removeSet = new Set(
      removeSources.map((s) => `${s.chainId}:${s.tokenAddress.toLowerCase()}`)
    );
    filtered = filtered.filter(
      (b) => !removeSet.has(`${b.chainID}:${b.tokenAddress.toLowerCase()}`)
    );
  }

  // Sort by priority
  return sortSourcesByPriority(filtered, dstChainId, dstTokenAddress);
};
