/**
 * Event testing utilities for async operations
 */

import { TimeoutError } from '../errors.js';
import { defer } from './deferred.js';

/**
 * Event listener tracker for cleanup
 *
 * Tracks event listeners added during tests and provides
 * automatic cleanup to prevent memory leaks.
 *
 * @example
 * ```ts
 * const tracker = new EventListenerTracker();
 * tracker.on(emitter, 'data', handler);
 * // ... test code ...
 * tracker.cleanup(); // Remove all tracked listeners
 * ```
 */
export class EventListenerTracker {
  private listeners: Array<{
    target: any;
    event: string;
    handler: (...args: any[]) => any;
    type: 'on' | 'once';
  }> = [];

  /**
   * Track an event listener for cleanup
   *
   * @param target - Event emitter
   * @param event - Event name
   * @param handler - Event handler function
   * @param type - Listener type ('on' or 'once')
   */
  track(target: any, event: string, handler: (...args: any[]) => any, type: 'on' | 'once' = 'on'): void {
    this.listeners.push({ target, event, handler, type });
  }

  /**
   * Add event listener and track it for cleanup
   *
   * @param target - Event emitter
   * @param event - Event name
   * @param handler - Event handler function
   */
  on(target: any, event: string, handler: (...args: any[]) => any): void {
    target.on(event, handler);
    this.track(target, event, handler, 'on');
  }

  /**
   * Add one-time event listener and track it for cleanup
   *
   * @param target - Event emitter
   * @param event - Event name
   * @param handler - Event handler function
   */
  once(target: any, event: string, handler: (...args: any[]) => any): void {
    target.once(event, handler);
    this.track(target, event, handler, 'once');
  }

