/**
 * Comprehensive event taxonomy for Nexus SDK Analytics
 * Naming convention: nexus_{category}_{action}_{status}
 */

export const NexusAnalyticsEvents = {
  // SDK Lifecycle Events
  SDK_INITIALIZED: 'nexus_sdk_initialized',
  SDK_INITIALIZATION_FAILED: 'nexus_sdk_initialization_failed',
  SDK_DEINITIALIZED: 'nexus_sdk_deinitialized',

  // Session Events
  SESSION_STARTED: 'nexus_session_started',
  SESSION_ENDED: 'nexus_session_ended',

  // Wallet Events
  WALLET_CONNECT_CLICKED: 'nexus_wallet_connect_clicked',
  WALLET_CONNECTED: 'nexus_wallet_connected',
  WALLET_CONNECT_FAILED: 'nexus_wallet_connect_failed',
  WALLET_DISCONNECTED: 'nexus_wallet_disconnected',
  WALLET_CHANGED: 'nexus_wallet_changed',
  WALLET_NETWORK_CHANGED: 'nexus_wallet_network_changed',

  // Balance Operations
  BALANCES_FETCH_STARTED: 'nexus_balances_fetch_started',
  BALANCES_FETCH_SUCCESS: 'nexus_balances_fetch_success',
  BALANCES_FETCH_FAILED: 'nexus_balances_fetch_failed',
  BALANCES_REFRESHED: 'nexus_balances_refreshed',

  // Bridge Operations
  BRIDGE_SIMULATION_STARTED: 'nexus_bridge_simulation_started',
  BRIDGE_SIMULATION_SUCCESS: 'nexus_bridge_simulation_success',
  BRIDGE_SIMULATION_FAILED: 'nexus_bridge_simulation_failed',
  BRIDGE_INITIATED: 'nexus_bridge_initiated',
  BRIDGE_INTENT_SHOWN: 'nexus_bridge_intent_shown',
  BRIDGE_INTENT_APPROVED: 'nexus_bridge_intent_approved',
  BRIDGE_INTENT_DENIED: 'nexus_bridge_intent_denied',
  BRIDGE_ALLOWANCE_REQUESTED: 'nexus_bridge_allowance_requested',
  BRIDGE_ALLOWANCE_APPROVED: 'nexus_bridge_allowance_approved',
  BRIDGE_ALLOWANCE_DENIED: 'nexus_bridge_allowance_denied',
  BRIDGE_TRANSACTION_SUBMITTED: 'nexus_bridge_transaction_submitted',
  BRIDGE_TRANSACTION_SUCCESS: 'nexus_bridge_transaction_success',
  BRIDGE_TRANSACTION_FAILED: 'nexus_bridge_transaction_failed',

  // Transfer Operations
  TRANSFER_SIMULATION_STARTED: 'nexus_transfer_simulation_started',
  TRANSFER_SIMULATION_SUCCESS: 'nexus_transfer_simulation_success',
  TRANSFER_SIMULATION_FAILED: 'nexus_transfer_simulation_failed',
  TRANSFER_INITIATED: 'nexus_transfer_initiated',
  TRANSFER_INTENT_SHOWN: 'nexus_transfer_intent_shown',
  TRANSFER_INTENT_APPROVED: 'nexus_transfer_intent_approved',
  TRANSFER_INTENT_DENIED: 'nexus_transfer_intent_denied',
  TRANSFER_TRANSACTION_SUBMITTED: 'nexus_transfer_transaction_submitted',
  TRANSFER_TRANSACTION_SUCCESS: 'nexus_transfer_transaction_success',
  TRANSFER_TRANSACTION_FAILED: 'nexus_transfer_transaction_failed',

  // Swap Operations
  SWAP_SIMULATION_STARTED: 'nexus_swap_simulation_started',
  SWAP_SIMULATION_SUCCESS: 'nexus_swap_simulation_success',
  SWAP_SIMULATION_FAILED: 'nexus_swap_simulation_failed',
  SWAP_INITIATED: 'nexus_swap_initiated',
  SWAP_TRANSACTION_SUCCESS: 'nexus_swap_transaction_success',
  SWAP_TRANSACTION_FAILED: 'nexus_swap_transaction_failed',

  // Execute Operations (Smart Contract Interactions)
  EXECUTE_SIMULATION_STARTED: 'nexus_execute_simulation_started',
  EXECUTE_SIMULATION_SUCCESS: 'nexus_execute_simulation_success',
  EXECUTE_SIMULATION_FAILED: 'nexus_execute_simulation_failed',
  EXECUTE_INITIATED: 'nexus_execute_initiated',
  EXECUTE_TRANSACTION_SUCCESS: 'nexus_execute_transaction_success',
  EXECUTE_TRANSACTION_FAILED: 'nexus_execute_transaction_failed',

  // Bridge and Execute Operations
  BRIDGE_AND_EXECUTE_SIMULATION_STARTED: 'nexus_bridge_and_execute_simulation_started',
  BRIDGE_AND_EXECUTE_SIMULATION_SUCCESS: 'nexus_bridge_and_execute_simulation_success',
  BRIDGE_AND_EXECUTE_SIMULATION_FAILED: 'nexus_bridge_and_execute_simulation_failed',
  BRIDGE_AND_EXECUTE_INITIATED: 'nexus_bridge_and_execute_initiated',
  BRIDGE_AND_EXECUTE_TRANSACTION_SUCCESS: 'nexus_bridge_and_execute_transaction_success',
  BRIDGE_AND_EXECUTE_TRANSACTION_FAILED: 'nexus_bridge_and_execute_transaction_failed',

  // Refund Operations
  REFUND_INITIATED: 'nexus_refund_initiated',
  REFUND_COMPLETED: 'nexus_refund_completed',

  // Error Events
  ERROR_OCCURRED: 'nexus_error_occurred',
  API_ERROR: 'nexus_api_error',
  NETWORK_ERROR: 'nexus_network_error',
  USER_REJECTED: 'nexus_user_rejected',

  // Performance Events
  OPERATION_PERFORMANCE: 'nexus_operation_performance',

  // UI Events (primarily for widget usage)
  PAGE_VIEWED: 'nexus_page_viewed',
  BUTTON_CLICKED: 'nexus_button_clicked',
} as const;

export type NexusAnalyticsEvent = (typeof NexusAnalyticsEvents)[keyof typeof NexusAnalyticsEvents];
