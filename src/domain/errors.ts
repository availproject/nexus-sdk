import type { Hex } from 'viem';

/**
 * Categories for hierarchical errors. Drives subclass identity and `error.category`
 * in OTel attributes. See ai-error-otel.md rev 10.
 */
export type ErrorCategory =
  | 'validation'
  | 'user_action'
  | 'simulation'
  | 'execution'
  | 'backend'
  | 'external_service'
  | 'internal';

/**
 * Hand-maintained literal union covering every async public method on `NexusClient`
 * plus exported async utility helpers that have their own OTel boundary.
 *
 * Drift is enforced by `tests/core/operation-name-drift.test-d.ts` — that test will
 * fail to compile if the client surface diverges from this list.
 *
 * `src/domain/` cannot import from `src/core/` (package layering), so the union is
 * hand-maintained here; the drift test lives in the assembly layer (`tests/core/`)
 * where it can import both sides.
 */
export type OperationName =
  // NexusClient async methods
  | 'initialize'
  | 'bridge'
  | 'bridgeAndTransfer'
  | 'simulateBridge'
  | 'simulateBridgeAndTransfer'
  | 'listIntents'
  | 'execute'
  | 'simulateExecute'
  | 'bridgeAndExecute'
  | 'simulateBridgeAndExecute'
  | 'getBalancesForBridge'
  | 'getBalancesForSwap'
  | 'swapWithExactIn'
  | 'swapWithExactOut'
  | 'swapAndExecute'
  | 'calculateMaxForSwap'
  | 'setEVMProvider'
  // exported utility helpers (rev 10)
  | 'getCoinbaseRates'
  | 'getSupportedChains';

// ── Service union per category ────────────────────────────────────────────────

export type ValidationService = never;
export type UserActionService = 'wallet' | 'hook';
export type SimulationService = 'rpc';
export type ExecutionService = 'wallet' | 'rpc';
export type BackendService = 'middleware';
export type ExternalServiceService =
  | 'lifi'
  | 'bebop'
  | 'fibrous'
  | 'zerox'
  | 'mystic'
  | 'relay'
  | 'coinbase';
export type InternalService = never;

/**
 * Maps a category literal to its allowed `service` values. Used by `ErrorContext<C>`
 * and the wrap helpers so TypeScript rejects mismatches (e.g. `service: 'middleware'`
 * on an `ExecutionError`).
 */
export type ServiceFor<C extends ErrorCategory> = C extends 'validation'
  ? undefined
  : C extends 'user_action'
    ? UserActionService
    : C extends 'simulation'
      ? SimulationService
      : C extends 'execution'
        ? ExecutionService
        : C extends 'backend'
          ? BackendService
          : C extends 'external_service'
            ? ExternalServiceService
            : C extends 'internal'
              ? undefined
              : never;

/**
 * Per-category context shape. When `ServiceFor<C>` is `undefined` (validation, internal),
 * `service` is optional and typed `undefined`. When it's a concrete union (backend, execution,
 * etc.), `service` is required and narrowed.
 *
 * The conditional split is what gives direct constructor calls type-safety:
 *   new BackendError(code, msg, { context: { service: 'wallet' } })  // ❌
 *   new BackendError(code, msg, { context: { service: 'middleware' } }) // ✓
 */
export type ErrorContext<C extends ErrorCategory = ErrorCategory> =
  ServiceFor<C> extends undefined
    ? {
        operation?: OperationName;
        service?: undefined;
        stepId?: string;
        stepType?: string;
        chainId?: number | bigint;
      }
    : {
        operation?: OperationName;
        service: ServiceFor<C>;
        stepId?: string;
        stepType?: string;
        chainId?: number | bigint;
      };

// ── ERROR_CODES ───────────────────────────────────────────────────────────────

