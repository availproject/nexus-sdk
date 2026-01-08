/**
 * PostHog analytics provider implementation
 */
import posthog, { type PostHog } from 'posthog-js';
import type { AnalyticsProvider } from './AnalyticsProvider';

export interface PostHogConfig {
  apiKey: string;
  apiHost?: string;
  sessionRecording?: boolean;
  debug?: boolean;
}

export class PostHogProvider implements AnalyticsProvider {
  private initialized = false;
  private readonly config: PostHogConfig;

  constructor(config: PostHogConfig) {
    this.config = config;
  }

  initialize(): void {
    // Prevent double initialization
    if (this.initialized) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Already initialized');
      }
      return;
    }

    // Check if running in browser
    if (typeof window === 'undefined') {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Not in browser environment, skipping initialization');
      }
      return;
    }

    try {
      posthog.init(this.config.apiKey, {
        api_host: this.config.apiHost || 'https://app.posthog.com',
        person_profiles: 'identified_only', // Only create profiles for identified users
        autocapture: false, // Manual tracking only for SDK operations
        capture_pageview: false, // Manual pageview tracking
        capture_pageleave: true, // Track when users leave
        session_recording: this.config.sessionRecording
          ? {
              maskAllInputs: false,
              maskTextSelector: '.sensitive', // Mask elements with .sensitive class
            }
          : undefined,
        loaded: (ph: PostHog) => {
          if (this.config.debug) {
            console.log('[PostHogProvider] Initialized successfully');
            ph.debug();
          }
        },
      });

      this.initialized = true;
    } catch (error) {
      console.error('[PostHogProvider] Initialization failed:', error);
    }
  }

  track(event: string, properties?: Record<string, unknown>): void {
    if (!this.initialized) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Cannot track event - not initialized:', event);
      }
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    try {
      posthog.capture(event, properties);
    } catch (error) {
      console.error('[PostHogProvider] Failed to track event:', event, error);
    }
  }

  identify(userId: string, properties?: Record<string, unknown>): void {
    if (!this.initialized) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Cannot identify user - not initialized:', userId);
      }
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    try {
      posthog.identify(userId, {
        ...properties,
        firstSeen: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[PostHogProvider] Failed to identify user:', error);
    }
  }

  register(properties: Record<string, unknown>): void {
    if (!this.initialized) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Cannot register properties - not initialized');
      }
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    try {
      posthog.register(properties);
    } catch (error) {
      console.error('[PostHogProvider] Failed to register properties:', error);
    }
  }

  reset(): void {
    if (!this.initialized) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    try {
      posthog.reset();
    } catch (error) {
      console.error('[PostHogProvider] Failed to reset:', error);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the PostHog instance for advanced usage
   */
  getPostHog() {
    return posthog;
  }
}
