import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNexusClient, type NexusClient, type TokenRef } from '../../src';
import { NexusAnalyticsEvents as Events } from '../../src/analytics/events';
import { ZERO_ADDRESS } from '../../src/domain';
import { BackendError, ERROR_CODES } from '../../src/domain/errors';
import * as telemetry from '../../src/services/telemetry';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from '../helpers/catalog';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const token: TokenRef = { chainId: 1, tokenAddress: ZERO_ADDRESS };
const cases = [
  { method: 'getTokens', operation: 'catalog_get_tokens', run: (client: NexusClient) => client.getTokens() },
  { method: 'getToken', operation: 'catalog_get_token', run: (client: NexusClient) => client.getToken(token) },
  { method: 'getTokensByChain', operation: 'catalog_get_tokens_by_chain', run: (client: NexusClient) => client.getTokensByChain(1) },
  { method: 'getAvailableSourceTokens', operation: 'catalog_get_available_source_tokens', run: (client: NexusClient) => client.getAvailableSourceTokens(token) },
  { method: 'getAvailableDestinationTokens', operation: 'catalog_get_available_destination_tokens', run: (client: NexusClient) => client.getAvailableDestinationTokens([token]) },
  { method: 'confirmRouteExists', operation: 'catalog_confirm_route_exists', run: (client: NexusClient) => client.confirmRouteExists([token], token) },
  { method: 'getSupportedChainsForRoute', operation: 'catalog_get_supported_chains_for_route', run: (client: NexusClient) => client.getSupportedChainsForRoute({ sources: [token] }) },
];

const clients: NexusClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.destroy());
  vi.restoreAllMocks();
});

const setup = async (initialize = true) => {
  const getIntentTokens = vi.fn(makeTokenFetcher(testChains));
  const getIntentChains = vi.fn(async () => testChains);
  const client = createNexusClient({
    clientId: 'catalog-telemetry-test',
    analytics: { mode: 'on' },
    internal: { middlewareClient: makeMiddlewareClient({ getIntentTokens, getIntentChains }) },
  });
  clients.push(client);
  if (initialize) await client.initialize();
  const track = vi.spyOn(client.analytics.getProvider(), 'track');
  const emit = vi.fn();
  vi.spyOn(telemetry, 'telemetryLogger', 'get').mockReturnValue({ emit } as never);
  const report = vi.spyOn(telemetry, 'reportTelemetryEvent');
  return { client, track, emit, report, getIntentTokens, getIntentChains };
};

