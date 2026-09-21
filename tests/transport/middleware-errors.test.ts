import axios, { type AxiosAdapter, type CreateAxiosDefaults } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError, createNexusClient, ERROR_CODES, NexusError, ValidationError } from '../../src';
import { Errors } from '../../src/domain/errors';
import { getIntentQuoteFailure } from '../../src/intent/errors';
import type { IntentQuoteRequest } from '../../src/intent/types';
import { createMiddlewareClient } from '../../src/transport/middleware';

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const ACCOUNT = '0x00000000000000000000000000000000000000aa';
const quoteRequest: IntentQuoteRequest = {
  sender: ACCOUNT,
  tradeType: 'exactOutput' as const,
  output: { chainId: 'EVM_1', token: ACCOUNT, amount: '1' },
};
const http = { get: vi.fn(), post: vi.fn() };
const responseError = (data: unknown, status = 422) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { data, status },
  });

const quoteError = async (error: unknown): Promise<BackendError> => {
  http.post.mockRejectedValue(error);
  const client = createMiddlewareClient('https://middleware.example');
  const result = await client.getIntentQuote(quoteRequest).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(BackendError);
  return result as BackendError;
};

describe('middleware error mapping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(axios.create).mockReturnValue(http as never);
  });

  it.each([
    ['INVALID_REQUEST', 'invalid_request', /request.*invalid/i],
    ['UNAUTHORIZED', 'unauthorized', /not authorized/i],
    ['NOT_FOUND', 'not_found', /not.*found/i],
    ['RATE_LIMITED', 'rate_limited', /too many requests/i],
    ['CONFIGURATION_ERROR', 'configuration_error', /not configured/i],
    ['UPSTREAM_ERROR', 'upstream_error', /service.*unavailable/i],
    ['UPSTREAM_TIMEOUT', 'upstream_timeout', /timed out/i],
    ['RPC_ERROR', 'rpc_error', /blockchain/i],
    ['SIMULATION_FAILED', 'simulation_failed', /simulation/i],
    ['TRANSACTION_REVERTED', 'transaction_reverted', /reverted/i],
    ['QUOTE_UNAVAILABLE', 'quote_unavailable', /no quote/i],
    ['PRICE_UNAVAILABLE', 'price_unavailable', /price/i],
    ['GAS_UNAVAILABLE', 'gas_unavailable', /gas.*estimate/i],
    ['CHAIN_NOT_SUPPORTED', 'chain_not_supported', /chain.*not supported/i],
    ['TOKEN_NOT_SUPPORTED', 'token_not_supported', /token.*not supported/i],
    ['INTERNAL_ERROR', 'error', /unexpected error/i],
  ])('maps middleware code %s', async (code, sdkCode, message) => {
    const error = await quoteError(responseError({ code, message: 'Internal diagnostic text' }));
    expect(error.code).toBe(`backend/${sdkCode}`);
    expect(error.message).toMatch(message);
    expect(error.context.service).toBe('middleware');
    expect(Object.values(ERROR_CODES)).toContain(error.code);
    expect(error.details).toMatchObject({ middlewareCode: code, error: 'Internal diagnostic text' });
  });

  it.each([
    ['NO_ROUTABLE_SOURCE', 'no_routable_source', /no route/i],
    ['INTENT_REFUSED', 'intent_refused', /cannot fulfill/i],
    ['PROVIDER_UNAVAILABLE', 'provider_unavailable', /providers.*unavailable/i],
    ['NO_PROVIDERS_ENABLED', 'no_providers_enabled', /no.*providers.*enabled/i],
    ['INSUFFICIENT_BALANCE', 'insufficient_balance', /insufficient.*balance/i],
    ['INSUFFICIENT_APPROVAL_GAS', 'insufficient_approval_gas', /gas.*approv/i],
    ['SAME_CHAIN_GAS_DROP_UNSUPPORTED', 'same_chain_gas_drop_unsupported', /gas.*cross-chain/i],
    ['QUOTE_PRICE_UNAVAILABLE', 'price_unavailable', /price/i],
    ['QUOTE_PRICE_OUTLIER', 'quote_price_outlier', /quote.*price/i],
    ['INPUT_BELOW_DEPOSIT_FEE', 'input_below_deposit_fee', /amount.*deposit fee/i],
    ['GAS_DROP_TOO_SMALL', 'gas_drop_too_small', /gas.*too small/i],
    ['REQUEST_EXPIRED', 'request_expired', /expired.*new quote/i],
    ['INVALID_INTENT_SIGNATURE', 'invalid_intent_signature', /intent signature.*invalid/i],
    ['MISSING_INTENT_SIGNATURE', 'missing_intent_signature', /intent signature.*missing/i],
    ['INVALID_PERMIT_SIGNATURE', 'invalid_permit_signature', /approval signature.*invalid/i],
    ['PERMIT_WITHOUT_SOURCE', 'permit_without_source', /approval signature.*source/i],
    ['PERMIT_NOT_SPONSORABLE', 'permit_not_sponsorable', /sponsored approvals.*not/i],
    ['INSUFFICIENT_ALLOWANCE', 'insufficient_allowance', /token approval.*insufficient/i],
    ['PERMIT_RELAY_FAILED', 'permit_relay_failed', /sponsored approval.*failed/i],
    ['MAYAN_INSUFFICIENT_COVERAGE', 'insufficient_balance', /insufficient.*balance/i],
    ['INVALID_MAYAN_QUOTE', 'quote_unavailable', /quote/i],
    ['MAYAN_QUOTE_FETCH_FAILED', 'provider_unavailable', /provider.*unavailable/i],
    ['MAYAN_NO_ROUTE', 'no_routable_source', /no route/i],
    ['MAYAN_CALLDATA_BUILD_FAILED', 'provider_unavailable', /provider.*unavailable/i],
    ['MISSING_CLIENT_ID', 'invalid_request', /client.*identity/i],
    ['MISSING_SURFACE', 'invalid_request', /client.*identity/i],
  ])('prefers middleware subcode %s over the general code', async (subcode, sdkCode, message) => {
    const error = await quoteError(responseError({
      code: 'INVALID_REQUEST', subcode, message: 'Internal diagnostic text', errorId: 'error-123',
      details: { chainId: 137, shortfalls: [{ actual: '0', required: '10' }] },
    }));
    expect(error.code).toBe(`backend/${sdkCode}`);
    expect(error.message).toMatch(message);
    expect(error.message.length).toBeLessThanOrEqual(120);
    expect(Object.values(ERROR_CODES)).toContain(error.code);
    expect(error.details).toMatchObject({
      middlewareCode: 'INVALID_REQUEST', middlewareSubcode: subcode, errorId: 'error-123',
      middlewareDetails: { shortfalls: [{ actual: '0', required: '10' }] },
    });
  });

  it('retains quote diagnostics when optional source verdicts are malformed', async () => {
    const error = await quoteError(responseError({
      code: 'QUOTE_UNAVAILABLE', subcode: 'INSUFFICIENT_APPROVAL_GAS',
      message: 'Insufficient native or USDC gas balance to approve the source token',
      errorId: 'gas-error', details: { sourceVerdicts: 'malformed', shortfalls: [137] },
    }));
    expect(error.message).toMatch(/gas.*approv/i);
    expect(getIntentQuoteFailure(error)).toMatchObject({
      subcode: 'INSUFFICIENT_APPROVAL_GAS', errorId: 'gas-error', sourceVerdicts: [],
      details: { shortfalls: [137] },
    });
  });

  it.each(['NEW_SUBCODE', 'constructor', 'toString', '__proto__'])(
    'falls back to the general code for unknown subcode %s', async (subcode) => {
      const error = await quoteError(responseError({ code: 'QUOTE_UNAVAILABLE', subcode }));
      expect(error).toMatchObject({ code: 'backend/quote_unavailable', message: expect.stringMatching(/no quote/i) });
    }
  );

  it('preserves a message from a future middleware code', async () => {
    const error = await quoteError(responseError({
      code: 'FUTURE_ERROR', subcode: 'FUTURE_SUBCODE', message: '  This route is paused.  ',
    }));
    expect(error).toMatchObject({ code: 'backend/get_quote_failed', message: 'This route is paused.' });
  });

  it.each([null, [], '<html>Bad Gateway</html>', { code: 12, subcode: {}, message: {} }, { message: '   ' }].map((payload) => [payload]))(
    'uses a readable fallback for malformed payload %j', async (payload) => {
      const error = await quoteError(responseError(payload));
      expect(error).toMatchObject({ code: 'backend/get_quote_failed', message: 'Unable to fetch a quote. Please try again.' });
    }
  );

  it.each([
    [401, 'unauthorized'], [403, 'unauthorized'], [404, 'not_found'], [429, 'rate_limited'],
    [502, 'upstream_error'], [503, 'upstream_error'], [504, 'upstream_timeout'],
  ])('maps HTTP %i when no error envelope is available', async (status, sdkCode) => {
    const error = await quoteError(responseError('<html>Gateway error</html>', status));
    expect(error.code).toBe(`backend/${sdkCode}`);
    expect(error.message).not.toMatch(/html|status code/i);
    expect(error.details?.httpStatus).toBe(status);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'])(
    'maps transport failure %s without a middleware response', async (code) => {
      const error = await quoteError(Object.assign(new Error('Axios request failed'), { code }));
      expect(error.code).toBe(code === 'ERR_NETWORK' ? 'backend/network_error' : 'backend/upstream_timeout');
      expect(error.message).toMatch(code === 'ERR_NETWORK' ? /connection/i : /timed out/i);
    }
  );

  it('maps submit errors through the same boundary as quote errors', async () => {
    http.post.mockRejectedValue(responseError({
      code: 'INVALID_REQUEST', subcode: 'REQUEST_EXPIRED', message: 'Intent submit request is already expired',
    }));
    await expect(createMiddlewareClient('https://middleware.example').submitIntent({
      provider: 'nexus-v2', rff: {}, signatures: [],
    })).rejects.toMatchObject({ code: 'backend/request_expired', message: expect.stringMatching(/new quote/i) });
  });

  it.each(['balances', 'chains', 'status', 'history'] as const)(
    'maps %s errors through the shared boundary', async (operation) => {
      http.get.mockRejectedValue(responseError({ code: 'RATE_LIMITED', message: 'Rate exceeded' }, 429));
      const client = createMiddlewareClient('https://middleware.example');
      const request = operation === 'balances' ? client.getIntentBalances(ACCOUNT)
        : operation === 'chains' ? client.getIntentChains()
        : operation === 'status' ? client.getIntentStatus(`0x${'11'.repeat(32)}`)
        : client.listIntentHistory();
      await expect(request).rejects.toMatchObject({ code: 'backend/rate_limited', message: expect.stringMatching(/too many requests/i) });
    }
  );

  it('preserves errors already classified by the SDK', async () => {
    const original = Errors.backend('Invalid Better Intent quote response');
    const error = await quoteError(original);
    expect(error).toBe(original);
    expect(error).toBeInstanceOf(NexusError);
  });

  it('preserves validation errors raised before sending a request', async () => {
    const client = createMiddlewareClient('https://middleware.example');
    await expect(client.getIntentChains({ sources: [{ chainId: -1 }] }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('delivers the mapped code and display message through the public swap method', async () => {
    const { default: realAxios, AxiosError } = await vi.importActual<typeof import('axios')>('axios');
    const adapter: AxiosAdapter = async (config) => {
      if (config.url?.endsWith('/quote')) {
        throw new AxiosError('Request failed with status code 422', 'ERR_BAD_REQUEST', config, undefined, {
          config, headers: {}, status: 422, statusText: 'Unprocessable Entity',
          data: {
            code: 'QUOTE_UNAVAILABLE', subcode: 'INSUFFICIENT_APPROVAL_GAS', errorId: 'quote-gas-123',
            message: 'Insufficient native or USDC gas balance to approve the source token',
          },
        });
      }
      const data = config.url?.endsWith('/chains') ? [{
          chainId: 'EVM_1', name: 'Ethereum', providers: ['nexus-v2'],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        }]
        : { tokens: [{
          universe: 'EVM', chainId: 'EVM_1', address: ACCOUNT, symbol: 'USDC', name: 'USD Coin',
          decimals: 6, isNative: false, asSource: [{ id: 'nexus-v2' }], asDestination: [{ id: 'nexus-v2' }],
          sponsoredApproval: false,
        }], offset: 0, limit: Number(config.params.get('limit')), total: 1 };
      return { data, config, status: 200, statusText: 'OK', headers: {} };
    };
    vi.mocked(axios.create).mockImplementation((config?: CreateAxiosDefaults) => realAxios.create({ ...config, adapter }));
    const client = createNexusClient({ clientId: 'test-client', network: 'mainnet', analytics: { enabled: false } });
    const walletRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [ACCOUNT];
      if (method === 'eth_chainId') return '0x1';
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    try {
      await client.initialize();
      await client.setEVMProvider({ request: walletRequest, on: vi.fn(), removeListener: vi.fn() });
      const error = await client.swapWithExactOut({
        toChainId: 1, toTokenAddress: ACCOUNT, toAmountRaw: 1n,
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(BackendError);
      expect(error).toMatchObject({
        code: 'backend/insufficient_approval_gas',
        message: 'Not enough gas to approve a source token. Add gas funds on the source chain or choose another source.',
        details: { errorId: 'quote-gas-123' },
      });
      expect(walletRequest.mock.calls.map(([request]) => request.method)).not.toContain('personal_sign');
    } finally {
      client.destroy();
    }
  });
});
