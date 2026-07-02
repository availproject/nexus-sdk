import { describe, expect, it, vi } from 'vitest';
import { installAxiosNetworkTiming } from '../../src/analytics/network-timing';

type InterceptorStore<T> = {
  handlers: Array<T | null>;
  use: (handler: T, rejected?: T) => number;
  eject: (id: number) => void;
};

const makeInterceptorStore = <T>(): InterceptorStore<T> => {
  const handlers: Array<T | null> = [];
  return {
    handlers,
    use: (handler: T) => {
      handlers.push(handler);
      return handlers.length - 1;
    },
    eject: (id: number) => {
      handlers[id] = null;
    },
  };
};

describe('installAxiosNetworkTiming', () => {
  it('starts and ends spans for request/response lifecycle', async () => {
    const request = makeInterceptorStore<(config: any) => any>();
    const responseSuccess = makeInterceptorStore<(response: any) => any>();
    const responseError = makeInterceptorStore<(error: any) => Promise<never>>();

    const client = {
      interceptors: {
        request: {
          use: request.use,
          eject: request.eject,
        },
        response: {
          use: (success: (response: any) => any, error: (err: any) => Promise<never>) => {
            const id = responseSuccess.use(success);
            responseError.use(error);
            return id;
          },
          eject: (id: number) => {
            responseSuccess.eject(id);
            responseError.eject(id);
          },
        },
      },
    } as any;

    const startSpan = vi.fn().mockReturnValue('span_1');
    const endSpan = vi.fn();
    const uninstall = installAxiosNetworkTiming(client, {
      enabled: true,
      timing: {
        startSpan,
        endSpan,
        withSpan: async (_name, fn) => fn(),
      },
    });

    const config = { method: 'get', url: '/api/v1/rffs' };
    const requestHandler = request.handlers[0];
    expect(requestHandler).toBeTypeOf('function');
    const nextConfig = requestHandler!(config);
    expect(nextConfig).toBe(config);

    const successHandler = responseSuccess.handlers[0];
    expect(successHandler).toBeTypeOf('function');
    successHandler!({ config, data: {} });

    expect(startSpan).toHaveBeenCalledWith('network.middleware.request', {
      tags: { method: 'GET', url: '/api/v1/rffs' },
    });
    expect(endSpan).toHaveBeenCalledWith('span_1', { success: true });

    uninstall();
    expect(request.handlers[0]).toBeNull();
    expect(responseSuccess.handlers[0]).toBeNull();
  });
});
