/**
 * Test Helper Utilities
 *
 * Common utilities for testing including temporary directory management,
 * console suppression, assertions, and fixture management.
 */

// Temporary directory management
export { createTempDir, cleanupTempDir } from './temp-dir.js';

// Console suppression
export { suppressConsole } from './console.js';

// Assertions and fixtures
export { assertRejects, type TestFixture, withFixture } from './assertions.js';

export {
  readTraceBounds,
  verifyFiniteTraces,
  type FiniteTraceModel,
  type TraceSubject,
  type TraceBounds,
  type TraceReport,
} from './finite-traces.js';
export { recordTraceReceipt } from './trace-receipt.js';
