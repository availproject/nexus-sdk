import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalsByChain } from '@avail-project/nexus-types';
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

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor() {}
}

describe('middleware approvals', () => {
  const realWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    axiosRootMock.create.mockReturnValue(makeClient());
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = realWebSocket;
    vi.useRealTimers();
  });

  it('rejects when approval websocket times out', async () => {
    vi.useFakeTimers();
    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const approvals: ApprovalsByChain = {
      1: [
        {
          address: '0x0000000000000000000000000000000000000000',
          ops: [],
        },
      ],
    };

    const promise = client.createApprovals(approvals);
    const assertion = expect(promise).rejects.toThrow('WebSocket timeout');
    await vi.advanceTimersByTimeAsync(120000);
    await assertion;
  });
});
