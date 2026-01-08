/**
 * Session management for analytics tracking
 */
import type { SessionProperties } from './types';

export class SessionManager {
  private sessionId: string;
  private sessionStartTime: number;
  private operationsAttempted = 0;
  private operationsSucceeded = 0;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    // Use crypto.randomUUID() if available (browser), otherwise fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for Node.js or older browsers
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get session start properties
   */
  getSessionStartProperties(url?: string, referrer?: string): SessionProperties {
    return {
      sessionId: this.sessionId,
      url,
      referrer,
    };
  }

  /**
   * Get session end properties
   */
  getSessionEndProperties(): SessionProperties {
    const sessionDuration = Date.now() - this.sessionStartTime;
    const successRate =
      this.operationsAttempted > 0
        ? (this.operationsSucceeded / this.operationsAttempted) * 100
        : 0;

    return {
      sessionId: this.sessionId,
      sessionDuration,
      operationsAttempted: this.operationsAttempted,
      operationsSucceeded: this.operationsSucceeded,
      successRate,
    };
  }

  /**
   * Track an operation attempt
   */
  trackOperationAttempt(): void {
    this.operationsAttempted++;
  }

  /**
   * Track a successful operation
   */
  trackOperationSuccess(): void {
    this.operationsSucceeded++;
  }

  /**
   * Get current operation counts
   */
  getOperationCounts(): { attempted: number; succeeded: number } {
    return {
      attempted: this.operationsAttempted,
      succeeded: this.operationsSucceeded,
    };
  }

  /**
   * Reset the session (create new session)
   */
  reset(): void {
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();
    this.operationsAttempted = 0;
    this.operationsSucceeded = 0;
  }
}
