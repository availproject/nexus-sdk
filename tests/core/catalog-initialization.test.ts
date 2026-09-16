import { describe, expect, it, vi } from 'vitest';
import { createNexusClient } from '../../src';
import { testChains } from '../fixtures/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

describe('catalog-backed initialization', () => {
  it.each(['mainnet', 'canary', 'testnet'] as const)('loads execution metadata from one catalog request on %s', async (network) => {
    const getIntentChains = vi.fn().mockResolvedValue(testChains);
    const getDeployment = vi.fn().mockRejectedValue(new Error('/deployment must not be requested'));
    const middleware = { ...makeMiddlewareClient({ getIntentChains }), getDeployment };
    const client = createNexusClient({ clientId: 'test-client', network, analytics: { enabled: false }, internal: { middlewareClient: middleware } });
    try {
      await client.initialize();
      expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
      expect(getDeployment).not.toHaveBeenCalled();
      expect(client.chainList.getChainByID(1)).toMatchObject({ supports7702: true });
      expect(client.chainList.getVaultContractAddress(1)).toBe(testChains[0].vaultAddress);
      expect(client.getSupportedChains()[0].capabilities).toEqual({ intent: network !== 'testnet', execute: true });
    } finally {
      client.destroy();
    }
  });

  it('filters Mayan intent support locally while retaining all execution chains and tokens', async () => {
    const chains = structuredClone(testChains);
    chains[1].providers = ['nexus-v2'];
    chains[1].asSource = ['nexus-v2'];
    chains[1].asDestination = ['nexus-v2'];
    const getIntentChains = vi.fn().mockResolvedValue(chains);
    const client = createNexusClient({
      clientId: 'test-client', network: 'mainnet', forceMayan: true, analytics: { enabled: false },
      internal: { middlewareClient: makeMiddlewareClient({ getIntentChains }) },
    });
    try {
      await client.initialize();
      expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
      expect(client.chainList.chains).toHaveLength(2);
      const supported = client.getSupportedChains();
      expect(supported[0]).toMatchObject({ providers: ['mayan'], asSource: ['mayan'], asDestination: ['mayan'] });
      expect(supported[0].tokens).toHaveLength(1);
      expect(supported[0].tokens[0].providers).toEqual([{ id: 'mayan' }]);
      expect(supported[1].capabilities).toEqual({ intent: false, execute: true });
      expect(chains[0].providers).toEqual(['nexus-v2', 'mayan']);
    } finally {
      client.destroy();
    }
  });
});
