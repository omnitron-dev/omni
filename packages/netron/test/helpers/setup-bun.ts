/**
 * Bun test setup file
 * This file is preloaded when running tests with Bun
 */

// Polyfill for any Node.js specific globals that Bun might not have
if (!globalThis.process) {
  globalThis.process = {
    env: {},
    exit: (code: number) => {
      throw new Error(`Process exit with code ${code}`);
    },
    nextTick: (callback: Function) => {
      queueMicrotask(() => callback());
    },
  } as any;
}

// Setup test environment variables
process.env.NODE_ENV = 'test';
process.env.TEST_REDIS_PORT = process.env.TEST_REDIS_PORT || '6420';

// Import reflect-metadata for decorators
import 'reflect-metadata';

// Set test timeout
if (typeof Bun !== 'undefined' && Bun.test) {
  // Bun is available, configure test defaults
  console.log('Running tests with Bun runtime');
}