/**
 * Exhaustive list of error codes. Shape: `category/specific_noun_suffix`.
 *
 * Suffix vocabulary:
 *   _failed   — generic operation failure (default)
 *   _timeout  — specifically timed out
 *   _reverted — wallet/chain revert
 *   _denied   — user rejection
 *   _exceeded — threshold crossed
 *   (none)    — terminal state, not a failure (e.g. fee_grant_requested)
 *
 * Every code's `category` segment must match the subclass it's thrown on.
 */
export const ERROR_CODES = {
  // ── validation/* — caller input / preconditions (no service)
  INVALID_INPUT: 'validation/invalid_input',
  INVALID_ADDRESS_LENGTH: 'validation/invalid_address_length',
  INVALID_VALUES_ALLOWANCE_HOOK: 'validation/invalid_allowance_hook',
  CHAIN_NOT_FOUND: 'validation/chain_not_found',
  CHAIN_DATA_NOT_FOUND: 'validation/chain_data_not_found',
  ASSET_NOT_FOUND: 'validation/asset_not_found',
  TOKEN_NOT_SUPPORTED: 'validation/token_not_supported',
  UNIVERSE_NOT_SUPPORTED: 'validation/universe_not_supported',
  ENVIRONMENT_NOT_SUPPORTED: 'validation/environment_not_supported',
  ENVIRONMENT_NOT_KNOWN: 'validation/environment_not_known',
  INSUFFICIENT_BALANCE: 'validation/insufficient_balance',
  NO_BALANCE_FOR_ADDRESS: 'validation/no_balance_for_address',
  SDK_NOT_INITIALIZED: 'validation/sdk_not_initialized',
  SDK_INIT_STATE_NOT_EXPECTED: 'validation/sdk_init_state_unexpected',
  WALLET_NOT_CONNECTED: 'validation/wallet_not_connected',
  VAULT_CONTRACT_NOT_FOUND: 'validation/vault_contract_not_found',
  VALIDATION_ERROR: 'validation/error',

  // ── user_action/* — user rejected (service='wallet'|'hook')
  USER_INTENT_HOOK_DENIED: 'user_action/intent_hook_denied',
  USER_INTENT_SIGNATURE_DENIED: 'user_action/intent_signature_denied',
  USER_ALLOWANCE_APPROVAL_DENIED: 'user_action/allowance_approval_denied',
  USER_SIWE_SIGNATURE_DENIED: 'user_action/siwe_signature_denied',
  USER_TX_SEND_DENIED: 'user_action/tx_send_denied',
  USER_EPHEMERAL_KEY_DENIED: 'user_action/ephemeral_key_denied',
  USER_ACTION_ERROR: 'user_action/error',

  // ── simulation/* — pre-execution simulate boundary (service='rpc')
  SIMULATION_ETH_CALL_FAILED: 'simulation/eth_call_failed',
  SIMULATION_ERROR: 'simulation/error',

  // ── execution/* — runtime failures (service='wallet'|'rpc')
  EXEC_GAS_ESTIMATE_FAILED: 'execution/gas_estimate_failed',
  EXEC_GAS_PRICE_FETCH_FAILED: 'execution/gas_price_fetch_failed',
  EXEC_L1_FEE_ESTIMATE_FAILED: 'execution/l1_fee_estimate_failed',
  EXEC_ERC20_ALLOWANCE_READ_FAILED: 'execution/erc20_allowance_read_failed',
  EXEC_ERC20_NONCE_READ_FAILED: 'execution/erc20_nonce_read_failed',
  EXEC_ERC20_NAME_READ_FAILED: 'execution/erc20_name_read_failed',
  EXEC_TX_RECEIPT_WAIT_TIMEOUT: 'execution/tx_receipt_wait_timeout',
  EXEC_TX_RECEIPT_CHECK_FAILED: 'execution/tx_receipt_check_failed',
  EXEC_TX_ONCHAIN_REVERTED: 'execution/tx_onchain_reverted',
  EXEC_REFUND_CHECK_FAILED: 'execution/refund_check_failed',
  EXEC_WALLET_CONNECT_FAILED: 'execution/wallet_connect_failed',
  EXEC_CHAIN_SWITCH_FAILED: 'execution/chain_switch_failed',
  EXEC_INTENT_SIGN_FAILED: 'execution/intent_sign_failed',
  EXEC_PERMIT_SIGN_FAILED: 'execution/permit_sign_failed',
  EXEC_APPROVAL_TX_SEND_FAILED: 'execution/approval_tx_send_failed',
  EXEC_APPROVAL_TX_CONFIRM_FAILED: 'execution/approval_tx_confirm_failed',
  EXEC_TX_SEND_FAILED: 'execution/exec_tx_send_failed',
  EXEC_TX_CONFIRM_FAILED: 'execution/exec_tx_confirm_failed',
  EXEC_ATOMIC_BATCH_STATUS_FAILED: 'execution/atomic_batch_status_failed',
  EXEC_TX_SUBMISSION_REVERTED: 'execution/tx_submission_reverted',
  EXEC_VAULT_DEPOSIT_SEND_FAILED: 'execution/vault_deposit_send_failed',
  EXEC_VAULT_DEPOSIT_CONFIRM_FAILED: 'execution/vault_deposit_confirm_failed',
  EXEC_DESTINATION_SWEEP_FAILED: 'execution/destination_sweep_failed',
  EXEC_REFUND_SEND_FAILED: 'execution/refund_send_failed',
  EXEC_SLIPPAGE_EXCEEDED: 'execution/slippage_exceeded',
  EXECUTION_ERROR: 'execution/error',

  // ── backend/* — Avail middleware HTTP/WS (service='middleware')
  BACKEND_BALANCES_FETCH_FAILED: 'backend/balances_fetch_failed',
  BACKEND_DEPLOYMENT_FETCH_FAILED: 'backend/deployment_fetch_failed',
  BACKEND_ORACLE_PRICES_FAILED: 'backend/oracle_prices_fetch_failed',
  BACKEND_RFF_SUBMIT_FAILED: 'backend/rff_submit_failed',
  BACKEND_RFF_FETCH_FAILED: 'backend/rff_fetch_failed',
  BACKEND_RFF_LIST_FAILED: 'backend/rff_list_failed',
  BACKEND_RFF_STATUS_FAILED: 'backend/rff_status_fetch_failed',
  BACKEND_SBC_SUBMIT_FAILED: 'backend/sbc_submit_failed',
  BACKEND_APPROVALS_WS_FAILED: 'backend/approvals_ws_failed',
  BACKEND_SIMULATION_BUNDLE_FAILED: 'backend/simulation_bundle_failed',
  BACKEND_FULFILMENT_WAIT_TIMEOUT: 'backend/fulfilment_wait_timeout',
  BACKEND_FEE_GRANT_REQUESTED: 'backend/fee_grant_requested',
  BACKEND_REPORT_MAYAN_TX_FAILED: 'backend/report_mayan_tx_failed',
  BACKEND_GET_QUOTE_FAILED: 'backend/get_quote_failed',
  BACKEND_GET_MAYAN_QUOTE_FAILED: 'backend/get_mayan_quote_failed',
  BACKEND_GET_BRIDGE_PROVIDER_FAILED: 'backend/get_bridge_provider_failed',
  BACKEND_SAFE_GET_ADDRESS_FAILED: 'backend/safe_get_address_failed',
  BACKEND_SAFE_ENSURE_FAILED: 'backend/safe_ensure_failed',
  BACKEND_SAFE_EXECUTE_FAILED: 'backend/safe_execute_failed',
  BACKEND_ERROR: 'backend/error',

  // ── external_service/* — third-party deps (service='lifi'|'bebop'|'fibrous'|'coinbase')
  EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED: 'external_service/destination_swap_quote_failed',
  EXTERNAL_SOURCE_SWAP_QUOTE_FAILED: 'external_service/source_swap_quote_failed',
  EXTERNAL_SWAP_ROUTE_BUILD_FAILED: 'external_service/swap_route_build_failed',
  EXTERNAL_RATES_DRIFT_EXCEEDED: 'external_service/rates_drift_exceeded',
  EXTERNAL_EXCHANGE_RATE_FETCH_FAILED: 'external_service/exchange_rate_fetch_failed',
  EXTERNAL_SERVICE_ERROR: 'external_service/error',

  // ── internal/* — true SDK invariants (no service)
  INTERNAL_ERROR: 'internal/error',
  INTERNAL_UNKNOWN_SIGNATURE: 'internal/unknown_signature',
  INTERNAL_EPHEMERAL_KEY_DERIVE_FAILED: 'internal/ephemeral_key_derive_failed',
  INTERNAL_DESTINATION_REQUEST_HASH_NOT_FOUND: 'internal/destination_request_hash_not_found',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ── NexusError hierarchy ──────────────────────────────────────────────────────

interface NexusErrorOpts<C extends ErrorCategory> {
  context: ErrorContext<C>;
  details?: Record<string, unknown>;
}

/**
 * Categorized error base. Generic on category so subclasses inherit a narrowed
 * `context` field — `BackendError`'s `context.service` is `'middleware'`,
 * `ExecutionError`'s is `'wallet' | 'rpc'`, etc.
 *
 * Flat by design: no native `cause` capture and no chain walking. The underlying
 * error's text is inlined into `message` at the throw site (via
 * `formatUnknownError`). `category` + `code` are the queryable axes; consumers
 * branch on the subclass / `category` at the top level. See `errors.md`.
 */
export abstract class NexusError<C extends ErrorCategory = ErrorCategory> extends Error {
  abstract readonly category: C;
  readonly code: ErrorCode;
  readonly context: ErrorContext<C>;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, opts: NexusErrorOpts<C>) {
    super(message);
    // `name` is NOT set from `this.constructor.name` — that string gets minified to
    // something like `"b"` by Vite/Rollup in production. Each subclass below pins
    // its name to a string literal that survives minification.
    this.code = code;
    this.context = opts.context;
    this.details = opts.details;
  }

  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      code: this.code,
      context: this.context,
      details: this.details,
    };
  }
}

