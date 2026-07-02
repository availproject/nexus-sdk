import { getLogger } from '../../domain';
import { type SweepContext, sweepEphemeralRefundsToEoa } from '../../services/init-refund-sweep';

const logger = getLogger();

export type InitSweepControllerInput = {
  /**
   * Lazy lookup for the sweep context. Returning `null` makes `runOnce()` a quiet no-op (e.g. the
   * wallet or chain list isn't wired up yet), without consuming the one-shot.
   */
  getContext: () => { ctx: SweepContext } | null;
  /** Override the sweep implementation; tests swap it for a spy. */
  sweep?: (input: { ctx: SweepContext; label: string }) => Promise<void>;
};

export type InitSweepController = {
  setSwapRunning: (running: boolean) => void;
  /** Fire the one-shot refund sweep now — fire-and-forget, runs at most once. */
  runOnce: () => void;
};

/**
 * One-shot refund sweep for the disposable SDK. On connect it makes a single best-effort pass that
 * drains bridge-failure refunds (USDC/USDT/ETH) stranded on the ephemeral-controlled account back to
 * the EOA, then stops — no `setInterval`/`setTimeout`. Sponsor-submitted via the ephemeral key, so it
 * never prompts. Skips while a swap is in flight (`setSwapRunning(true)`) so it can't race a live
 * ephemeral session.
 */
export const createInitSweepController = (input: InitSweepControllerInput): InitSweepController => {
  const sweepImpl = input.sweep ?? sweepEphemeralRefundsToEoa;
  let isSweepRunning = false;
  let isSwapRunning = false;
  let hasSwept = false;

  const runOnce = (): void => {
    if (hasSwept || isSweepRunning) return;
    // TODO(init-sweep-race): one-shot with no timer — if a swap is already mid-flight when this
    // fires, the sweep is skipped and never retried. Revisit deferring the single sweep until the
    // in-flight swap settles.
    if (isSwapRunning) {
      logger.debug('initSweep:skipped', { reason: 'swapInFlight' });
      return;
    }
    const resolved = input.getContext();
    if (!resolved) {
      logger.debug('initSweep:skipped', { reason: 'noContext' });
      return;
    }

    isSweepRunning = true;
    hasSwept = true;
    void sweepImpl({ ctx: resolved.ctx, label: 'Init refund sweep' })
      .catch((error) => {
        logger.debug('initSweep:failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        isSweepRunning = false;
      });
  };

  return {
    setSwapRunning: (running) => {
      isSwapRunning = running;
    },
    runOnce,
  };
};
