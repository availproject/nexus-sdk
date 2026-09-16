import { describe, expect, it } from 'vitest';
import { createChainList } from '../../src/services/chain-list';
import { testChains } from '../fixtures/chains';

describe('createChainList execution flags', () => {
  it.each([true, false, undefined])('preserves flags set to %s', (value) => {
    const list = createChainList([{ ...testChains[0], eip7702Enabled: value, swapSupported: value }]);
    expect(list.getChainByID(1).supports7702).toBe(value);
    expect(list.getChainByID(1).swapSupported).toBe(value);
  });
});
