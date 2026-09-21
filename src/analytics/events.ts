/**
 * Event taxonomy for Nexus SDK Analytics.
 * Naming convention: nexus_{category}_{action}_{status}
 */

export const NexusAnalyticsEvents = {
  // Payment attempt contract v1. Only INTENT_OUTCOME represents a terminal outcome.
  INTENT_STARTED: 'nexus_v2_intent_started',
  INTENT_QUOTED: 'nexus_v2_intent_quoted',
  INTENT_COMMITTED: 'nexus_v2_intent_committed',
  INTENT_TRANSACTION: 'nexus_v2_intent_transaction',
  INTENT_SOURCE_STATUS: 'nexus_v2_intent_source_status',
  INTENT_DELIVERED: 'nexus_v2_intent_delivered',
  INTENT_OUTCOME: 'nexus_v2_intent_outcome',
  INTENT_OBSERVATION_FAILED: 'nexus_v2_intent_observation_failed',
  INTENT_QUOTE_REFRESH_FAILED: 'nexus_v2_intent_quote_refresh_failed',
  INTENT_SKIPPED: 'nexus_v2_intent_skipped',
  BALANCES_FETCH_PARTIAL: 'nexus_v2_balances_fetch_partial',
  // SDK Lifecycle
  /** Fires after the SDK has connected to its backing services and is ready for operations. */
  SDK_INITIALIZED: 'nexus_v2_sdk_initialized',
  /** Fires when SDK initialization throws. */
  SDK_INITIALIZATION_FAILED: 'nexus_v2_sdk_initialization_failed',
  /** Fires when the SDK is destroyed and resources are released. */
  SDK_DEINITIALIZED: 'nexus_v2_sdk_deinitialized',

  // Session
  /** Fires once at the start of an SDK session. */
  SESSION_STARTED: 'nexus_v2_session_started',
  /** Fires when the session ends or the page unloads. */
  SESSION_ENDED: 'nexus_v2_session_ended',

  // Wallet
  /** Fires when the integrator calls setEvmProvider, before address resolution. */
  WALLET_CONNECT_INITIATED: 'nexus_v2_wallet_connect_initiated',
  /** Fires after the SDK successfully reads the wallet address and chain id. */
  WALLET_CONNECTED: 'nexus_v2_wallet_connected',
  /** Fires when reading the wallet address or chain id throws. */
  WALLET_CONNECT_FAILED: 'nexus_v2_wallet_connect_failed',

  // Balance Operations
  /** Fires before the SDK requests balances from the middleware. */
  BALANCES_FETCH_STARTED: 'nexus_v2_balances_fetch_started',
  /** Fires after the SDK receives a balances response. */
  BALANCES_FETCH_SUCCESS: 'nexus_v2_balances_fetch_success',
  /** Fires when the balances request errors. */
  BALANCES_FETCH_FAILED: 'nexus_v2_balances_fetch_failed',
  /** Fires when the SDK refreshes already-cached balances. */
  BALANCES_REFRESHED: 'nexus_v2_balances_refreshed',

  // Catalog Operations (one lifecycle per public call, including cached results)
  CATALOG_FETCH_STARTED: 'nexus_v2_catalog_fetch_started',
  CATALOG_FETCH_SUCCESS: 'nexus_v2_catalog_fetch_success',
  CATALOG_FETCH_FAILED: 'nexus_v2_catalog_fetch_failed',

  // Swap Operations
  /** Fires when swap simulation begins. */
  SWAP_SIMULATION_STARTED: 'nexus_v2_swap_simulation_started',
  /** Fires when swap simulation returns a viable plan. */
  SWAP_SIMULATION_SUCCESS: 'nexus_v2_swap_simulation_success',
  /** Fires when swap simulation throws. */
  SWAP_SIMULATION_FAILED: 'nexus_v2_swap_simulation_failed',
  /** Fires when swapWithExactIn() or swapWithExactOut() is called. */
  SWAP_INITIATED: 'nexus_v2_swap_initiated',
  /** Fires when the swap plan is presented to the user via onIntent. */
  SWAP_PLAN_PREVIEW: 'nexus_v2_swap_plan_preview',
  /** Fires when the user (or default hook) confirms the swap plan. */
  SWAP_PLAN_CONFIRMED: 'nexus_v2_swap_plan_confirmed',
  /** Fires when the user denies the swap plan via onIntent. */
  SWAP_PLAN_REJECTED: 'nexus_v2_swap_plan_rejected',
  /** Fires when the SDK prompts the user to sign an on-chain swap step. */
  SWAP_TRANSACTION_SIGNING_REQUESTED: 'nexus_v2_swap_transaction_signing_requested',
  /** Fires when an on-chain swap step transaction is broadcast. */
  SWAP_TRANSACTION_SUBMITTED: 'nexus_v2_swap_transaction_submitted',
  /** Fires when a non-terminal on-chain swap step is mined. */
  SWAP_STEP_CONFIRMED: 'nexus_v2_swap_step_confirmed',
  /** Fires when the relayer fails to submit the intent on a cross-chain swap. */
  SWAP_INTENT_RELAY_FAILED: 'nexus_v2_swap_intent_relay_failed',
  /** Fires when an individual on-chain swap step fails. */
  SWAP_STEP_FAILED: 'nexus_v2_swap_step_failed',
  /** Fires when the swap completes end-to-end. */
  SWAP_TRANSACTION_SUCCESS: 'nexus_v2_swap_transaction_success',
  /** Fires when the top-level swap promise rejects. */
  SWAP_TRANSACTION_FAILED: 'nexus_v2_swap_transaction_failed',

  // Swap and Execute Operations
  /** Fires when swap-and-execute simulation begins. */
  SWAP_AND_EXECUTE_SIMULATION_STARTED: 'nexus_v2_swap_and_execute_simulation_started',
  /** Fires when swap-and-execute simulation returns a viable plan. */
  SWAP_AND_EXECUTE_SIMULATION_SUCCESS: 'nexus_v2_swap_and_execute_simulation_success',
  /** Fires when swap-and-execute simulation throws. */
  SWAP_AND_EXECUTE_SIMULATION_FAILED: 'nexus_v2_swap_and_execute_simulation_failed',
  /** Fires when swapAndExecute() is called. */
  SWAP_AND_EXECUTE_INITIATED: 'nexus_v2_swap_and_execute_initiated',
  /** Fires when the swap-and-execute plan is presented to the user via onIntent. */
  SWAP_AND_EXECUTE_PLAN_PREVIEW: 'nexus_v2_swap_and_execute_plan_preview',
  /** Fires when the user (or default hook) confirms the swap-and-execute plan. */
  SWAP_AND_EXECUTE_PLAN_CONFIRMED: 'nexus_v2_swap_and_execute_plan_confirmed',
  /** Fires when the user denies the swap-and-execute plan via onIntent. */
  SWAP_AND_EXECUTE_PLAN_REJECTED: 'nexus_v2_swap_and_execute_plan_rejected',
  /** Fires when the SDK prompts the user to sign an on-chain step in the swap leg. */
  SWAP_AND_EXECUTE_SWAP_LEG_SIGNING_REQUESTED:
    'nexus_v2_swap_and_execute_swap_leg_signing_requested',
  /** Fires when an on-chain swap-leg step is broadcast. */
  SWAP_AND_EXECUTE_SWAP_LEG_SUBMITTED: 'nexus_v2_swap_and_execute_swap_leg_submitted',
  /** Fires when a non-terminal on-chain swap-leg step is mined. */
  SWAP_AND_EXECUTE_SWAP_LEG_STEP_CONFIRMED: 'nexus_v2_swap_and_execute_swap_leg_step_confirmed',
  /** Fires when the relayer fails to submit the intent on the swap leg. */
  SWAP_AND_EXECUTE_SWAP_LEG_INTENT_RELAY_FAILED:
    'nexus_v2_swap_and_execute_swap_leg_intent_relay_failed',
  /** Fires when an individual on-chain swap-leg step fails. */
  SWAP_AND_EXECUTE_SWAP_LEG_STEP_FAILED: 'nexus_v2_swap_and_execute_swap_leg_step_failed',
  /** Fires when the swap leg completes (intent fulfillment completed). */
  SWAP_AND_EXECUTE_SWAP_LEG_SUCCESS: 'nexus_v2_swap_and_execute_swap_leg_success',
  /** Fires when the swap leg fails as a whole. */
  SWAP_AND_EXECUTE_SWAP_LEG_FAILED: 'nexus_v2_swap_and_execute_swap_leg_failed',
  /** Fires when the SDK prompts the user to approve a token allowance for the execute leg. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_REQUESTED:
    'nexus_v2_swap_and_execute_execute_leg_allowance_requested',
  /** Fires when the execute-leg allowance approval transaction confirms. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_APPROVED:
    'nexus_v2_swap_and_execute_execute_leg_allowance_approved',
  /** Fires when the execute-leg allowance approval is rejected or fails. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_DENIED:
    'nexus_v2_swap_and_execute_execute_leg_allowance_denied',
  /** Fires when the SDK prompts the user to sign the execute-leg transaction. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_SIGNING_REQUESTED:
    'nexus_v2_swap_and_execute_execute_leg_signing_requested',
  /** Fires when the execute-leg transaction is broadcast. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_SUBMITTED: 'nexus_v2_swap_and_execute_execute_leg_submitted',
  /** Fires when the execute-leg transaction confirms on-chain. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_SUCCESS: 'nexus_v2_swap_and_execute_execute_leg_success',
  /** Fires when the execute leg fails. */
  SWAP_AND_EXECUTE_EXECUTE_LEG_FAILED: 'nexus_v2_swap_and_execute_execute_leg_failed',
  /** Fires when swap-and-execute completes end-to-end. */
  SWAP_AND_EXECUTE_SUCCESS: 'nexus_v2_swap_and_execute_success',
  /** Fires when the top-level swap-and-execute promise rejects. */
  SWAP_AND_EXECUTE_FAILED: 'nexus_v2_swap_and_execute_failed',
  /** Fires when swap-and-execute resolves with the swap leg skipped (e.g. balance already sufficient). */
  SWAP_AND_EXECUTE_SKIPPED: 'nexus_v2_swap_and_execute_skipped',

  // Execute Operations (standalone smart-contract interactions)
  /** Fires when execute simulation begins. */
  EXECUTE_SIMULATION_STARTED: 'nexus_v2_execute_simulation_started',
  /** Fires when execute simulation returns a viable plan. */
  EXECUTE_SIMULATION_SUCCESS: 'nexus_v2_execute_simulation_success',
  /** Fires when execute simulation throws. */
  EXECUTE_SIMULATION_FAILED: 'nexus_v2_execute_simulation_failed',
  /** Fires when execute() is called. */
  EXECUTE_INITIATED: 'nexus_v2_execute_initiated',
  /** Fires when the execute transaction is broadcast (used when waitForReceipt is false). */
  EXECUTE_TRANSACTION_SUBMITTED: 'nexus_v2_execute_transaction_submitted',
  /** Fires when the execute transaction has on-chain finality. */
  EXECUTE_TRANSACTION_SUCCESS: 'nexus_v2_execute_transaction_success',
  /** Fires when the top-level execute promise rejects. */
  EXECUTE_TRANSACTION_FAILED: 'nexus_v2_execute_transaction_failed',

  // Refund Operations
  /** Fires when a refund is initiated for a stuck or expired intent. */
  REFUND_INITIATED: 'nexus_v2_refund_initiated',
  /** Fires when a refund completes. */
  REFUND_COMPLETED: 'nexus_v2_refund_completed',

  // Performance Events
  /** Span event emitted at the end of every tracked operation. */
  OPERATION_PERFORMANCE: 'nexus_v2_operation_performance',

  // UI Events
  /** Page-view event (widget usage). */
  PAGE_VIEWED: 'nexus_v2_page_viewed',
  /** Button-click event (widget usage). */
  BUTTON_CLICKED: 'nexus_v2_button_clicked',

  // List Intents Operations
  /** Fires when listIntents() is called. */
  LIST_INTENTS_INITIATED: 'nexus_v2_list_intents_initiated',
  /** Fires when listIntents() returns. */
  LIST_INTENTS_SUCCESS: 'nexus_v2_list_intents_success',
  /** Fires when listIntents() throws. */
  LIST_INTENTS_FAILED: 'nexus_v2_list_intents_failed',
} as const;

