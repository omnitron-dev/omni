/**
 * Wait utilities for async testing
 */

import { TimeoutError } from '../errors.js';

/**
 * Options for wait operations
 */
export interface WaitOptions {
  /**
   * Timeout in milliseconds (default: 5000)
   */
  timeout?: number;

  /**
   * Polling interval in milliseconds (default: 50)
   */
  interval?: number;

  /**
   * Custom error message
   */
  message?: string;
}

/**
 * Wait for a condition to be true
 *
 * Polls the condition function at regular intervals until it returns true
 * or the timeout is reached.
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Wait configuration options
 * @throws TimeoutError if timeout is reached before condition is met
 *
 * @example
 * ```ts
 * await waitFor(
 *   () => element.isVisible(),
 *   { timeout: 3000, interval: 100 }
 * );
 * ```
 */
export async function waitFor(condition: () => boolean | Promise<boolean>, options: WaitOptions = {}): Promise<void> {
  const { timeout = 5000, interval = 50, message = 'Condition not met' } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await delay(interval);
  }

  throw new TimeoutError('waitFor: ' + message, timeout);
}

/**
 * Wait for a condition to be true with timeout (alternative naming)
 *
 * This is an alias for waitFor with slightly different parameter signature
 * for backward compatibility.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @param interval - Polling interval in milliseconds (default: 50)
 * @throws TimeoutError if timeout is reached before condition is met
 *
 * @example
 * ```ts
 * await waitForCondition(
 *   () => counter > 10,
 *   5000,
 *   100
 * );
 * ```
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
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new TimeoutError('waitForCondition', timeout);
}

/**
 * Delay execution for specified milliseconds
 *
 * Simple async sleep utility for introducing delays in tests.
 *
 * @param ms - Milliseconds to delay
 *
 * @example
 * ```ts
 * await delay(1000); // Wait 1 second
 * ```
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for next tick in the event loop
 *
 * Useful for allowing pending async operations to complete
 * before proceeding with test assertions.
 *
 * @example
 * ```ts
 * emitter.emit('event');
 * await nextTick(); // Let handlers execute
 * expect(handlerCalled).toBe(true);
 * ```
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Flush all pending promises in the event loop
 *
 * Ensures all microtasks and next-tick callbacks are executed
 * before proceeding. Useful for testing promise chains and
 * async operations.
 *
 * @example
 * ```ts
 * Promise.resolve().then(() => { executed = true });
 * await flushPromises();
 * expect(executed).toBe(true);
 * ```
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => process.nextTick(resolve));
}
