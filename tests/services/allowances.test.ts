import { describe, expect, it } from 'vitest';
import type { AllowanceHookSource } from '../../src/domain';
import { resolveAllowanceInputs } from '../../src/services/allowances';

const makeSource = (overrides?: Partial<AllowanceHookSource>): AllowanceHookSource => ({
  allowance: {
    current: '0',
    currentRaw: 0n,
    minimum: '1',
    minimumRaw: 1n,
  },
  chain: {
    id: 1,
    logo: '',
    name: 'Ethereum',
  },
  token: {
    contractAddress: '0x0000000000000000000000000000000000000001',
    decimals: 6,
    logo: '',
    name: 'USD Coin',
    symbol: 'USDC',
  },
  ...overrides,
});

describe('resolveAllowanceInputs', () => {
  it('maps allowance selections to SetAllowanceInput', () => {
    const sources: AllowanceHookSource[] = [
      makeSource({ allowance: { current: '0', currentRaw: 0n, minimum: '2', minimumRaw: 2n } }),
      makeSource({
        chain: { id: 10, logo: '', name: 'Optimism' },
        token: {
          contractAddress: '0x0000000000000000000000000000000000000002',
          decimals: 6,
          logo: '',
          name: 'USD Coin',
          symbol: 'USDC',
        },
        allowance: { current: '0', currentRaw: 0n, minimum: '3', minimumRaw: 3n },
      }),
    ];

    const result = resolveAllowanceInputs({
      sources,
      allowances: ['min', '1.5'],
    });

    expect(result).toEqual([
      {
        amount: 2n,
        chainID: 1,
        tokenContract: '0x0000000000000000000000000000000000000001',
      },
      {
        amount: 1500000n,
        chainID: 10,
        tokenContract: '0x0000000000000000000000000000000000000002',
      },
    ]);
  });

  it('throws when allowance lengths do not match sources', () => {
    const sources = [makeSource()];

    expect(() =>
      resolveAllowanceInputs({
        sources,
        allowances: [],
      })
    ).toThrow('Invalid allowance values passed');
  });
});
