import { ERROR_CODES, createError } from './nexusError';

export const Errors = {
  sdkNotInitialized: () => createError(ERROR_CODES.SDK_NOT_INITIALIZED, 'SDK is not initialized()'),
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

  userRejectedAllowance: () =>
    createError(ERROR_CODES.USER_DENIED_ALLOWANCE, 'User rejected the allowance.'),

  userRejectedIntentSignature: () =>
    createError(ERROR_CODES.USER_DENIED_INTENT_SIGNATURE, 'User rejected signing the intent hash.'),

  insufficientBalance: () =>
    createError(ERROR_CODES.INSUFFICIENT_BALANCE, 'Insufficient balance to proceed.'),

  walletNotConnected: (walletType: string) =>
    createError(ERROR_CODES.WALLET_NOT_CONNECTED, `Wallet is not connected for ${walletType}`),

  userRejectedSIWESignature: () =>
    createError(ERROR_CODES.USER_DENIED_SIWE_SIGNATURE, `User rejected SIWE signature.`),

  vscError: (msg: string, data?: unknown) =>
    createError(ERROR_CODES.INTERNAL_ERROR, `VSC: ${msg}`, {
      details: {
        data,
      },
    }),

  cosmosError: (msg: string) => createError(ERROR_CODES.INTERNAL_ERROR, `COSMOS: ${msg}`),
  gasPriceError: (result: unknown) =>
    createError(ERROR_CODES.FETCH_GAS_PRICE_FAILED, `rpc: estimateMaxFeePerGas failed`, {
      details: {
        result,
      },
    }),
  slippageError: (msg: string) =>
    createError(ERROR_CODES.SLIPPAGE_EXCEEDED_ALLOWANCE, `rpc: slippage exceeded - ${msg}`),
  vaultContractNotFound: (chainId: number | bigint) =>
    createError(
      ERROR_CODES.VAULT_CONTRACT_NOT_FOUND,
      `vault contract not found for chain ${chainId.toString()}`,
    ),
  simulationError: (msg: string) =>
    createError(ERROR_CODES.SIMULATION_FAILED, `tenderly simulation failed: ${msg}`),
  rFFFeeExpired: () => createError(ERROR_CODES.RFF_FEE_EXPIRED, `fee is not adequate`),
};
