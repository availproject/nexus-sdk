import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackendError,
  ERROR_CODES,
  ExecutionError,
  ExternalServiceError,
} from '../../src/domain/errors';

// ── Telemetry module mock — captured by the hoisted vi.mock factory below.
// `currentLogger` is mutable so individual tests can set it to null (pre-init) or
// rebind the emit spy.
const emit = vi.fn();
let currentLogger: { emit: typeof emit } | null = { emit };

vi.mock('../../src/services/telemetry', () => ({
  get telemetryLogger() {
    return currentLogger;
  },
  setLoggerProvider: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER the mock declaration so the mocked binding is in place.
import {
  OPTIONS_FLATTEN_KEYS,
  PARAMS_FLATTEN_KEYS,
  reportOperationError,
} from '../../src/services/error-telemetry';

beforeEach(() => {
  emit.mockReset();
  currentLogger = { emit };
});

const getAttributes = (): Record<string, unknown> => {
  expect(emit).toHaveBeenCalledTimes(1);
  return emit.mock.calls[0][0].attributes as Record<string, unknown>;
};

describe('reportOperationError — basic emission', () => {
  it('no-ops silently when telemetryLogger is null', () => {
    currentLogger = null;
    expect(() =>
      reportOperationError({
        operation: 'bridge',
        operationId: 'op_1',
        error: new Error('x'),
      }),
    ).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits operation, operation.id, and error.* identity attributes for a NexusError', () => {
    const err = new BackendError(
      ERROR_CODES.BACKEND_BALANCES_FETCH_FAILED,
      'fetch failed',
      { context: { service: 'middleware' } },
    );
    reportOperationError({
      operation: 'getBalancesForBridge',
      operationId: 'op_1',
      error: err,
    });
    const attrs = getAttributes();
    expect(attrs.operation).toBe('getBalancesForBridge');
    expect(attrs['operation.id']).toBe('op_1');
    expect(attrs['error.name']).toBe('BackendError');
    expect(attrs['error.category']).toBe('backend');
    expect(attrs['error.code']).toBe('backend/balances_fetch_failed');
    expect(attrs['error.service']).toBe('middleware');
    expect(attrs['error.message']).toBe('fetch failed');
  });

  it('emits sensible defaults for a plain Error (no category/code/service)', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      error: new Error('boom'),
    });
    const attrs = getAttributes();
    expect(attrs['error.name']).toBe('Error');
    expect(attrs['error.message']).toBe('boom');
    expect(attrs['error.category']).toBeUndefined();
    expect(attrs['error.code']).toBeUndefined();
    expect(attrs['error.service']).toBeUndefined();
  });

  it('redacts long data/calldata hex in top-level error.details', () => {
    const longHex = `0x${'01'.repeat(200)}`;
    const err = new ExecutionError(ERROR_CODES.EXEC_TX_SEND_FAILED, 'send failed', {
      context: { service: 'wallet' },
      details: { data: longHex, calldata: longHex, signature: '0xdeadbeefSECRET' },
    });
    reportOperationError({ operation: 'bridge', operationId: 'op_1', error: err });
    const details = String(getAttributes()['error.details']);
    expect(details).toContain('[hex:402B]');
    expect(details).toContain('[redacted]');
    expect(details).not.toContain(longHex);
    expect(details).not.toContain('SECRET');
  });

  it('does not emit a cause chain or rootCause', () => {
    const err = new BackendError(ERROR_CODES.BACKEND_BALANCES_FETCH_FAILED, 'fetch failed', {
      context: { service: 'middleware' },
    });
    reportOperationError({ operation: 'bridge', operationId: 'op_1', error: err });
    const attrs = getAttributes();
    expect(attrs['error.chain']).toBeUndefined();
    expect(attrs['error.rootCause.name']).toBeUndefined();
    expect(attrs['error.rootCause.message']).toBeUndefined();
  });

  it('swallows emit failures without throwing', () => {
    emit.mockImplementation(() => {
      throw new Error('emit blew up');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        reportOperationError({
          operation: 'bridge',
          operationId: 'op_1',
          error: new Error('x'),
        }),
      ).not.toThrow();
      // The fallback console.error fires exactly once with the wrapping context.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('reportOperationError: emit failed');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('reportOperationError — error.context.* nested attributes', () => {
  it('emits stepId, stepType, chainId from context when present', () => {
    const err = new ExecutionError(
      ERROR_CODES.EXEC_TX_SEND_FAILED,
      'send failed',
      {
        context: {
          service: 'wallet',
          stepId: 'execute_transaction:8453',
          stepType: 'execute_transaction',
          chainId: 8453,
        },
      },
    );
    reportOperationError({ operation: 'execute', operationId: 'op_1', error: err });
    const attrs = getAttributes();
    expect(attrs['error.context.stepId']).toBe('execute_transaction:8453');
    expect(attrs['error.context.stepType']).toBe('execute_transaction');
    expect(attrs['error.context.chainId']).toBe(8453);
  });

  it('omits context.* attributes when fields are absent', () => {
    const err = new ExecutionError(ERROR_CODES.EXECUTION_ERROR, 'x', {
      context: { service: 'rpc' },
    });
    reportOperationError({ operation: 'execute', operationId: 'op_1', error: err });
    const attrs = getAttributes();
    expect(attrs['error.context.stepId']).toBeUndefined();
    expect(attrs['error.context.stepType']).toBeUndefined();
    expect(attrs['error.context.chainId']).toBeUndefined();
  });
});

describe('sanitizer — applied to params + options before flattening', () => {
  const baseErr = () => new Error('x');

  it('bigint becomes string', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: { toAmountRaw: 1_000_000n, toChainId: 137 },
      error: baseErr(),
    });
    const attrs = getAttributes();
    expect(attrs['params.toAmountRaw']).toBe('1000000');
    expect(attrs['params.toChainId']).toBe(137);
  });

  it('hex >12 chars is truncated to first-6 / last-4', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: { recipient: '0xAB12CDEF34567890ABCDEF12345678901234567A' },
      error: baseErr(),
    });
    const attrs = getAttributes();
    expect(attrs['params.recipient']).toBe('0xAB12…567A');
  });

  it('short hex passes through unchanged', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: { recipient: '0xabcd' },
      error: baseErr(),
    });
    const attrs = getAttributes();
    expect(attrs['params.recipient']).toBe('0xabcd');
  });

  it('keys named data/calldata/abi/bytecode become [hex:NB] when value is hex >12', () => {
    const longHex = `0x${'01'.repeat(200)}`;
    reportOperationError({
      operation: 'execute',
      operationId: 'op_1',
      params: { data: longHex, calldata: longHex, abi: longHex, bytecode: longHex },
      error: baseErr(),
    });
    const attrs = getAttributes();
    expect(JSON.stringify(attrs)).toContain('[hex:402B]');
  });

  it('signature/privateKey/mnemonic keys are redacted', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: {
        signature: '0xdeadbeef',
        signatures: ['0xdead'],
        privateKey: '0xsecret',
        mnemonic: 'twelve word seed phrase here',
      },
      error: baseErr(),
    });
    const attrs = getAttributes();
    const raw = String(attrs['params.raw']);
    expect(raw).toContain('[redacted]');
    expect(raw).not.toContain('0xdeadbeef');
    expect(raw).not.toContain('0xsecret');
    expect(raw).not.toContain('twelve word seed');
  });

  it('functions and provider-like objects are dropped', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: {
        toChainId: 137,
        callback: () => 'nope',
        provider: { request: () => {}, send: () => {} },
        promise: Promise.resolve('x'),
      },
      error: baseErr(),
    });
    const attrs = getAttributes();
    const raw = String(attrs['params.raw']);
    expect(raw).not.toContain('nope');
    expect(raw).not.toContain('provider');
    expect(raw).not.toContain('promise');
    expect(attrs['params.toChainId']).toBe(137);
  });

  it('caps recursion at depth 4', () => {
    const deep: Record<string, unknown> = {};
    let cur: Record<string, unknown> = deep;
    for (let i = 0; i < 10; i += 1) {
      cur.nested = {};
      cur = cur.nested as Record<string, unknown>;
    }
    cur.leaf = 'deepest';
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: deep,
      error: baseErr(),
    });
    const attrs = getAttributes();
    const raw = String(attrs['params.raw']);
    expect(raw).toContain('[depth>4]');
    expect(raw).not.toContain('deepest');
  });

  it('arrays longer than 32 keep first 32 plus …(N more) marker', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: { sources: Array.from({ length: 50 }, (_, i) => i) },
      error: baseErr(),
    });
    const attrs = getAttributes();
    const raw = String(attrs['params.raw']);
    expect(raw).toContain('…(18 more)');
  });
});

