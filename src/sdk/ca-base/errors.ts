import type { Hex } from 'viem';
import { createError, ERROR_CODES } from './nexusError';

export const Errors = {
  sdkNotInitialized: () => createError(ERROR_CODES.SDK_NOT_INITIALIZED, 'SDK is not initialized()'),
  sdkInitStateNotExpected: (state: string) =>
    createError(ERROR_CODES.SDK_INIT_STATE_NOT_EXPECTED, 'Unexpected init SDK state', {
      details: { state },
    }),
  accountConnectionFailed: () =>
    createError(ERROR_CODES.CONNECT_ACCOUNT_FAILED, 'Account failed to connect from connector'),
  environmentNotSupported: (environment: string) =>
    createError(ERROR_CODES.ENVIRONMENT_NOT_SUPPORTED, 'Environment not supported yet', {
      details: { environment },
    }),
  environmentNotKnown: () =>
    createError(ERROR_CODES.ENVIRONMENT_NOT_KNOWN, 'Environment not known/mapped'),
  invalidAllowance: (expected: number, got: number) =>
    createError(
      ERROR_CODES.INVALID_VALUES_ALLOWANCE_HOOK,
      'Invalid allowance values passed. The length of allowances should equal input lengths.',
      {
        context: 'onAllowance:allow()',
        details: { expectedLength: expected, receivedLength: got },
      }
    ),
  chainNotFound: (chainId: number | bigint) =>
    createError(ERROR_CODES.CHAIN_NOT_FOUND, `Chain not found: ${chainId}`, {
      details: { chainId },
    }),
  chainDataNotFound: (chainId: number | bigint) =>
    createError(ERROR_CODES.CHAIN_DATA_NOT_FOUND, `Chain data not found for chain: ${chainId}`, {
      details: { chainId },
    }),
  assetNotFound: (tokenSymbol: string) =>
    createError(ERROR_CODES.ASSET_NOT_FOUND, `Asset not found in UserAssets: ${tokenSymbol}`, {
      details: { tokenSymbol },
    }),
  internal: (msg: string, details?: Record<string, unknown>) =>
    createError(ERROR_CODES.INTERNAL_ERROR, `Internal error: ${msg}`, {
      details,
    }),
  tokenNotSupported: (address?: string, chainId?: number, additionalMessage?: string) =>
    createError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token/Asset with address ${address} is not supported on chain ${chainId}.\n${additionalMessage}`,
      {
        details: { address, chainId },
      }
    ),
  universeNotSupported: () =>
    createError(ERROR_CODES.UNIVERSE_NOT_SUPPORTED, 'Universe not supported'),
  tokenNotFound: (symbol: string, chainId: number) =>
    createError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token with symbol ${symbol} not found on chain ${chainId}`,
      {
        details: { symbol, chainId },
      }
    ),

  tronDepositFailed: (result: unknown) =>
    createError(ERROR_CODES.TRON_DEPOSIT_FAIL, 'Tron deposit transaction failed.', {
      details: { result },
    }),

  tronApprovalFailed: (result: unknown) =>
    createError(ERROR_CODES.TRON_APPROVAL_FAIL, 'Tron approval transaction failed.', {
      details: { result },
    }),

  liquidityTimeout: () =>
    createError(ERROR_CODES.LIQUIDITY_TIMEOUT, 'Timed out waiting for fulfilment.'),

  userDeniedIntent: () => createError(ERROR_CODES.USER_DENIED_INTENT, 'User rejected the intent.'),

  userRejectedAllowance: () =>
    createError(ERROR_CODES.USER_DENIED_ALLOWANCE, 'User rejected the allowance.'),

  userRejectedIntentSignature: () =>
    createError(ERROR_CODES.USER_DENIED_INTENT_SIGNATURE, 'User rejected signing the intent hash.'),

  insufficientBalance: (msg?: string) =>
    createError(ERROR_CODES.INSUFFICIENT_BALANCE, `Insufficient balance to proceed. ${msg}`),

  walletNotConnected: (walletType: string) =>
    createError(ERROR_CODES.WALLET_NOT_CONNECTED, `Wallet is not connected for ${walletType}`),

  userRejectedSIWESignature: () =>
    createError(ERROR_CODES.USER_DENIED_SIWE_SIGNATURE, 'User rejected SIWE signature.'),

  vscError: (msg: string, data?: unknown) =>
    createError(ERROR_CODES.INTERNAL_ERROR, `VSC: ${msg}`, {
      details: {
        data,
      },
    }),

  cosmosError: (msg: string) => createError(ERROR_CODES.COSMOS_ERROR, `COSMOS: ${msg}`),
  gasPriceError: (result: unknown) =>
    createError(ERROR_CODES.FETCH_GAS_PRICE_FAILED, 'rpc: estimateMaxFeePerGas failed', {
      details: {
        result,
      },
    }),
  unknownSignatureType: () => createError(ERROR_CODES.UNKNOWN_SIGNATURE, 'Unknown signature type'),
  quoteFailed: (message: string) =>
    createError(ERROR_CODES.QUOTE_FAILED, `Quote failed: ${message}`),
  swapFailed: (message: string) => createError(ERROR_CODES.SWAP_FAILED, `Swap failed: ${message}`),
  ratesChangedBeyondTolerance: (rate: number | bigint, tolerance: number | bigint) =>
    createError(
      ERROR_CODES.RATES_CHANGED_BEYOND_TOLERANCE,
      `Rates changed beyond tolerance. Rate: ${rate}\nTolerance:${tolerance}`
    ),
  slippageError: (msg: string) =>
    createError(ERROR_CODES.SLIPPAGE_EXCEEDED_ALLOWANCE, `rpc: slippage exceeded - ${msg}`),
  vaultContractNotFound: (chainId: number | bigint) =>
    createError(
      ERROR_CODES.VAULT_CONTRACT_NOT_FOUND,
      `vault contract not found for chain ${chainId.toString()}`
    ),
  simulationError: (msg: string) =>
    createError(ERROR_CODES.SIMULATION_FAILED, `tenderly simulation failed: ${msg}`),
  rFFFeeExpired: () => createError(ERROR_CODES.RFF_FEE_EXPIRED, 'fee is not adequate'),
  destinationRequestHashNotFound: () =>
    createError(
      ERROR_CODES.DESTINATION_REQUEST_HASH_NOT_FOUND,
      'requestHash not found for destination'
    ),
  transactionTimeout: (timeout: number) =>
    createError(
      ERROR_CODES.TRANSACTION_TIMEOUT,
      `⏰ Timeout: Transaction not confirmed within ${timeout}s`
    ),
  transactionReverted: (txHash: string) =>
    createError(ERROR_CODES.TRANSACTION_REVERTED, `Transaction reverted: ${txHash}`),
  invalidInput: (msg: string) => createError(ERROR_CODES.INVALID_INPUT, `input invalid: ${msg}`),
  invalidAddressLength: (addressType: string, additionalMessage?: string) =>
    createError(
      ERROR_CODES.INVALID_ADDRESS_LENGTH,
      `Invalid ${addressType} address length: ${additionalMessage}`,
      { details: { type: addressType } }
    ),
  noBalanceForAddress: (address: Hex) => {
    createError(ERROR_CODES.NO_BALANCE_FOR_ADDRESS, `no balance found for user: ${address}`);
  },
};
