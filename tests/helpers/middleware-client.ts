import type { Hex } from 'viem';
import type { MiddlewareClient } from '../../src/transport';

export const makeMiddlewareClient = (
  overrides: Partial<MiddlewareClient> = {}
): MiddlewareClient => ({
  getDeployment: async () => ({}) as never,
  getIntentChains: async () => [],
  getIntentTokens: async () => [],
  getIntentBalances: async () => ({ balances: [], errored: false }),
  getIntentQuote: async () => {
    throw new Error('getIntentQuote fixture not configured');
  },
  submitIntent: async (request) => ({
    quoteId: request.rffSignature as Hex,
    status: 'created',
  }),
  getIntentStatus: async (id) => ({
    id,
    provider: 'nexus-v2',
    status: 'created',
    substatus: 'awaiting_source_deposit',
  }),
  listIntentHistory: async () => ({ intents: [], total: 0 }),
  configureTiming: () => undefined,
  destroy: () => undefined,
  ...overrides,
});
