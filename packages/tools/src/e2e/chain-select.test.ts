import { describe, expect, it } from 'vitest';
import { type ChainInfo, pickRandomChain, selectTestsForChain } from './chain-select';

const chain = (symbols: string[]): ChainInfo => ({ id: 1, name: 'Test', symbols });

describe('pickRandomChain', () => {
  it('throws on empty array', () => {
    expect(() => pickRandomChain([])).toThrow(/No chains available/);
  });

  it('returns the only element when given a single chain', () => {
    const c = chain(['ETH']);
    expect(pickRandomChain([c])).toBe(c);
  });

  it('always returns an element from the input', () => {
    const chains = [chain(['A']), chain(['B']), chain(['C'])];
    for (let i = 0; i < 50; i += 1) {
      expect(chains).toContain(pickRandomChain(chains));
    }
  });
});

describe('selectTestsForChain', () => {
  it('returns USDC test when chain supports USDC', () => {
    expect(selectTestsForChain(chain(['USDC']), '0.1', '0.001')).toEqual([
      { token: 'USDC', amount: '0.1' },
    ]);
  });

  it('returns USDC.e test when chain supports USDC.e but not USDC', () => {
    expect(selectTestsForChain(chain(['USDC.e']), '0.1', '0.001')).toEqual([
      { token: 'USDC.e', amount: '0.1' },
    ]);
  });

  it('prefers USDC over USDC.e when both are present', () => {
    expect(selectTestsForChain(chain(['USDC', 'USDC.e']), '0.1', '0.001')).toEqual([
      { token: 'USDC', amount: '0.1' },
    ]);
  });

  it('returns ETH test when chain supports ETH', () => {
    expect(selectTestsForChain(chain(['ETH']), '0.1', '0.001')).toEqual([
      { token: 'ETH', amount: '0.001' },
    ]);
  });

  it('returns both USDC and ETH when both are supported', () => {
    expect(selectTestsForChain(chain(['USDC', 'ETH']), '0.1', '0.001')).toEqual([
      { token: 'USDC', amount: '0.1' },
      { token: 'ETH', amount: '0.001' },
    ]);
  });

  it('returns empty when no supported tokens', () => {
    expect(selectTestsForChain(chain(['DAI', 'WBTC']), '0.1', '0.001')).toEqual([]);
  });
});
