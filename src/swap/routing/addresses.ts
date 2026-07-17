import type { Hex } from 'viem';
import type { ChainListType } from '../../domain';
import { predictSafeAccountAddress } from '../safe/predict';
import type { WalletPath } from '../types';
import { chainSupports7702, resolveWalletPath } from '../wallet/capabilities';
import type { RouteOptions } from '../route';

export type WalletDecision = {
  sourceExecutionPaths: Map<number, WalletPath>;
};

export function resolveWalletDecisions(input: {
  sourceChainIds: Iterable<number>;
  walletPathHints: Map<number, WalletPath>;
}): WalletDecision {
  const chainIds = [...new Set(input.sourceChainIds)];
  const sourceExecutionPaths = new Map<number, WalletPath>();
  for (const chainId of chainIds) {
    // Preflight populates hints from each chain's 7702 support — 'ephemeral' for 7702 (Calibur
    // SBC), 'safe' for non-7702. Default to 'ephemeral' for any chain the preflight didn't
    // include, mirroring the chainSupports7702 default.
    sourceExecutionPaths.set(chainId, input.walletPathHints.get(chainId) ?? 'ephemeral');
  }
  return { sourceExecutionPaths };
}

function resolveWalletAddress(walletPath: WalletPath, options: RouteOptions): Hex {
  return walletPath === 'safe'
    ? predictSafeAccountAddress(options.ephemeralAddress).address
    : options.ephemeralAddress;
}

export function buildExecutorAddressByChain(
  sourceExecutionPaths: Map<number, WalletPath>,
  options: RouteOptions
): Map<number, Hex> {
  return new Map(
    [...sourceExecutionPaths.entries()].map(([chainId, walletPath]) => [
      chainId,
      resolveWalletAddress(walletPath, options),
    ])
  );
}

// Source-swap recipient. Output stays at the per-chain wrapper unless this is the same-chain
// COT-destination case (no dst swap step) — there it can go straight to the user's EOA.
export function buildSourceRecipientAddressByChain(input: {
  chainIds: Iterable<number>;
  sourceExecutionPaths: Map<number, WalletPath>;
  destinationChainId: number;
  destinationHasSwap: boolean;
  options: RouteOptions;
}): Map<number, Hex> {
  return new Map(
    [...new Set(input.chainIds)].map((chainId) => {
      // Same-chain + COT destination: no wrapper round-trip, deliver to EOA directly.
      if (chainId === input.destinationChainId && !input.destinationHasSwap) {
        return [chainId, input.options.eoaAddress];
      }
      const path = input.sourceExecutionPaths.get(chainId);
      if (!path) {
        return [chainId, input.options.ephemeralAddress];
      }
      return [chainId, resolveWalletAddress(path, input.options)];
    })
  );
}

// Destination quote taker — the on-chain executor of the dst aggregator swap. For 7702 chains
// it's the Calibur-delegated ephemeral; for non-7702 it's the predicted Safe wrapper.
export function destinationWrapperAddress(
  destinationChain: ReturnType<ChainListType['getChainByID']>,
  options: RouteOptions
): Hex {
  return resolveWalletAddress(resolveWalletPath(chainSupports7702(destinationChain)), options);
}

// Convert the user's requested native amount into a COT budget for the destination gas swap.
// Used as the EXACT_IN input to `destinationGasSwapExactIn`; the aggregator decides how much
// native to deliver. Throws when the dst chain's native price isn't in the oracle response —
// the caller already gated on requestedNativeAmountRaw > 0n, so a missing price is fatal.
