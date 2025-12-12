import { type AnyValueMap, SeverityNumber } from '@opentelemetry/api-logs';
import { telemetryLogger } from './telemetry';

export interface NexusErrorData {
  context?: string; // Where or why it happened
  cause?: unknown; // Optional nested error
  details?: Record<string, unknown>; // Specific structured info
}

export class NexusError extends Error {
  readonly code: ErrorCode;
  readonly data?: NexusErrorData;

  constructor(code: ErrorCode, message: string, data?: NexusErrorData) {
    super(message);
    this.name = 'NexusError';
    this.code = code;
    this.data = data;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }
}

export const ERROR_CODES = {
  INVALID_VALUES_ALLOWANCE_HOOK: 'INVALID_VALUES_ALLOWANCE_HOOK',
  SDK_NOT_INITIALIZED: 'SDK_NOT_INITIALIZED',
  SDK_INIT_STATE_NOT_EXPECTED: 'SDK_INIT_STATE_NOT_EXPECTED',
  CHAIN_NOT_FOUND: 'CHAIN_NOT_FOUND',
  CHAIN_DATA_NOT_FOUND: 'CHAIN_DATA_NOT_FOUND',
  RATES_CHANGED_BEYOND_TOLERANCE: 'RATES_CHANGED_BEYOND_TOLERANCE',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  COSMOS_ERROR: 'COSMOS_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TOKEN_NOT_SUPPORTED: 'TOKEN_NOT_SUPPORTED',
  UNIVERSE_NOT_SUPPORTED: 'UNIVERSE_NOT_SUPPORTED',
  ENVIRONMENT_NOT_SUPPORTED: 'ENVIRONMENT_NOT_SUPPORTED',
  ENVIRONMENT_NOT_KNOWN: 'ENVIRONMENT_NOT_KNOWN',
  UNKNOWN_SIGNATURE: 'UNKNOWN_SIGNATURE',
  TRON_DEPOSIT_FAIL: 'TRON_DEPOSIT_FAIL',
  TRON_APPROVAL_FAIL: 'TRON_APPROVAL_FAIL',
  LIQUIDITY_TIMEOUT: 'LIQUIDITY_TIMEOUT',
  USER_DENIED_INTENT: 'USER_DENIED_INTENT',
  USER_DENIED_ALLOWANCE: 'USER_DENIED_ALLOWANCE',
  USER_DENIED_INTENT_SIGNATURE: 'USER_DENIED_INTENT_SIGNATURE',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  REFUND_FAILED: 'REFUND_FAILED',
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  USER_DENIED_SIWE_SIGNATURE: 'USER_DENIED_SIWE_SIGNATURE',
  FETCH_GAS_PRICE_FAILED: 'FETCH_GAS_PRICE_FAILED',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  QUOTE_FAILED: 'QUOTE_FAILED',
  SWAP_FAILED: 'SWAP_FAILED',
  CONNECT_ACCOUNT_FAILED: 'CONNECT_ACCOUNT_FAILED',
  VAULT_CONTRACT_NOT_FOUND: 'VAULT_CONTRACT_NOT_FOUND',
  SLIPPAGE_EXCEEDED_ALLOWANCE: 'SLIPPAGE_EXCEEDED_ALLOWANCE',
  ALLOWANCE_SETTING_ERROR: 'ALLOWANCE_SETTING_ERROR',
  REFUND_CHECK_ERROR: 'REFUND_CHECK_ERROR',
  DESTINATION_REQUEST_HASH_NOT_FOUND: 'DESTINATION_REQUEST_HASH_NOT_FOUND',
  DESTINATION_SWEEP_ERROR: 'DESTINATION_SWEEP_ERROR',
  RFF_FEE_EXPIRED: 'RFF_FEE_EXPIRED',
  FEE_GRANT_REQUESTED: 'FEE_GRANT_REQUESTED',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_ADDRESS_LENGTH: 'INVALID_ADDRESS_LENGTH',
  NO_BALANCE_FOR_ADDRESS: 'NO_BALANCE_FOR_ADDRESS',
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',
  TRANSACTION_REVERTED: 'TRANSACTION_REVERTED',
  TRANSACTION_CHECK_ERROR: 'TRANSACTION_CHECK_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function createError(code: ErrorCode, message: string, data?: NexusErrorData): NexusError {
  const nexusError = new NexusError(code, message, data);
  try {
    telemetryLogger?.emit({
      body: message,
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      attributes: {
        data: nexusError.data,
        cause: code,
        stackTrace: nexusError.stack,
      } as AnyValueMap,
    });
  } catch {
    //
  }
  return nexusError;
}

/* --- Expected handling ---

function handleNexusError(err: unknown) {
  if (err instanceof NexusError) {
    console.error(`[${err.code}] ${err.message}`);

    if (err.data?.context) {
      console.error(`Context: ${err.data.context}`);
    }

    if (err.data?.details) {
      console.error('Details:', err.data.details);
    }

    switch (err.code) {
      case ERROR_CODES.USER_DENIED_INTENT:
      case ERROR_CODES.USER_DENIED_ALLOWANCE:
        alert('You rejected the transaction. Please try again.');
        break;

      case ERROR_CODES.INSUFFICIENT_BALANCE:
        alert('Your wallet does not have enough funds.');
        break;

      case ERROR_CODES.TRON_DEPOSIT_FAIL:
        console.warn('Deposit failed');
        // Possibly ask user to retry
        break;

      default:
        // Unknown but typed error
        console.error('Unexpected NexusError:', err.toJSON());
    }

    // Optional:
    logErrorToService(err.toJSON());
  } else {
    // Non-Nexus errors (network, library, etc.)
    console.error('Unexpected error:', err);
  }
}
*/
