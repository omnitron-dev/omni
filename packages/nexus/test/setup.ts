/**
 * Test Setup
 * Global test configuration and setup
 */

import { isJest, sleep } from './test-utils.js';

// Increase test timeout for async operations
if (isJest) {
  jest.setTimeout(10000);
}

// Mock global fetch for Node.js environment
if (typeof global !== 'undefined' && typeof global.fetch === 'undefined') {
  (global as any).fetch = isJest ? jest.fn() : () => Promise.reject(new Error('fetch not available'));
}

// Mock console methods to reduce noise in tests
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env['DEBUG']) {
    if (isJest) {
      console.log = jest.fn();
      console.warn = jest.fn();
      console.error = jest.fn();
    } else {
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
    }
  }
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

// Global test utilities
if (typeof global !== 'undefined') {
  (global as any).createMockFunction = <T extends (...args: any[]) => any>(): any => {
    if (isJest) {
      return jest.fn<ReturnType<T>, Parameters<T>>();
    }
    // For non-Jest environments, return a simple spy
    const calls: Parameters<T>[] = [];
    const results: ReturnType<T>[] = [];
    const fn = ((...args: Parameters<T>) => {
      calls.push(args);
      const result = undefined as ReturnType<T>;
      results.push(result);
      return result;
    }) as any;
    fn.mock = { calls, results };
    return fn;
  };

  (global as any).delay = sleep;
}

// Ensure all async operations complete
afterEach(async () => {
  await new Promise(resolve => setImmediate ? setImmediate(resolve) : setTimeout(resolve, 0));
});

// Clean up any hanging timers
afterEach(() => {
  if (isJest) {
    jest.clearAllTimers();
  }
});

// Ensure proper error handling
if (typeof process !== 'undefined') {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection in tests:', reason);
    throw reason;
  });
}

// Type declarations for global test utilities
declare global {
  function createMockFunction<T extends (...args: any[]) => any>(): any;
  function delay(ms: number): Promise<void>;
}

export {};