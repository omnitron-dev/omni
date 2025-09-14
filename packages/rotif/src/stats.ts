import { SubscriptionStats } from './types';

/**
 * Tracks statistics for message processing.
 * Provides methods to record various events and retrieve statistics.
 * @class StatsTracker
 */
export class StatsTracker {
  /** Number of successfully processed messages */
  private messages = 0;
  /** Number of retry attempts */
  private retries = 0;
  /** Number of failed messages (moved to DLQ) */
  private failures = 0;
  /** Timestamp of the last processed message */
  private lastMessageAt: number = 0;

  /**
   * Records a successfully processed message.
   * Updates the message count and last message timestamp.
   */
  recordMessage() {
    this.messages++;
    this.lastMessageAt = Date.now();
  }

  /**
   * Records a retry attempt.
   * Increments the retry counter.
   */
  recordRetry() {
    this.retries++;
  }

  /**
   * Records a failed message.
   * Increments the failure counter.
   */
  recordFailure() {
    this.failures++;
  }

  /**
   * Returns the current statistics.
   * @returns {SubscriptionStats} Current statistics
   */
  getStats(): SubscriptionStats {
    return {
      messages: this.messages,
      retries: this.retries,
      failures: this.failures,
      lastMessageAt: this.lastMessageAt,
    };
  }
}
