import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMiddlewareClient } from '../../src/transport/middleware';

vi.mock('axios', () => ({
  default: {
    create: vi.fn(),
  },
}));

type AxiosInstanceMock = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

type AxiosRootMock = {
  create: ReturnType<typeof vi.fn>;
};

const axiosRootMock = axios as unknown as AxiosRootMock;

const makeClient = (): AxiosInstanceMock => ({
  get: vi.fn(),
  post: vi.fn(),
});

describe('middleware error handling', () => {
  beforeEach(() => {
    axiosRootMock.create.mockReset();
  });

  it('wraps listRFFs response validation errors', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    axiosClient.get.mockResolvedValue({ data: { rffs: [] } });

    const client = createMiddlewareClient('https://mw.example');
    await expect(client.listRFFs()).rejects.toThrow('Failed to list RFFs from middleware');
  });

  it('wraps getBalances response validation errors', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    axiosClient.get.mockResolvedValue({
      data: {
        '1': {
          universe: 'EVM',
          total_usd: '0',
          errored: false,
          currencies: [
            {
              balance: 123,
              token_address: '0x0000000000000000000000000000000000000001',
              value: '0',
            },
          ],
        },
      },
    });

    const client = createMiddlewareClient('https://mw.example');
    await expect(
      client.getBalances('0x0000000000000000000000000000000000000000', 0)
    ).rejects.toThrow('Failed to fetch balances from middleware');
  });
});

// An axios-style error whose response body is the middleware's typed error envelope.
const middlewareEnvelopeError = (over: Record<string, unknown> = {}) =>
  Object.assign(new Error('Request failed with status code 422'), {
    isAxiosError: true,
    response: {
      status: 422,
      data: {
        code: 'TRANSACTION_REVERTED',
        message: 'Swap reverted on chain',
        errorId: 'err-uuid-1',
        subcode: 'TRANSFER_FROM_FAILED',
        details: { source: 'inner-call' },
        ...over,
      },
    },
  });

const quoteRequest = {
  sources: [{ chain_id: '1', contract_address: '0x0000000000000000000000000000000000000001' }],
  destination: { chain_id: '10', contract_address: '0x0000000000000000000000000000000000000002' },
};

describe('middleware typed error envelope capture', () => {
  beforeEach(() => {
    axiosRootMock.create.mockReset();
  });

  it('captures code/subcode/errorId/details from the envelope into BackendError.details', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    axiosClient.post.mockRejectedValue(middlewareEnvelopeError());

    const client = createMiddlewareClient('https://mw.example');
    await expect(client.getQuote(quoteRequest)).rejects.toMatchObject({
      code: 'backend/get_quote_failed',
      details: {
        error: 'Swap reverted on chain',
        middlewareCode: 'TRANSACTION_REVERTED',
        middlewareSubcode: 'TRANSFER_FROM_FAILED',
        errorId: 'err-uuid-1',
        middlewareDetails: { source: 'inner-call' },
      },
    });
  });

  it('falls back to the raw message when the error carries no envelope', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    axiosClient.post.mockRejectedValue(new Error('socket hang up'));

    const client = createMiddlewareClient('https://mw.example');
    const err = await client.getQuote(quoteRequest).catch((e) => e);
    expect(err.code).toBe('backend/get_quote_failed');
    expect(err.details.error).toBe('socket hang up');
    expect(err.details.middlewareCode).toBeUndefined();
    expect(err.details.errorId).toBeUndefined();
  });
});
