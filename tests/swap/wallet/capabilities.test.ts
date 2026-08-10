import { describe, expect, it, vi } from 'vitest';
import type { Chain } from '../../../src/domain';
import { Universe } from '../../../src/domain/chain-abstraction';
import {
  chainSupports7702,
  resolveSwapWalletPath,
  resolveWalletPath,
} from '../../../src/swap/wallet/capabilities';

const makeChain = (id: number, supports7702?: boolean): Chain => ({
  id,
  name: `Chain ${id}`,
  universe: Universe.ETHEREUM,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  rpcUrls: { default: { http: ['https://rpc.example.com'], webSocket: ['wss://rpc.example.com'] } },
  supports7702,
});

describe('chainSupports7702', () => {
  it('returns true when supports7702 is explicitly true', () => {
    const chain = makeChain(42161, true);
    expect(chainSupports7702(chain)).toBe(true);
  });

  it('defaults to true when supports7702 is undefined', () => {
    const chain = makeChain(42161, undefined);
    expect(chainSupports7702(chain)).toBe(true);
  });

  it('returns false when supports7702 is explicitly false', () => {
    const chain = makeChain(42161, false);
    expect(chainSupports7702(chain)).toBe(false);
  });
});

describe('resolveWalletPath', () => {
  it('7702 chain → ephemeral', () => {
    expect(resolveWalletPath(true)).toBe('ephemeral');
  });

  it('non-7702 chain → safe', () => {
    expect(resolveWalletPath(false)).toBe('safe');
  });
});

describe('resolveSwapWalletPath', () => {
  it('uses the Safe whenever swaps are explicitly enabled', () => {
    expect(resolveSwapWalletPath({ ...makeChain(1, true), swapSupported: true })).toBe('safe');
    expect(resolveSwapWalletPath({ ...makeChain(2, false), swapSupported: true })).toBe('safe');
  });

  it('retains the legacy capability fallback when swaps are not explicitly enabled', () => {
    expect(resolveSwapWalletPath(makeChain(1, true))).toBe('ephemeral');
    expect(resolveSwapWalletPath(makeChain(2, false))).toBe('safe');
  });
});