describe('public catalog operation telemetry', () => {
  it.each(cases)('reports one successful $method operation with its latency', async ({ method, operation, run }) => {
    const { client, track, report } = await setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const pending = run(client);
    now.mockReturnValue(1042);
    await pending;

    const events = track.mock.calls.filter(([name]) => name.startsWith('nexus_v2_catalog_'));
    expect(events.map(([name]) => name)).toEqual([
      'nexus_v2_catalog_fetch_started', 'nexus_v2_catalog_fetch_success',
    ]);
    const operationId = events[0]![1]!['operation.id'];
    expect(operationId).toEqual(expect.any(String));
    for (const [, properties] of events) {
      expect(properties).toMatchObject({
        method, 'operation.id': operationId, 'nexus.client.id': 'catalog-telemetry-test',
        'session.id': client.analytics.getSessionId(), 'surface.name': 'nexus-sdk',
      });
    }
    expect(track).toHaveBeenCalledWith(Events.OPERATION_PERFORMANCE, expect.objectContaining({
      operation, spanId: operationId, duration: 42, success: true,
    }));
    expect(report).toHaveBeenCalledWith('nexus_v2_catalog_fetch_success',
      expect.objectContaining({ method, 'operation.id': operationId }));
    expect(track.mock.calls.some(([name]) => name.startsWith('nexus_v2_intent_'))).toBe(false);
  });

  it.each(cases)('reports structured $method failures and rethrows the original error', async ({ method, operation, run }) => {
    const { client, track, emit, getIntentTokens, getIntentChains } = await setup();
    const error = new BackendError(ERROR_CODES.BACKEND_RATE_LIMITED, 'Private upstream detail', {
      context: { service: 'middleware' }, details: { errorId: 'catalog-error-id' },
    });
    getIntentTokens.mockRejectedValue(error);
    getIntentChains.mockRejectedValue(error);

    await expect(run(client)).rejects.toBe(error);

    const events = track.mock.calls.filter(([name]) => name.startsWith('nexus_v2_catalog_'));
    expect(events.map(([name]) => name)).toEqual([
      'nexus_v2_catalog_fetch_started', 'nexus_v2_catalog_fetch_failed',
    ]);
    const operationId = events[0]![1]!['operation.id'];
    const reason = {
      'error.code': 'rate_limited', 'error.type': error.code,
      'error.category': 'backend', 'error.service': 'middleware',
    };
    expect(events[1]![1]).toMatchObject({ method, 'operation.id': operationId, ...reason });
    expect(events[1]![1]).not.toHaveProperty('reason.bucket');
    expect(track).toHaveBeenCalledWith(Events.OPERATION_PERFORMANCE, expect.objectContaining({
      operation, spanId: operationId, duration: expect.any(Number), success: false,
    }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      severityText: 'ERROR',
      attributes: expect.objectContaining({
        operation: method, 'operation.id': operationId, 'nexus.client.id': 'catalog-telemetry-test',
        'error.middleware.errorId': 'catalog-error-id', ...reason,
      }),
    }));
    expect(JSON.stringify(track.mock.calls)).not.toContain('Private upstream detail');
    expect(JSON.stringify(track.mock.calls)).not.toContain('catalog-error-id');
  });

  it('measures concurrent and cached calls separately without changing fetch deduplication', async () => {
    const { client, track, getIntentTokens } = await setup();
    const [first, second] = await Promise.all([client.getTokens(), client.getTokens()]);
    const cached = await client.getTokens();
    expect(second).toBe(first);
    expect(cached).toBe(first);
    expect(getIntentTokens).toHaveBeenCalledTimes(1);
    const successes = track.mock.calls.filter(([name]) => name === 'nexus_v2_catalog_fetch_success');
    expect(successes).toHaveLength(3);
    expect(new Set(successes.map(([, properties]) => properties!['operation.id'])).size).toBe(3);
  });

  it('treats an incompatible route as a successful catalog check', async () => {
    const { client, track } = await setup();
    await expect(client.confirmRouteExists([], token)).resolves.toBe(false);
    expect(track).toHaveBeenCalledWith('nexus_v2_catalog_fetch_success', expect.objectContaining({ method: 'confirmRouteExists' }));
    expect(track.mock.calls.some(([name]) => name === 'nexus_v2_catalog_fetch_failed')).toBe(false);
  });

  it('reports local validation failures before any token request', async () => {
    const { client, track, getIntentTokens } = await setup();
    await expect(client.getTokensByChain(999)).rejects.toMatchObject({ code: ERROR_CODES.CHAIN_NOT_FOUND });
    expect(getIntentTokens).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('nexus_v2_catalog_fetch_failed', expect.objectContaining({
      method: 'getTokensByChain', 'error.code': 'unsupported_route', 'error.category': 'validation',
    }));
  });

  it('captures synchronous catalog preconditions at the operation boundary', async () => {
    const { client, track, getIntentChains } = await setup(false);
    await expect(Promise.resolve().then(() => client.getSupportedChainsForRoute({})))
      .rejects.toMatchObject({ code: ERROR_CODES.SDK_NOT_INITIALIZED });
    expect(getIntentChains).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('nexus_v2_catalog_fetch_failed', expect.objectContaining({
      method: 'getSupportedChainsForRoute', 'error.code': 'configuration',
    }));
  });
});
