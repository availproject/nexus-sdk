import type { Hex } from 'viem';
import type { ChainListType } from '../../domain';
import type { RouteOptions } from '../route';
import { predictSafeAccountAddressV2 } from '../safe/predict';
import type { WalletPath } from '../types';
import { resolveSwapWalletPath } from '../wallet/capabilities';

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
    // Preflight populates hints from each chain's swap wallet policy. Default to 'ephemeral' for
    // any chain the preflight didn't include to preserve the legacy fallback.
    sourceExecutionPaths.set(chainId, input.walletPathHints.get(chainId) ?? 'ephemeral');
  }
  return { sourceExecutionPaths };
}

function resolveWalletAddress(walletPath: WalletPath, options: RouteOptions): Hex {
  return walletPath === 'safe'
    ? predictSafeAccountAddressV2(options.eoaAddress, options.ephemeralAddress).address
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

// Source-swap recipient. Remote outputs that will bridge go straight to the ephemeral bridge
// holder, even when a Safe executes the swap. Destination-chain output stays at its wrapper unless
// this is the COT-destination case (no dst swap step), where it can go straight to the user's EOA.
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
      if (chainId !== input.destinationChainId) {
        return [chainId, input.options.ephemeralAddress];
      }
      return [chainId, resolveWalletAddress(path, input.options)];
    })
  );
}

// Destination quote taker — the on-chain executor of the destination aggregator swap.
export function destinationWrapperAddress(
  destinationChain: ReturnType<ChainListType['getChainByID']>,
  options: RouteOptions
): Hex {
  return resolveWalletAddress(resolveSwapWalletPath(destinationChain), options);
}

// Convert the user's requested native amount into a COT budget for the destination gas swap.
// Used as the EXACT_IN input to `destinationGasSwapExactIn`; the aggregator decides how much
// native to deliver. Throws when the dst chain's native price isn't in the oracle response —
// the caller already gated on requestedNativeAmountRaw > 0n, so a missing price is fatal.