export class ValidationError extends NexusError<'validation'> {
  override readonly name = 'ValidationError';
  readonly category = 'validation' as const;
}

export class UserActionError extends NexusError<'user_action'> {
  override readonly name = 'UserActionError';
  readonly category = 'user_action' as const;
}

export class SimulationError extends NexusError<'simulation'> {
  override readonly name = 'SimulationError';
  readonly category = 'simulation' as const;
}

export class ExecutionError extends NexusError<'execution'> {
  override readonly name = 'ExecutionError';
  readonly category = 'execution' as const;
}

export class BackendError extends NexusError<'backend'> {
  override readonly name = 'BackendError';
  readonly category = 'backend' as const;
}

export class ExternalServiceError extends NexusError<'external_service'> {
  override readonly name = 'ExternalServiceError';
  readonly category = 'external_service' as const;
}

export class InternalError extends NexusError<'internal'> {
  override readonly name = 'InternalError';
  readonly category = 'internal' as const;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

// ── Wrap helpers ─────────────────────────────────────────────────────────────
//
// Flat-opts call site → nested-context constructor. Each helper's opts is typed
// per category, so `service` is narrowed at the call site.

type WrapOpts<S> = {
  service: S;
  details?: Record<string, unknown>;
  operation?: OperationName;
  stepId?: string;
  stepType?: string;
  chainId?: number | bigint;
};

const toContext = <S>(
  opts: WrapOpts<S>
): {
  service: S;
  operation?: OperationName;
  stepId?: string;
  stepType?: string;
  chainId?: number | bigint;
} => ({
  service: opts.service,
  operation: opts.operation,
  stepId: opts.stepId,
  stepType: opts.stepType,
  chainId: opts.chainId,
});

// ── Named factories ──────────────────────────────────────────────────────────

export const Errors = {
  // ── wrap helpers (categorize an external/unknown failure).
  //    Inline the underlying error's text into `msg` at the call site via
  //    `formatUnknownError(cause)` — there is no `cause` capture.
  backend: (
    msg: string,
    opts: WrapOpts<BackendService> = { service: 'middleware' }
  ): BackendError =>
    new BackendError(ERROR_CODES.BACKEND_ERROR, msg, {
      details: opts.details,
      context: toContext(opts),
    }),

  execution: (msg: string, opts: WrapOpts<ExecutionService>): ExecutionError =>
    new ExecutionError(ERROR_CODES.EXECUTION_ERROR, msg, {
      details: opts.details,
      context: toContext(opts),
    }),

  simulation: (msg: string, opts: WrapOpts<SimulationService>): SimulationError =>
    new SimulationError(ERROR_CODES.SIMULATION_ERROR, msg, {
      details: opts.details,
      context: toContext(opts),
    }),

  externalService: (msg: string, opts: WrapOpts<ExternalServiceService>): ExternalServiceError =>
    new ExternalServiceError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, msg, {
      details: opts.details,
      context: toContext(opts),
    }),

