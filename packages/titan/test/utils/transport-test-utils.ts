/**
 * Transport Test Utilities
 *
 * Shared utilities for testing transport implementations
 */

import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Find an available port for testing
 *
 * @returns Promise resolving to an available port number
 */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Find an available HTTP port for testing
 *
 * @returns Promise resolving to an available port number
 */
export async function getFreeHttpPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createHttpServer();
    server.listen(0, () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Wait for a specific event to be emitted
 *
 * @param emitter - The event emitter to listen to
 * @param event - The event name to wait for
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving with the event data
 */
export function waitForEvent<T = any>(
  emitter: EventEmitter,
  event: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    emitter.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Wait for multiple events to be emitted
 *
 * @param emitter - The event emitter to listen to
 * @param events - Array of event names to wait for
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving when all events have been emitted
 */
export async function waitForEvents(
  emitter: EventEmitter,
  events: string[],
  timeout = 5000
): Promise<void> {
  const promises = events.map(event => waitForEvent(emitter, event, timeout));
  await Promise.all(promises);
}

/**
 * Wait for a condition to become true
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @param interval - Check interval in milliseconds (default: 100)
 * @returns Promise resolving when condition is true
 */
export function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
        return;
      }

      if (Date.now() - startTime >= timeout) {
        reject(new Error('Timeout waiting for condition'));
        return;
      }

      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Delay execution for a specified time
 *
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise with resolve/reject functions
 *
 * @returns Object with promise and resolve/reject functions
 */
export function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Retry an operation with exponential backoff
 *
 * @param operation - Async operation to retry
 * @param options - Retry options
 * @returns Promise resolving with operation result
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    backoffFactor?: number;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, delay: initialDelay = 100, backoffFactor = 2 } = options;

  let lastError: Error;
  let currentDelay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay *= backoffFactor;
      }
    }
  }

  throw lastError!;
}

/**
 * Run an operation with a timeout
 *
 * @param operation - Async operation to run
 * @param timeout - Timeout in milliseconds
 * @param errorMessage - Error message if timeout occurs
 * @returns Promise resolving with operation result
 */
export function withTimeout<T>(
  operation: Promise<T>,
  timeout: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeout)
    )
  ]);
}
