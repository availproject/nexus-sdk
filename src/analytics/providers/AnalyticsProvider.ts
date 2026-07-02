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
   * Register an additional id as an alias of the current distinct id so
   * pre-identify events attach to the same user. Call before identify().
   * @param aliasId - The new id to alias.
   */
  alias?(aliasId: string): void;

  /**
   * Associates the current user with a group.
   * @param groupType - The group taxonomy.
   * @param groupKey - The group identifier within the type.
   * @param properties - Optional group properties.
   */
  group?(groupType: string, groupKey: string, properties?: Record<string, unknown>): void;

  /**
   * Check if the provider is initialized
   * @returns true if initialized, false otherwise
   */
  isInitialized(): boolean;
}
