import { describe, expect, it, vi } from 'vitest';
import { AnalyticsManager } from '../../src/analytics/AnalyticsManager';
import { NexusAnalyticsEvents as Events } from '../../src/analytics/events';
import { trackIntentOperation } from '../../src/client/operation-boundary';
import { BackendError, ERROR_CODES, Errors } from '../../src/domain/errors';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import { runIntent } from '../../src/intent/orchestrator';
import type { IntentStatus } from '../../src/intent/types';
import { INTENT_SIGNATURE, sponsoredQuoteResponse } from '../fixtures/better-intent';
import * as telemetry from '../../src/services/telemetry';

const setup = () => {
  const analytics = new AnalyticsManager('mainnet', { mode: 'on' });
  const track = vi.spyOn(analytics.getProvider(), 'track');
  const quote = normalizeIntentQuote(sponsoredQuoteResponse());
  const deps = {
    explorerUrl: '', now: () => 1_900_000_000_000,
    approve: vi.fn(), confirmApproval: vi.fn(), sendNative: vi.fn(),
    sign: vi.fn(async () => INTENT_SIGNATURE),
    submit: vi.fn(async () => ({ quoteId: quote.quote.id, status: 'created' as const })),
    getStatus: vi.fn(async (): Promise<IntentStatus> => ({
      id: quote.quote.id, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', legs: [],
    })),
  };
  const outcomes = () => track.mock.calls.filter(([name]) => name === Events.INTENT_OUTCOME).map(([, props]) => props);
  const run = (input: Partial<Parameters<typeof runIntent>[0]> = {}) => trackIntentOperation(
    analytics, 'swapWithExactOut', { toChainId: 1 }, {},
    (_id, reporting) => runIntent({ requestQuote: async () => quote, ...input, reporting }, deps),
  );
  return { analytics, track, quote, deps, outcomes, run };
};