  /**
   * Remove all tracked listeners
   *
   * Safely removes all event listeners, catching and ignoring
   * any errors that occur during cleanup.
   */
  cleanup(): void {
    for (const { target, event, handler } of this.listeners) {
      try {
        if (target.removeListener) {
          target.removeListener(event, handler);
        } else if (target.off) {
          target.off(event, handler);
        }
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.listeners = [];
  }

  /**
   * Get the number of tracked listeners
   */
  get count(): number {
    return this.listeners.length;
  }
}

/**
 * Event collector for testing
 *
 * Collects events from an event emitter for later inspection
 * and assertions in tests.
 *
 * @example
 * ```ts
 * const collector = new EventCollector(emitter);
 * collector.collect('data');
 * // ... trigger events ...
 * const events = collector.getEvents('data');
 * expect(events).toHaveLength(3);
 * ```
 */
export class EventCollector<T = any> {
  private events: Array<{ event: string; data: T; timestamp: number }> = [];
  private listeners = new Map<string, (...args: any[]) => void>();

  constructor(private emitter: any) {}

  /**
   * Start collecting events
   *
   * @param eventName - Name of event to collect
   * @returns This collector for chaining
   */
  collect(eventName: string): this {
    const listener = (...args: any[]) => {
      this.events.push({
        event: eventName,
        data: args.length === 1 ? args[0] : args,
        timestamp: Date.now(),
      });
    };

    this.listeners.set(eventName, listener);
    this.emitter.on(eventName, listener);
    return this;
  }

  /**
   * Stop collecting events
   *
   * @param eventName - Name of event to stop collecting, or undefined to stop all
   */
  stop(eventName?: string): void {
    if (eventName) {
      const listener = this.listeners.get(eventName);
      if (listener) {
        this.emitter.off(eventName, listener);
        this.listeners.delete(eventName);
      }
    } else {
      for (const [event, listener] of this.listeners) {
        this.emitter.off(event, listener);
      }
      this.listeners.clear();
    }
  }

  /**
   * Get collected events
   *
   * @param eventName - Filter by event name, or undefined for all events
   * @returns Array of collected events with data and timestamps
   */
  getEvents(eventName?: string): Array<{ event: string; data: T; timestamp: number }> {
    if (eventName) {
      return this.events.filter((e) => e.event === eventName);
    }
    return [...this.events];
  }

  /**
   * Clear collected events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Wait for a specific event
   *
   * @param eventName - Name of event to wait for
   * @param timeout - Timeout in milliseconds (default: 5000)
   * @returns Promise resolving to event data
   * @throws TimeoutError if timeout is reached
   */
  async waitForEvent(eventName: string, timeout = 5000): Promise<T> {
    const deferred = defer<T>();

    const listener = (data: T) => {
      deferred.resolve(data);
    };

    this.emitter.once(eventName, listener);

    const timer = setTimeout(() => {
      this.emitter.off(eventName, listener);
      deferred.reject(new TimeoutError('event: ' + eventName, timeout));
    }, timeout);

    try {
      const result = await deferred.promise;
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  /**
   * Get event count
   *
   * @param eventName - Filter by event name, or undefined for total count
   * @returns Number of collected events
   */
  getEventCount(eventName?: string): number {
    if (eventName) {
      return this.events.filter((e) => e.event === eventName).length;
    }
    return this.events.length;
  }

  /**
   * Assert event was emitted
   *
   * @param eventName - Name of event to check
   * @param expectedCount - Expected number of emissions (optional)
   * @throws Error if assertion fails
   */
  assertEmitted(eventName: string, expectedCount?: number): void {
    const count = this.getEventCount(eventName);
    if (expectedCount !== undefined) {
      if (count !== expectedCount) {
        throw new Error(`Expected ${expectedCount} ${eventName} events, got ${count}`);
      }
    } else if (count === 0) {
      throw new Error(`Expected ${eventName} event to be emitted`);
    }
  }

  /**
   * Assert event was not emitted
   *
   * @param eventName - Name of event to check
   * @throws Error if assertion fails
   */
  assertNotEmitted(eventName: string): void {
    const count = this.getEventCount(eventName);
    if (count > 0) {
      throw new Error(`Expected ${eventName} event not to be emitted, but got ${count}`);
    }
  }
}

/**
 * Wait for multiple events
 *
 * Waits for all specified events to be emitted on the target,
 * with a timeout for each individual event.
 *
 * @param target - Event emitter
 * @param events - Array of event names to wait for
 * @param timeout - Timeout per event in milliseconds (default: 5000)
 * @returns Promise resolving to array of event data
 * @throws TimeoutError if any event times out
 *
 * @example
 * ```ts
 * const [userData, profileData] = await waitForEvents(
 *   emitter,
 *   ['user', 'profile'],
 *   3000
 * );
 * ```
 */
export async function waitForEvents(target: any, events: string[], timeout = 5000): Promise<any[]> {
  const promises: Promise<any>[] = [];

  for (const event of events) {
    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError('event: ' + event, timeout));
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
 * Collect events until a condition is met
 *
 * Collects events from the target until the condition function
 * returns true, with a timeout for the entire operation.
 *
 * @param target - Event emitter
 * @param event - Event name to collect
 * @param condition - Function that returns true when enough events are collected
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to array of collected events
 * @throws TimeoutError if timeout is reached
 *
 * @example
 * ```ts
 * const events = await collectEvents(
 *   emitter,
 *   'data',
 *   (events) => events.length >= 5,
 *   3000
 * );
 * ```
 */
export async function collectEvents<T>(
  target: any,
  event: string,
  condition: (events: T[]) => boolean,
  timeout = 5000
): Promise<T[]> {
  const events: T[] = [];
  const deferred = defer<T[]>();

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
    deferred.reject(new TimeoutError('collectEvents', timeout));
  }, timeout);

  try {
    return await deferred.promise;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create an event spy
 *
 * Creates a spy that records all events emitted on the target,
 * returning an object with the collected events and a cleanup function.
 *
 * @param target - Event emitter
 * @param event - Event name to spy on
 * @returns Object with events array and clear function
 *
 * @example
 * ```ts
 * const spy = createEventSpy(emitter, 'data');
 * // ... trigger events ...
 * expect(spy.events).toHaveLength(3);
 * spy.clear();
 * ```
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
