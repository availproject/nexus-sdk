import type { TimingSpanHooks } from '../domain';

type SpanOptions = Parameters<TimingSpanHooks['withSpan']>[2];
type StartSpanOptions = Parameters<TimingSpanHooks['startSpan']>[1];

const safeStartSpan = (
  timing: TimingSpanHooks | undefined,
  name: string,
  options?: StartSpanOptions
): string | undefined => {
  if (!timing) {
    return undefined;
  }
  try {
    return timing.startSpan(name, options);
  } catch {
    // timing must never break product flows
    return undefined;
  }
};

const safeEndSpan = (
  timing: TimingSpanHooks | undefined,
  spanId: string | undefined,
  result: { success: boolean; error?: Error }
): void => {
  if (!timing || !spanId) {
    return;
  }
  try {
    timing.endSpan(spanId, result);
  } catch {
    // timing must never break product flows
  }
};

export const withTimingSpan = <T>(
  timing: TimingSpanHooks | undefined,
  name: string,
  fn: () => Promise<T>,
  options?: SpanOptions
): Promise<T> => {
  const spanId = safeStartSpan(timing, name, options);
  return fn()
    .then((result) => {
      safeEndSpan(timing, spanId, { success: true });
      return result;
    })
    .catch((error) => {
      safeEndSpan(timing, spanId, { success: false, error: error as Error });
      throw error;
    });
};

export const withRootTimingSpan = async <T>(
  timing: TimingSpanHooks | undefined,
  name: string,
  fn: (rootSpanId: string | undefined) => Promise<T>,
  options?: StartSpanOptions
): Promise<T> => {
  const rootSpanId = safeStartSpan(timing, name, options);
  try {
    const result = await fn(rootSpanId);
    safeEndSpan(timing, rootSpanId, { success: true });
    return result;
  } catch (error) {
    safeEndSpan(timing, rootSpanId, { success: false, error: error as Error });
    throw error;
  }
};
