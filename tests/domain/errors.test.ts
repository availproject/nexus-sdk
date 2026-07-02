import { describe, expect, it } from 'vitest';
import {
  BackendError,
  ERROR_CODES,
  Errors,
  ExecutionError,
  ExternalServiceError,
  InternalError,
  NexusError,
  SimulationError,
  UserActionError,
  ValidationError,
} from '../../src/domain/errors';

describe('NexusError subclasses', () => {
  it('ValidationError carries category, code, name, and no service', () => {
    const err = new ValidationError(ERROR_CODES.VALIDATION_ERROR, 'bad input', {
      context: {},
    });
    expect(err).toBeInstanceOf(NexusError);
    expect(err.category).toBe('validation');
    expect(err.code).toBe('validation/error');
    expect(err.name).toBe('ValidationError');
    expect(err.context.service).toBeUndefined();
  });

  it('BackendError requires service=middleware in context', () => {
    const err = new BackendError(ERROR_CODES.BACKEND_BALANCES_FETCH_FAILED, 'fetch failed', {
      context: { service: 'middleware' },
    });
    expect(err.category).toBe('backend');
    expect(err.context.service).toBe('middleware');
    expect(err.code).toBe('backend/balances_fetch_failed');
  });

  it('ExecutionError carries either wallet or rpc service', () => {
    const wallet = new ExecutionError(ERROR_CODES.EXEC_TX_SEND_FAILED, 'send failed', {
      context: { service: 'wallet' },
    });
    const rpc = new ExecutionError(ERROR_CODES.EXEC_GAS_ESTIMATE_FAILED, 'estimate failed', {
      context: { service: 'rpc' },
    });
    expect(wallet.context.service).toBe('wallet');
    expect(rpc.context.service).toBe('rpc');
  });

  it('UserActionError supports wallet and hook services', () => {
    const wallet = new UserActionError(
      ERROR_CODES.USER_INTENT_SIGNATURE_DENIED,
      'rejected sig',
      { context: { service: 'wallet' } },
    );
    const hook = new UserActionError(ERROR_CODES.USER_INTENT_HOOK_DENIED, 'rejected hook', {
      context: { service: 'hook' },
    });
    expect(wallet.context.service).toBe('wallet');
    expect(hook.context.service).toBe('hook');
  });

  it('ExternalServiceError supports lifi, bebop, and coinbase', () => {
    const coinbase = new ExternalServiceError(
      ERROR_CODES.EXTERNAL_EXCHANGE_RATE_FETCH_FAILED,
      'oh no',
      { context: { service: 'coinbase' } },
    );
    expect(coinbase.category).toBe('external_service');
    expect(coinbase.context.service).toBe('coinbase');
  });

  it('InternalError accepts no service field', () => {
    const err = new InternalError(ERROR_CODES.INTERNAL_ERROR, 'invariant', { context: {} });
    expect(err.category).toBe('internal');
    expect(err.context.service).toBeUndefined();
  });

  it('SimulationError requires service=rpc', () => {
    const err = new SimulationError(ERROR_CODES.SIMULATION_ETH_CALL_FAILED, 'sim failed', {
      context: { service: 'rpc' },
    });
    expect(err.category).toBe('simulation');
    expect(err.context.service).toBe('rpc');
  });
});

describe('NexusError is flat (no cause chain)', () => {
  it('does not capture native cause', () => {
    const err = new InternalError(ERROR_CODES.INTERNAL_ERROR, 'outer', { context: {} });
    expect(err.cause).toBeUndefined();
  });

  it('toJSON returns a flat single-level object', () => {
    const err = new BackendError(ERROR_CODES.BACKEND_BALANCES_FETCH_FAILED, 'failed', {
      context: { service: 'middleware', chainId: 8453 },
      details: { foo: 'bar' },
    });
    const json = err.toJSON() as Record<string, unknown>;
    expect(json.name).toBe('BackendError');
    expect(json.code).toBe('backend/balances_fetch_failed');
    expect(json.category).toBe('backend');
    expect(json.message).toBe('failed');
    expect(json.context).toEqual({ service: 'middleware', chainId: 8453 });
    expect(json.details).toEqual({ foo: 'bar' });
    expect('cause' in json).toBe(false);
  });

  it('has no chain-walking methods', () => {
    const err = new InternalError(ERROR_CODES.INTERNAL_ERROR, 'x', { context: {} });
    expect((err as unknown as { walk?: unknown }).walk).toBeUndefined();
    expect((err as unknown as { find?: unknown }).find).toBeUndefined();
  });
});

