/**
 * Test utilities for cross-runtime compatibility (Node.js and Bun)
 */

export {
  isBun,
  isJest,
  supportsFakeTimers,
  setupFakeTimers,
  teardownFakeTimers,
  advanceTimersByTime,
  clearAllTimers,
  expectAsync,
  sleep,
} from '@omnitron-dev/testing';
