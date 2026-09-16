import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../package.json';
import { createNexusClient } from '../../src';
import { NexusAnalyticsEvents } from '../../src/analytics/events';
import { Errors } from '../../src/domain/errors';
import * as telemetry from '../../src/services/telemetry';
import { makeMiddlewareClient } from '../helpers/middleware-client';

describe('telemetry identity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps declared client and session identity isolated between SDK instances', async () => {
    const emit = vi.fn();
    vi.spyOn(telemetry, 'telemetryLogger', 'get').mockReturnValue({ emit } as never);
    const clients = ['Partner.One', 'Partner.Two'].map((clientId) => createNexusClient({
      clientId, network: 'mainnet', analytics: { mode: 'on' },
      internal: { middlewareClient: makeMiddlewareClient({
        getIntentChains: async () => { throw Errors.backend('catalog unavailable'); },
      }) },
    }));
    try {
      const tracks = clients.map((client) => vi.spyOn(client.analytics.getProvider(), 'track'));
      await Promise.all(clients.map((client) => client.initialize().catch(() => undefined)));
      clients.forEach((client, index) => {
        const props = tracks[index].mock.calls.find(([name]) => name === NexusAnalyticsEvents.SDK_INITIALIZATION_FAILED)?.[1];
        expect(props).toMatchObject({
          'nexus.client.id': index === 0 ? 'Partner.One' : 'Partner.Two',
          'surface.name': 'nexus-sdk', 'surface.version': version,
          'session.id': client.analytics.getBaseProperties().sessionId,
        });
      });
      const records = emit.mock.calls.map(([record]) => record.attributes);
      expect(records).toEqual(expect.arrayContaining(clients.map((client, index) => expect.objectContaining({
        'nexus.client.id': index === 0 ? 'Partner.One' : 'Partner.Two',
        'surface.name': 'nexus-sdk', 'surface.version': version,
        'session.id': client.analytics.getBaseProperties().sessionId,
      }))));
      expect(clients[0].analytics.getBaseProperties().sessionId).not.toBe(clients[1].analytics.getBaseProperties().sessionId);
    } finally {
      clients.forEach((client) => client.destroy());
    }
  });
});
