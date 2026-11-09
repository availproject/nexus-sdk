import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../package.json';
import { createNexusClient } from '../../src';
import { NexusAnalyticsEvents } from '../../src/analytics/events';
import { Errors } from '../../src/domain/errors';
import * as telemetry from '../../src/services/telemetry';
import { makeMiddlewareClient } from '../helpers/middleware-client';
import { getSupportedChains } from '../../src/utils';

describe('telemetry identity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps declared client and session identity isolated between SDK instances', async () => {
    const emit = vi.fn();
    vi.spyOn(telemetry, 'telemetryLogger', 'get').mockReturnValue({ emit } as never);
    const networks = ['mainnet', 'canary'] as const;
    const clients = ['Partner.One', 'Partner.Two'].map((clientId, index) => createNexusClient({
      clientId, network: networks[index], analytics: { mode: 'on' },
      ...(index === 0 ? { surfaceName: 'nexus-widget', surfaceVersion: '1.2.3' } : {}),
      internal: { middlewareClient: makeMiddlewareClient({
        getIntentChains: async () => { throw Errors.backend('catalog unavailable'); },
      }) },
    }));
    try {
      const registrations = clients.map((client) => {
        const provider = client.analytics.getProvider();
        vi.spyOn(provider, 'isInitialized').mockReturnValue(true);
        const register = vi.spyOn(provider, 'register');
        client.analytics.reset();
        return register;
      });
      const tracks = clients.map((client) => vi.spyOn(client.analytics.getProvider(), 'track'));
      await Promise.all(clients.map((client) => client.initialize().catch(() => undefined)));
      clients.forEach((client, index) => {
        const props = tracks[index].mock.calls.find(([name]) => name === NexusAnalyticsEvents.SDK_INITIALIZATION_FAILED)?.[1];
        expect(props).toMatchObject({
          'nexus.client.id': index === 0 ? 'Partner.One' : 'Partner.Two',
          'surface.name': index === 0 ? 'nexus-widget' : 'nexus-sdk',
          'surface.version': index === 0 ? '1.2.3' : version,
          'session.id': client.analytics.getBaseProperties().sessionId,
          'nexus.network': networks[index],
        });
        const base = client.analytics.getBaseProperties();
        const globals = registrations[index].mock.calls[0][0];
        expect(globals).toMatchObject({
          'surface.name': index === 0 ? 'nexus-widget' : 'nexus-sdk',
          'surface.version': index === 0 ? '1.2.3' : version,
        });
        expect(base.sdkVersion).toBe(version);
        for (const properties of [props, base, globals]) {
          expect(properties).toMatchObject({ 'nexus.network': networks[index] });
          expect(properties).not.toHaveProperty('network');
        }
      });
      const records = emit.mock.calls.map(([record]) => record.attributes);
      expect(records).toEqual(expect.arrayContaining(clients.map((client, index) => expect.objectContaining({
        'nexus.client.id': index === 0 ? 'Partner.One' : 'Partner.Two',
        'surface.name': index === 0 ? 'nexus-widget' : 'nexus-sdk',
        'surface.version': index === 0 ? '1.2.3' : version,
        'session.id': client.analytics.getBaseProperties().sessionId,
        'nexus.network': networks[index],
      }))));
      for (const record of records) expect(record).not.toHaveProperty('network');
      expect(clients[0].analytics.getBaseProperties().sessionId).not.toBe(clients[1].analytics.getBaseProperties().sessionId);
    } finally {
      clients.forEach((client) => client.destroy());
    }
  });

  it.each([
    [undefined, undefined, 'nexus-sdk', version],
    ['nexus-widget', undefined, 'nexus-widget', version],
    [undefined, '1.2.3', 'nexus-sdk', '1.2.3'],
    ['nexus-widget', '1.2.3', 'nexus-widget', '1.2.3'],
  ])('uses surface %s / %s on utility error logs without a client session', async (surfaceName, surfaceVersion, expectedName, expectedVersion) => {
    const emit = vi.fn();
    vi.spyOn(telemetry, 'telemetryLogger', 'get').mockReturnValue({ emit } as never);
    await expect(getSupportedChains('canary', { clientId: '', surfaceName, surfaceVersion }))
      .rejects.toThrow('non-empty clientId');
    const attributes = emit.mock.calls[0][0].attributes;
    expect(attributes).toMatchObject({
      operation: 'getSupportedChains', 'nexus.network': 'canary',
      'surface.name': expectedName, 'surface.version': expectedVersion,
    });
    expect(attributes).not.toHaveProperty('network');
    expect(attributes).not.toHaveProperty('session.id');
  });
});
