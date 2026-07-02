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

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
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

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    await expect(
      client.getBalances('0x0000000000000000000000000000000000000000', 0)
    ).rejects.toThrow('Failed to fetch balances from middleware');
  });
});
