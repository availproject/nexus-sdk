import { encodeFunctionData, erc20Abi, type Hex, maxUint256 } from 'viem';
import { isNativeAddress } from '../services/addresses';
import type { SafeCall } from '../services/safe';
import { SWEEPER_ADDRESS } from './constants';
import type { SwapCache } from './wallet/cache';

// ---------------------------------------------------------------------------
// Sweeper ABI
// ---------------------------------------------------------------------------

export const SWEEPER_ABI = [
  {
    type: 'function',
    name: 'sweepERC20',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ---------------------------------------------------------------------------
// createSweeperTxs
// ---------------------------------------------------------------------------

/**
 * Creates Safe calls to sweep an ERC-20 from the Safe to the receiver.
 *
 * For ERC20:
 *   1. approve(SWEEPER_ADDRESS, maxUint256)  — skipped if allowance sufficient
 *   2. SWEEPER.sweepERC20(token, receiver)
 *
 */
export const createSweeperTxs = (
  tokenAddress: Hex,
  receiver: Hex,
  _chainId: number,
  cache: Pick<SwapCache, 'getAllowance'> | undefined,
  safeAddress?: Hex
): SafeCall[] => {
  if (isNativeAddress(tokenAddress)) return [];
  const calls: SafeCall[] = [];
  const owner = safeAddress ?? tokenAddress;
  const currentAllowance =
    cache?.getAllowance(tokenAddress, owner, SWEEPER_ADDRESS as Hex, _chainId) ?? 0n;
  if (currentAllowance < maxUint256) {
    calls.push({
      to: tokenAddress,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [SWEEPER_ADDRESS as Hex, maxUint256],
      }),
      value: 0n,
    });
  }

  calls.push({
    to: SWEEPER_ADDRESS as Hex,
    data: encodeFunctionData({
      abi: SWEEPER_ABI,
      functionName: 'sweepERC20',
      args: [tokenAddress, receiver],
    }),
    value: 0n,
  });

  return calls;
};
