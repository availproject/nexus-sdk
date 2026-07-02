/**
 * PostHog analytics provider. Uses a named instance ('avail-nexus') to coexist
 * with an integrator's own `posthog.init()` on the default singleton.
 */
import posthog, { type PostHog, type PostHogInterface } from 'posthog-js';
import { getLogger } from '../../domain/utils/logger';
import type { AnalyticsProvider } from './AnalyticsProvider';

export interface PostHogConfig {
  apiKey: string;
  apiHost?: string;
  sessionRecording?: boolean;
  debug?: boolean;
}

const logger = getLogger();
const POSTHOG_INSTANCE_NAME = 'avail-nexus';

export class PostHogProvider implements AnalyticsProvider {
  private initialized = false;
  private readonly config: PostHogConfig;
  private instance: PostHog | null = null;

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
      // Third arg is the instance name; keeps this provider off the global singleton.
      const instance = posthog.init(
        this.config.apiKey,
        {
          api_host: this.config.apiHost || 'https://app.posthog.com',
          person_profiles: 'identified_only',
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: true,
          session_recording: this.config.sessionRecording
            ? {
                maskAllInputs: false,
                maskTextSelector: '.sensitive',
              }
            : undefined,
          loaded: (ph: PostHogInterface) => {
            if (this.config.debug) {
              logger.debug('[PostHogProvider] Initialized successfully');
              ph.debug();
            }
          },
        },
        POSTHOG_INSTANCE_NAME
      );

      this.instance = instance ?? null;
      this.initialized = true;
    } catch (error) {
      console.error('[PostHogProvider] Initialization failed:', error);
    }
  }

  track(event: string, properties?: Record<string, unknown>): void {
    if (!this.initialized || !this.instance) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Cannot track event - not initialized:', event);
      }
      return;
    }

    try {
      this.instance.capture(event, properties);
    } catch (error) {
      console.error('[PostHogProvider] Failed to track event:', event, error);
    }
  }

  identify(userId: string, properties?: Record<string, unknown>): void {
    if (!this.initialized || !this.instance) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Cannot identify user - not initialized:', userId);
      }
      return;
    }

    try {
      // firstSeen as $set_once so it isn't overwritten on every identify call.
      const setProps = { ...properties };
      this.instance.identify(userId, setProps, { firstSeen: new Date().toISOString() });
    } catch (error) {
      console.error('[PostHogProvider] Failed to identify user:', error);
    }
  }

  register(properties: Record<string, unknown>): void {
    if (!this.initialized || !this.instance) {
      if (this.config.debug) {
        console.warn('[PostHogProvider] Cannot register properties - not initialized');
      }
      return;
    }

    try {
      this.instance.register(properties);
    } catch (error) {
      console.error('[PostHogProvider] Failed to register properties:', error);
    }
  }

  alias(aliasId: string): void {
    if (!this.initialized || !this.instance) return;
    try {
      // posthog-js: alias(id) registers id as an alias of the current distinct
      // id. Call before identify() to merge pre-identify events.
      this.instance.alias(aliasId);
    } catch (error) {
      console.error('[PostHogProvider] Failed to alias:', error);
    }
  }

  group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
    if (!this.initialized || !this.instance) return;
    try {
      this.instance.group(groupType, groupKey, properties);
    } catch (error) {
      console.error('[PostHogProvider] Failed to set group:', error);
    }
  }

  reset(): void {
    if (!this.initialized || !this.instance) {
      return;
    }

    try {
      this.instance.reset();
    } catch (error) {
      console.error('[PostHogProvider] Failed to reset:', error);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the named PostHog instance for advanced usage
   */
  getPostHog(): PostHog | null {
    return this.instance;
  }
}
