import { describe, expect, it } from 'vitest';
import { BackendError, ERROR_CODES, ValidationError } from '../../../../src/domain/errors';
import type { Snapshot } from './balance-check';
import type { ChainInfo } from './chain-select';
import {
  assembleResult,
  deriveBalanceFields,
  deriveBridgeStatus,
  deriveErrorMsg,
  extractFallbackError,
  formatError,
} from './cron-result';
import type { StressOutcome, StressPayload } from './cron-stress';

const makeSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  mode: 'before',
  capturedAt: '2025-01-01T00:00:00.000Z',
  network: 'testnet',
  token: 'USDC',
  unifiedBalance: '10',
  decimals: 6,
  perChain: [
    { chainId: 1, chainName: 'Eth Sep', balance: '10' },
    { chainId: 2, chainName: 'Arb Sep', balance: '0' },
  ],
  ...overrides,
});

const testChain: ChainInfo = { id: 2, name: 'Arb Sep', symbols: ['USDC', 'ETH'] };

const makeStress = (overrides: Partial<StressOutcome> = {}): StressOutcome => {
  const defaultPayload: StressPayload = {
    operations: [
      {
        id: 0,
        status: 'fulfilled',
        destinationChainId: 2,
        token: 'USDC',
        amount: '0.1',
        durationMs: 5000,
        intentExplorerUrl: 'https://explorer/op/123',
      },
    ],
  };
  return {
    exitCode: 0,
    payload: defaultPayload,
    combinedTail: [],
    ...overrides,
  };
};

describe('formatError', () => {
  it('returns the message for a plain Error (no redundant "Error:" prefix)', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('prefixes typed subclasses with the class name', () => {
    expect(formatError(new TypeError('bad arg'))).toBe('TypeError: bad arg');
    expect(formatError(new RangeError('out of range'))).toBe('RangeError: out of range');
  });

  it('prefixes custom error classes', () => {
    class MiddlewareError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'MiddlewareError';
      }
    }
    expect(formatError(new MiddlewareError('upstream 500'))).toBe('MiddlewareError: upstream 500');
  });

  it('falls back to String() for non-Error throws', () => {
    expect(formatError('raw string')).toBe('raw string');
    expect(formatError(42)).toBe('42');
    expect(formatError(null)).toBe('null');
    expect(formatError({ toString: () => 'thing' })).toBe('thing');
  });

  it('uses String(err) when Error has empty message', () => {
    const e = new Error('');
    expect(formatError(e)).toBe(String(e));
  });

  it('surfaces NexusError code alongside name and message', () => {
    const err = new BackendError(
      ERROR_CODES.BACKEND_RFF_SUBMIT_FAILED,
      'middleware 500: bad response',
      {
        context: { service: 'middleware' },
      }
    );
    expect(formatError(err)).toBe(
      'BackendError[backend/rff_submit_failed]: middleware 500: bad response'
    );
  });

  it('uses the structured code for ValidationError too', () => {
    const err = new ValidationError(ERROR_CODES.INVALID_INPUT, 'bad input', { context: {} });
    expect(formatError(err)).toBe('ValidationError[validation/invalid_input]: bad input');
  });
});

describe('deriveBridgeStatus', () => {
  it('returns "fulfilled" when exit=0 and op fulfilled', () => {
    expect(deriveBridgeStatus(0, 'fulfilled')).toBe('fulfilled');
  });

  it('returns opStatus verbatim when exit != 0 (preserves bash quirk)', () => {
    expect(deriveBridgeStatus(1, 'fulfilled')).toBe('fulfilled');
    expect(deriveBridgeStatus(1, 'failed')).toBe('failed');
    expect(deriveBridgeStatus(2, 'running')).toBe('running');
  });

  it('returns "no-op" when opStatus is missing', () => {
    expect(deriveBridgeStatus(0, undefined)).toBe('no-op');
    expect(deriveBridgeStatus(1, undefined)).toBe('no-op');
  });
});

describe('extractFallbackError', () => {
  it('returns empty string for empty input', () => {
    expect(extractFallbackError([])).toBe('');
  });

  it('returns the last error-shaped line, not the first', () => {
    expect(
      extractFallbackError([
        'logged something',
        'Error: first error',
        'progress update',
        'TypeError: second error',
        'more progress',
      ])
    ).toBe('TypeError: second error');
  });

  it('falls back to last non-empty line when no errors are present', () => {
    expect(extractFallbackError(['line 1', 'line 2', 'line 3'])).toBe('line 3');
  });

  it('matches Error-suffixed identifiers (CustomDomainError: ...)', () => {
    expect(extractFallbackError(['progress', 'CustomDomainError: boom'])).toBe(
      'CustomDomainError: boom'
    );
  });

  it('matches RangeError and TypeError explicitly', () => {
    expect(extractFallbackError(['progress', 'RangeError: bad index'])).toBe(
      'RangeError: bad index'
    );
  });
});

