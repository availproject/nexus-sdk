import type {
  MiddlewareBridgeAndExecuteClient,
  MiddlewareClient,
  MiddlewareSwapClient,
  MiddlewareSwapExecutionClient,
} from '../../src/transport';

export const makeMiddlewareClient = (
  overrides: Partial<MiddlewareClient> = {}
): MiddlewareClient => ({
  getBalances: async () => [],
  getSwapBalances: async () => [],
  getOraclePrices: async () => [],
  createApprovals: async () => [],
  listRFFs: async () => ({ rffs: [], total: 0 }),
  submitRFF: async () => ({ request_hash: '0x' }),
  getRFF: async () => ({
    request: {
      sources: [],
      destination_universe: 'EVM',
      destination_chain_id: '0x',
      recipient_address: '0x',
      destinations: [],
      nonce: '0x',
      expiry: '0x',
      parties: [],
    },
    request_hash: '0x',
    status: 'created',
    solver: null,
  }),
  getRFFStatus: async () => ({ status: 'created' }),
  getDeployment: async () => ({}) as never,
  simulateBundleV2: async () => ({ gas: [] }),
  getLiFiQuote: async () => ({}),
  getBebopQuote: async () => ({}),
  getFibrousQuote: async () => ({}),
  getFibrousRoute: async () => ({}),
  getLiFiTokenPrice: async () => null,
  getRelayTokenPrice: async () => null,
  submitSBCs: async () => [],
  getQuote: async () => ({
    fulfillmentBps: 0,
    sources: [],
    destination: {
      chainId: 0,
      tokenAddress: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      fulfillmentFeeUsd: '0',
      fulfillmentFeeToken: '0',
    },
  }),
  getBridgeProvider: async () => ({ provider: "nexus" }),
  // Echo each requested leg back as its own quote (index- and chain/token-aligned), with
  // effectiveAmountIn64 == the requested amount — Mayan's behaviour for a like-for-like leg. The
  // empty default threw "Mayan quote response length mismatch" for any real leg; override per test
  // to assert specific quote fields.
  getMayanQuotes: async (request) => ({
    destination: { chainId: 0, tokenAddress: '0x' },
    quotes: request.sources.map((source) => ({
      source: {
        chainId: Number(BigInt(source.chain_id)),
        tokenAddress: source.contract_address,
        amount: source.amount,
      },
      mayanQuote: {
        minReceived: 0,
        deadline64: '0',
        protocolBps: 0,
        effectiveAmountIn64: source.amount,
      },
    })) as never,
  }),
  reportMayanNativeTx: async () => ({success: true}),
  configureTiming: () => {},
  destroy: () => {},
  ...overrides,
});

export const makeBridgeAndExecuteMiddlewareClient = (
  overrides: Partial<MiddlewareBridgeAndExecuteClient> = {}
): MiddlewareBridgeAndExecuteClient => makeMiddlewareClient(overrides);

export const makeSwapMiddlewareClient = (
  overrides: Partial<MiddlewareSwapClient> = {}
): MiddlewareSwapClient => makeMiddlewareClient(overrides);

export const makeSwapExecutionMiddlewareClient = (
  overrides: Partial<MiddlewareSwapExecutionClient> = {}
): MiddlewareSwapExecutionClient => makeMiddlewareClient(overrides);