describe('flattening allow-list — real public field names', () => {
  it('emits each allow-listed params key as a top-level params.<key> attribute', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: {
        toChainId: 137,
        toTokenSymbol: 'USDC',
        toAmountRaw: 1_000_000n,
        recipient: '0xAB12CDEF34567890ABCDEF12345678901234567A',
        unrelated: 'should-stay-in-raw-only',
      },
      error: new Error('x'),
    });
    const attrs = getAttributes();
    expect(attrs['params.toChainId']).toBe(137);
    expect(attrs['params.toTokenSymbol']).toBe('USDC');
    expect(attrs['params.toAmountRaw']).toBe('1000000');
    expect(attrs['params.recipient']).toBe('0xAB12…567A');
    expect(attrs['params.unrelated']).toBeUndefined();
    const raw = String(attrs['params.raw']);
    expect(raw).toContain('unrelated');
    expect(raw).toContain('should-stay-in-raw-only');
  });

  it('emits each allow-listed options key as a top-level options.<key> attribute', () => {
    reportOperationError({
      operation: 'swapWithExactIn',
      operationId: 'op_1',
      options: {
        slippageTolerance: 50,
        fillTimeoutMinutes: 30,
        extras: 'should-stay-in-raw-only',
      },
      error: new Error('x'),
    });
    const attrs = getAttributes();
    expect(attrs['options.slippageTolerance']).toBe(50);
    expect(attrs['options.fillTimeoutMinutes']).toBe(30);
    expect(attrs['options.extras']).toBeUndefined();
  });

  it('does NOT emit rev-8-era invented field names as top-level attributes', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: {
        toChainId: 137,
        toToken: 'should-not-flatten',
        fromChainId: 42161,
      },
      options: { slippage: 50, timeout: 300 },
      error: new Error('x'),
    });
    const attrs = getAttributes();
    expect(attrs['params.toToken']).toBeUndefined();
    expect(attrs['params.fromChainId']).toBeUndefined();
    expect(attrs['params.walletMode']).toBeUndefined();
    expect(attrs['options.slippage']).toBeUndefined();
    expect(attrs['options.timeout']).toBeUndefined();
  });

  it('omits the params.<key> / options.<key> attribute when the value is undefined', () => {
    reportOperationError({
      operation: 'execute',
      operationId: 'op_1',
      params: { toChainId: 137, transactionTimeout: undefined },
      options: { fillTimeoutMinutes: undefined },
      error: new Error('x'),
    });
    const attrs = getAttributes();
    expect(attrs['params.toChainId']).toBe(137);
    expect(attrs['params.transactionTimeout']).toBeUndefined();
    expect(attrs['options.fillTimeoutMinutes']).toBeUndefined();
  });

  it('always emits params.raw / options.raw, even with no allow-listed keys present', () => {
    reportOperationError({
      operation: 'bridge',
      operationId: 'op_1',
      params: { only: 'forensic-data' },
      options: { only: 'forensic-options' },
      error: new Error('x'),
    });
    const attrs = getAttributes();
    expect(typeof attrs['params.raw']).toBe('string');
    expect(typeof attrs['options.raw']).toBe('string');
    expect(String(attrs['params.raw'])).toContain('forensic-data');
    expect(String(attrs['options.raw'])).toContain('forensic-options');
  });

  it('omits params.* and options.* entirely when neither was passed', () => {
    reportOperationError({
      operation: 'initialize',
      operationId: 'op_1',
      error: new Error('x'),
    });
    const attrs = getAttributes();
    expect(attrs['params.raw']).toBeUndefined();
    expect(attrs['options.raw']).toBeUndefined();
  });
});

