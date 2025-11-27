/**
 * Base interface for analytics providers
 * Implement this interface to create custom analytics providers
 */
export interface AnalyticsProvider {
  /**
   * Initialize the analytics provider
   */
  initialize(): void;

  /**
   * Track an event with optional properties
   * @param event - The event name
   * @param properties - Additional event properties
   */
  track(event: string, properties?: Record<string, unknown>): void;

  /**
   * Identify a user
   * @param userId - The unique user identifier (e.g., wallet address)
   * @param properties - User properties
   */
  identify(userId: string, properties?: Record<string, unknown>): void;

  /**
   * Register global properties that are sent with every event
   * @param properties - Global properties
   */
  register(properties: Record<string, unknown>): void;

  /**
   * Reset user identification and clear session data
   */
  reset(): void;

  /**
   * Check if the provider is initialized
   * @returns true if initialized, false otherwise
   */
  isInitialized(): boolean;
}
