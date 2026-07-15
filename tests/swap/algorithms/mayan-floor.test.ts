import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { filterMayanSourcesByChain } from '../../../src/swap/algorithms/mayan-floor';

describe('filterMayanSourcesByChain', () => {
  it('aggregates source value by chain and preserves surviving source order', () => {
    const holdings = [
      { id: 'a', chainID: 1, valueUsd: new Decimal('0.7') },
      { id: 'b', chainID: 2, valueUsd: new Decimal('2') },
      { id: 'c', chainID: 1, valueUsd: new Decimal('0.5') },
      { id: 'd', chainID: 3, valueUsd: new Decimal('0.9') },
    ];

    const result = filterMayanSourcesByChain(
      holdings,
      new Decimal('1.1'),
      (holding) => holding.valueUsd
    );

    expect(result.holdings).toEqual([holdings[0], holdings[1], holdings[2]]);
    expect(result.droppedChains).toEqual([{ chainID: 3, valueUsd: new Decimal('0.9') }]);
    expect(holdings.map((holding) => holding.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
