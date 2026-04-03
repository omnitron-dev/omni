/**
 * Test setup file for vitest
 *
 * Provides global test configuration, cleanup utilities, and
 * custom matchers for netron-react integration tests.
 */

import { afterEach, afterAll, vi, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend vitest expect with jest-dom matchers
expect.extend(matchers);

// Add WebSocket polyfill for integration tests if not already available
// happy-dom provides WebSocket, so we only need ws polyfill in Node environments
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    // Dynamic import to avoid bundling issues
    const ws = await import('ws');
    (globalThis as any).WebSocket = ws.WebSocket;
  } catch {
    // If ws is not available, tests that need WebSocket will fail gracefully
    console.warn('WebSocket polyfill (ws) not available');
  }
}

// ============================================================================
// Global Test Environment Configuration
// ============================================================================

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;

  // Track active servers for cleanup
  var __ACTIVE_MOCK_SERVERS__: Set<{ close: () => Promise<void> }>;

  // Track active clients for cleanup
  var __ACTIVE_TEST_CLIENTS__: Set<{ disconnect: () => Promise<void> }>;
}

// Set React act environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Initialize cleanup trackers
globalThis.__ACTIVE_MOCK_SERVERS__ = new Set();
globalThis.__ACTIVE_TEST_CLIENTS__ = new Set();

// ============================================================================
// Server Tracking for Cleanup
// ============================================================================

/**
 * Track a mock server for automatic cleanup
 */
export function trackServer(server: { close: () => Promise<void> }): void {
  globalThis.__ACTIVE_MOCK_SERVERS__.add(server);
}

/**
 * Untrack a mock server (call when manually closed)
 */
export function untrackServer(server: { close: () => Promise<void> }): void {
  globalThis.__ACTIVE_MOCK_SERVERS__.delete(server);
}

/**
 * Track a test client for automatic cleanup
 */
export function trackClient(client: { disconnect: () => Promise<void> }): void {
  globalThis.__ACTIVE_TEST_CLIENTS__.add(client);
}

/**
 * Untrack a test client (call when manually disconnected)
 */
export function untrackClient(client: { disconnect: () => Promise<void> }): void {
  globalThis.__ACTIVE_TEST_CLIENTS__.delete(client);
}

// ============================================================================
// Cleanup Hooks
// ============================================================================

/**
 * Clean up after each test
 */
afterEach(async () => {
  // Clear all mocks
  vi.clearAllMocks();

  // Reset timers if they were faked
  vi.useRealTimers();

  // Cleanup any active mock servers
  const serverCleanupPromises: Promise<void>[] = [];
  const activeServers = Array.from(globalThis.__ACTIVE_MOCK_SERVERS__);
  for (const server of activeServers) {
    serverCleanupPromises.push(
      server.close().catch((err) => {
        console.warn('[Test Cleanup] Failed to close server:', err);
      })
    );
  }
  await Promise.all(serverCleanupPromises);
  globalThis.__ACTIVE_MOCK_SERVERS__.clear();

  // Cleanup any active test clients
  const clientCleanupPromises: Promise<void>[] = [];
  const activeClients = Array.from(globalThis.__ACTIVE_TEST_CLIENTS__);
  for (const client of activeClients) {
    clientCleanupPromises.push(
      client.disconnect().catch((err) => {
        console.warn('[Test Cleanup] Failed to disconnect client:', err);
      })
    );
  }
  await Promise.all(clientCleanupPromises);
  globalThis.__ACTIVE_TEST_CLIENTS__.clear();
});

/**
 * Ensure all resources are cleaned up after all tests
 */
afterAll(async () => {
  // Final cleanup pass
  const finalServers = Array.from(globalThis.__ACTIVE_MOCK_SERVERS__);
  for (const server of finalServers) {
    await server.close().catch(() => {});
  }
  globalThis.__ACTIVE_MOCK_SERVERS__.clear();

  const finalClients = Array.from(globalThis.__ACTIVE_TEST_CLIENTS__);
  for (const client of finalClients) {
    await client.disconnect().catch(() => {});
  }
  globalThis.__ACTIVE_TEST_CLIENTS__.clear();
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for a condition to become true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 10 } = options;
  const startTime = Date.now();

  while (true) {
    const result = await condition();
    if (result) return;

    if (Date.now() - startTime > timeout) {
      throw new Error('waitFor: Timeout waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wait for a specific number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Flush all pending promises and timers
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run a callback with fake timers, then restore real timers
 */
export async function withFakeTimers<T>(callback: () => T | Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Advance fake timers and flush microtasks
 */
export async function advanceTimersAndFlush(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flushPromises();
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined');
  }
}

/**
 * Assert that a promise rejects with an error
 */
export async function assertRejects(promise: Promise<unknown>, errorMatch?: string | RegExp): Promise<Error> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error('Promise rejected with non-Error value');
    }

    if (errorMatch) {
      const matches =
        typeof errorMatch === 'string' ? error.message.includes(errorMatch) : errorMatch.test(error.message);

      if (!matches) {
        throw new Error(`Expected error message to match "${errorMatch}", got "${error.message}"`);
      }
    }

    return error;
  }
}

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a spy function that records calls
 */
export function createSpy<T extends (...args: unknown[]) => unknown>(
  impl?: T
): T & {
  calls: unknown[][];
  reset: () => void;
  callCount: number;
} {
  const calls: unknown[][] = [];

  const spy = ((...args: unknown[]) => {
    calls.push(args);
    return impl?.(...args);
  }) as T & {
    calls: unknown[][];
    reset: () => void;
    callCount: number;
  };

  spy.calls = calls;
  spy.reset = () => {
    calls.length = 0;
  };
  Object.defineProperty(spy, 'callCount', {
    get: () => calls.length,
  });

  return spy;
}

/**
 * Create a mock function that can be configured
 */
export function createMockFn<TArgs extends unknown[], TReturn>(): {
  fn: (...args: TArgs) => TReturn | undefined;
  setReturn: (value: TReturn) => void;
  setImplementation: (impl: (...args: TArgs) => TReturn) => void;
  calls: TArgs[];
  reset: () => void;
} {
  let returnValue: TReturn | undefined;
  let implementation: ((...args: TArgs) => TReturn) | undefined;
  const calls: TArgs[] = [];

  const fn = (...args: TArgs): TReturn | undefined => {
    calls.push(args);
    if (implementation) {
      return implementation(...args);
    }
    return returnValue;
  };

  return {
    fn,
    setReturn: (value: TReturn) => {
      returnValue = value;
    },
    setImplementation: (impl: (...args: TArgs) => TReturn) => {
      implementation = impl;
    },
    calls,
    reset: () => {
      calls.length = 0;
      returnValue = undefined;
      implementation = undefined;
    },
  };
}

// ============================================================================
// React Testing Helpers
// ============================================================================

/**
 * Wait for next React render cycle
 */
export async function waitForNextRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Suppress React console errors during test
 */
export function suppressReactErrors(): () => void {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args[0];
    if (typeof message === 'string' && (message.includes('Warning:') || message.includes('React'))) {
      return;
    }
    originalError.apply(console, args);
  };

  return () => {
    console.error = originalError;
  };
}

// ============================================================================
// Environment Helpers
// ============================================================================

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1';
}

/**
 * Skip test in CI environment
 */
export function skipInCI(reason?: string): void {
  if (isCI()) {
    console.log(`Skipping test in CI${reason ? `: ${reason}` : ''}`);
    throw new Error('SKIP');
  }
}
