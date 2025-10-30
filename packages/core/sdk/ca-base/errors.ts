import { ERROR_CODES, createError } from './nexusError';

export const Errors = {
  invalidAllowance: (expected: number, got: number) =>
    createError(
      ERROR_CODES.INVALID_VALUES_ALLOWANCE_HOOK,
      'Invalid allowance values passed. The length of allowances should equal input lengths.',
      {
        context: 'onAllowance:allow()',
        details: { expectedLength: expected, receivedLength: got },
      },
    ),

  chainNotFound: (chainId: number | bigint) =>
    createError(ERROR_CODES.CHAIN_NOT_FOUND, `Chain not found: ${chainId}`, {
      details: { chainId },
    }),

  internal: (msg: string, details?: Record<string, unknown>) =>
    createError(ERROR_CODES.INTERNAL_ERROR, `Internal error: ${msg}`, {
      details,
    }),

  tokenNotSupported: (address: string, chainId: number) =>
    createError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token with address ${address} is not supported on chain ${chainId}`,
      {
        details: { address, chainId },
      },
    ),

  tokenNotFound: (symbol: string, chainId: number) =>
    createError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token with symbol ${symbol} not found on chain ${chainId}`,
      {
        details: { symbol, chainId },
      },
    ),

  tronDepositFailed: (result: unknown) =>
    createError(ERROR_CODES.TRON_DEPOSIT_FAIL, 'Tron deposit transaction failed.', {
      details: { result },
    }),

  tronApprovalFailed: (result: unknown) =>
    createError(ERROR_CODES.TRON_APPROVAL_FAIL, 'Tron approval transaction failed.', {
      details: { result },
    }),

  fuelDepositFailed: (result: unknown) =>
    createError(ERROR_CODES.FUEL_DEPOSIT_FAIL, 'Fuel deposit transaction failed.', {
      details: { result },
    }),

  liquidityTimeout: () =>
    createError(ERROR_CODES.LIQUIDITY_TIMEOUT, 'Timed out waiting for fulfilment.'),

  userDeniedIntent: () => createError(ERROR_CODES.USER_DENIED_INTENT, 'User rejected the intent.'),

  userDeniedAllowance: () =>
    createError(ERROR_CODES.USER_DENIED_ALLOWANCE, 'User rejected the allowance.'),

  userRejectedIntentSignature: () =>
    createError(ERROR_CODES.USER_DENIED_ALLOWANCE, 'User rejected signing the intent hash.'),

  insufficientBalance: () =>
    createError(ERROR_CODES.INSUFFICIENT_BALANCE, 'Insufficient balance to proceed.'),
};
