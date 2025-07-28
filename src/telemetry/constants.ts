import type { TelemetryEventType, TelemetryCategory, TelemetrySeverity } from '../types';

/**
 * Default telemetry configuration values
 */
export const DEFAULT_TELEMETRY_CONFIG = {
  enabled: false,
  environment: 'development' as const,
  version: '0.1.1',
  sampleRate: 1.0,
  batchSize: 10,
  batchTimeout: 5000,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 10000,
  enableDebug: false,
  enableConsole: false,
  enableLocalStorage: true,
  enableSessionStorage: true,
  enableIndexedDB: false,
  privacySettings: {
    trackUserInteractions: true,
    trackTransactions: true,
    trackErrors: true,
    trackPerformance: true,
    trackNetwork: true,
    trackWallet: true,
    trackUI: true,
    anonymizeData: false,
    maskAddresses: false,
    maskBalances: false,
  },
} as const;

/**
 * Event type to category mapping
 */
export const EVENT_CATEGORY_MAP: Record<TelemetryEventType, TelemetryCategory> = {
  // SDK lifecycle events
  sdk_initialized: 'sdk_lifecycle',
  sdk_error: 'error',
  
  // User interaction events
  user_connected: 'user_interaction',
  user_disconnected: 'user_interaction',
  chain_switched: 'user_interaction',
  account_changed: 'user_interaction',
  ui_component_rendered: 'ui',
  ui_interaction: 'ui',
  button_clicked: 'ui',
  form_submitted: 'ui',
  modal_opened: 'ui',
  modal_closed: 'ui',
  
  // Transaction events
  transaction_started: 'transaction',
  transaction_completed: 'transaction',
  transaction_failed: 'transaction',
  transaction_simulated: 'transaction',
  
  // Bridge events
  bridge_initiated: 'bridge',
  bridge_completed: 'bridge',
  bridge_failed: 'bridge',
  
  // Transfer events
  transfer_initiated: 'transfer',
  transfer_completed: 'transfer',
  transfer_failed: 'transfer',
  
  // Execute events
  execute_initiated: 'execute',
  execute_completed: 'execute',
  execute_failed: 'execute',
  
  // Approval events
  approval_requested: 'approval',
  approval_granted: 'approval',
  approval_denied: 'approval',
  
  // Wallet events
  wallet_connected: 'wallet',
  wallet_disconnected: 'wallet',
  wallet_switched: 'wallet',
  
  // Network events
  network_request: 'network',
  network_response: 'network',
  
  // Performance events
  performance_metric: 'performance',
  balance_checked: 'performance',
  gas_estimated: 'performance',
  simulation_requested: 'performance',
  
  // Cache events
  cache_hit: 'performance',
  cache_miss: 'performance',
  
  // Error events
  error_occurred: 'error',
  validation_error: 'error',
  timeout_occurred: 'error',
  rate_limit_hit: 'error',
  
  // Feature events
  feature_used: 'analytics',
  unsupported_feature: 'analytics',
  deprecated_feature_used: 'analytics',
  experimental_feature_used: 'analytics',
  
  // Retry and fallback events
  retry_attempted: 'error',
  fallback_used: 'error',
  
  // Privacy and consent events
  analytics_consent_changed: 'privacy',
  privacy_settings_changed: 'privacy',
  telemetry_enabled: 'privacy',
  telemetry_disabled: 'privacy',
} as const;

/**
 * Event type to severity mapping
 */