describe('deriveErrorMsg', () => {
  it('uses opError when present, ignoring tail', () => {
    expect(deriveErrorMsg('the error', 'failed', ['Error: from log'])).toBe('the error');
  });

  it('returns undefined when bridge is fulfilled', () => {
    expect(deriveErrorMsg(undefined, 'fulfilled', ['Error: ignored'])).toBeUndefined();
  });

  it('falls back to tail when opError empty and bridge not fulfilled', () => {
    expect(deriveErrorMsg(undefined, 'failed', ['Error: from log'])).toBe('Error: from log');
  });

  it('returns undefined when no fallback is available', () => {
    expect(deriveErrorMsg(undefined, 'failed', [])).toBeUndefined();
  });

  it('returns undefined for empty-string opError (treated as absent)', () => {
    expect(deriveErrorMsg('', 'fulfilled', [])).toBeUndefined();
  });
});

describe('deriveBalanceFields', () => {
  it('returns before_failed when before snapshot errored', () => {
    expect(
      deriveBalanceFields({ error: 'rpc down' }, { snapshot: makeSnapshot() }, 2, '0.1')
    ).toEqual({ balanceStatus: 'before_failed', balanceError: 'rpc down' });
  });

  it('returns mismatch with unifiedBefore when after errored', () => {
    expect(
      deriveBalanceFields(
        { snapshot: makeSnapshot({ unifiedBalance: '10' }) },
        { error: 'timeout' },
        2,
        '0.1'
      )
    ).toEqual({
      balanceStatus: 'mismatch',
      balanceError: 'timeout',
      unifiedBefore: '10',
    });
  });

  it('returns skipped when neither snapshot is present and no errors', () => {
    expect(deriveBalanceFields({}, {}, 2, '0.1')).toEqual({ balanceStatus: 'skipped' });
  });

  it('returns ok when verify passes', () => {
    const before = makeSnapshot({
      unifiedBalance: '10',
      perChain: [{ chainId: 2, chainName: 'Arb', balance: '5' }],
    });
    const after = makeSnapshot({
      mode: 'after',
      unifiedBalance: '10',
      perChain: [{ chainId: 2, chainName: 'Arb', balance: '5.1' }],
    });
    const result = deriveBalanceFields({ snapshot: before }, { snapshot: after }, 2, '0.1');
    expect(result.balanceStatus).toBe('ok');
    expect(result.unifiedBefore).toBe('10');
    expect(result.unifiedAfter).toBe('10');
    expect(Number(result.destDelta)).toBeCloseTo(0.1);
  });

  it('returns mismatch when delta is insufficient (< 0.5× expected)', () => {
    const before = makeSnapshot({
      perChain: [{ chainId: 2, chainName: 'Arb', balance: '5' }],
    });
    const after = makeSnapshot({
      mode: 'after',
      perChain: [{ chainId: 2, chainName: 'Arb', balance: '5.01' }],
    });
    const result = deriveBalanceFields({ snapshot: before }, { snapshot: after }, 2, '0.1');
    expect(result.balanceStatus).toBe('mismatch');
    expect(result.unifiedBefore).toBe('10');
    expect(result.unifiedAfter).toBe('10');
  });
});

describe('assembleResult', () => {
  it('builds a passed result on happy path', () => {
    const before = makeSnapshot({
      perChain: [{ chainId: 2, chainName: 'Arb', balance: '0' }],
    });
    const after = makeSnapshot({
      mode: 'after',
      perChain: [{ chainId: 2, chainName: 'Arb', balance: '0.1' }],
    });
    const result = assembleResult({
      destChain: testChain,
      test: { token: 'USDC', amount: '0.1' },
      before: { snapshot: before },
      after: { snapshot: after },
      stress: makeStress(),
    });
    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.bridgeStatus).toBe('fulfilled');
    expect(result.errorMsg).toBeUndefined();
    expect(result.balanceStatus).toBe('ok');
    expect(result.durationMs).toBe(5000);
    expect(result.intentUrl).toBe('https://explorer/op/123');
  });

  it('builds a failed result with fallback error when stress crashed before op was recorded', () => {
    const result = assembleResult({
      destChain: testChain,
      test: { token: 'USDC', amount: '0.1' },
      before: { error: 'rpc down' },
      after: { error: 'skipped' },
      stress: {
        exitCode: 1,
        payload: {},
        combinedTail: ['some log', 'Error: provider failed to init'],
      },
    });
    expect(result.status).toBe('failed');
    expect(result.bridgeStatus).toBe('no-op');
    expect(result.errorMsg).toBe('Error: provider failed to init');
    expect(result.balanceStatus).toBe('before_failed');
    expect(result.balanceError).toBe('rpc down');
  });

  it('marks bridge as fulfilled even when exitCode != 0 (bash quirk preserved)', () => {
    const result = assembleResult({
      destChain: testChain,
      test: { token: 'USDC', amount: '0.1' },
      before: { snapshot: makeSnapshot() },
      after: { snapshot: makeSnapshot({ mode: 'after' }) },
      stress: makeStress({ exitCode: 1 }),
    });
    expect(result.status).toBe('failed');
    expect(result.bridgeStatus).toBe('fulfilled');
  });
});
