import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { ChainListType } from '../../src/domain';
import { toIntentRecord } from '../../src/services/intent-records';

const makeChainList = (): ChainListType =>
  ({
    getChainByID: vi.fn().mockReturnValue({
      id: 42161,
      name: 'Arbitrum',
      custom: { icon: 'https://example.com/arbitrum.png', knownTokens: [] },
    }),
    getChainAndTokenByAddress: vi.fn(),
  }) as unknown as ChainListType;

describe('toIntentRecord', () => {
  it('fails fast when middleware provides an unsupported universe', () => {
    const chainList = makeChainList();

    expect(() =>
      toIntentRecord(
        {
          request_hash:
            '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex,
          status: 'created',
          solver: null,
          request: {
            sources: [],
            destination_universe: 'BTC' as unknown as 'EVM',
            destination_chain_id: '42161',
            recipient_address:
              '0x0000000000000000000000000000000000000000000000000000000000000ccc' as Hex,
            destinations: [],
            nonce: '1',
            expiry: '1710003600',
            parties: [],
          },
        } as never,
        chainList,
        'https://intent.example'
      )
    ).toThrow('Universe not supported');
  });
});
