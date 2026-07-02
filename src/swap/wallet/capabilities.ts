import type { Chain } from '../../domain';
import type { WalletPath } from '../types';

/**
 * Returns whether a chain supports EIP-7702 (Calibur delegation).
 * Defaults to `true` when the field is missing (until middleware sends explicit data).
 */
export const chainSupports7702 = (chain: Chain): boolean => {
  return chain.supports7702 ?? true;
};

/**
 * Determines the smart-account wrapper used on a chain.
 *
 * - 7702 chain → `ephemeral` (Calibur-delegated EOA)
 * - non-7702 chain → `safe` (Safe smart account owned by the ephemeral)
 *
 * The user's connected EOA is never a swap-executor wallet path: source swaps, bridge deposits,
 * and destination swaps always run inside one of the two wrappers above. Bridge fills on
 * destination-COT routes go directly to the user's EOA (no wrapper), but that's signalled by
 * the absence of a destination-swap step, not by this function.
 */
export const resolveWalletPath = (is7702: boolean): WalletPath => (is7702 ? 'ephemeral' : 'safe');

/**
 * Filters chains to only those that support EIP-7702 (Calibur).
 * Chains without `supports7702` default to true.
 */
export const filterValidSourceChains = (chains: Chain[]): Chain[] => {
  return chains.filter(chainSupports7702);
};
