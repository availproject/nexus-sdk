import { describe, expect, it, vi } from 'vitest';
import { AnalyticsManager } from '../../src/analytics/AnalyticsManager';
import { trackIntentOperation } from '../../src/core/sdk/operation-boundary';

describe('Better Intent analytics boundary', () => {
  it('parents flow timing spans to the public operation', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'mainnet',
      { enabled: true, mode: 'on' },
      { enabled: true, sampleRate: 1, onSpanComplete }
    );
    let operationId = '';

    await trackIntentOperation(manager, 'bridge', { toChainId: 1 }, undefined, async (id) => {
      operationId = id;
      const timing = manager.scopedTimingHooks(id);
      await timing.withSpan('intent.quote', async () => undefined);
      return { ok: true };
    });

    const span = onSpanComplete.mock.calls
      .map(([value]) => value)
      .find((value) => value.operation === 'intent.quote');
    expect(span.parentSpanId).toBe(operationId);
    expect(span.rootSpanId).toBe(operationId);
  });

  it('rethrows failures after reporting the operation boundary', async () => {
    const manager = new AnalyticsManager('mainnet', { enabled: false });
    const error = new Error('quote failed');

    await expect(
      trackIntentOperation(manager, 'simulateBridge', {}, undefined, async () => {
        throw error;
      })
    ).rejects.toBe(error);
  });
});