describe('Errors.* wrap helpers categorize a failure (no cause capture)', () => {
  it('backend produces BackendError with service=middleware and no prefix', () => {
    const err = Errors.backend('GET balances failed: boom', {
      service: 'middleware',
      stepId: 's1',
      chainId: 8453,
    });
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('backend/error');
    expect(err.message).toBe('GET balances failed: boom');
    expect(err.context.service).toBe('middleware');
    expect(err.context.stepId).toBe('s1');
    expect(err.context.chainId).toBe(8453);
    expect(err.cause).toBeUndefined();
  });

  it('execution picks the wallet or rpc service per call site', () => {
    const wallet = Errors.execution('send failed', { service: 'wallet' });
    const rpc = Errors.execution('read failed', { service: 'rpc' });
    expect(wallet).toBeInstanceOf(ExecutionError);
    expect(wallet.context.service).toBe('wallet');
    expect(rpc.context.service).toBe('rpc');
  });

  it('externalService supports coinbase among others', () => {
    const err = Errors.externalService('rates fetch failed', {
      service: 'coinbase',
      operation: 'getCoinbaseRates',
    });
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.context.service).toBe('coinbase');
    expect(err.context.operation).toBe('getCoinbaseRates');
  });

  it('simulation defaults to rpc service', () => {
    const err = Errors.simulation('sim failed', { service: 'rpc' });
    expect(err).toBeInstanceOf(SimulationError);
    expect(err.context.service).toBe('rpc');
  });
});

describe('Errors.* named factories', () => {
  it('sdkNotInitialized returns ValidationError with the right code', () => {
    const err = Errors.sdkNotInitialized();
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('validation/sdk_not_initialized');
  });

  it('userDeniedIntent returns UserActionError with hook service', () => {
    const err = Errors.userDeniedIntent();
    expect(err).toBeInstanceOf(UserActionError);
    expect(err.code).toBe('user_action/intent_hook_denied');
    expect(err.context.service).toBe('hook');
  });

  it('userRejectedIntentSignature returns UserActionError with wallet service', () => {
    const err = Errors.userRejectedIntentSignature();
    expect(err).toBeInstanceOf(UserActionError);
    expect(err.code).toBe('user_action/intent_signature_denied');
    expect(err.context.service).toBe('wallet');
  });

  it('userRejectedTxSend returns UserActionError with wallet service', () => {
    const err = Errors.userRejectedTxSend();
    expect(err).toBeInstanceOf(UserActionError);
    expect(err.code).toBe('user_action/tx_send_denied');
    expect(err.context.service).toBe('wallet');
  });

  it('userRejectedEphemeralKey returns UserActionError with wallet service', () => {
    const err = Errors.userRejectedEphemeralKey();
    expect(err).toBeInstanceOf(UserActionError);
    expect(err.code).toBe('user_action/ephemeral_key_denied');
    expect(err.context.service).toBe('wallet');
  });

  it('liquidityTimeout maps to backend/fulfilment_wait_timeout', () => {
    const err = Errors.liquidityTimeout('0xrff');
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('backend/fulfilment_wait_timeout');
    expect(err.context.service).toBe('middleware');
    expect(err.message).toContain('0xrff');
    expect(err.details).toEqual({ requestHash: '0xrff' });
  });

  it('transactionReverted maps to execution/tx_onchain_reverted with rpc service', () => {
    const err = Errors.transactionReverted('0xdead');
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe('execution/tx_onchain_reverted');
    expect(err.context.service).toBe('rpc');
    expect(err.message).toContain('0xdead');
  });

  it('transactionTimeout maps to execution/tx_receipt_wait_timeout with rpc service', () => {
    const err = Errors.transactionTimeout(30);
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe('execution/tx_receipt_wait_timeout');
    expect(err.context.service).toBe('rpc');
  });

  it('gasPriceError maps to execution/gas_price_fetch_failed with rpc service', () => {
    const err = Errors.gasPriceError({ tag: 'whatever' });
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe('execution/gas_price_fetch_failed');
    expect(err.context.service).toBe('rpc');
  });

  it('ratesChangedBeyondTolerance maps to external_service/rates_drift_exceeded', () => {
    const err = Errors.ratesChangedBeyondTolerance(123, '0.5%', 'lifi');
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.code).toBe('external_service/rates_drift_exceeded');
    expect(err.context.service).toBe('lifi');
  });

  it('slippageExceeded maps to execution/slippage_exceeded with wallet service', () => {
    const err = Errors.slippageExceeded('100', '90');
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe('execution/slippage_exceeded');
  });

  it('ephemeralKeyFailed maps to internal/ephemeral_key_derive_failed', () => {
    const err = Errors.ephemeralKeyFailed(new Error('crypto bug'));
    expect(err).toBeInstanceOf(InternalError);
    expect(err.code).toBe('internal/ephemeral_key_derive_failed');
  });

  it('destinationRequestHashNotFound maps to internal/destination_request_hash_not_found', () => {
    const err = Errors.destinationRequestHashNotFound();
    expect(err).toBeInstanceOf(InternalError);
    expect(err.code).toBe('internal/destination_request_hash_not_found');
  });

  it('swapRouteFailed maps to external_service/swap_route_build_failed', () => {
    const err = Errors.swapRouteFailed('no route', 'lifi');
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.code).toBe('external_service/swap_route_build_failed');
    expect(err.context.service).toBe('lifi');
  });

  it('quoteFailed maps to external_service/destination_swap_quote_failed', () => {
    const err = Errors.quoteFailed('upstream 5xx', 'bebop');
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.code).toBe('external_service/destination_swap_quote_failed');
  });

  it('swapQuoteFailed maps to external_service/source_swap_quote_failed', () => {
    const err = Errors.swapQuoteFailed('upstream 5xx', 'lifi');
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.code).toBe('external_service/source_swap_quote_failed');
  });
});
