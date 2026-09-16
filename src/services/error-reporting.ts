import {
  ERROR_CODES as Codes,
  type ErrorCategory,
  type ErrorCode,
  NexusError,
} from '../domain/errors';

// Internal reporting vocabulary. Public error codes, categories and messages stay unchanged.
// Unknown inputs never become dynamic buckets or fall back to matching display text.
const buckets: Partial<Record<ErrorCode, string>> = {
  [Codes.CHAIN_NOT_FOUND]: 'unsupported_route',
  [Codes.TOKEN_NOT_SUPPORTED]: 'unsupported_route',
  [Codes.UNIVERSE_NOT_SUPPORTED]: 'unsupported_route',
  [Codes.BACKEND_CHAIN_NOT_SUPPORTED]: 'unsupported_route',
  [Codes.BACKEND_TOKEN_NOT_SUPPORTED]: 'unsupported_route',
  [Codes.BACKEND_NO_ROUTABLE_SOURCE]: 'unsupported_route',
  [Codes.BACKEND_INTENT_REFUSED]: 'unsupported_route',
  [Codes.BACKEND_SAME_CHAIN_GAS_DROP_UNSUPPORTED]: 'unsupported_route',
  [Codes.BACKEND_PERMIT_NOT_SPONSORABLE]: 'unsupported_route',
  [Codes.INSUFFICIENT_BALANCE]: 'insufficient_funds',
  [Codes.NO_BALANCE_FOR_ADDRESS]: 'insufficient_funds',
  [Codes.BACKEND_INSUFFICIENT_BALANCE]: 'insufficient_funds',
  [Codes.BACKEND_INSUFFICIENT_APPROVAL_GAS]: 'insufficient_gas',
  [Codes.BACKEND_INPUT_BELOW_DEPOSIT_FEE]: 'amount_too_small',
  [Codes.BACKEND_GAS_DROP_TOO_SMALL]: 'amount_too_small',
  [Codes.BACKEND_QUOTE_UNAVAILABLE]: 'quote_unavailable',
  [Codes.BACKEND_PRICE_UNAVAILABLE]: 'pricing',
  [Codes.BACKEND_QUOTE_PRICE_OUTLIER]: 'pricing',
  [Codes.EXEC_SLIPPAGE_EXCEEDED]: 'pricing',
  [Codes.EXTERNAL_RATES_DRIFT_EXCEEDED]: 'pricing',
  [Codes.BACKEND_INSUFFICIENT_ALLOWANCE]: 'approval',
  [Codes.BACKEND_PERMIT_RELAY_FAILED]: 'approval',
  [Codes.BACKEND_INVALID_INTENT_SIGNATURE]: 'signature',
  [Codes.BACKEND_MISSING_INTENT_SIGNATURE]: 'signature',
  [Codes.BACKEND_INVALID_PERMIT_SIGNATURE]: 'signature',
  [Codes.BACKEND_PERMIT_WITHOUT_SOURCE]: 'signature',
  [Codes.BACKEND_SIMULATION_FAILED]: 'simulation',
  [Codes.BACKEND_SIMULATION_BUNDLE_FAILED]: 'simulation',
  [Codes.EXEC_TX_ONCHAIN_REVERTED]: 'transaction_reverted',
  [Codes.EXEC_TX_SUBMISSION_REVERTED]: 'transaction_reverted',
  [Codes.BACKEND_TRANSACTION_REVERTED]: 'transaction_reverted',
  [Codes.BACKEND_REQUEST_EXPIRED]: 'expired',
  [Codes.BACKEND_RATE_LIMITED]: 'rate_limited',
  [Codes.BACKEND_UNAUTHORIZED]: 'configuration',
  [Codes.BACKEND_CONFIGURATION_ERROR]: 'configuration',
  [Codes.BACKEND_NO_PROVIDERS_ENABLED]: 'configuration',
  [Codes.SDK_NOT_INITIALIZED]: 'configuration',
  [Codes.SDK_INIT_STATE_NOT_EXPECTED]: 'configuration',
  [Codes.ENVIRONMENT_NOT_KNOWN]: 'configuration',
  [Codes.ENVIRONMENT_NOT_SUPPORTED]: 'configuration',
  [Codes.WALLET_NOT_CONNECTED]: 'wallet',
  [Codes.BACKEND_INVALID_REQUEST]: 'invalid_request',
  [Codes.BACKEND_NETWORK_ERROR]: 'network',
  [Codes.BACKEND_UPSTREAM_TIMEOUT]: 'timeout',
  [Codes.BACKEND_FULFILMENT_WAIT_TIMEOUT]: 'timeout',
  [Codes.EXEC_TX_RECEIPT_WAIT_TIMEOUT]: 'timeout',
  [Codes.BACKEND_RPC_ERROR]: 'rpc',
};

/** Bounded event properties only. Raw errors and middleware diagnostics belong in OTel logs. */
export const getErrorReportingProperties = (error: unknown): Record<string, string> => {
  if (!(error instanceof NexusError)) return { 'reason.bucket': 'unknown' };
  const fallbacks: Record<ErrorCategory, string> = {
    user_action: 'user_declined',
    validation: 'invalid_request',
    simulation: 'simulation',
    execution: error.context.service === 'wallet' ? 'wallet' : 'rpc',
    backend: 'unavailable',
    external_service: 'unavailable',
    internal: 'internal',
  };
  const localReason = error.details?.reasonBucket;
  const override =
    localReason === 'unsupported_route' || localReason === 'expired' ? localReason : undefined;
  return {
    'reason.bucket': override ?? buckets[error.code] ?? fallbacks[error.category as ErrorCategory],
    'error.code': error.code,
    'error.category': error.category,
    ...(error.context.service ? { 'error.service': error.context.service } : {}),
  };
};
