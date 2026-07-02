/**
 * Event taxonomy for Nexus SDK Analytics.
 * Naming convention: nexus_{category}_{action}_{status}
 */

export const NexusAnalyticsEvents = {
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

  // Bridge Operations
  /** Fires when bridge simulation begins. */
  BRIDGE_SIMULATION_STARTED: 'nexus_v2_bridge_simulation_started',
  /** Fires when bridge simulation returns a viable plan. */
  BRIDGE_SIMULATION_SUCCESS: 'nexus_v2_bridge_simulation_success',
  /** Fires when bridge simulation throws. */
  BRIDGE_SIMULATION_FAILED: 'nexus_v2_bridge_simulation_failed',
  /** Fires when bridge() is called. */
  BRIDGE_INITIATED: 'nexus_v2_bridge_initiated',
  /** Fires when the bridge plan is presented to the user via onIntent. */
  BRIDGE_PLAN_PREVIEW: 'nexus_v2_bridge_plan_preview',
  /** Fires when the user (or default hook) confirms the bridge plan. */
  BRIDGE_PLAN_CONFIRMED: 'nexus_v2_bridge_plan_confirmed',
  /** Fires when the user denies the bridge plan via onIntent. */
  BRIDGE_PLAN_REJECTED: 'nexus_v2_bridge_plan_rejected',
  /** Fires when the user signs the bridge intent payload. */
  BRIDGE_INTENT_SIGNED: 'nexus_v2_bridge_intent_signed',
  /** Fires when the bridge intent signature step fails. */
  BRIDGE_INTENT_SIGN_FAILED: 'nexus_v2_bridge_intent_sign_failed',
  /** Fires when the SDK prompts the user to approve a token allowance for the bridge. */
  BRIDGE_ALLOWANCE_REQUESTED: 'nexus_v2_bridge_allowance_requested',
  /** Fires when the bridge allowance approval transaction confirms. */
  BRIDGE_ALLOWANCE_APPROVED: 'nexus_v2_bridge_allowance_approved',
  /** Fires when the bridge allowance approval is rejected or fails. */
  BRIDGE_ALLOWANCE_DENIED: 'nexus_v2_bridge_allowance_denied',
  /** Fires when the SDK prompts the user to sign the bridge deposit transaction. */
  BRIDGE_TRANSACTION_SIGNING_REQUESTED: 'nexus_v2_bridge_transaction_signing_requested',
  /** Fires when the source-chain bridge deposit transaction is broadcast. */
  BRIDGE_TRANSACTION_SUBMITTED: 'nexus_v2_bridge_transaction_submitted',
  /** Fires when the source-chain bridge deposit is mined. */
  BRIDGE_VAULT_DEPOSIT_CONFIRMED: 'nexus_v2_bridge_vault_deposit_confirmed',
  /** Fires when the source-chain bridge deposit reverts or is rejected. */
  BRIDGE_DEPOSIT_FAILED: 'nexus_v2_bridge_deposit_failed',
  /** Fires when destination-chain settlement (solver fill) fails. */
  BRIDGE_FILL_FAILED: 'nexus_v2_bridge_fill_failed',
  /** Fires when the bridge completes end-to-end. */
  BRIDGE_TRANSACTION_SUCCESS: 'nexus_v2_bridge_transaction_success',
  /** Fires when the top-level bridge promise rejects. */
  BRIDGE_TRANSACTION_FAILED: 'nexus_v2_bridge_transaction_failed',

  // Transfer Operations
  /** Fires when transfer simulation begins. */
  TRANSFER_SIMULATION_STARTED: 'nexus_v2_transfer_simulation_started',
  /** Fires when transfer simulation returns a viable plan. */
  TRANSFER_SIMULATION_SUCCESS: 'nexus_v2_transfer_simulation_success',
  /** Fires when transfer simulation throws. */
  TRANSFER_SIMULATION_FAILED: 'nexus_v2_transfer_simulation_failed',
  /** Fires when bridgeAndTransfer() is called. */
  TRANSFER_INITIATED: 'nexus_v2_transfer_initiated',
  /** Fires when the transfer plan is presented to the user via onIntent. */
  TRANSFER_PLAN_PREVIEW: 'nexus_v2_transfer_plan_preview',
  /** Fires when the user (or default hook) confirms the transfer plan. */
  TRANSFER_PLAN_CONFIRMED: 'nexus_v2_transfer_plan_confirmed',
  /** Fires when the user denies the transfer plan via onIntent. */
  TRANSFER_PLAN_REJECTED: 'nexus_v2_transfer_plan_rejected',
  /** Fires when the user signs the transfer intent payload. */
  TRANSFER_INTENT_SIGNED: 'nexus_v2_transfer_intent_signed',
  /** Fires when the transfer intent signature step fails. */
  TRANSFER_INTENT_SIGN_FAILED: 'nexus_v2_transfer_intent_sign_failed',
  /** Fires when the SDK prompts the user to approve a token allowance for the transfer. */
  TRANSFER_ALLOWANCE_REQUESTED: 'nexus_v2_transfer_allowance_requested',
  /** Fires when the transfer allowance approval transaction confirms. */
  TRANSFER_ALLOWANCE_APPROVED: 'nexus_v2_transfer_allowance_approved',
  /** Fires when the transfer allowance approval is rejected or fails. */
  TRANSFER_ALLOWANCE_DENIED: 'nexus_v2_transfer_allowance_denied',
  /** Fires when the SDK prompts the user to sign the transfer deposit transaction. */
  TRANSFER_TRANSACTION_SIGNING_REQUESTED: 'nexus_v2_transfer_transaction_signing_requested',
  /** Fires when the source-chain transfer deposit transaction is broadcast. */
  TRANSFER_TRANSACTION_SUBMITTED: 'nexus_v2_transfer_transaction_submitted',
  /** Fires when the source-chain transfer deposit is mined. */
  TRANSFER_VAULT_DEPOSIT_CONFIRMED: 'nexus_v2_transfer_vault_deposit_confirmed',
  /** Fires when the source-chain transfer deposit reverts or is rejected. */
  TRANSFER_DEPOSIT_FAILED: 'nexus_v2_transfer_deposit_failed',
  /** Fires when destination-chain settlement (solver fill) fails. */
  TRANSFER_FILL_FAILED: 'nexus_v2_transfer_fill_failed',
  /** Fires when the transfer completes end-to-end. */
  TRANSFER_TRANSACTION_SUCCESS: 'nexus_v2_transfer_transaction_success',
  /** Fires when the top-level transfer promise rejects. */
  TRANSFER_TRANSACTION_FAILED: 'nexus_v2_transfer_transaction_failed',

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
  /** Fires when the relayer fails to submit the bridge intent on a cross-chain swap. */
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
  /** Fires when the relayer fails to submit the bridge intent on the swap leg. */
  SWAP_AND_EXECUTE_SWAP_LEG_INTENT_RELAY_FAILED:
    'nexus_v2_swap_and_execute_swap_leg_intent_relay_failed',
  /** Fires when an individual on-chain swap-leg step fails. */
  SWAP_AND_EXECUTE_SWAP_LEG_STEP_FAILED: 'nexus_v2_swap_and_execute_swap_leg_step_failed',
  /** Fires when the swap leg completes (destination_swap confirmed or bridge_fill completed). */
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

  // Bridge and Execute Operations
  /** Fires when bridge-and-execute simulation begins. */
  BRIDGE_AND_EXECUTE_SIMULATION_STARTED: 'nexus_v2_bridge_and_execute_simulation_started',
  /** Fires when bridge-and-execute simulation returns a viable plan. */
  BRIDGE_AND_EXECUTE_SIMULATION_SUCCESS: 'nexus_v2_bridge_and_execute_simulation_success',
  /** Fires when bridge-and-execute simulation throws. */
  BRIDGE_AND_EXECUTE_SIMULATION_FAILED: 'nexus_v2_bridge_and_execute_simulation_failed',
  /** Fires when bridgeAndExecute() is called. */
  BRIDGE_AND_EXECUTE_INITIATED: 'nexus_v2_bridge_and_execute_initiated',
  /** Fires when the bridge-and-execute plan is presented to the user via onIntent. */
  BRIDGE_AND_EXECUTE_PLAN_PREVIEW: 'nexus_v2_bridge_and_execute_plan_preview',
  /** Fires when the user (or default hook) confirms the bridge-and-execute plan. */
  BRIDGE_AND_EXECUTE_PLAN_CONFIRMED: 'nexus_v2_bridge_and_execute_plan_confirmed',
  /** Fires when the user denies the bridge-and-execute plan via onIntent. */
  BRIDGE_AND_EXECUTE_PLAN_REJECTED: 'nexus_v2_bridge_and_execute_plan_rejected',
  /** Fires when the user signs the bridge-leg intent payload. */
  BRIDGE_AND_EXECUTE_INTENT_SIGNED: 'nexus_v2_bridge_and_execute_intent_signed',
  /** Fires when the bridge-leg intent signature step fails. */
  BRIDGE_AND_EXECUTE_INTENT_SIGN_FAILED: 'nexus_v2_bridge_and_execute_intent_sign_failed',
  /** Fires when the SDK prompts the user to approve a token allowance for the bridge leg. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_ALLOWANCE_REQUESTED:
    'nexus_v2_bridge_and_execute_bridge_leg_allowance_requested',
  /** Fires when the bridge-leg allowance approval transaction confirms. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_ALLOWANCE_APPROVED:
    'nexus_v2_bridge_and_execute_bridge_leg_allowance_approved',
  /** Fires when the bridge-leg allowance approval is rejected or fails. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_ALLOWANCE_DENIED:
    'nexus_v2_bridge_and_execute_bridge_leg_allowance_denied',
  /** Fires when the SDK prompts the user to sign the bridge-leg deposit transaction. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_SIGNING_REQUESTED:
    'nexus_v2_bridge_and_execute_bridge_leg_signing_requested',
  /** Fires when the bridge-leg deposit transaction is broadcast. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_SUBMITTED: 'nexus_v2_bridge_and_execute_bridge_leg_submitted',
  /** Fires when the bridge-leg source-chain deposit is mined. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_DEPOSIT_CONFIRMED:
    'nexus_v2_bridge_and_execute_bridge_leg_deposit_confirmed',
  /** Fires when the bridge-leg source-chain deposit reverts. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_DEPOSIT_FAILED:
    'nexus_v2_bridge_and_execute_bridge_leg_deposit_failed',
  /** Fires when the bridge-leg destination-chain fill fails. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_FILL_FAILED: 'nexus_v2_bridge_and_execute_bridge_leg_fill_failed',
  /** Fires when the bridge leg completes end-to-end. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_SUCCESS: 'nexus_v2_bridge_and_execute_bridge_leg_success',
  /** Fires when the bridge leg fails as a whole. */
  BRIDGE_AND_EXECUTE_BRIDGE_LEG_FAILED: 'nexus_v2_bridge_and_execute_bridge_leg_failed',
  /** Fires when the SDK prompts the user to approve a token allowance for the execute leg. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_REQUESTED:
    'nexus_v2_bridge_and_execute_execute_leg_allowance_requested',
  /** Fires when the execute-leg allowance approval transaction confirms. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_APPROVED:
    'nexus_v2_bridge_and_execute_execute_leg_allowance_approved',
  /** Fires when the execute-leg allowance approval is rejected or fails. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_DENIED:
    'nexus_v2_bridge_and_execute_execute_leg_allowance_denied',
  /** Fires when the SDK prompts the user to sign the execute-leg transaction. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_SIGNING_REQUESTED:
    'nexus_v2_bridge_and_execute_execute_leg_signing_requested',
  /** Fires when the execute-leg transaction is broadcast. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_SUBMITTED: 'nexus_v2_bridge_and_execute_execute_leg_submitted',
  /** Fires when the execute-leg transaction confirms on-chain. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_SUCCESS: 'nexus_v2_bridge_and_execute_execute_leg_success',
  /** Fires when the execute leg fails. */
  BRIDGE_AND_EXECUTE_EXECUTE_LEG_FAILED: 'nexus_v2_bridge_and_execute_execute_leg_failed',
  /** Fires when bridge-and-execute completes end-to-end. */
  BRIDGE_AND_EXECUTE_TRANSACTION_SUCCESS: 'nexus_v2_bridge_and_execute_transaction_success',
  /** Fires when the top-level bridge-and-execute promise rejects. */
  BRIDGE_AND_EXECUTE_TRANSACTION_FAILED: 'nexus_v2_bridge_and_execute_transaction_failed',

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

  // Calculate Max For Swap Operations
  /** Fires when calculateMaxForSwap() is called. */
  CALCULATE_MAX_FOR_SWAP_INITIATED: 'nexus_v2_calculate_max_for_swap_initiated',
  /** Fires when calculateMaxForSwap() returns. */
  CALCULATE_MAX_FOR_SWAP_SUCCESS: 'nexus_v2_calculate_max_for_swap_success',
  /** Fires when calculateMaxForSwap() throws. */
  CALCULATE_MAX_FOR_SWAP_FAILED: 'nexus_v2_calculate_max_for_swap_failed',
} as const;