describe('allow-list constants — guard the contract', () => {
  it('PARAMS_FLATTEN_KEYS contains the real public param fields', () => {
    expect(PARAMS_FLATTEN_KEYS).toEqual(
      expect.arrayContaining([
        'toChainId',
        'toTokenSymbol',
        'toTokenAddress',
        'toAmountRaw',
        'toNativeAmountRaw',
        'recipient',
        'sources',
        'to',
        'gasPrice',
        'enableTransactionPolling',
        'transactionTimeout',
        'waitForReceipt',
        'receiptTimeout',
        'requiredConfirmations',
        'recentApprovalTxHash',
      ]),
    );
  });

  it('OPTIONS_FLATTEN_KEYS contains the real public option fields', () => {
    expect(OPTIONS_FLATTEN_KEYS).toEqual(
      expect.arrayContaining(['fillTimeoutMinutes', 'slippageTolerance']),
    );
  });

  it('rev-8-era invented field names are NOT in the allow-list', () => {
    const forbidden = [
      'toToken',
      'fromToken',
      'fromChainId',
      'fromAmountRaw',
      'walletMode',
      'mode',
      'slippage',
      'timeout',
      'enableTracking',
    ];
    for (const name of forbidden) {
      expect(PARAMS_FLATTEN_KEYS).not.toContain(name);
      expect(OPTIONS_FLATTEN_KEYS).not.toContain(name);
    }
  });
});

describe('reportOperationError — error.service propagation for ExternalServiceError', () => {
  it('lifts service=coinbase for Coinbase pricing failures', () => {
    const err = new ExternalServiceError(
      ERROR_CODES.EXTERNAL_EXCHANGE_RATE_FETCH_FAILED,
      'rates fetch failed',
      { context: { service: 'coinbase' } },
    );
    reportOperationError({
      operation: 'getCoinbaseRates',
      operationId: 'no_analytics',
      error: err,
    });
    const attrs = getAttributes();
    expect(attrs['error.category']).toBe('external_service');
    expect(attrs['error.service']).toBe('coinbase');
    expect(attrs['operation.id']).toBe('no_analytics');
  });
});
