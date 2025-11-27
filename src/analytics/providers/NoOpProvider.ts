/**
 * No-op analytics provider
 * Used when analytics is disabled or for testing
 */
import { AnalyticsProvider } from './AnalyticsProvider';

export class NoOpProvider implements AnalyticsProvider {
  private initialized = false;

  initialize(): void {
    this.initialized = true;
  }

  track(_event: string, _properties?: Record<string, unknown>): void {
    // No-op
  }

  identify(_userId: string, _properties?: Record<string, unknown>): void {
    // No-op
  }

  register(_properties: Record<string, unknown>): void {
    // No-op
  }

  reset(): void {
    // No-op
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
