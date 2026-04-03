/**
 * Test setup file for Jest
 */

// Import reflect-metadata for decorator support
import { vi } from 'vitest';
import 'reflect-metadata';

// Set test environment
process.env['NODE_ENV'] = 'test';

// Increase timeout for async tests
// Test timeout: 10000ms (configured in vitest.config.ts)

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  // Keep info and debug for debugging tests
  info: console.info,
  debug: console.debug,
  log: console.log,
};
