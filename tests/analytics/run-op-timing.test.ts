import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsManager,
  sanitizePerformanceSpanForPostHog,
} from '../../src/analytics/AnalyticsManager';
import { NexusAnalyticsEvents, NexusOperationNames } from '../../src/analytics/events';
import type { SpanProperties } from '../../src/analytics/types';
import { trackBridge } from '../../src/core/sdk/operation-boundary';
import type { BridgeIntent, BridgeParams } from '../../src/domain';
import type { BridgeResult } from '../../src/domain';

/**
 * Approach D parenting + analytics-disabled guarantees.
 *
 * Locks in: (1) dev-timing spans started via a scoped timing hook parent to
 * the runOp opId (the flowId); (2) when analytics is off + dev-timing is on,
 * span timings still log via `onSpanComplete` and no PostHog event fires;
 * (3) when analytics is on + dev-timing is off, only the runOp's
 * OPERATION_PERFORMANCE fires (no per-step span events); (4) parallel
 * trackX invocations keep their parents distinct; (5) per-step lifecycle
 * events carry the flowId.
 */

const bridgeParams: BridgeParams = {
  toChainId: 1,
  toTokenSymbol: 'USDC',
  toAmountRaw: 100n,
};

// The bridge result the run callback resolves to. extractBridgeProperties is
// safe with a null intent (returns {}), so we can pass a minimal shape that
// satisfies the `Pick<BridgeResult, 'intentExplorerUrl' | 'intent'>` constraint.
const fakeBridgeResult: Pick<BridgeResult, 'intentExplorerUrl' | 'intent'> = {
  intentExplorerUrl: 'https://example/intent/0xabc',
  intent: null as unknown as BridgeIntent,
};