  // ── validation/* named factories
  sdkNotInitialized: (): ValidationError =>
    new ValidationError(ERROR_CODES.SDK_NOT_INITIALIZED, 'SDK is not initialized()', {
      context: {},
    }),

  sdkInitStateNotExpected: (state: string): ValidationError =>
    new ValidationError(ERROR_CODES.SDK_INIT_STATE_NOT_EXPECTED, 'Unexpected init SDK state', {
      context: {},
      details: { state },
    }),

  environmentNotSupported: (environment: string): ValidationError =>
    new ValidationError(ERROR_CODES.ENVIRONMENT_NOT_SUPPORTED, 'Environment not supported yet', {
      context: {},
      details: { environment },
    }),

  environmentNotKnown: (): ValidationError =>
    new ValidationError(ERROR_CODES.ENVIRONMENT_NOT_KNOWN, 'Environment not known/mapped', {
      context: {},
    }),

  invalidAllowance: (expected: number, got: number): ValidationError =>
    new ValidationError(
      ERROR_CODES.INVALID_VALUES_ALLOWANCE_HOOK,
      'Invalid allowance values passed. The length of allowances should equal input lengths.',
      {
        context: {},
        details: { expectedLength: expected, receivedLength: got, source: 'onAllowance:allow()' },
      }
    ),

