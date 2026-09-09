import { UserRejectedRequestError } from 'viem';

type WalkableError = {
  walk?: (fn: (err: unknown) => unknown) => unknown;
};

type Eip1193Error = {
  code?: unknown;
};

export const isUserRejectedRequest = (error: unknown): boolean => {
  if (error instanceof UserRejectedRequestError) {
    return true;
  }

  // Direct EIP-1193 providers such as MetaMask reject requests with a plain
  // object rather than viem's UserRejectedRequestError wrapper.
  if (error !== null && typeof error === 'object' && (error as Eip1193Error).code === 4001) {
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
