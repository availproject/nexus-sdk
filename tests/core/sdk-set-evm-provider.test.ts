import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EthereumProvider } from '../../src';
import { createNexusClient, ExecutionError, NexusError } from '../../src';
import type { MiddlewareClient } from '../../src/transport';
import { makeMiddlewareClient } from '../helpers/middleware-client';

// Capture the exact error object passed to reportOperationError so we can verify it
// matches the public throw. Stub setLoggerProvider so this test stays offline.
const reportOperationErrorSpy = vi.fn();
const setLoggerProviderSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/error-telemetry', () => ({
  reportOperationError: (input: unknown) => reportOperationErrorSpy(input),
  PARAMS_FLATTEN_KEYS: [],
  OPTIONS_FLATTEN_KEYS: [],
}));

vi.mock('../../src/services/telemetry', () => ({
  setLoggerProvider: (...args: unknown[]) => setLoggerProviderSpy(...args),
  telemetryLogger: null,
}));

const buildClient = (provider: EthereumProvider, middlewareOverrides: Partial<MiddlewareClient> = {}) => {
  const middleware = makeMiddlewareClient(middlewareOverrides);
  // createNexusClient takes a config; mocked telemetry above means initialize doesn't actually talk to OTel.
  const client = createNexusClient({
    network: 'mainnet',
    debug: false,
  });
  // We don't need initialize() to succeed for setEVMProvider error tests.
  // Patch the internal middleware client by overriding via the test-only setter — none exists.
  // Instead we just call setEVMProvider directly; it does not require initialize.
  void middleware;
  void provider;
  return client;
};

beforeEach(() => {
  reportOperationErrorSpy.mockReset();
  setLoggerProviderSpy.mockClear();
});

describe('setEVMProvider — telemetry and public throw stay aligned', () => {
  it('emits OTel using the same categorized ExecutionError that is thrown to the caller', async () => {
    const innerFailure = new Error('eth_accounts blew up');
    const failingProvider: EthereumProvider = {
      request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') throw innerFailure;
        if (method === 'eth_requestAccounts') throw innerFailure;
        throw new Error(`Unhandled provider method: ${method}`);
      }),
    } as unknown as EthereumProvider;

    const client = buildClient(failingProvider);

    let thrown: unknown;
    try {
      await client.setEVMProvider(failingProvider);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ExecutionError);
    expect(thrown).toBeInstanceOf(NexusError);
    const thrownErr = thrown as ExecutionError;
    expect(thrownErr.category).toBe('execution');
    expect(thrownErr.code).toBe('execution/error');
    expect(thrownErr.context.service).toBe('wallet');
    expect(thrownErr.context.operation).toBe('setEVMProvider');

    // OTel must see the exact same instance the consumer sees.
    expect(reportOperationErrorSpy).toHaveBeenCalledTimes(1);
    const reported = reportOperationErrorSpy.mock.calls[0][0] as {
      operation: string;
      error: unknown;
    };
    expect(reported.operation).toBe('setEVMProvider');
    expect(reported.error).toBe(thrownErr);
  });

  it('inlines the original error text into the wrapped error message', async () => {
    const innerFailure = new Error('ECONNRESET');
    const failingProvider: EthereumProvider = {
      request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') throw innerFailure;
        throw new Error(`Unhandled provider method: ${method}`);
      }),
    } as unknown as EthereumProvider;

    const client = buildClient(failingProvider);

    let thrown: unknown;
    try {
      await client.setEVMProvider(failingProvider);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ExecutionError);
    // Errors are flat — no cause chain. The original error text is inlined into the
    // top-level message via formatUnknownError.
    expect((thrown as ExecutionError).message).toContain('ECONNRESET');
    expect((thrown as NexusError).cause).toBeUndefined();
  });
});
