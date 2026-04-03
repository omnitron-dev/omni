/**
 * Mock timer utilities for testing time-dependent code
 */

/**
 * Mock timer controller for testing time-dependent code
 *
 * Provides manual control over setTimeout, setInterval, and time advancement,
 * allowing deterministic testing of code that relies on timers.
 *
 * @example
 * ```ts
 * const timer = new MockTimerController();
 * timer.install();
 *
 * setTimeout(() => console.log('done'), 1000);
 * timer.tick(1000); // Advances time and triggers callback
 *
 * timer.restore();
 * ```
 */
export class MockTimerController {
  private timers = new Map<NodeJS.Timeout, { callback: (...args: any[]) => any; delay: number; time: number }>();
  private currentTime = 0;
  private nextId = 1;
  private originalTimers?: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  };

  /**
   * Install mock timers, replacing native implementations
   *
   * Saves the original timer functions for later restoration.
   */
  install(): void {
    // Save original timers
    this.originalTimers = {
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
    };

    // Replace with mocks
    (global as any).setTimeout = this.setTimeout.bind(this);
    (global as any).clearTimeout = this.clearTimeout.bind(this);
    (global as any).setInterval = this.setInterval.bind(this);
    (global as any).clearInterval = this.clearInterval.bind(this);
  }

  /**
   * Restore native timer implementations
   *
   * Restores the original timer functions that were saved during install().
   */
  restore(): void {
    if (this.originalTimers) {
      global.setTimeout = this.originalTimers.setTimeout;
      global.clearTimeout = this.originalTimers.clearTimeout;
      global.setInterval = this.originalTimers.setInterval;
      global.clearInterval = this.originalTimers.clearInterval;
      this.originalTimers = undefined;
    }
  }

  /**
   * Mock implementation of setTimeout
   *
   * @param callback - Function to call when timer fires
   * @param delay - Delay in milliseconds
   * @returns Timer ID for cancellation
   */
  setTimeout(callback: (...args: any[]) => any, delay: number): NodeJS.Timeout {
    const id = this.nextId++ as any;
    this.timers.set(id, { callback, delay, time: this.currentTime + delay });
    return id;
  }

  /**
   * Mock implementation of clearTimeout
   *
   * @param id - Timer ID to cancel
   */
  clearTimeout(id: NodeJS.Timeout): void {
    this.timers.delete(id);
  }

  /**
   * Mock implementation of setInterval
   *
   * Note: This is a simplified implementation that doesn't truly repeat.
   * For more complex interval testing, consider using multiple setTimeout calls.
   *
   * @param callback - Function to call when timer fires
   * @param delay - Delay in milliseconds
   * @returns Timer ID for cancellation
   */
  setInterval(callback: (...args: any[]) => any, delay: number): NodeJS.Timeout {
    // Simplified implementation - for true intervals, would need recurring logic
    return this.setTimeout(() => {
      callback();
      this.setInterval(callback, delay);
    }, delay);
  }

  /**
   * Mock implementation of clearInterval
   *
   * @param id - Timer ID to cancel
   */
  clearInterval(id: NodeJS.Timeout): void {
    this.clearTimeout(id);
  }

  /**
   * Advance time by specified amount
   *
   * Fires all timers that should execute within the advanced time period,
   * in chronological order.
   *
   * @param ms - Milliseconds to advance
   *
   * @example
   * ```ts
   * setTimeout(() => console.log('A'), 100);
   * setTimeout(() => console.log('B'), 200);
   * timer.tick(150); // Logs 'A'
   * timer.tick(100); // Logs 'B'
   * ```
   */
  tick(ms: number): void {
    const targetTime = this.currentTime + ms;

    while (this.currentTime < targetTime) {
      const nextTimer = this.getNextTimer();
      if (!nextTimer || nextTimer.time > targetTime) {
        this.currentTime = targetTime;
        break;
      }

      this.currentTime = nextTimer.time;
      nextTimer.callback();
      this.timers.delete(nextTimer.id);
    }
  }

  /**
   * Get the current mock time
   *
   * @returns Current time in milliseconds since mock timer creation
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Get the number of pending timers
   *
   * @returns Count of active timers
   */
  getPendingCount(): number {
    return this.timers.size;
  }

  /**
   * Clear all pending timers
   */
  clearAll(): void {
    this.timers.clear();
  }

  /**
   * Reset the mock timer to initial state
   */
  reset(): void {
    this.timers.clear();
    this.currentTime = 0;
    this.nextId = 1;
  }

  /**
   * Get the next timer to fire
   *
   * @private
   * @returns Timer details or null if no timers pending
   */
  private getNextTimer(): { id: NodeJS.Timeout; callback: (...args: any[]) => any; time: number } | null {
    let next: any = null;
    let nextId: NodeJS.Timeout | null = null;

    for (const [id, timer] of this.timers) {
      if (!next || timer.time < next.time) {
        next = timer;
        nextId = id;
      }
    }

    return next ? { id: nextId!, ...next } : null;
  }
}

/**
 * Create a mock timer controller
 *
 * Factory function for creating MockTimerController instances.
 *
 * @example
 * ```ts
 * const timer = createMockTimer();
 * timer.install();
 * // ... test code ...
 * timer.restore();
 * ```
 */
export function createMockTimer(): MockTimerController {
  return new MockTimerController();
}
