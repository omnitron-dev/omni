/**
 * Transport Test Utilities
 *
 * Shared utilities for testing transport implementations
 */

import { createServer } from 'node:net';
import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Ports per worker. Large enough that a suite never wraps its band, so a
 * number is not reused while anything might still hold it.
 */
const PORT_BAND_SIZE = 1500;

/**
 * Where the bands start.
 *
 * Deliberately below the kernel's ephemeral range (49152+ on macOS/BSD): a
 * port the kernel can hand out on its own is one an unrelated socket in this
 * process can be given while a test is between `getFreePort` and `listen`.
 */
const PORT_BAND_BASE = 20000;

/** How many distinct bands exist before they repeat. */
const PORT_BAND_COUNT = 16;

/**
 * The port range belonging to THIS vitest worker.
 *
 * `getFreePort` used to bind port 0, read what the kernel assigned, close, and
 * return the number — so every worker drew from one shared ephemeral pool and
 * two of them could be handed the same number seconds apart. A full run of
 * this package produced `EADDRINUSE 127.0.0.1:60843` and a WebSocket `404`
 * (the same collision seen from the client side) from exactly that.
 *
 * Nothing that RETURNS a port can hold it, so the window between handing a
 * number out and binding it cannot be closed. What is closed here is the part
 * that made the window matter: the workers no longer draw from a shared pool.
 */
export function portBandForWorker(): { start: number; end: number } {
  const worker = Number(process.env['VITEST_POOL_ID'] ?? process.env['VITEST_WORKER_ID'] ?? 1);
  const index = (Math.max(1, worker) - 1) % PORT_BAND_COUNT;
  const start = PORT_BAND_BASE + index * PORT_BAND_SIZE;
  return { start, end: start + PORT_BAND_SIZE };
}

/**
 * Shared by both helpers on purpose. Two cursors over one band would collide
 * with each other — the same defect with the workers replaced by helpers.
 */
let portCursor = 0;

/**
 * Whether `port` can be bound ON THE HOST THE CALLER WILL USE.
 *
 * The old probe listened on port 0 with no host, i.e. the wildcard address,
 * while every caller binds `127.0.0.1`. Those are different questions: with
 * SO_REUSEADDR — which Node sets — a wildcard bind can succeed while
 * `127.0.0.1:P` is held by someone else, so the probe answered "free" about a
 * port that was in use. A test in this file reproduces that: it parks a server
 * on a port and the old helper hands the very same number back.
 */
async function isBindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Find an available port for testing.
 *
 * @param host - the address the caller will bind. Must match, or the answer is
 *   about a different socket.
 * @returns Promise resolving to an available port number
 */
export async function getFreePort(host = '127.0.0.1'): Promise<number> {
  const band = portBandForWorker();
  for (let tried = 0; tried < PORT_BAND_SIZE; tried++) {
    const port = band.start + (portCursor++ % PORT_BAND_SIZE);
    if (await isBindable(port, host)) {
      return port;
    }
  }
  throw new Error(
    `No free port in this worker's band ${band.start}-${band.end - 1} on ${host}. ` +
      `Either a previous run left servers behind, or the band is too small for this suite.`
  );
}

/**
 * Find an available HTTP port for testing.
 *
 * Shares the band and the cursor with `getFreePort`: an HTTP server and a TCP
 * server in the same worker must not be handed the same number.
 *
 * @returns Promise resolving to an available port number
 */
export async function getFreeHttpPort(host = '127.0.0.1'): Promise<number> {
  return getFreePort(host);
}

/**
 * Wait for a specific event to be emitted
 *
 * @param emitter - The event emitter to listen to
 * @param event - The event name to wait for
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving with the event data
 */
export function waitForEvent<T = any>(emitter: EventEmitter, event: string, timeout = 5000): Promise<T> {
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
export async function waitForEvents(emitter: EventEmitter, events: string[], timeout = 5000): Promise<void> {
  const promises = events.map((event) => waitForEvent(emitter, event, timeout));
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
export function waitForCondition(condition: () => boolean, timeout = 5000, interval = 100): Promise<void> {
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
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
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
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeout)),
  ]);
}
