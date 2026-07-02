import { describe, expect, it } from 'vitest';
import { getSupportedChainsFromChainList } from '../../src/services/chains';
import type { ChainListType } from '../../src/domain';

const makeChain = (id: number, swapSupported?: boolean) => ({
  id,
  name: `Chain ${id}`,
  custom: { icon: 'https://logo', knownTokens: [] },
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', logo: 'https://eth' },
  swapSupported,
});

describe('getSupportedChainsFromChainList', () => {
  it('exposes swapSupported=true when the chain supports swaps', () => {
    const chainList = { chains: [makeChain(42161, true)] } as unknown as ChainListType;
    const [chain] = getSupportedChainsFromChainList(chainList);
    expect(chain.swapSupported).toBe(true);
  });

  it('exposes swapSupported=false when the chain explicitly disables swaps', () => {
    const chainList = { chains: [makeChain(1, false)] } as unknown as ChainListType;
    const [chain] = getSupportedChainsFromChainList(chainList);
    expect(chain.swapSupported).toBe(false);
  });

  it('defaults swapSupported=true when the flag is absent (=== false is the only block, matching route.ts)', () => {
    const chainList = { chains: [makeChain(10, undefined)] } as unknown as ChainListType;
    const [chain] = getSupportedChainsFromChainList(chainList);
    expect(chain.swapSupported).toBe(true);
  });
});
