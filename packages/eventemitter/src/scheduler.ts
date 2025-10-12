import type { ScheduledEvent, ScheduleOptions } from './types.js';

/**
 * Event scheduler for delayed and recurring events
 */
export class EventScheduler {
  private scheduledEvents: Map<string, ScheduledEvent> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private nextId = 0;

  /**
   * Schedule an event for future emission
   */
  schedule(
    event: string,
    data: any,
    options: ScheduleOptions,
    emitFn: (event: string, data: any) => void | Promise<void>
  ): string {
    const id = this.generateId();
    const now = Date.now();

    let executeAt: number;

    if (options.at) {
      executeAt = options.at.getTime();
    } else if (options.delay) {
      executeAt = now + options.delay;
    } else {
      executeAt = now;
    }

    const scheduledEvent: ScheduledEvent = {
      id,
      event,
      data,
      options,
      scheduledAt: now,
      executeAt,
      status: 'pending',
    };

    this.scheduledEvents.set(id, scheduledEvent);

    // Handle cron expressions (simplified - would need a proper cron library in production)
    if (options.cron) {
      // For demo purposes, we'll interpret simple cron patterns
      this.scheduleRecurring(id, scheduledEvent, emitFn);
    } else {
      // Schedule one-time event
      const delay = Math.max(0, executeAt - now);
      const timer = setTimeout(async () => {
        try {
          await this.executeScheduledEvent(id, scheduledEvent, emitFn);
        } catch {
          // Error is already handled in executeScheduledEvent, just prevent unhandled rejection
        }
      }, delay);

      this.timers.set(id, timer);
    }

    return id;
  }

  /**
   * Cancel a scheduled event
   */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    const event = this.scheduledEvents.get(id);
    if (event) {
      event.status = 'cancelled';
      this.scheduledEvents.delete(id);
      return true;
    }

    return false;
  }

  /**
   * Cancel all scheduled events
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.scheduledEvents.clear();
  }

  /**
   * Get scheduled events
   */
  getScheduledEvents(): ScheduledEvent[] {
    return Array.from(this.scheduledEvents.values());
  }

  /**
   * Get pending events
   */
  getPendingEvents(): ScheduledEvent[] {
    return Array.from(this.scheduledEvents.values()).filter((event) => event.status === 'pending');
  }

  /**
   * Execute a scheduled event
   */
  private async executeScheduledEvent(
    id: string,
    scheduledEvent: ScheduledEvent,
    emitFn: (event: string, data: any) => void | Promise<void>
  ): Promise<void> {
    const event = this.scheduledEvents.get(id);
    if (!event || event.status !== 'pending') return;

    event.status = 'executing';

    try {
      await this.executeWithRetry(
        () => emitFn(scheduledEvent.event, scheduledEvent.data),
        scheduledEvent.options.retry
      );

      event.status = 'completed';
    } catch (error) {
      event.status = 'failed';
      throw error;
    } finally {
      this.scheduledEvents.delete(id);
      this.timers.delete(id);
    }
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry(fn: () => void | Promise<void>, retryOptions?: any): Promise<void> {
    if (!retryOptions) {
      return fn();
    }

    const maxAttempts = retryOptions.maxAttempts || 3;
    const delay = retryOptions.delay || 1000;
    const backoff = retryOptions.backoff || 'linear';
    const factor = retryOptions.factor || 2;
    const maxDelay = retryOptions.maxDelay || 30000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxAttempts) {
          let waitTime = delay;

          if (backoff === 'exponential') {
            waitTime = Math.min(delay * Math.pow(factor, attempt - 1), maxDelay);
          } else if (backoff === 'linear') {
            waitTime = Math.min(delay * attempt, maxDelay);
          }

          await this.sleep(waitTime);
        }
      }
    }

    throw lastError;
  }

  /**
   * Schedule recurring event (simplified implementation)
   */
  private scheduleRecurring(
    id: string,
    scheduledEvent: ScheduledEvent,
    emitFn: (event: string, data: any) => void | Promise<void>
  ): void {
    // This is a simplified implementation
    // In production, you'd want to use a proper cron library
    const interval = this.parseCronInterval(scheduledEvent.options.cron!);

    if (interval > 0) {
      const timer = setInterval(async () => {
        const event = this.scheduledEvents.get(id);
        if (!event) {
          clearInterval(timer);
          return;
        }

        try {
          await emitFn(scheduledEvent.event, scheduledEvent.data);
        } catch (error) {
          // Log error but continue recurring
          console.error(`Recurring event ${id} failed:`, error);
        }
      }, interval);

      this.timers.set(id, timer as any);
    }
  }

  /**
   * Parse cron expression to interval (simplified)
   */
  private parseCronInterval(cron: string): number {
    // Very simplified cron parsing - just for demo
    // Real implementation would use a proper cron parser

    // Handle some common patterns
    if (cron === '* * * * *') return 60000; // Every minute
    if (cron === '*/5 * * * *') return 5 * 60000; // Every 5 minutes
    if (cron === '0 * * * *') return 60 * 60000; // Every hour
    if (cron === '0 0 * * *') return 24 * 60 * 60000; // Daily

    // Default to hourly
    return 60 * 60000;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `scheduled_${Date.now()}_${++this.nextId}`;
  }
}
