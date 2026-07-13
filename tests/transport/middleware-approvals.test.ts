import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalsByChain } from '@avail-project/nexus-types';
import type { Hex } from 'viem';
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

const address = '0x0000000000000000000000000000000000000aaa' as Hex;
const approvals: ApprovalsByChain = {
  1: [{ address, ops: [] } as never],
};

describe('middleware approvals', () => {
  beforeEach(() => {
    axiosRootMock.create.mockReset();
  });

  it('posts to /api/v2/create-sponsored-approvals and returns parsed results', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    const txHash =
      '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
    axiosClient.post.mockResolvedValue({
      data: [{ chainId: 1, address, errored: false, txHash }],
    });

    const client = createMiddlewareClient('https://mw.example');
    const results = await client.createApprovals(approvals);

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/api/v2/create-sponsored-approvals',
      approvals
    );
    expect(results).toEqual([{ chainId: 1, address, errored: false, txHash }]);
  });

  it('wraps a failed request as a BackendError carrying the typed envelope', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    axiosClient.post.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 502'), {
        isAxiosError: true,
        response: {
          status: 502,
          data: {
            code: 'UPSTREAM_ERROR',
            message: 'relayer down',
            errorId: 'err-approve-1',
          },
        },
      })
    );

    const client = createMiddlewareClient('https://mw.example');
    const err = await client.createApprovals(approvals).catch((e) => e);
    expect(err.code).toBe('backend/approvals_ws_failed');
    expect(err.details).toMatchObject({
      middlewareCode: 'UPSTREAM_ERROR',
      errorId: 'err-approve-1',
    });
  });
});
