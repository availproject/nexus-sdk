import { UserRejectedRequestError } from 'viem';

type WalkableError = {
  walk?: (fn: (err: unknown) => unknown) => unknown;
};

export const isUserRejectedRequest = (error: unknown): boolean => {
  if (error instanceof UserRejectedRequestError) {
    return true;
  }

  if (error && typeof error === 'object' && 'walk' in error) {
    const walk = (error as WalkableError).walk;
    if (typeof walk === 'function') {
      const nested = walk((err) => err instanceof UserRejectedRequestError);
      return nested instanceof UserRejectedRequestError;
    }
  }

  return false;
};
