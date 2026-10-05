import { describe, expect, it, vi } from 'vitest';
import { createNexusClient } from '../../src';
import { testChains } from '../fixtures/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

describe('catalog-backed initialization', () => {
  it.each(['mainnet', 'canary', 'testnet'] as const)('loads execution metadata from one catalog request on %s', async (network) => {
    const metadata = testChains.map(({ tokens: _tokens, ...chain }) => chain);
    const getIntentChains = vi.fn().mockResolvedValue(metadata);
    const getIntentTokens = vi.fn();
    const getDeployment = vi.fn().mockRejectedValue(new Error('/deployment must not be requested'));
    const middleware = { ...makeMiddlewareClient({ getIntentChains, getIntentTokens }), getDeployment };
    const client = createNexusClient({ clientId: 'test-client', network, analytics: { enabled: false }, internal: { middlewareClient: middleware } });
    try {
      await client.initialize();
      expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
      expect(getIntentTokens).not.toHaveBeenCalled();
      expect(getDeployment).not.toHaveBeenCalled();
      expect(client.chainList.getChainByID(1)).toMatchObject({ supports7702: true });
      expect(client.chainList.getVaultContractAddress(1)).toBe(testChains[0].vaultAddress);
      expect(client.getSupportedChains()[0].capabilities).toEqual({ intent: network !== 'testnet', execute: true });
    } finally {
      client.destroy();
    }
  });

  it('retains every provider in the cached catalog and execution metadata', async () => {
    const chains = structuredClone(testChains);
    chains[1].providers = ['nexus-v2'];
    chains[1].asSource = ['nexus-v2'];
    chains[1].asDestination = ['nexus-v2'];
    const getIntentChains = vi.fn().mockResolvedValue(chains);
    const getIntentTokens = vi.fn();
    const client = createNexusClient({
      clientId: 'test-client', network: 'mainnet', analytics: { enabled: false },
      internal: { middlewareClient: makeMiddlewareClient({ getIntentChains, getIntentTokens }) },
    });
    try {
      await client.initialize();
      expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
      expect(getIntentTokens).not.toHaveBeenCalled();
      expect(client.chainList.chains).toHaveLength(2);
      const supported = client.getSupportedChains();
      expect(supported[0]).toMatchObject({ providers: ['nexus-v2', 'mayan'], asSource: ['nexus-v2', 'mayan'], asDestination: ['nexus-v2', 'mayan'] });
      expect(supported[0]).not.toHaveProperty('tokens');
      expect(supported[1]).toMatchObject({ providers: ['nexus-v2'], capabilities: { intent: true, execute: true } });
      expect(chains[0].providers).toEqual(['nexus-v2', 'mayan']);
    } finally {
      client.destroy();
    }
  });

  it('forwards explicit provider constraints for route discovery', async () => {
    const metadata = testChains.map(({ tokens: _tokens, ...chain }) => chain);
    const getIntentChains = vi.fn().mockResolvedValue(metadata);
    const getIntentTokens = vi.fn();
    const client = createNexusClient({
      clientId: 'test-client', analytics: { enabled: false },
      internal: { middlewareClient: makeMiddlewareClient({ getIntentChains, getIntentTokens }) },
    });
    try {
      await client.initialize();
      const constraints = { providers: ['relay' as const], sources: [{ chainId: 1 }] };
      await expect(client.getSupportedChainsForRoute(constraints)).resolves.toEqual(metadata);
      expect(getIntentChains).toHaveBeenLastCalledWith(constraints);
    } finally {
      client.destroy();
    }
  });
});
