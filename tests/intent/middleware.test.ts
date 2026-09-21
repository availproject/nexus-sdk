import axios, { type AxiosAdapter, type CreateAxiosDefaults } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { createNexusClient } from '../../src';
import { version } from '../../package.json';
import { getIntentQuoteFailure } from '../../src/intent/errors';
import { createMiddlewareClient } from '../../src/intent/middleware';

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const axiosRoot = axios as unknown as { create: ReturnType<typeof vi.fn> };
const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
const TOKEN = '0x00000000000000000000000000000000000000bb' as Hex;
const QUOTE_ID = `0x${'11'.repeat(32)}` as Hex;

const makeAxios = () => ({ get: vi.fn(), post: vi.fn() });

const quoteResponse = () => ({
  quoteId: QUOTE_ID,
  provider: 'nexus-v2',
  tradeType: 'exactOutput',
  input: [],
  output: { chainId: 'EVM_1', tokenAddress: TOKEN, amount: '1' },
  minAmountOut: '1',
  fees: { deposit: '0', fulfillment: '0', protocol: '0', solver: '0' },
  expiry: '2000000000',
  rff: {},
  rffHash: QUOTE_ID,
  allowances: [],
  nativeTransactions: [],
  submitRequirements: {
    requiredSignatures: [{
        kind: 'intent', universe: 'EVM', signingScheme: 'personal_sign',
        data: { messagePrefix: 'Sign this intent to proceed', message: '0x1234', hash: QUOTE_ID },
      }],
    requiresApprovals: false,
    requiresNativeTxReceipts: false,
  },
});

