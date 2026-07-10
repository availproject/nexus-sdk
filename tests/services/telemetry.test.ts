import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OTel SDK before importing the module under test so we observe constructor
// counts rather than running real exporters.
const LoggerProviderCtor = vi.fn();
const OTLPLogExporterCtor = vi.fn();
const BatchLogRecordProcessorCtor = vi.fn();
const setGlobalLoggerProvider = vi.fn();
const getLogger = vi.fn(() => ({ emit: vi.fn() }));

vi.mock('@opentelemetry/sdk-logs', () => ({
  LoggerProvider: class {
    constructor(...args: unknown[]) {
      LoggerProviderCtor(...args);
    }
  },
  BatchLogRecordProcessor: class {
    constructor(...args: unknown[]) {
      BatchLogRecordProcessorCtor(...args);
    }
  },
}));

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: class {
    constructor(...args: unknown[]) {
      OTLPLogExporterCtor(...args);
    }
  },
}));

vi.mock('@opentelemetry/api-logs', async () => {
  const real = await vi.importActual<typeof import('@opentelemetry/api-logs')>('@opentelemetry/api-logs');
  return {
    ...real,
    logs: {
      ...real.logs,
      setGlobalLoggerProvider: (...args: unknown[]) => setGlobalLoggerProvider(...args),
      getLogger: (...args: unknown[]) => getLogger(...args),
    },
  };
});

// Stub the platform helpers so they don't touch real window/localStorage in node.
vi.mock('../../src/services/platform', () => ({
  cryptoGetRandomValues: vi.fn(async (bytes: Uint8Array) => {
    bytes.fill(0);
    return bytes;
  }),
  isBrowser: () => false,
  locationHost: () => 'test-host',
  locationOrigin: () => 'test-origin',
  storageGetItem: vi.fn(() => 'cached-client-id'),
  storageSetItem: vi.fn(),
}));

const networkConfig = {
  NETWORK_HINT: 'testnet',
  MIDDLEWARE_HTTP_URL: 'http://example',
  INTENT_EXPLORER_URL: 'http://example',
} as unknown as Parameters<
  typeof import('../../src/services/telemetry').setLoggerProvider
>[0];

beforeEach(() => {
  LoggerProviderCtor.mockClear();
  OTLPLogExporterCtor.mockClear();
  BatchLogRecordProcessorCtor.mockClear();
  setGlobalLoggerProvider.mockClear();
  getLogger.mockClear();
  // Reset module state so each test starts with telemetryLogger=null + initInFlight=null.
  vi.resetModules();
});

describe('setLoggerProvider — concurrency-safe one-shot init', () => {
  it('only constructs one LoggerProvider when two concurrent first calls race', async () => {
    const { setLoggerProvider } = await import('../../src/services/telemetry');
    await Promise.all([setLoggerProvider(networkConfig), setLoggerProvider(networkConfig)]);
    expect(LoggerProviderCtor).toHaveBeenCalledTimes(1);
    expect(OTLPLogExporterCtor).toHaveBeenCalledTimes(1);
    expect(setGlobalLoggerProvider).toHaveBeenCalledTimes(1);
    expect(getLogger).toHaveBeenCalledTimes(1);
  });

  it('subsequent serial calls are no-ops once the logger is set', async () => {
    const { setLoggerProvider } = await import('../../src/services/telemetry');
    await setLoggerProvider(networkConfig);
    await setLoggerProvider(networkConfig);
    await setLoggerProvider(networkConfig);
    expect(LoggerProviderCtor).toHaveBeenCalledTimes(1);
    expect(setGlobalLoggerProvider).toHaveBeenCalledTimes(1);
  });

  it('three concurrent first calls still only init once', async () => {
    const { setLoggerProvider } = await import('../../src/services/telemetry');
    await Promise.all([
      setLoggerProvider(networkConfig),
      setLoggerProvider(networkConfig),
      setLoggerProvider(networkConfig),
    ]);
    expect(LoggerProviderCtor).toHaveBeenCalledTimes(1);
    expect(setGlobalLoggerProvider).toHaveBeenCalledTimes(1);
  });
});

describe('setLoggerProvider — never blocks SDK usage on init failure', () => {
  it('resolves successfully when LoggerProvider construction throws', async () => {
    LoggerProviderCtor.mockImplementationOnce(() => {
      throw new Error('OTel SDK exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { setLoggerProvider, telemetryLogger } = await import(
        '../../src/services/telemetry'
      );
      // Must not reject — telemetry-init failure is invisible to callers.
      await expect(setLoggerProvider(networkConfig)).resolves.toBeUndefined();
      // The module's exported `telemetryLogger` is captured at import time; what we really
      // care about is that no OTel logger got installed on the global registry.
      expect(setGlobalLoggerProvider).not.toHaveBeenCalled();
      expect(getLogger).not.toHaveBeenCalled();
      expect(telemetryLogger).toBeNull();
      // Failure was logged for debugging.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('Telemetry init failed');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('concurrent failed-init callers all resolve, no caller sees a rejection', async () => {
    LoggerProviderCtor.mockImplementationOnce(() => {
      throw new Error('OTel SDK exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { setLoggerProvider } = await import('../../src/services/telemetry');
      const results = await Promise.allSettled([
        setLoggerProvider(networkConfig),
        setLoggerProvider(networkConfig),
        setLoggerProvider(networkConfig),
      ]);
      for (const r of results) {
        expect(r.status).toBe('fulfilled');
      }
      // Still only one init attempt — concurrent callers share work even on failure.
      expect(LoggerProviderCtor).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('allows a future call to retry after init failure', async () => {
    // First attempt: LoggerProvider throws. Second attempt: succeeds.
    LoggerProviderCtor.mockImplementationOnce(() => {
      throw new Error('OTel SDK exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { setLoggerProvider } = await import('../../src/services/telemetry');
      await setLoggerProvider(networkConfig);
      expect(setGlobalLoggerProvider).not.toHaveBeenCalled(); // first attempt failed mid-init

      // Retry — the lock should have been cleared.
      await setLoggerProvider(networkConfig);
      expect(LoggerProviderCtor).toHaveBeenCalledTimes(2);
      expect(setGlobalLoggerProvider).toHaveBeenCalledTimes(1); // succeeded on retry
      expect(getLogger).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
