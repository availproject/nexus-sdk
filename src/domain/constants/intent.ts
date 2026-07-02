export const INTENT_EXPIRY = 15 * 60 * 1000;

// Default minutes to wait for a bridge intent to be filled before timing out. Single source of
// truth for the `fillTimeoutMinutes` fallback across the bridge, swap, and SDK flows.
export const DEFAULT_FILL_TIMEOUT_MINUTES = 5;