describe('Better Intent middleware transport', () => {
  beforeEach(() => axiosRoot.create.mockReset());

  it('keeps concurrent attempts isolated across quote, submit, status and detail requests', async () => {
    const { default: realAxios } = await vi.importActual<typeof import('axios')>('axios');
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({
      data: config.url?.endsWith('/quote') ? quoteResponse() :
        config.url?.endsWith('/submit') ? { quoteId: QUOTE_ID, status: 'created' } :
        { quoteId: QUOTE_ID, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', rff: {}, legs: [] },
      status: 200, statusText: 'OK', headers: {}, config,
    }));
    axiosRoot.create.mockImplementation((config: CreateAxiosDefaults) => realAxios.create({ ...config, adapter }));
    const mw = createMiddlewareClient('https://middleware.example', { clientId: 'test' });
    const request = { sender: ACCOUNT, tradeType: 'exactOutput' as const, output: { chainId: 'EVM_1', token: TOKEN, amount: '1' } };
    try {
      await Promise.all(['attempt-a', 'attempt-b'].map(async (id) => {
        await mw.getIntentQuote(request, id);
        await mw.getIntentQuote(request, id);
        await mw.submitIntent({ provider: 'nexus-v2', rff: {}, signatures: [] }, id);
        await mw.getIntentStatus(QUOTE_ID, id);
      }));
      for (const id of ['attempt-a', 'attempt-b']) {
        const calls = adapter.mock.calls.filter(([config]) => config.headers.get('x-request-id') === id);
        expect(calls.map(([config]) => config.url?.split('/').slice(4).join('/'))).toEqual([
          'quote', 'quote', 'submit', `status/${QUOTE_ID}`, `rff/${QUOTE_ID}`,
        ]);
      }
      expect(adapter.mock.calls).toHaveLength(10);
      expect(adapter.mock.calls.every(([config]) => !config.data?.includes('attempt-'))).toBe(true);
    } finally { mw.destroy(); }
  });

  it('sends the public client identity on Better Intent requests', async () => {
    const { default: realAxios } = await vi.importActual<typeof import('axios')>('axios');
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({
      data: [],
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));
    axiosRoot.create.mockImplementation((config: CreateAxiosDefaults) =>
      realAxios.create({ ...config, adapter })
    );
    const client = createNexusClient({ clientId: 'My.App', analytics: { enabled: false } });

    try {
      await client.initialize();

      const requests = adapter.mock.calls
        .map(([config]) => config)
        .filter(({ url }) => url?.startsWith('/api/v1/intent/'));
      expect(requests).toHaveLength(1);
      expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/api/v1/intent/chains']);
      expect(requests[0]?.headers.toJSON()).toMatchObject({
        'x-nexus-client-id': 'My.App',
        'x-nexus-surface': 'nexus-sdk',
        'x-nexus-surface-version': version,
      });
    } finally {
      client.destroy();
    }
  });

  it('loads chain metadata without requesting token pages', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get
      .mockResolvedValueOnce({ data: [{
        chainId: 'EVM_1', name: 'Ethereum', providers: ['relay'],
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      }] })
      .mockResolvedValueOnce({ data: { tokens: [], offset: 0, limit: 1000, total: 0 } });
    const chains = await createMiddlewareClient('https://mw.example').getIntentChains();
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(chains[0]).not.toHaveProperty('tokens');
  });

  it('loads and normalizes the provider chain, token, and balance catalogs', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get
      .mockResolvedValueOnce({
        data: [
          {
            chainId: 'EVM_1',
            name: 'Ethereum',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            providers: ['nexus-v2', 'relay'],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: {
          tokens: [{
            universe: 'EVM', chainId: 'EVM_1', address: TOKEN,
            symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false,
            asSource: [{ id: 'mayan', currencyId: 'usdc' }],
            asDestination: [{ id: 'mayan' }],
            permit: { variant: 'eip2612', version: '2' }, sponsoredApproval: true,
          }],
          offset: 0, limit: 1000, total: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          errored: false,
          balances: [
            {
              universe: 'EVM',
              chainId: 'EVM_1',
              address: TOKEN,
              name: 'USD Coin',
              symbol: 'USDC',
              decimals: 6,
              isNative: false,
              providers: [{ id: 'nexus-v2', currencyId: 1 }],
              balance: '42',
              valueUsd: 0,
              priceSource: 'oracle',
              usable: true,
            },
          ],
        },
      });

    const client = createMiddlewareClient('https://mw.example');

    await expect(client.getIntentChains({ providers: ['mayan'] })).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        providers: ['nexus-v2', 'relay'],
        capabilities: { intent: true, execute: false },
      }),
    ]);
    await expect(client.getIntentTokens({ providers: ['mayan'], limit: 1000 })).resolves.toMatchObject({
        tokens: [expect.objectContaining({
          chainId: 1, address: TOKEN,
          asSource: [{ id: 'mayan', currencyId: 'usdc' }],
          permit: { variant: 'eip2612', version: '2' }, sponsoredApproval: true,
        })],
    });
    await expect(
      client.getIntentBalances(ACCOUNT, { refresh: true, providers: ['mayan'] })
    ).resolves.toEqual({
      errored: false,
      balances: [expect.objectContaining({ balanceRaw: 42n })],
    });
    expect(http.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/intent/chains',
      { params: new URLSearchParams('provider=mayan') }
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/intent/tokens',
      { params: new URLSearchParams('provider=mayan&offset=0&limit=1000') }
    );
    expect(http.get).toHaveBeenNthCalledWith(
      3,
      `/api/v1/intent/balances/${ACCOUNT}`,
      { params: { refresh: true, provider: 'mayan' } }
    );
  });

  it('fetches only the requested token page and forwards API filters', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    const token = {
      universe: 'EVM', chainId: 'EVM_1', address: TOKEN,
      symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false,
      asSource: [{ id: 'relay' }], asDestination: [{ id: 'relay' }],
      sponsoredApproval: false,
    };
    http.get.mockResolvedValueOnce({ data: { tokens: [token], offset: 10, limit: 1, total: 100 } });
    const page = await createMiddlewareClient('https://mw.example').getIntentTokens({
      chainId: 1, providers: ['relay', 'mayan'], symbol: 'USDC', name: 'USD',
      contract: TOKEN, offset: 10, limit: 1,
    });
    expect(page).toMatchObject({ tokens: [{ address: TOKEN }], offset: 10, limit: 1, total: 100 });
    expect(http.get).toHaveBeenCalledOnce();
    const params = http.get.mock.calls[0][1].params;
    expect(params.get('chainId')).toBe('EVM_1');
    expect(params.getAll('provider')).toEqual(['relay', 'mayan']);
    for (const [key, value] of Object.entries({ symbol: 'USDC', name: 'USD', contract: TOKEN, offset: '10', limit: '1' })) {
      expect(params.get(key)).toBe(value);
    }
  });

  it('rejects invalid token pagination from the API', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get.mockResolvedValueOnce({ data: { tokens: [], offset: 0, limit: 50, total: 1 } });
    await expect(createMiddlewareClient('https://mw.example').getIntentTokens())
      .rejects.toThrow(/token.*pag/i);
  });

  it('accepts an empty page beyond the end of the token list', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get.mockResolvedValueOnce({ data: { tokens: [], offset: 50, limit: 50, total: 1 } });
    await expect(createMiddlewareClient('https://mw.example').getIntentTokens({ offset: 50 }))
      .resolves.toEqual({ tokens: [], offset: 50, limit: 50, total: 1 });
  });

  it('quotes and submits using the Better Intent wire format', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.post
      .mockResolvedValueOnce({ data: quoteResponse() })
      .mockResolvedValueOnce({ data: { quoteId: QUOTE_ID, status: 'created' } });

    const client = createMiddlewareClient('https://mw.example');
    const request = {
      sender: ACCOUNT,
      tradeType: 'exactOutput' as const,
      output: { chainId: 'EVM_1', token: TOKEN, amount: '1' },
      slippageBps: 50,
    };
    const quoted = await client.getIntentQuote(request);
    const submit = {
      provider: quoted.execution.provider,
      rff: quoted.execution.rff,
      signatures: [{ kind: 'intent' as const, universe: 'EVM' as const, signingScheme: 'personal_sign' as const, signature: `0x${'22'.repeat(65)}` as Hex }],
    };

    expect(quoted.quote.id).toBe(QUOTE_ID);
    expect(quoted.quote).not.toHaveProperty('rff');
    await expect(client.submitIntent(submit)).resolves.toEqual({
      quoteId: QUOTE_ID,
      status: 'created',
    });
    expect(http.post).toHaveBeenNthCalledWith(1, '/api/v1/intent/quote', request, { headers: undefined });
    expect(http.post).toHaveBeenNthCalledWith(2, '/api/v1/intent/submit', submit, { headers: undefined });
  });

  it('exposes structured quote failure diagnostics', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.post.mockRejectedValue({
      response: {
        data: {
          code: 'QUOTE_UNAVAILABLE',
          subcode: 'NO_ROUTABLE_SOURCE',
          message: 'No provider could quote this intent',
          errorId: 'error-123',
          details: {
            sourceVerdicts: [
              {
                chainId: 'EVM_137',
                tokenAddress: TOKEN,
                tokenSymbol: 'USDC',
                state: 'unroutable',
                reason: 'NOT_IN_PROVIDER_CATALOG',
              },
            ],
            providerReasons: ['mayan: token is not supported'],
          },
        },
      },
    });
    const client = createMiddlewareClient('https://mw.example');

    let failure = null;
    try {
      await client.getIntentQuote({
        sender: ACCOUNT,
        tradeType: 'exactOutput',
        output: { chainId: 'EVM_1', token: TOKEN, amount: '1' },
      });
    } catch (error) {
      failure = getIntentQuoteFailure(error);
    }

    expect(failure).toEqual({
      code: 'QUOTE_UNAVAILABLE',
      subcode: 'NO_ROUTABLE_SOURCE',
      errorId: 'error-123',
      retryable: false,
      sourceVerdicts: [
        expect.objectContaining({ chainId: 137, reason: 'NOT_IN_PROVIDER_CATALOG' }),
      ],
      providerReasons: ['mayan: token is not supported'],
      details: {
        sourceVerdicts: [
          {
            chainId: 'EVM_137',
            tokenAddress: TOKEN,
            tokenSymbol: 'USDC',
            state: 'unroutable',
            reason: 'NOT_IN_PROVIDER_CATALOG',
          },
        ],
        providerReasons: ['mayan: token is not supported'],
      },
    });
  });

  it('exposes structured balance and approval-gas quote failures', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.post.mockRejectedValue({
      response: {
        data: {
          code: 'QUOTE_UNAVAILABLE',
          subcode: 'INSUFFICIENT_APPROVAL_GAS',
          message: 'Insufficient gas balance',
          errorId: 'error-456',
          details: { shortfalls: [{ chainId: 137, required: '10', actual: '0' }] },
        },
      },
    });
    const client = createMiddlewareClient('https://mw.example');

    let failure = null;
    try {
      await client.getIntentQuote({
        sender: ACCOUNT,
        tradeType: 'exactInput',
        input: [{ chainId: 'EVM_137', token: TOKEN, amount: '1' }],
        output: { chainId: 'EVM_1', token: TOKEN },
      });
    } catch (error) {
      failure = getIntentQuoteFailure(error);
    }

    expect(failure).toMatchObject({
      subcode: 'INSUFFICIENT_APPROVAL_GAS',
      retryable: false,
      details: { shortfalls: [{ chainId: 137, required: '10', actual: '0' }] },
    });
  });

  it('serializes directional chain constraints as repeated query parameters', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get.mockResolvedValue({ data: [] });
    const client = createMiddlewareClient('https://mw.example');

    await client.getIntentChains({
      providers: ['nexus-v2', 'mayan'],
      sources: [
        { chainId: 10, tokenAddress: TOKEN, amountRaw: 1_000_000n },
        { chainId: 137, tokenAddress: TOKEN, amountRaw: 2_000_000n },
      ],
      destinations: [{ chainId: 8453, tokenAddress: TOKEN }],
    });

    const params = http.get.mock.calls[0]?.[1]?.params as URLSearchParams;
    expect(params.getAll('provider')).toEqual(['nexus-v2', 'mayan']);
    expect(params.getAll('sourceChain')).toEqual(['EVM_10', 'EVM_137']);
    expect(params.getAll('sourceToken')).toEqual([TOKEN, TOKEN]);
    expect(params.getAll('sourceAmount')).toEqual(['1000000', '2000000']);
    expect(params.getAll('destinationChain')).toEqual(['EVM_8453']);
  });

  it('normalizes intent lifecycle status', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get.mockImplementation(async (url: string) => ({
      data: url.includes('/status/')
        ? {
            quoteId: QUOTE_ID,
            provider: 'relay',
            status: 'fulfilled',
            substatus: 'completed',
            progress: { kind: 'completed' },
            rff: {},
          }
        : {
            request_hash: QUOTE_ID,
            status: 'fulfilled',
            legs: [
              {
                sourceIndex: 0,
                status: 'fulfilled',
                txHash: `0x${'33'.repeat(32)}`,
                explorerLink: 'https://optimistic.etherscan.io/tx/0x33',
                protocolExplorerLink: 'https://relay.link/transaction/0x33',
                error: null,
              },
            ],
          },
    }));

    const client = createMiddlewareClient('https://mw.example');

    await expect(client.getIntentStatus(QUOTE_ID)).resolves.toEqual({
      id: QUOTE_ID,
      provider: 'relay',
      status: 'fulfilled',
      substatus: 'completed',
      legs: [
        {
          sourceIndex: 0,
          status: 'fulfilled',
          txHash: `0x${'33'.repeat(32)}`,
          txExplorerUrl: 'https://optimistic.etherscan.io/tx/0x33',
          protocolExplorerUrl: 'https://relay.link/transaction/0x33',
        },
      ],
    });
    expect(http.get).toHaveBeenCalledWith(`/api/v1/intent/status/${QUOTE_ID}`, { headers: undefined });
    expect(http.get).toHaveBeenCalledWith(`/api/v1/intent/rff/${QUOTE_ID}`, { headers: undefined });
  });

  it('merges Nexus and external intent history behind one request', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get.mockImplementation(async (url: string) => ({
      data: {
        rffs: [
          {
            request_hash: url.endsWith('rffs-external') ? `0x${'22'.repeat(32)}` : QUOTE_ID,
            status: 'fulfilled',
            solver: null,
            created_at: url.endsWith('rffs-external') ? 20 : 10,
            updated_at: url.endsWith('rffs-external') ? 21 : 11,
            request: {},
          },
        ],
        total: 1,
      },
    }));

    const client = createMiddlewareClient('https://mw.example');
    const result = await client.listIntentHistory({
      user: ACCOUNT,
      status: 'fulfilled',
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.intents.map(({ provider }) => provider)).toEqual([undefined, 'nexus-v2']);
    expect(http.get).toHaveBeenCalledWith('/api/v1/intent/rffs', {
      params: { user: ACCOUNT, status: 'fulfilled', limit: 20, offset: 0 },
    });
    expect(http.get).toHaveBeenCalledWith('/api/v1/intent/rffs-external', {
      params: { user: ACCOUNT, status: 'fulfilled', limit: 20, offset: 0 },
    });
  });
});