export type NexusAnalyticsEvent = (typeof NexusAnalyticsEvents)[keyof typeof NexusAnalyticsEvents];

/**
 * Stable operation labels passed to `analytics.startOperation()`; surface as
 * the `operation` property on `OPERATION_PERFORMANCE` events.
 */
export const NexusOperationNames = {
  BRIDGE: 'bridge',
  BRIDGE_SIMULATION: 'bridge_simulation',
  TRANSFER: 'transfer',
  TRANSFER_SIMULATION: 'transfer_simulation',
  SWAP: 'swap',
  SWAP_AND_EXECUTE: 'swap_and_execute',
  EXECUTE: 'execute',
  EXECUTE_SIMULATION: 'execute_simulation',
  BRIDGE_AND_EXECUTE: 'bridge_and_execute',
  BRIDGE_AND_EXECUTE_SIMULATION: 'bridge_and_execute_simulation',
  BALANCES_FETCH_BRIDGE: 'balances_fetch_bridge',
  BALANCES_FETCH_SWAP: 'balances_fetch_swap',
  LIST_INTENTS: 'list_intents',
  CALCULATE_MAX_FOR_SWAP: 'calculate_max_for_swap',
  WALLET_CONNECT: 'wallet_connect',
  INITIALIZE: 'initialize',
} as const;

export type NexusOperationName = (typeof NexusOperationNames)[keyof typeof NexusOperationNames];
