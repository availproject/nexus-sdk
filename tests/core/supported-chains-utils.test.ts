import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createNexusClient } from '../../src';
import type { IntentProvider, IntentProviderSupport } from '../../src';
import { ZERO_ADDRESS } from '../../src/domain';
import { getSupportedChains } from '../../src/utils';
import * as transport from '../../src/transport';
import { testChains } from '../fixtures/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

describe('supported-chain utilities', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['export', 'client.utils'] as const)('preserves directional support through %s', async (entrypoint) => {
    const catalog = structuredClone(testChains);
    const metadata = catalog[0];
    metadata.asSource = ['nexus-v2', 'mayan'];
    metadata.asDestination = ['relay'];
    metadata.tokens[0].asSource = [];
    metadata.tokens[0].asDestination = [{ id: 'nexus-v2', currencyId: 3 }];
    metadata.tokens[1].asSource = [{ id: 'nexus-v2', currencyId: 1 }];
    metadata.tokens[1].asDestination = [{ id: 'mayan' }];
    const getIntentChains = vi.fn().mockResolvedValue(catalog);
    const middleware = makeMiddlewareClient({ getIntentChains });
    vi.spyOn(transport, 'createMiddlewareClient').mockReturnValue(middleware);
    const client = createNexusClient({ clientId: 'test-client', analytics: { enabled: false } });
    try {
      const result = entrypoint === 'export'
        ? await getSupportedChains('mainnet')
        : await client.utils.getSupportedChains('mainnet');
      const chain = result.find(({ id }) => id === metadata.id)!;
      expect(chain).toMatchObject({
        id: metadata.id, name: metadata.name, logo: metadata.logo, swapSupported: true,
        asSource: ['nexus-v2', 'mayan'], asDestination: ['relay'],
      });
      expect(chain.tokens.find(({ contractAddress }) => contractAddress === metadata.tokens[1].address)).toMatchObject({
        contractAddress: metadata.tokens[1].address, decimals: 6, currencyId: 1,
        permitVariant: 1, permitVersion: 2,
        asSource: [{ id: 'nexus-v2', currencyId: 1 }], asDestination: [{ id: 'mayan' }],
      });
      expect(chain.tokens.find(({ contractAddress }) => contractAddress === ZERO_ADDRESS)).toMatchObject({
        decimals: 18, asSource: [], asDestination: [{ id: 'nexus-v2', currencyId: 3 }],
      });
      expectTypeOf(chain.asSource).toEqualTypeOf<IntentProvider[]>();
      expectTypeOf(chain.tokens[0].asDestination).toEqualTypeOf<IntentProviderSupport[]>();
      expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
    } finally {
      client.destroy();
    }
  });
});
