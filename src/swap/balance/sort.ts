import type { Hex } from 'viem';
import { isNativeAddress } from '../../services/addresses';
import { equalFold } from '../../services/strings';
import type { FlatBalance } from '../types';

// ---------------------------------------------------------------------------
// Stablecoin detection
// ---------------------------------------------------------------------------

const STABLECOINS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'BUSD',
  'TUSD',
  'FRAX',
  'LUSD',
  'USDD',
  'USDP',
  'GUSD',
]);

const isStablecoin = (symbol: string): boolean => STABLECOINS.has(symbol.toUpperCase());

const ETHEREUM_MAINNET = 1;

// ---------------------------------------------------------------------------
// 11-level priority system
// ---------------------------------------------------------------------------

/**
 * Sorts source balances by priority for swap routing.
 *
 * Group 1 (Same Chain as destination):
 *   1. Same token, same chain
 *   2. Stablecoin, same chain
 *   3. Gas token, same chain
 *   4. Other token, same chain
 * Group 2 (Other Chains, non-Ethereum):
 *   5. Same token
 *   6. Stablecoin
 *   7. Other token
 * Group 3 (Ethereum Mainnet — most expensive):
 *   8. Same token
 *   9. Stablecoin
 *  10. ETH native
 *  11. Other token
 * Tiebreaker: USD value DESC
 */
export const sortSourcesByPriority = (
  balances: FlatBalance[],
  dstChainId: number,
  dstTokenAddress: Hex
): FlatBalance[] => {
  const getPriority = (b: FlatBalance): number => {
    const isSameChain = b.chainID === dstChainId;
    const isSameToken = equalFold(b.tokenAddress, dstTokenAddress);
    const isStable = isStablecoin(b.symbol);
    const isGas = isNativeAddress(b.tokenAddress as Hex);
    const isEthereum = b.chainID === ETHEREUM_MAINNET;

    if (isSameChain) {
      if (isSameToken) return 1;
      if (isStable) return 2;
      if (isGas) return 3;
      return 4;
    }

    if (isEthereum) {
      if (isSameToken) return 8;
      if (isStable) return 9;
      if (isGas) return 10;
      return 11;
    }

    // Other chains (non-Ethereum, non-destination)
    if (isSameToken) return 5;
    if (isStable) return 6;
    return 7;
  };

  return [...balances].sort((a, b) => {
    const pa = getPriority(a);
    const pb = getPriority(b);
    if (pa !== pb) return pa - pb;
    // Tiebreaker: USD value DESC
    return b.value - a.value;
  });
};
