import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createNexusClient } from '../../src';
import type { IntentProvider } from '../../src';
import { getSupportedChains } from '../../src/utils';
import * as transport from '../../src/intent/middleware';
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
        ? await getSupportedChains('mainnet', { clientId: 'test-client' })
        : await client.utils.getSupportedChains('mainnet');
      const chain = result.find(({ id }) => id === metadata.id)!;
      expect(chain).toMatchObject({
        id: metadata.id, name: metadata.name, logo: metadata.logo, swapSupported: true,
        asSource: ['nexus-v2', 'mayan'], asDestination: ['relay'],
      });
      expect(chain).not.toHaveProperty('tokens');
      expectTypeOf(chain.asSource).toEqualTypeOf<IntentProvider[]>();
      expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
      expect(transport.createMiddlewareClient).toHaveBeenLastCalledWith(
        expect.any(String), { clientId: 'test-client' }
      );
    } finally {
      client.destroy();
    }
  });
});
