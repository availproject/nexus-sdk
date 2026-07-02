import type { Hex } from 'viem';
import type { ChainListType } from '../domain';
import { Errors } from '../domain/errors';
import { isNativeAddress } from '../services/addresses';
import { SwapMode } from './types';

export enum CurrencyID {
  USDC = 1,
  USDT = 2,
  ETH = 3,
}

export const DEFAULT_CURRENCY_ID = CurrencyID.USDC;

export type ResolvedCOT = {
  address: Hex;
  decimals: number;
  permitVariant?: number;
  permitVersion?: number;
  currencyId: number;
};

/**
 * Resolve the COT (Common Output Token) for a given chain.
 *
 * Priority:
 * 1. Look up by currencyId in the chain's token list (from deployment config)
 * 2. Fall back to hardcoded COT_BY_CHAIN map (only for currencyId=1 / USDC)
 * 3. Throw if not found
 */
export function resolveCOT(
  chainId: number,
  chainList: ChainListType,
  currencyId: number = DEFAULT_CURRENCY_ID
): ResolvedCOT {
  try {
    const token = chainList.getTokenByCurrencyId(chainId, currencyId);
    return {
      address: token.contractAddress,
      decimals: token.decimals,
      permitVariant: token.permitVariant,
      permitVersion: token.permitVersion,
      currencyId,
    };
  } catch {
    throw Errors.swapRouteFailed(`No COT with currencyId=${currencyId} on chain ${chainId}`);
  }
}

/**
 * Resolve the bridgeable mesh currencyId for a (chain, token) pair, or undefined when the token
 * isn't a recognized mesh asset on that chain. Native is resolved via the chain's nativeCurrency.
 * Two tokens are the same bridgeable family iff their currencyIds match.
 */
export function resolveCurrencyId(
  chainList: ChainListType,
  chainId: number,
  tokenAddress: Hex
): number | undefined {
  try {
    if (isNativeAddress(tokenAddress)) {
      return chainList.getChainByID(chainId)?.nativeCurrency.currencyId;
    }
    return chainList.getTokenByAddress(chainId, tokenAddress)?.currencyId;
  } catch {
    return undefined;
  }
}

export type SwapSettlement = {
  // The currency the route settles/bridges in: the destination family for a same-token bridge,
  // otherwise the COT (USDC by default). Resolve per-chain addresses with `resolveCOT(chain, currencyId)`.
  currencyId: number;
  // True iff the same-token direct bridge fires: EXACT_IN where every selected source is the same
  // non-COT bridgeable mesh family as the destination token (ERC-20 or native). Then the route
  // bridges that token directly (no source/destination swap); otherwise it runs the COT round-trip.
  sameTokenBridge: boolean;
};

/**
 * Decide a swap's settlement currency + whether the same-token direct bridge applies, in one place.
 * Both preflight (which token to fee-quote) and the route (fast-path vs COT flow) consume this so
 * the decision can't drift. `sources` are the selected sources to judge family on — the route passes
 * its resolved holdings; preflight passes the requested sources (empty ⇒ not same-token, since the
 * families aren't yet known).
 */
export function resolveSwapSettlement(
  chainList: ChainListType,
  mode: SwapMode,
  sources: { chainId: number; tokenAddress: Hex }[],
  dstChainId: number,
  dstTokenAddress: Hex,
  cotCurrencyId: number
): SwapSettlement {
  const dstFamily = resolveCurrencyId(chainList, dstChainId, dstTokenAddress);
  const sameTokenBridge =
    mode === SwapMode.EXACT_IN &&
    dstFamily != null &&
    dstFamily !== cotCurrencyId &&
    sources.length > 0 &&
    sources.every((s) => resolveCurrencyId(chainList, s.chainId, s.tokenAddress) === dstFamily);
  return {
    currencyId: sameTokenBridge ? dstFamily : cotCurrencyId,
    sameTokenBridge,
  };
}