describe('payment attempt outcomes', () => {
  it('lets validation handle malformed inputs without telemetry replacing the error', async () => {
    const s = setup();
    const error = Errors.invalidInput('Invalid source');
    await expect(trackIntentOperation(s.analytics, 'swapWithExactOut', { sources: [null] }, {}, async () => { throw error; }))
      .rejects.toBe(error);
    expect(s.outcomes()).toEqual([expect.objectContaining({ 'attempt.outcome': 'rejected' })]);
  });
  it('links refreshed quotes to one attempt and records delivery once', async () => {
    const s = setup();
    const refreshed = structuredClone(s.quote);
    refreshed.quote.id = `0x${'ab'.repeat(32)}`;
    const result = await s.run({ refreshQuote: async () => refreshed,
      onIntent: async ({ refresh, allow }) => { await refresh(); allow(); },
      onEvent: () => { throw new Error('consumer failure'); },
    });
    expect(s.outcomes()).toHaveLength(1);
    expect(s.outcomes()[0]).toMatchObject({ 'attempt.id': result.attemptId,
      'attempt.outcome': 'completed', 'attempt.committed': true, 'quote.id': refreshed.quote.id });
    const quotes = s.track.mock.calls.filter(([name]) => name === Events.INTENT_QUOTED);
    expect(quotes).toHaveLength(2);
    expect(new Set(quotes.map(([, props]) => props?.['attempt.id'])).size).toBe(1);
    expect(JSON.stringify(s.track.mock.calls)).not.toContain(INTENT_SIGNATURE);
  });

  it.each(['hook', 'signature'] as const)('counts %s rejection before commitment as stopped', async (where) => {
    const s = setup();
    if (where === 'signature') s.deps.sign.mockRejectedValue(Errors.userRejectedIntentSignature());
    await expect(s.run(where === 'hook' ? { onIntent: ({ deny }) => deny() } : {})).rejects.toThrow();
    expect(s.outcomes()).toEqual([expect.objectContaining({ 'attempt.outcome': 'stopped',
      'attempt.committed': false, 'reason.bucket': 'user_declined' })]);
    expect(s.track.mock.calls.some(([name]) => name === Events.SWAP_TRANSACTION_FAILED)).toBe(false);
  });

  it('counts quote rejection separately and gives a retry a new ID', async () => {
    const s = setup();
    const error = new BackendError(ERROR_CODES.BACKEND_NO_ROUTABLE_SOURCE, 'Display only', { context: { service: 'middleware' } });
    await expect(s.run({ requestQuote: async () => { throw error; } })).rejects.toBe(error);
    await s.run();
    expect(s.outcomes().map((props) => props?.['attempt.outcome'])).toEqual(['rejected', 'completed']);
    expect(s.outcomes()[0]?.['attempt.id']).not.toBe(s.outcomes()[1]?.['attempt.id']);
    expect(s.outcomes()[0]).toMatchObject({ 'reason.bucket': 'unsupported_route', 'error.code': error.code });
  });

  it('reports confirmed expiry as failed but a polling timeout as observation loss', async () => {
    const s = setup();
    s.deps.getStatus.mockResolvedValueOnce({ id: s.quote.quote.id, provider: 'nexus-v2', status: 'expired', substatus: 'expired', legs: [] });
    await expect(s.run()).rejects.toThrow();
    expect(s.outcomes()[0]).toMatchObject({ 'attempt.outcome': 'failed', 'reason.bucket': 'expired' });
    await expect(s.run({ timeoutMs: -1 })).rejects.toMatchObject({ code: ERROR_CODES.BACKEND_FULFILMENT_WAIT_TIMEOUT });
    expect(s.outcomes()).toHaveLength(1);
    expect(s.track).toHaveBeenCalledWith(Events.INTENT_OBSERVATION_FAILED, expect.objectContaining({
      'attempt.committed': true, 'attempt.pending': true, 'reason.bucket': 'timeout',
    }));
  });

  it('does not replace delivery with failure if destination execute later throws', async () => {
    const s = setup();
    const error = Errors.transactionReverted('0x1234');
    await expect(trackIntentOperation(s.analytics, 'swapAndExecute', {}, {}, async (_id, reporting) => {
      await runIntent({ requestQuote: async () => s.quote, reporting }, s.deps);
      throw error;
    })).rejects.toBe(error);
    expect(s.outcomes()).toEqual([expect.objectContaining({ 'attempt.outcome': 'completed' })]);
  });

  it('keeps telemetry failures from changing the operation result', async () => {
    const s = setup();
    s.track.mockImplementation(() => { throw new Error('telemetry unavailable'); });
    await expect(s.run()).resolves.toMatchObject({ status: { status: 'fulfilled' } });
  });

  it.each([false, true])('uses native broadcast as commitment (broadcast=%s)', async (broadcast) => {
    const s = setup();
    s.quote.execution.allowances = [];
    s.quote.execution.nativeTransactions = [{ chainId: 8453, sourceIndex: 0,
      kind: 'native_source_deposit', to: s.quote.quote.input[0]!.tokenAddress, valueRaw: 10n,
      functionName: 'deposit', abi: [], vaultRequest: {},
    }];
    s.quote.quote.plan.steps.splice(1, 0, { id: 'native:8453:0', type: 'native_transaction',
      chainId: 8453, sourceIndex: 0, to: s.quote.quote.input[0]!.tokenAddress, valueRaw: 10n });
    const hash = `0x${'fa'.repeat(32)}` as const;
    s.deps.sendNative.mockImplementation(async (_instruction, _signature, onSubmitted) => {
      expect(s.track.mock.calls.some(([event]) => event === Events.INTENT_COMMITTED)).toBe(false);
      if (broadcast) onSubmitted(hash);
      throw broadcast ? Errors.liquidityTimeout(s.quote.quote.id) : Errors.userRejectedTxSend();
    });
    await expect(s.run()).rejects.toThrow();
    if (broadcast) {
      expect(s.outcomes()).toEqual([]);
      expect(s.track).toHaveBeenCalledWith(Events.INTENT_TRANSACTION, expect.objectContaining({ 'transaction.hash': hash }));
      expect(s.track).toHaveBeenCalledWith(Events.INTENT_OBSERVATION_FAILED, expect.objectContaining({ 'attempt.pending': true }));
    } else {
      expect(s.outcomes()).toEqual([expect.objectContaining({ 'attempt.outcome': 'stopped', 'attempt.committed': false })]);
    }
  });

  it('reports recoverable refresh errors without ending the attempt', async () => {
    const s = setup();
    await s.run({ refreshQuote: async () => { throw Errors.backend('temporary failure'); },
      onIntent: async ({ refresh, allow }) => { await refresh().catch(() => undefined); allow(); } });
    expect(s.outcomes()).toEqual([expect.objectContaining({ 'attempt.outcome': 'completed' })]);
    expect(s.track).toHaveBeenCalledWith(Events.INTENT_QUOTE_REFRESH_FAILED, expect.objectContaining({ 'attempt.committed': false }));
  });

  it('buckets local quote expiry without changing the public backend error code', async () => {
    const s = setup();
    s.quote.quote.expiresAt = 1;
    await expect(s.run()).rejects.toMatchObject({ code: ERROR_CODES.BACKEND_ERROR });
    expect(s.outcomes()).toEqual([expect.objectContaining({ 'attempt.outcome': 'rejected', 'reason.bucket': 'expired' })]);
  });

  it('counts a multi-source payment once and deduplicates unchanged source status observations', async () => {
    const s = setup();
    s.quote.quote.input.push({ ...s.quote.quote.input[0]!, chainId: 10 });
    const legs = [{ sourceIndex: 0, status: 'fulfilled' as const }, { sourceIndex: 1, status: 'fulfilled' as const }];
    s.deps.getStatus.mockResolvedValueOnce({ id: s.quote.quote.id, provider: 'nexus-v2', status: 'deposited', substatus: 'processing', legs })
      .mockResolvedValue({ id: s.quote.quote.id, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', legs });
    await s.run({ pollingIntervalMs: 0 });
    expect(s.outcomes()).toHaveLength(1);
    expect(s.outcomes()[0]).toMatchObject({ sourceChainIds: [8453, 10] });
    expect(s.track.mock.calls.filter(([event]) => event === Events.INTENT_SOURCE_STATUS)).toHaveLength(2);
  });

  it('preserves middleware diagnostics and complete correlation IDs in the error log', async () => {
    const s = setup();
    const emit = vi.fn();
    const spy = vi.spyOn(telemetry, 'telemetryLogger', 'get').mockReturnValue({ emit } as never);
    const error = new BackendError(ERROR_CODES.BACKEND_NETWORK_ERROR, 'Display message', { context: { service: 'middleware' },
      details: { errorId: 'middleware-error-id', middlewareCode: 'UPSTREAM_ERROR', middlewareSubcode: 'PROVIDER_UNAVAILABLE' } });
    s.deps.submit.mockRejectedValue(error);
    try {
      await expect(s.run()).rejects.toBe(error);
      const record = emit.mock.calls.map(([entry]) => entry).find((entry) => entry.severityText === 'ERROR');
      expect(record.attributes).toMatchObject({
        'attempt.id': expect.any(String), 'quote.id': s.quote.quote.id, 'intent.id': s.quote.quote.id,
        'session.id': s.analytics.getSessionId(), 'attempt.pending': true,
        'error.middleware.errorId': 'middleware-error-id', 'error.code': error.code, 'reason.bucket': 'network',
      });
      expect(JSON.stringify(s.track.mock.calls)).not.toContain('Display message');
    } finally { spy.mockRestore(); }
  });
});