  chainNotFound: (chainId: number | bigint): ValidationError =>
    new ValidationError(ERROR_CODES.CHAIN_NOT_FOUND, `Chain not found: ${chainId}`, {
      context: { chainId },
      details: { chainId: chainId.toString() },
    }),

  chainDataNotFound: (chainId: number | bigint): ValidationError =>
    new ValidationError(
      ERROR_CODES.CHAIN_DATA_NOT_FOUND,
      `Chain data not found for chain: ${chainId}`,
      { context: { chainId }, details: { chainId: chainId.toString() } }
    ),

  assetNotFound: (tokenSymbol: string): ValidationError =>
    new ValidationError(
      ERROR_CODES.ASSET_NOT_FOUND,
      `Asset not found in UserAssets: ${tokenSymbol}`,
      { context: {}, details: { tokenSymbol } }
    ),

  tokenNotSupported: (
    address?: string,
    chainId?: number,
    additionalMessage?: string
  ): ValidationError =>
    new ValidationError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token/Asset with address ${address} is not supported on chain ${chainId}.\n${additionalMessage}`,
      { context: {}, details: { address, chainId } }
    ),

  universeNotSupported: (): ValidationError =>
    new ValidationError(ERROR_CODES.UNIVERSE_NOT_SUPPORTED, 'Universe not supported', {
      context: {},
    }),

  tokenNotFound: (symbol: string, chainId: number): ValidationError =>
    new ValidationError(
      ERROR_CODES.TOKEN_NOT_SUPPORTED,
      `Token with symbol ${symbol} not found on chain ${chainId}`,
      { context: { chainId }, details: { symbol, chainId } }
    ),

  insufficientBalance: (msg?: string): ValidationError =>
    new ValidationError(
      ERROR_CODES.INSUFFICIENT_BALANCE,
      `Insufficient balance to proceed. ${msg ?? ''}`.trim(),
      { context: {} }
    ),

  walletNotConnected: (walletType: string): ValidationError =>
    new ValidationError(
      ERROR_CODES.WALLET_NOT_CONNECTED,
      `Wallet is not connected for ${walletType}`,
      { context: {}, details: { walletType } }
    ),

  vaultContractNotFound: (chainId: number | bigint): ValidationError =>
    new ValidationError(
      ERROR_CODES.VAULT_CONTRACT_NOT_FOUND,
      `vault contract not found for chain ${chainId.toString()}`,
      { context: { chainId } }
    ),

  invalidInput: (msg: string): ValidationError =>
    new ValidationError(ERROR_CODES.INVALID_INPUT, `input invalid: ${msg}`, { context: {} }),

  invalidAddressLength: (addressType: string, additionalMessage?: string): ValidationError =>
    new ValidationError(
      ERROR_CODES.INVALID_ADDRESS_LENGTH,
      `Invalid ${addressType} address length: ${additionalMessage ?? ''}`,
      { context: {}, details: { type: addressType } }
    ),

  noBalanceForAddress: (address: Hex): ValidationError =>
    new ValidationError(
      ERROR_CODES.NO_BALANCE_FOR_ADDRESS,
      `no balance found for user: ${address}`,
      { context: {}, details: { address } }
    ),

  // ── user_action/* named factories
  userDeniedIntent: (): UserActionError =>
    new UserActionError(ERROR_CODES.USER_INTENT_HOOK_DENIED, 'User rejected the intent.', {
      context: { service: 'hook' },
    }),

  userRejectedAllowance: (): UserActionError =>
    new UserActionError(
      ERROR_CODES.USER_ALLOWANCE_APPROVAL_DENIED,
      'User rejected the allowance.',
      { context: { service: 'wallet' } }
    ),

  userRejectedIntentSignature: (): UserActionError =>
    new UserActionError(
      ERROR_CODES.USER_INTENT_SIGNATURE_DENIED,
      'User rejected signing the intent hash.',
      { context: { service: 'wallet' } }
    ),

  userRejectedSIWESignature: (): UserActionError =>
    new UserActionError(ERROR_CODES.USER_SIWE_SIGNATURE_DENIED, 'User rejected SIWE signature.', {
      context: { service: 'wallet' },
    }),

  userRejectedTxSend: (): UserActionError =>
    new UserActionError(ERROR_CODES.USER_TX_SEND_DENIED, 'User rejected sending the transaction.', {
      context: { service: 'wallet' },
    }),

  userRejectedEphemeralKey: (): UserActionError =>
    new UserActionError(
      ERROR_CODES.USER_EPHEMERAL_KEY_DENIED,
      'User rejected signing the ephemeral-key derivation message.',
      { context: { service: 'wallet' } }
    ),

  // ── backend/* named factories
  liquidityTimeout: (requestHash: Hex): BackendError =>
    new BackendError(
      ERROR_CODES.BACKEND_FULFILMENT_WAIT_TIMEOUT,
      `Timed out waiting for fulfilment (RFF ${requestHash}).`,
      {
        context: { service: 'middleware' },
        details: { requestHash },
      }
    ),

  feeGrantRequested: (): BackendError =>
    new BackendError(ERROR_CODES.BACKEND_FEE_GRANT_REQUESTED, 'Fee grant requested.', {
      context: { service: 'middleware' },
    }),

  // ── execution/* named factories
  transactionTimeout: (timeout: number): ExecutionError =>
    new ExecutionError(
      ERROR_CODES.EXEC_TX_RECEIPT_WAIT_TIMEOUT,
      `⏰ Timeout: Transaction not confirmed within ${timeout}s`,
      { context: { service: 'rpc' }, details: { timeout } }
    ),

  transactionReverted: (txHash: string): ExecutionError =>
    new ExecutionError(ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED, `Transaction reverted: ${txHash}`, {
      context: { service: 'rpc' },
      details: { txHash },
    }),

  gasPriceError: (result: unknown): ExecutionError =>
    new ExecutionError(
      ERROR_CODES.EXEC_GAS_PRICE_FETCH_FAILED,
      'rpc: estimateMaxFeePerGas failed',
      { context: { service: 'rpc' }, details: { result } }
    ),

  slippageExceeded: (expected: string, actual: string): ExecutionError =>
    new ExecutionError(
      ERROR_CODES.EXEC_SLIPPAGE_EXCEEDED,
      `Slippage exceeded: expected ${expected}, got ${actual}`,
      { context: { service: 'wallet' }, details: { expected, actual } }
    ),

  // ── external_service/* named factories
  quoteFailed: (message: string, service: ExternalServiceService = 'lifi'): ExternalServiceError =>
    new ExternalServiceError(
      ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED,
      `Quote failed: ${message}`,
      { context: { service } }
    ),

  swapQuoteFailed: (msg: string, service: ExternalServiceService = 'lifi'): ExternalServiceError =>
    new ExternalServiceError(
      ERROR_CODES.EXTERNAL_SOURCE_SWAP_QUOTE_FAILED,
      `Swap quote failed: ${msg}`,
      { context: { service } }
    ),

  swapRouteFailed: (msg: string, service: ExternalServiceService = 'lifi'): ExternalServiceError =>
    new ExternalServiceError(
      ERROR_CODES.EXTERNAL_SWAP_ROUTE_BUILD_FAILED,
      `Swap route failed: ${msg}`,
      { context: { service } }
    ),

  ratesChangedBeyondTolerance: (
    rate: number | bigint,
    tolerance: string,
    service: ExternalServiceService = 'lifi'
  ): ExternalServiceError =>
    new ExternalServiceError(
      ERROR_CODES.EXTERNAL_RATES_DRIFT_EXCEEDED,
      `Rates changed beyond tolerance. Rate: ${rate}\nTolerance:${tolerance}`,
      { context: { service }, details: { rate: rate.toString(), tolerance } }
    ),

  // ── simulation/* named factories
  simulationFailed: (msg: string): SimulationError =>
    new SimulationError(ERROR_CODES.SIMULATION_ETH_CALL_FAILED, `simulation failed: ${msg}`, {
      context: { service: 'rpc' },
    }),

  // ── internal/* named factories
  unknownSignatureType: (): InternalError =>
    new InternalError(ERROR_CODES.INTERNAL_UNKNOWN_SIGNATURE, 'Unknown signature type', {
      context: {},
    }),

  ephemeralKeyFailed: (cause?: unknown): InternalError =>
    new InternalError(
      ERROR_CODES.INTERNAL_EPHEMERAL_KEY_DERIVE_FAILED,
      cause !== undefined
        ? `Ephemeral key derivation failed: ${formatUnknownError(cause)}`
        : 'Ephemeral key derivation failed',
      { context: {} }
    ),

  destinationRequestHashNotFound: (): InternalError =>
    new InternalError(
      ERROR_CODES.INTERNAL_DESTINATION_REQUEST_HASH_NOT_FOUND,
      'requestHash not found for destination',
      { context: {} }
    ),

  internal: (msg: string, details?: Record<string, unknown>): InternalError =>
    new InternalError(ERROR_CODES.INTERNAL_ERROR, `Internal error: ${msg}`, {
      context: {},
      details,
    }),
};
