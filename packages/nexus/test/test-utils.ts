/**
 * Test utilities for cross-runtime compatibility (Node.js, Bun, and Deno)
 */

export {
  isBun,
  isDeno,
  isNode,
  isJest,
  supportsFakeTimers,
  setupFakeTimers,
  teardownFakeTimers,
  advanceTimersByTime,
  clearAllTimers,
  expectAsync,
  sleep,
  RUNTIME
} from '@omnitron-dev/testing';