import { NexusError } from '../domain/errors';
import type { IntentQuoteFailure } from './types';

/** Returns structured Better Intent quote diagnostics without exposing Axios response shapes. */
export const getIntentQuoteFailure = (error: unknown): IntentQuoteFailure | null => {
  if (!(error instanceof NexusError)) return null;
  const failure = error.details?.intentQuoteFailure;
  if (typeof failure !== 'object' || failure === null) return null;
  return failure as IntentQuoteFailure;
};
