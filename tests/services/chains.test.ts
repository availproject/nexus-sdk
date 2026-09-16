import { describe, expect, it } from 'vitest';
import { getSupportedChainsFromCatalog } from '../../src/services/chains';
import { testChains } from '../fixtures/chains';

const makeChain = (id: number, swapSupported?: boolean) => ({
  ...testChains[0],
  id,
  name: `Chain ${id}`,
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', logo: 'https://eth' },
  swapSupported,
});

describe('getSupportedChainsFromCatalog', () => {
  it('exposes swapSupported=true when the chain supports swaps', () => {
    const [chain] = getSupportedChainsFromCatalog([makeChain(42161, true)]);
    expect(chain.swapSupported).toBe(true);
  });

  it('exposes swapSupported=false when the chain explicitly disables swaps', () => {
    const [chain] = getSupportedChainsFromCatalog([makeChain(1, false)]);
    expect(chain.swapSupported).toBe(false);
  });

  it('defaults swapSupported=true when the flag is absent (=== false is the only block, matching route.ts)', () => {
    const [chain] = getSupportedChainsFromCatalog([makeChain(10, undefined)]);
    expect(chain.swapSupported).toBe(true);
  });
});
