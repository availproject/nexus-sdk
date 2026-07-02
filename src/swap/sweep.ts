import { encodeFunctionData, erc20Abi, type Hex, maxUint256 } from 'viem';
import { isNativeAddress } from '../services/addresses';
import type { SBCCall } from '../services/sbc';
import { CALIBUR_ADDRESS, EADDRESS, SWEEPER_ADDRESS } from './constants';
import type { SwapCache } from './wallet/cache';

// ---------------------------------------------------------------------------
// ABI fragments for Calibur + Sweeper
// ---------------------------------------------------------------------------

const CALIBUR_APPROVE_NATIVE_ABI = [
  {
    type: 'function',
    name: 'approveNative',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

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
  {
    type: 'function',
    name: 'sweepERC7914',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ---------------------------------------------------------------------------
// createSweeperTxs
// ---------------------------------------------------------------------------

/**
 * Creates SBC calls to sweep tokens from the ephemeral wallet to the receiver.
 *
 * For ERC20:
 *   1. approve(SWEEPER_ADDRESS, maxUint256)  — skipped if allowance sufficient
 *   2. SWEEPER.sweepERC20(token, receiver)
 *
 * For native (EADDRESS):
 *   1. Calibur.approveNative(SWEEPER_ADDRESS, maxUint256)  — native approval via Calibur
 *   2. SWEEPER.sweepERC7914(receiver)
 */
export const createSweeperTxs = (
  tokenAddress: Hex,
  receiver: Hex,
  _chainId: number,
  cache: Pick<SwapCache, 'getAllowance'> | undefined,
  ephemeralAddress?: Hex
): SBCCall[] => {
  const calls: SBCCall[] = [];
  const isNative = isNativeAddress(tokenAddress);

  if (isNative) {
    // Native token sweep via Calibur's ERC-7914
    const owner = ephemeralAddress ?? (CALIBUR_ADDRESS as Hex);
    const currentAllowance =
      cache?.getAllowance(EADDRESS as Hex, owner, SWEEPER_ADDRESS as Hex, _chainId) ?? 0n;
    if (currentAllowance < maxUint256) {
      // Approve native via Calibur
      calls.push({
        to: owner,
        data: encodeFunctionData({
          abi: CALIBUR_APPROVE_NATIVE_ABI,
          functionName: 'approveNative',
          args: [SWEEPER_ADDRESS as Hex, maxUint256],
        }),
        value: 0n,
      });
    }

    // Sweep native
    calls.push({
      to: SWEEPER_ADDRESS as Hex,
      data: encodeFunctionData({
        abi: SWEEPER_ABI,
        functionName: 'sweepERC7914',
        args: [receiver],
      }),
      value: 0n,
    });
  } else {
    // ERC20 sweep
    const erc20Owner = ephemeralAddress ?? tokenAddress;
    const currentAllowance =
      cache?.getAllowance(tokenAddress, erc20Owner, SWEEPER_ADDRESS as Hex, _chainId) ?? 0n;
    if (currentAllowance < maxUint256) {
      // Approve sweeper
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

    // Sweep ERC20
    calls.push({
      to: SWEEPER_ADDRESS as Hex,
      data: encodeFunctionData({
        abi: SWEEPER_ABI,
        functionName: 'sweepERC20',
        args: [tokenAddress, receiver],
      }),
      value: 0n,
    });
  }

  return calls;
};
