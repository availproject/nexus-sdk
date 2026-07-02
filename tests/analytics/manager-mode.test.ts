import { describe, expect, it } from 'vitest';
import { AnalyticsManager } from '../../src/analytics/AnalyticsManager';

// Vitest sets NODE_ENV=test, so the env guard would normally disable analytics
// on every construction. These tests cover the `mode` flag's behavior.
describe('AnalyticsManager `mode` config', () => {
  it("`mode: 'on'` bypasses the env guard", () => {
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'on' });
    expect(manager.isEnabled()).toBe(true);
  });

  it("`mode: 'off'` disables even when env guard would have allowed it", () => {
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'off' });
    expect(manager.isEnabled()).toBe(false);
  });

  it("`mode: 'auto'` runs the env guard (disabled under NODE_ENV=test)", () => {
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'auto' });
    expect(manager.isEnabled()).toBe(false);
  });

  it('default mode matches `auto` (no env-guard regression)', () => {
    const manager = new AnalyticsManager('testnet', { enabled: true });
    expect(manager.isEnabled()).toBe(false);
  });

  it("`enabled: false` wins over `mode: 'on'`", () => {
    const manager = new AnalyticsManager('testnet', { enabled: false, mode: 'on' });
    expect(manager.isEnabled()).toBe(false);
  });
});
