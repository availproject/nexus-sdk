import { describe, expect, it, vi } from 'vitest';
import { createInitSweepController } from '../../src/core/sdk/init-sweep-controller';
import type { SweepContext } from '../../src/services/init-refund-sweep';

const ctx = {} as unknown as SweepContext;

describe('createInitSweepController', () => {
  it('runs the sweep exactly once across repeated runOnce calls', () => {
    const sweep = vi.fn().mockResolvedValue(undefined);
    const controller = createInitSweepController({ getContext: () => ({ ctx }), sweep });
    controller.runOnce();
    controller.runOnce();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith({ ctx, label: 'Init refund sweep' });
  });

  it('skips while a swap is in flight', () => {
    const sweep = vi.fn().mockResolvedValue(undefined);
    const controller = createInitSweepController({ getContext: () => ({ ctx }), sweep });
    controller.setSwapRunning(true);
    controller.runOnce();
    expect(sweep).not.toHaveBeenCalled();
  });

  it('is a no-op without a context yet and does not consume the one-shot', () => {
    const sweep = vi.fn().mockResolvedValue(undefined);
    let context: { ctx: SweepContext } | null = null;
    const controller = createInitSweepController({ getContext: () => context, sweep });
    controller.runOnce(); // no context → skipped, not consumed
    expect(sweep).not.toHaveBeenCalled();
    context = { ctx };
    controller.runOnce(); // context now available → fires
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('swallows sweep errors (best-effort, fire-and-forget)', async () => {
    const sweep = vi.fn().mockRejectedValue(new Error('network blip'));
    const controller = createInitSweepController({ getContext: () => ({ ctx }), sweep });
    expect(() => controller.runOnce()).not.toThrow();
    await Promise.resolve(); // let the rejection settle into the controller's .catch
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