describe('AnalyticsManager.runOp + scoped dev-timing (Approach D)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parents child spans to the runOp opId via the scoped timing hook', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'testnet',
      { enabled: true, mode: 'on' },
      { enabled: true, sampleRate: 1, onSpanComplete }
    );

    let capturedOpId = '';
    await trackBridge(manager, bridgeParams, undefined, async (_wrapped, opId) => {
      capturedOpId = opId;
      // What `getCommonFlowDeps(opId)` builds in base.ts and flows then consume
      // via `withTimingSpan(deps.timing, ...)`. Testing the scoped hook directly
      // is the same code path as production minus the flow-helper indirection.
      const scoped = manager.scopedTimingHooks(opId);
      const childId = scoped.startSpan('flow.bridge.test_child');
      scoped.endSpan(childId, { success: true });
      return fakeBridgeResult;
    });

    expect(capturedOpId).not.toBe('');
    const childSpan = onSpanComplete.mock.calls
      .map(([s]) => s)
      .find((s) => s?.operation === 'flow.bridge.test_child');
    expect(childSpan).toBeDefined();
    expect(childSpan.parentSpanId).toBe(capturedOpId);
    // Child should also inherit the opId as rootSpanId — that's how PostHog
    // dashboards group every span for one flow under a single root.
    expect(childSpan.rootSpanId).toBe(capturedOpId);
  });

  it('honors explicit parentSpanId in caller opts (scoped default is overridden)', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'testnet',
      { enabled: true, mode: 'on' },
      { enabled: true, sampleRate: 1, onSpanComplete }
    );

    await trackBridge(manager, bridgeParams, undefined, async (_wrapped, opId) => {
      const scoped = manager.scopedTimingHooks(opId);
      // First child parents to opId (scoped default). Second child explicitly
      // parents to the first — simulates a nested sub-tree inside a flow.
      const outer = scoped.startSpan('flow.bridge.outer');
      const inner = scoped.startSpan('flow.bridge.inner', { parentSpanId: outer });
      scoped.endSpan(inner, { success: true });
      scoped.endSpan(outer, { success: true });
      return fakeBridgeResult;
    });

    const spans = onSpanComplete.mock.calls.map(([s]) => s);
    const outer = spans.find((s) => s.operation === 'flow.bridge.outer');
    const inner = spans.find((s) => s.operation === 'flow.bridge.inner');
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner.parentSpanId).toBe(outer.spanId);
  });

  it('logs span completion via onSpanComplete when analytics is off but dev-timing is on', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'testnet',
      { enabled: false },
      { enabled: true, sampleRate: 1, onSpanComplete }
    );
    // The provider is what actually emits to PostHog. When analytics.enabled
    // is false, the manager uses NoOpProvider and short-circuits track()
    // before reaching the provider — spy on the provider directly to verify.
    const providerTrackSpy = vi.spyOn(manager.getProvider(), 'track');

    await trackBridge(manager, bridgeParams, undefined, async (_wrapped, opId) => {
      const scoped = manager.scopedTimingHooks(opId);
      await scoped.withSpan('flow.bridge.test_child', async () => 'ok');
      return fakeBridgeResult;
    });

    // analytics off → provider never sees a track call (no PostHog emission)
    expect(manager.isEnabled()).toBe(false);
    expect(providerTrackSpy).not.toHaveBeenCalled();
    // But dev-timing still emits via the onSpanComplete callback
    const names = onSpanComplete.mock.calls.map(([s]) => s.operation);
    expect(names).toContain('flow.bridge.test_child');
  });

  it('emits only OPERATION_PERFORMANCE for the opId when analytics is on + dev-timing is off', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'testnet',
      { enabled: true, mode: 'on' },
      { enabled: false, onSpanComplete }
    );
    const trackSpy = vi.spyOn(manager, 'track');
    trackSpy.mockClear();

    await trackBridge(manager, bridgeParams, undefined, async (_wrapped, opId) => {
      const scoped = manager.scopedTimingHooks(opId);
      // dev-timing disabled → startSpan returns '' (no span created)
      const childId = scoped.startSpan('flow.bridge.test_child');
      expect(childId).toBe('');
      scoped.endSpan(childId, { success: true });
      return fakeBridgeResult;
    });

    // Exactly one OPERATION_PERFORMANCE event — for the runOp opId
    // (emitted from endOperation with alwaysEmitAnalytics: true).
    const perfEvents = trackSpy.mock.calls.filter(
      ([event]) => event === NexusAnalyticsEvents.OPERATION_PERFORMANCE
    );
    expect(perfEvents).toHaveLength(1);
    expect(perfEvents[0][1]).toMatchObject({
      operation: NexusOperationNames.BRIDGE,
      success: true,
    });
    // No child-span analytics
    expect(onSpanComplete).not.toHaveBeenCalled();
  });

  it('keeps parents distinct across parallel trackX invocations', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'testnet',
      { enabled: true, mode: 'on' },
      { enabled: true, sampleRate: 1, onSpanComplete }
    );

    let opA = '';
    let opB = '';

    const runA = async () =>
      trackBridge(manager, bridgeParams, undefined, async (_wrapped, opId) => {
        opA = opId;
        const scoped = manager.scopedTimingHooks(opId);
        const child = scoped.startSpan('flow.bridge.child_A');
        await new Promise((r) => setTimeout(r, 20));
        scoped.endSpan(child, { success: true });
        return fakeBridgeResult;
      });

    const runB = async () =>
      trackBridge(manager, bridgeParams, undefined, async (_wrapped, opId) => {
        opB = opId;
        const scoped = manager.scopedTimingHooks(opId);
        const child = scoped.startSpan('flow.bridge.child_B');
        await new Promise((r) => setTimeout(r, 10));
        scoped.endSpan(child, { success: true });
        return fakeBridgeResult;
      });

    await Promise.all([runA(), runB()]);

    expect(opA).not.toBe(opB);
    const spans = onSpanComplete.mock.calls.map(([s]) => s);
    const childA = spans.find((s) => s.operation === 'flow.bridge.child_A');
    const childB = spans.find((s) => s.operation === 'flow.bridge.child_B');
    expect(childA.parentSpanId).toBe(opA);
    expect(childB.parentSpanId).toBe(opB);
  });

  it('sanitizePerformanceSpanForPostHog drops only the error fields, preserves everything else', () => {
    // Direct unit test on the boundary helper. Lives separately from the
    // integration test below so a regression in the filter shows up in both
    // (one as missing keys, one as leaked error details) — clearer signal
    // when grepping a test report.
    const span: SpanProperties = {
      operation: 'bridge',
      duration: 1234,
      success: false,
      errorMessage: 'sensitive detail that must not reach PostHog',
      errorType: 'ExecutionError',
      metadata: { foo: 'bar' },
      spanId: 'op_abc',
      parentSpanId: undefined,
      rootSpanId: 'op_abc',
      startedAtIso: '2026-01-01T00:00:00.000Z',
      endedAtIso: '2026-01-01T00:00:01.234Z',
      tags: undefined,
    };

    const sanitized = sanitizePerformanceSpanForPostHog(span);

    expect(sanitized).not.toHaveProperty('errorMessage');
    expect(sanitized).not.toHaveProperty('errorType');
    expect(sanitized).toMatchObject({
      operation: 'bridge',
      duration: 1234,
      success: false,
      spanId: 'op_abc',
      rootSpanId: 'op_abc',
      startedAtIso: '2026-01-01T00:00:00.000Z',
      endedAtIso: '2026-01-01T00:00:01.234Z',
    });
  });

  it('strips errorMessage/errorType from OPERATION_PERFORMANCE when the run rejects', async () => {
    // Regression guard: SpanProperties.endSpan auto-populates errorMessage / errorType
    // from the Error passed to endOperation. Without filtering, those fields would
    // ride along into the PostHog `nexus_v2_operation_performance` payload —
    // re-leaking error details after we just stripped them from FAILED events.
    // Keep this assertion strict (`not.toHaveProperty`) so any future regression
    // (someone restoring the full span payload on the analytics sink) fails loudly.
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'on' });
    const trackSpy = vi.spyOn(manager, 'track');
    trackSpy.mockClear();

    await expect(
      trackBridge(manager, bridgeParams, undefined, async () => {
        throw new Error('runtime exploded with sensitive detail');
      })
    ).rejects.toThrow('runtime exploded with sensitive detail');

    const perfCall = trackSpy.mock.calls.find(
      ([event]) => event === NexusAnalyticsEvents.OPERATION_PERFORMANCE
    );
    expect(perfCall).toBeDefined();
    const payload = perfCall?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      operation: NexusOperationNames.BRIDGE,
      success: false,
    });
    expect(payload).not.toHaveProperty('errorMessage');
    expect(payload).not.toHaveProperty('errorType');
  });

  it('stamps flowId on per-step lifecycle events emitted during the flow', async () => {
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'on' });
    const trackSpy = vi.spyOn(manager, 'track');
    trackSpy.mockClear();
    const userOnEvent = vi.fn();

    let capturedOpId = '';
    await trackBridge(
      manager,
      bridgeParams,
      { onEvent: userOnEvent },
      async (wrapped, opId) => {
        capturedOpId = opId;
        // Simulate the flow firing a bridge event. The lifecycle translator
        // is wired through `wrapped.onEvent` and should stamp `flowId: opId`
        // on the resulting per-step track call (BRIDGE_INTENT_SIGNED here).
        wrapped.onEvent?.({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
          intentRequestHash: '0xabc' as `0x${string}`,
        } as Parameters<NonNullable<typeof wrapped.onEvent>>[0]);
        return fakeBridgeResult;
      }
    );

    const signedCall = trackSpy.mock.calls.find(
      ([event]) => event === NexusAnalyticsEvents.BRIDGE_INTENT_SIGNED
    );
    expect(signedCall).toBeDefined();
    expect(signedCall?.[1]).toMatchObject({
      intentRequestHash: '0xabc',
      flowId: capturedOpId,
    });
    // User's onEvent still receives the original event unchanged
    expect(userOnEvent).toHaveBeenCalledTimes(1);
  });
});