export type NexusAnalyticsEvent = (typeof NexusAnalyticsEvents)[keyof typeof NexusAnalyticsEvents];

/**
 * Stable operation labels passed to `analytics.startOperation()`; surface as
 * the `operation` property on `OPERATION_PERFORMANCE` events.
 */
export const NexusOperationNames = {
  SWAP: 'swap',
  SWAP_AND_EXECUTE: 'swap_and_execute',
  EXECUTE: 'execute',
  EXECUTE_SIMULATION: 'execute_simulation',
  BALANCES_FETCH_SWAP: 'balances_fetch_swap',
  CATALOG_GET_TOKENS: 'catalog_get_tokens',
  CATALOG_GET_TOKEN: 'catalog_get_token',
  CATALOG_GET_TOKENS_BY_CHAIN: 'catalog_get_tokens_by_chain',
  CATALOG_GET_AVAILABLE_SOURCE_TOKENS: 'catalog_get_available_source_tokens',
  CATALOG_GET_AVAILABLE_DESTINATION_TOKENS: 'catalog_get_available_destination_tokens',
  CATALOG_CONFIRM_ROUTE_EXISTS: 'catalog_confirm_route_exists',
  CATALOG_GET_SUPPORTED_CHAINS_FOR_ROUTE: 'catalog_get_supported_chains_for_route',
  LIST_INTENTS: 'list_intents',
  WALLET_CONNECT: 'wallet_connect',
  INITIALIZE: 'initialize',
} as const;

export type NexusOperationName = (typeof NexusOperationNames)[keyof typeof NexusOperationNames];
