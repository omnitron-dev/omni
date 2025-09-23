/**
 * Test setup file for Jest
 */

// Import reflect-metadata for decorator support
import 'reflect-metadata';

// Set test environment
process.env['NODE_ENV'] = 'test';

// Increase timeout for async tests
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  // Keep info and debug for debugging tests
  info: console.info,
  debug: console.debug,
  log: console.log,
};