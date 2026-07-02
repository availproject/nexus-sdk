import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsManager } from '../../src/analytics/AnalyticsManager';
import { NexusAnalyticsEvents } from '../../src/analytics/events';
import { getLogger } from '../../src/domain/utils/logger';

describe('AnalyticsManager dev timing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('supports logs-only mode without emitting performance analytics', async () => {
    const onSpanComplete = vi.fn();
    const manager = new AnalyticsManager(
      'testnet',
      { enabled: true },
      { enabled: true, emitAnalytics: false, emitLogs: true, onSpanComplete }
    );

    const trackSpy = vi.spyOn(manager, 'track');
    trackSpy.mockClear();
    const logSpy = vi.spyOn(getLogger(), 'info').mockImplementation(() => {});

    await manager.withSpan('flow.bridge.prepare_intent', async () => {
      return Promise.resolve('ok');
    });

    expect(trackSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'dev_timing.span_complete',
      expect.objectContaining({
        name: 'flow.bridge.prepare_intent',
        success: true,
      })
    );
    expect(onSpanComplete).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy operation tracking behavior', async () => {
    // `mode: 'on'` bypasses the env guard so emission can be verified inside
    // vitest (NODE_ENV=test would otherwise disable the manager).
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'on' });
    const trackSpy = vi.spyOn(manager, 'track');
    trackSpy.mockClear();

    await manager.trackOperation('legacy_operation', async () => Promise.resolve('ok'));

    expect(trackSpy).toHaveBeenCalledWith(
      NexusAnalyticsEvents.OPERATION_PERFORMANCE,
      expect.objectContaining({
        operation: 'legacy_operation',
        success: true,
      })
    );
  });
});
