/**
 * Jest setup file for @devgrid/eventemitter
 * Configures Jest environment and test utilities
 */

import { jest } from '@jest/globals';

// Make jest available globally for source files that need it
(global as any).jest = jest;

// Set longer timeout for async tests
jest.setTimeout(10000);
