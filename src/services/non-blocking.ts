import { getLogger } from '../domain';

const logger = getLogger();

export const runNonBlocking = (
  label: string,
  effect: () => void,
  context?: Record<string, unknown>
) => {
  try {
    effect();
  } catch (error) {
    logger.warn(label, {
      ...context,
      error,
    });
  }
};
