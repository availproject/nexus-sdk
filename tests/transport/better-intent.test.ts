import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { createMiddlewareClient } from '../../src/transport/middleware';

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
  fees: { deposit: '0', fulfillment: '0', protocol: '0', solver: '0', caGas: '0' },
  expiry: '2000000000',
  rff: {},
  rffHash: QUOTE_ID,
  signing: {
    type: 'personal_sign',
    messagePrefix: 'Sign this intent to proceed',
    message: '0x12',
    hash: QUOTE_ID,
  },
  allowances: [],
  nativeTransactions: [],
  submitRequirements: {
    requiresIntentSignature: true,
    requiresApprovals: false,
    requiresNativeTxReceipts: false,
  },
});

describe('Better Intent middleware transport', () => {
  beforeEach(() => axiosRoot.create.mockReset());

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
            providers: ['nexus-v2'],
            tokens: [],
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] })
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

    await expect(client.getIntentChains()).resolves.toEqual([
      expect.objectContaining({ id: 1, capabilities: { intent: true, execute: false } }),
    ]);
    await expect(client.getIntentTokens()).resolves.toEqual([]);
    await expect(client.getIntentBalances(ACCOUNT, { refresh: true })).resolves.toEqual({
      errored: false,
      balances: [expect.objectContaining({ balanceRaw: 42n })],
    });
    expect(http.get).toHaveBeenNthCalledWith(1, '/api/v1/better-intent/chains');
    expect(http.get).toHaveBeenNthCalledWith(2, '/api/v1/better-intent/tokens');
    expect(http.get).toHaveBeenNthCalledWith(
      3,
      `/api/v1/better-intent/balances/${ACCOUNT}`,
      { params: { refresh: true } }
    );
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
      rffSignature: '0x12' as Hex,
    };

    expect(quoted.quote.id).toBe(QUOTE_ID);
    expect(quoted.quote).not.toHaveProperty('rff');
    await expect(client.submitIntent(submit)).resolves.toEqual({
      quoteId: QUOTE_ID,
      status: 'created',
    });
    expect(http.post).toHaveBeenNthCalledWith(1, '/api/v1/better-intent/quote', request);
    expect(http.post).toHaveBeenNthCalledWith(2, '/api/v1/better-intent/submit', submit);
  });

  it('normalizes intent lifecycle status', async () => {
    const http = makeAxios();
    axiosRoot.create.mockReturnValue(http);
    http.get.mockResolvedValue({
      data: {
        quoteId: QUOTE_ID,
        provider: 'mayan',
        status: 'fulfilled',
        substatus: 'completed',
        rff: {},
      },
    });

    const client = createMiddlewareClient('https://mw.example');

    await expect(client.getIntentStatus(QUOTE_ID)).resolves.toEqual({
      id: QUOTE_ID,
      provider: 'mayan',
      status: 'fulfilled',
      substatus: 'completed',
    });
    expect(http.get).toHaveBeenCalledWith(`/api/v1/better-intent/status/${QUOTE_ID}`);
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
    expect(result.intents.map(({ provider }) => provider)).toEqual(['mayan', 'nexus-v2']);
    expect(http.get).toHaveBeenCalledWith('/api/v1/better-intent/rffs', {
      params: { user: ACCOUNT, status: 'fulfilled', limit: 20, offset: 0 },
    });
    expect(http.get).toHaveBeenCalledWith('/api/v1/better-intent/rffs-external', {
      params: { user: ACCOUNT, status: 'fulfilled', limit: 20, offset: 0 },
    });
  });
});
