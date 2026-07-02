import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSweeperTxs } from '../../src/swap/sweep';
import { CALIBUR_ADDRESS, EADDRESS, SWEEPER_ADDRESS } from '../../src/swap/constants';
import { decodeFunctionData, type Hex } from 'viem';
import type { SwapCache } from '../../src/swap/wallet/cache';

const MOCK_RECEIVER = '0xaaaa000000000000000000000000000000000001' as Hex;
const MOCK_TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const CHAIN_ID = 42161;

const makeCache = (allowance: bigint = 0n) => ({
  getAllowance: vi.fn().mockReturnValue(allowance),
});

describe('createSweeperTxs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ERC20 sweep → approve + sweepERC20 calls', () => {
    const cache = makeCache(0n);
    const calls = createSweeperTxs(MOCK_TOKEN, MOCK_RECEIVER, CHAIN_ID, cache as unknown as Pick<SwapCache, 'getAllowance'>);

    expect(calls.length).toBe(2);
    // First call: approve SWEEPER_ADDRESS
    expect(calls[0].to.toLowerCase()).toBe(MOCK_TOKEN.toLowerCase());
    // Second call: sweepERC20
    expect(calls[1].to.toLowerCase()).toBe(SWEEPER_ADDRESS.toLowerCase());
  });

  it('native sweep → approveNative + sweepERC7914 calls', () => {
    const cache = makeCache(0n);
    const calls = createSweeperTxs(EADDRESS as Hex, MOCK_RECEIVER, CHAIN_ID, cache as unknown as Pick<SwapCache, 'getAllowance'>);

    expect(calls.length).toBe(2);
    expect(calls[0].to.toLowerCase()).toBe(CALIBUR_ADDRESS.toLowerCase());
    expect(
      decodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'approveNative',
            inputs: [
              { name: 'spender', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
        ] as const,
        data: calls[0].data,
      }).functionName
    ).toBe('approveNative');
    // Second call should target sweeper
    expect(calls[1].to.toLowerCase()).toBe(SWEEPER_ADDRESS.toLowerCase());
  });

  it('skip approve if allowance sufficient', () => {
    // maxUint256 allowance already set
    const cache = makeCache(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));
    const calls = createSweeperTxs(MOCK_TOKEN, MOCK_RECEIVER, CHAIN_ID, cache as unknown as Pick<SwapCache, 'getAllowance'>);

    // Only sweepERC20 call, no approve
    expect(calls.length).toBe(1);
    expect(calls[0].to.toLowerCase()).toBe(SWEEPER_ADDRESS.toLowerCase());
  });

  it('all calls have zero value for ERC20 sweeps', () => {
    const cache = makeCache(0n);
    const calls = createSweeperTxs(MOCK_TOKEN, MOCK_RECEIVER, CHAIN_ID, cache as unknown as Pick<SwapCache, 'getAllowance'>);

    for (const call of calls) {
      expect(call.value).toBe(0n);
    }
  });

  it('ERC20 queries cache with token as token and ephemeral as owner', () => {
    const EPHEMERAL = '0xeeee000000000000000000000000000000000099' as Hex;
    const cache = makeCache(0n);
    createSweeperTxs(MOCK_TOKEN, MOCK_RECEIVER, CHAIN_ID, cache as unknown as Pick<SwapCache, 'getAllowance'>, EPHEMERAL);

    expect(cache.getAllowance).toHaveBeenCalledWith(
      MOCK_TOKEN,          // token
      EPHEMERAL,           // owner = ephemeral wallet
      SWEEPER_ADDRESS,     // spender
      CHAIN_ID,
    );
  });

  it('native queries cache with EADDRESS as token and ephemeral as owner', () => {
    const EPHEMERAL = '0xeeee000000000000000000000000000000000099' as Hex;
    const cache = makeCache(0n);
    createSweeperTxs(EADDRESS as Hex, MOCK_RECEIVER, CHAIN_ID, cache as unknown as Pick<SwapCache, 'getAllowance'>, EPHEMERAL);

    expect(cache.getAllowance).toHaveBeenCalledWith(
      EADDRESS,            // token
      EPHEMERAL,           // owner = ephemeral wallet
      SWEEPER_ADDRESS,     // spender
      CHAIN_ID,
    );
  });

  it('undefined cache produces approve + sweep calls (safe fallback)', () => {
    const calls = createSweeperTxs(MOCK_TOKEN, MOCK_RECEIVER, CHAIN_ID, undefined);

    // Should include approve since cache is unknown
    expect(calls.length).toBe(2);
    expect(calls[0].to.toLowerCase()).toBe(MOCK_TOKEN.toLowerCase());
    expect(calls[1].to.toLowerCase()).toBe(SWEEPER_ADDRESS.toLowerCase());
  });
});