export const EVENT_SEVERITY_MAP: Record<TelemetryEventType, TelemetrySeverity> = {
  // Debug level events
  sdk_initialized: 'debug',
  ui_component_rendered: 'debug',
  cache_hit: 'debug',
  cache_miss: 'debug',
  performance_metric: 'debug',
  balance_checked: 'debug',
  gas_estimated: 'debug',
  simulation_requested: 'debug',
  
  // Info level events
  user_connected: 'info',
  user_disconnected: 'info',
  chain_switched: 'info',
  account_changed: 'info',
  transaction_started: 'info',
  transaction_completed: 'info',
  bridge_initiated: 'info',
  bridge_completed: 'info',
  transfer_initiated: 'info',
  transfer_completed: 'info',
  execute_initiated: 'info',
  execute_completed: 'info',
  approval_requested: 'info',
  approval_granted: 'info',
  wallet_connected: 'info',
  wallet_disconnected: 'info',
  wallet_switched: 'info',
  network_request: 'info',
  network_response: 'info',
  ui_interaction: 'info',
  button_clicked: 'info',
  form_submitted: 'info',
  modal_opened: 'info',
  modal_closed: 'info',
  feature_used: 'info',
  retry_attempted: 'info',
  fallback_used: 'info',
  analytics_consent_changed: 'info',
  privacy_settings_changed: 'info',
  telemetry_enabled: 'info',
  telemetry_disabled: 'info',
  
  // Warning level events
  approval_denied: 'warn',
  unsupported_feature: 'warn',
  deprecated_feature_used: 'warn',
  experimental_feature_used: 'warn',
  timeout_occurred: 'warn',
  rate_limit_hit: 'warn',
  
  // Error level events
  sdk_error: 'error',
  transaction_failed: 'error',
  bridge_failed: 'error',
  transfer_failed: 'error',
  execute_failed: 'error',
  error_occurred: 'error',
  validation_error: 'error',
  transaction_simulated: 'error',
} as const;

/**
 * Storage keys for telemetry data
 */
export const STORAGE_KEYS = {
  TELEMETRY_CONFIG: 'nexus_telemetry_config',
  TELEMETRY_EVENTS: 'nexus_telemetry_events',
  TELEMETRY_SESSION: 'nexus_telemetry_session',
  TELEMETRY_CONSENT: 'nexus_telemetry_consent',
  TELEMETRY_USER_ID: 'nexus_telemetry_user_id',
  TELEMETRY_WALLET_ADDRESS: 'nexus_telemetry_wallet_address',
  TELEMETRY_CHAIN_ID: 'nexus_telemetry_chain_id',
  TELEMETRY_NETWORK: 'nexus_telemetry_network',
} as const;

/**
 * Default telemetry endpoints
 */
export const TELEMETRY_ENDPOINTS = {
  PRODUCTION: 'https://telemetry.availproject.co',
  STAGING: 'https://telemetry-staging.availproject.co',
  DEVELOPMENT: 'https://telemetry-dev.availproject.co',
} as const;

/**
 * Telemetry event priorities for batching
 */
export const EVENT_PRIORITIES: Record<TelemetryEventType, number> = {
  // High priority events (sent immediately)
  sdk_error: 1,
  error_occurred: 1,
  transaction_failed: 1,
  bridge_failed: 1,
  transfer_failed: 1,
  execute_failed: 1,
  timeout_occurred: 1,
  rate_limit_hit: 1,
  
  // Medium priority events (batched with shorter timeout)
  user_connected: 2,
  user_disconnected: 2,
  wallet_connected: 2,
  wallet_disconnected: 2,
  transaction_completed: 2,
  bridge_completed: 2,
  transfer_completed: 2,
  execute_completed: 2,
  approval_granted: 2,
  approval_denied: 2,
  
  // Low priority events (batched with longer timeout)
  sdk_initialized: 3,
  chain_switched: 3,
  account_changed: 3,
  ui_interaction: 3,
  button_clicked: 3,
  form_submitted: 3,
  modal_opened: 3,
  modal_closed: 3,
  performance_metric: 3,
  balance_checked: 3,
  gas_estimated: 3,
  simulation_requested: 3,
  cache_hit: 3,
  cache_miss: 3,
  network_request: 3,
  network_response: 3,
  ui_component_rendered: 3,
  transaction_started: 3,
  bridge_initiated: 3,
  transfer_initiated: 3,
  execute_initiated: 3,
  approval_requested: 3,
  wallet_switched: 3,
  feature_used: 3,
  unsupported_feature: 3,
  deprecated_feature_used: 3,
  experimental_feature_used: 3,
  retry_attempted: 3,
  fallback_used: 3,
  validation_error: 3,
  transaction_simulated: 3,
  analytics_consent_changed: 3,
  privacy_settings_changed: 3,
  telemetry_enabled: 3,
  telemetry_disabled: 3,
} as const;

/**
 * Maximum values for telemetry data
 */
export const TELEMETRY_LIMITS = {
  MAX_EVENT_SIZE: 1024 * 1024, // 1MB
  MAX_BATCH_SIZE: 100,
  MAX_RETRIES: 5,
  MAX_STORAGE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_SESSION_DURATION: 24 * 60 * 60 * 1000, // 24 hours
  MAX_EVENT_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const; 