import { describe, expect, it } from 'vitest';
import { BackendError, ERROR_CODES, Errors } from '../../src/domain/errors';
import { getErrorReportingProperties } from '../../src/services/error-reporting';

describe('internal reporting reasons', () => {
  it.each([
    [ERROR_CODES.BACKEND_NO_ROUTABLE_SOURCE, 'unsupported_route'],
    [ERROR_CODES.BACKEND_INTENT_REFUSED, 'quote_unavailable'],
    [ERROR_CODES.BACKEND_INSUFFICIENT_BALANCE, 'insufficient_funds'],
    [ERROR_CODES.BACKEND_INSUFFICIENT_APPROVAL_GAS, 'insufficient_gas'],
    [ERROR_CODES.BACKEND_QUOTE_PRICE_OUTLIER, 'pricing'],
    [ERROR_CODES.BACKEND_INVALID_PERMIT_SIGNATURE, 'signature'],
    [ERROR_CODES.BACKEND_RATE_LIMITED, 'rate_limited'],
    [ERROR_CODES.BACKEND_UPSTREAM_TIMEOUT, 'timeout'],
    [ERROR_CODES.BACKEND_NETWORK_ERROR, 'network'],
  ])('maps %s without changing the public error', (code, bucket) => {
    const error = new BackendError(code, 'display message', { context: { service: 'middleware' },
      details: { errorId: 'middleware-123', middlewareSubcode: 'sensitive future value' } });
    expect(getErrorReportingProperties(error)).toEqual({
      'error.code': bucket, 'error.type': code, 'error.category': 'backend',
      'error.service': 'middleware',
    });
    expect(error.message).toBe('display message');
    expect(error.code).toBe(code);
  });

  it('does not classify arbitrary text as user rejection or expose it as a bucket', () => {
    expect(getErrorReportingProperties(new Error('User rejected the intent.'))).toEqual({
      'error.code': 'unknown',
    });
    expect(getErrorReportingProperties(Errors.userDeniedIntent())).toMatchObject({
      'error.code': 'user_declined', 'error.type': ERROR_CODES.USER_INTENT_HOOK_DENIED, 'error.category': 'user_action',
    });
  });

  it('uses bounded local diagnostics when a public code is shared by several conditions', () => {
    expect(getErrorReportingProperties(Errors.invalidInput('No common provider', { reasonBucket: 'unsupported_route' })))
      .toMatchObject({ 'error.code': 'unsupported_route', 'error.type': ERROR_CODES.INVALID_INPUT });
    expect(getErrorReportingProperties(Errors.invalidInput('Bad input', { reasonBucket: 'arbitrary text' })))
      .toMatchObject({ 'error.code': 'invalid_request' });
  });
});
