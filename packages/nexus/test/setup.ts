/**
 * Test Setup
 * Global test configuration and setup
 */

// Increase test timeout for async operations
jest.setTimeout(10000);

// Mock global fetch for Node.js environment
if (typeof global.fetch === 'undefined') {
  (global as any).fetch = jest.fn();
}

// Mock console methods to reduce noise in tests
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

// Global test utilities
global.createMockFunction = <T extends (...args: any[]) => any>(): jest.Mock<ReturnType<T>, Parameters<T>> => {
  return jest.fn<ReturnType<T>, Parameters<T>>();
};

global.delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Ensure all async operations complete
afterEach(async () => {
  await new Promise(resolve => setImmediate(resolve));
});

// Clean up any hanging timers
afterEach(() => {
  jest.clearAllTimers();
});

// Ensure proper error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in tests:', reason);
  throw reason;
});

// Type declarations for global test utilities
declare global {
  function createMockFunction<T extends (...args: any[]) => any>(): jest.Mock<ReturnType<T>, Parameters<T>>;
  function delay(ms: number): Promise<void>;
  var fetch: jest.Mock;
}

export {};