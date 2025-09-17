/**
 * Async test utilities for handling timeouts, retries, and event listeners
 */

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Wait for an async operation with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout = 5000,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${errorMessage} after ${timeout}ms`));
    }, timeout);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Retry an async operation with backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    backoff?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { retries = 3, delay = 100, backoff = 2, onRetry } = options;

  let lastError: Error;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (i < retries - 1) {
        if (onRetry) {
          onRetry(lastError, i + 1);
        }

        const waitTime = delay * Math.pow(backoff, i);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError!;
}

/**
 * Event listener tracker for cleanup
 */
export class EventListenerTracker {
  private listeners: Array<{
    target: any;
    event: string;
    handler: Function;
    type: 'on' | 'once';
  }> = [];

  /**
   * Track an event listener
   */
  track(target: any, event: string, handler: Function, type: 'on' | 'once' = 'on'): void {
    this.listeners.push({ target, event, handler, type });
  }

  /**
   * Add listener and track it
   */
  on(target: any, event: string, handler: Function): void {
    target.on(event, handler);
    this.track(target, event, handler, 'on');
  }

  /**
   * Add once listener and track it
   */
  once(target: any, event: string, handler: Function): void {
    target.once(event, handler);
    this.track(target, event, handler, 'once');
  }

  /**
   * Remove all tracked listeners
   */
  cleanup(): void {
    for (const { target, event, handler } of this.listeners) {
      try {
        if (target.removeListener) {
          target.removeListener(event, handler);
        } else if (target.off) {
          target.off(event, handler);
        }
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    this.listeners = [];
  }

  /**
   * Get tracked listener count
   */
  get count(): number {
    return this.listeners.length;
  }
}

/**
 * Promise with deferred resolution
 */
export class DeferredPromise<T> {
  public promise: Promise<T>;
  public resolve!: (value: T) => void;
  public reject!: (error: Error) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value: T) => {
        if (!this.settled) {
          this.settled = true;
          resolve(value);
        }
      };

      this.reject = (error: Error) => {
        if (!this.settled) {
          this.settled = true;
          reject(error);
        }
      };
    });
  }

  get isSettled(): boolean {
    return this.settled;
  }
}

/**
 * Wait for multiple events
 */
export async function waitForEvents(
  target: any,
  events: string[],
  timeout = 5000
): Promise<any[]> {
  const results: any[] = [];
  const promises: Promise<any>[] = [];

  for (const event of events) {
    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Event "${event}" not received within ${timeout}ms`));
      }, timeout);

      const handler = (data: any) => {
        clearTimeout(timeoutId);
        resolve(data);
      };

      target.once(event, handler);
    });

    promises.push(promise);
  }

  return Promise.all(promises);
}

/**
 * Collect events until condition is met
 */
export async function collectEvents<T>(
  target: any,
  event: string,
  condition: (events: T[]) => boolean,
  timeout = 5000
): Promise<T[]> {
  const events: T[] = [];
  const deferred = new DeferredPromise<T[]>();

  const handler = (data: T) => {
    events.push(data);
    if (condition(events)) {
      target.off(event, handler);
      deferred.resolve(events);
    }
  };

  target.on(event, handler);

  const timeoutId = setTimeout(() => {
    target.off(event, handler);
    deferred.reject(new Error(`Condition not met within ${timeout}ms`));
  }, timeout);

  try {
    return await deferred.promise;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clean up resources safely
 */
export async function safeCleanup(cleanupFns: Array<() => Promise<void> | void>): Promise<void> {
  const errors: Error[] = [];

  for (const fn of cleanupFns) {
    try {
      await fn();
    } catch (error) {
      errors.push(error as Error);
    }
  }

  if (errors.length > 0) {
    console.error('Cleanup errors:', errors);
  }
}

/**
 * Wait for next tick
 */
export function nextTick(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Flush promises in the event loop
 */
export async function flushPromises(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => process.nextTick(resolve));
}

/**
 * Mock timer controller for tests
 */
export class MockTimerController {
  private timers = new Map<NodeJS.Timeout, { callback: Function; delay: number; time: number }>();
  private currentTime = 0;
  private nextId = 1;

  /**
   * Install mock timers
   */
  install(): void {
    (global as any).setTimeout = this.setTimeout.bind(this);
    (global as any).clearTimeout = this.clearTimeout.bind(this);
    (global as any).setInterval = this.setInterval.bind(this);
    (global as any).clearInterval = this.clearInterval.bind(this);
  }

  /**
   * Restore native timers
   */
  restore(): void {
    // This would need to save original timers first
  }

  /**
   * Mock setTimeout
   */
  setTimeout(callback: Function, delay: number): NodeJS.Timeout {
    const id = this.nextId++ as any;
    this.timers.set(id, { callback, delay, time: this.currentTime + delay });
    return id;
  }

  /**
   * Mock clearTimeout
   */
  clearTimeout(id: NodeJS.Timeout): void {
    this.timers.delete(id);
  }

  /**
   * Mock setInterval
   */
  setInterval(callback: Function, delay: number): NodeJS.Timeout {
    // Simplified implementation
    return this.setTimeout(() => {
      callback();
      this.setInterval(callback, delay);
    }, delay);
  }

  /**
   * Mock clearInterval
   */
  clearInterval(id: NodeJS.Timeout): void {
    this.clearTimeout(id);
  }

  /**
   * Advance time by specified amount
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

  private getNextTimer(): { id: NodeJS.Timeout; callback: Function; time: number } | null {
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
 * Create event emitter spy
 */
export function createEventSpy(target: any, event: string): { events: any[]; clear: () => void } {
  const events: any[] = [];

  const handler = (data: any) => {
    events.push(data);
  };

  target.on(event, handler);

  return {
    events,
    clear: () => {
      target.off(event, handler);
      events.length = 0;
    },
  };
}