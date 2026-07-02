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

describe('middleware simulateBundleV2', () => {
  beforeEach(() => {
    axiosRootMock.create.mockReset();
  });

  it('returns gas as bigints on success', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.post.mockResolvedValue({
      data: [{ gasLimit: '0x10', gasUsed: '0x00' }],
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.simulateBundleV2({
      chainId: '1',
      simulations: [
        {
          stepId: 's1',
          type: 'call',
          from: '0x0000000000000000000000000000000000000000',
          to: '0x0000000000000000000000000000000000000000',
        },
      ],
    });

    expect(result.gas).toEqual([16n]);
    expect(axiosClient.post).toHaveBeenCalledTimes(1);
    expect(axiosClient.post.mock.calls[0]?.[0]).toBe('/api/v1/gas/bundle-v2');
  });

  it('throws when middleware reports failure', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.post.mockResolvedValue({
      data: null,
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');

    await expect(
      client.simulateBundleV2({
        chainId: '1',
        simulations: [
          {
            stepId: 's1',
            type: 'call',
            from: '0x0000000000000000000000000000000000000000',
            to: '0x0000000000000000000000000000000000000000',
          },
        ],
      })
    ).rejects.toThrow('Failed to call simulation middleware');
  });
});
