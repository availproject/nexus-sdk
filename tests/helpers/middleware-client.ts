import type { Hex } from 'viem';
import type { MiddlewareClient } from '../../src/intent/middleware';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from './catalog';

export const makeMiddlewareClient = (
  overrides: Partial<MiddlewareClient> = {}
): MiddlewareClient => ({
  getIntentChains: async () => [],
  getIntentTokens: makeTokenFetcher(testChains),
  getIntentBalances: async () => ({ balances: [], errored: false }),
  getIntentQuote: async () => {
    throw new Error('getIntentQuote fixture not configured');
  },
  submitIntent: async (request) => ({
    quoteId: request.rff.quoteId as Hex,
    status: 'created',
  }),
  getIntentStatus: async (id) => ({
    id,
    provider: 'nexus-v2',
    status: 'created',
    substatus: 'awaiting_source_deposit',
    legs: [],
  }),
  listIntentHistory: async () => ({ intents: [], total: 0 }),
  configureTiming: () => undefined,
  destroy: () => undefined,
  ...overrides,
});
