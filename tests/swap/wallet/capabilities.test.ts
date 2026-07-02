import { describe, expect, it, vi } from 'vitest';
import {
  chainSupports7702,
  filterValidSourceChains,
  resolveWalletPath,
} from '../../../src/swap/wallet/capabilities';
import type { Chain } from '../../../src/domain';
import { Universe } from '../../../src/domain/chain-abstraction';

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

describe('filterValidSourceChains', () => {
  it('keeps 7702 chains', () => {
    const chains = [makeChain(42161, true), makeChain(10, true)];
    const filtered = filterValidSourceChains(chains);
    expect(filtered).toHaveLength(2);
  });

  it('filters out non-7702 chains', () => {
    const chains = [makeChain(42161, true), makeChain(10, false)];
    const filtered = filterValidSourceChains(chains);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(42161);
  });

  it('defaults undefined supports7702 to true (keeps chain)', () => {
    const chains = [makeChain(42161, undefined)];
    const filtered = filterValidSourceChains(chains);
    expect(filtered).toHaveLength(1);
  });
});
