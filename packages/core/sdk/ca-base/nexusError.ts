export interface NexusErrorData {
  context?: string; // Where or why it happened
  cause?: unknown; // Optional nested error
  details?: Record<string, unknown>; // Specific structured info
}

class NexusError extends Error {
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
  CHAIN_NOT_FOUND: 'CHAIN_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TOKEN_NOT_SUPPORTED: 'TOKEN_NOT_SUPPORTED',
  TRON_DEPOSIT_FAIL: 'TRON_DEPOSIT_FAIL',
  TRON_APPROVAL_FAIL: 'TRON_APPROVAL_FAIL',
  FUEL_DEPOSIT_FAIL: 'FUEL_DEPOSIT_FAIL',
  LIQUIDITY_TIMEOUT: 'LIQUIDITY_TIMEOUT',
  USER_DENIED_INTENT: 'USER_DENIED_INTENT',
  USER_DENIED_ALLOWANCE: 'USER_DENIED_ALLOWANCE',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function createError(code: ErrorCode, message: string, data?: NexusErrorData): NexusError {
  return new NexusError(code, message, data);
}

export default NexusError;

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
      case ERROR_CODES.FUEL_DEPOSIT_FAIL:
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
