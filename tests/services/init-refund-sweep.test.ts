import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import {
  buildRefundSweepCall,
  collectRefundSweepGroups,
} from '../../src/services/init-refund-sweep';
import { EADDRESS } from '../../src/swap/constants';
import type { ChainListType, SwapTokenBalance } from '../../src/domain';

vi.mock('../../src/swap/wallet/capabilities', () => ({
  chainSupports7702: (chain: { id: number }) => chain.id === 42161,
}));

const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EOA = '0x1111111111111111111111111111111111111111' as Hex;
const ARB = 42161; // 7702 → ephemeral
const BASE = 8453; // non-7702 → safe
const USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' as Hex;
const SPAM = '0xdeadBeefdeadBEEFdeadbeEfDeAdbEEFdeadBEef' as Hex;

const chainBal = (
  chainId: number,
  contractAddress: Hex,
  balance: string,
  decimals: number,
  symbol: string
) => ({
  balance,
  value: '0',
  symbol,
  chain: { id: chainId, logo: '', name: `Chain ${chainId}` },
  contractAddress,
  decimals,
  universe: 0,
});

const knownTokens = new Set([USDC.toLowerCase(), USDT_ARB.toLowerCase()]);
const chainList = {
  getChainByID: (id: number) => ({ id }),
  getTokenByAddress: (_id: number, addr: Hex) =>
    knownTokens.has(addr.toLowerCase()) ? { contractAddress: addr } : undefined,
} as unknown as ChainListType;

describe('buildRefundSweepCall', () => {
  it('builds an ERC20 transfer(EOA, amount) call with value 0', () => {
    const call = buildRefundSweepCall(USDC, 1_000_000n, EOA);
    expect(call.to).toBe(USDC);
    expect(call.value).toBe(0n);
    expect(call.data).toBe(
      encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [EOA, 1_000_000n] })
    );
  });

  it('builds a native value-send straight to the EOA with empty calldata', () => {
    const call = buildRefundSweepCall(EADDRESS, 5_000_000_000_000_000n, EOA);
    expect(call.to).toBe(EOA);
    expect(call.value).toBe(5_000_000_000_000_000n);
    expect(call.data).toBe('0x');
  });
});

describe('collectRefundSweepGroups', () => {
  it('batches positive known-token balances into one group per chain for the matching holder', () => {
    const balances = [
      {
        symbol: 'USDC',
        chainBalances: [chainBal(ARB, USDC, '1', 6, 'USDC'), chainBal(BASE, USDC, '2', 6, 'USDC')],
      },
      { symbol: 'ETH', chainBalances: [chainBal(ARB, EADDRESS, '0.5', 18, 'ETH')] },
      { symbol: 'SPAM', chainBalances: [chainBal(ARB, SPAM, '100', 18, 'SPAM')] },
      { symbol: 'USDT', chainBalances: [chainBal(ARB, USDT_ARB, '0', 6, 'USDT')] },
    ] as unknown as SwapTokenBalance[];

    const groups = collectRefundSweepGroups(balances, 'ephemeral', chainList, EOA);

    // Only ARB (7702 → ephemeral); BASE is non-7702 (safe), SPAM unknown, USDT zero.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.chainId).toBe(ARB);
    expect(groups[0]!.holder).toBe('ephemeral');
    // USDC transfer + ETH native value, batched into one chain tx.
    expect(groups[0]!.calls).toHaveLength(2);
    expect(groups[0]!.calls.find((c) => c.to === EOA)?.value).toBe(500_000_000_000_000_000n);
  });

  it('routes non-7702 chain balances to the safe holder', () => {
    const balances = [
      {
        symbol: 'USDC',
        chainBalances: [chainBal(ARB, USDC, '1', 6, 'USDC'), chainBal(BASE, USDC, '2', 6, 'USDC')],
      },
    ] as unknown as SwapTokenBalance[];

    const groups = collectRefundSweepGroups(balances, 'safe', chainList, EOA);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.chainId).toBe(BASE);
    expect(groups[0]!.holder).toBe('safe');
    expect(groups[0]!.calls).toHaveLength(1); // USDC transfer only
  });
});
