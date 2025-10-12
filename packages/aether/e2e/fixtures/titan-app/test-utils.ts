/**
 * Test utilities for Titan test application
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';

/**
 * Create a mock logger for testing
 */
export function createMockLogger(): ILogger {
  const noop = () => {};
  const mockLogger: ILogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => mockLogger,
    level: 'info',
  };
  return mockLogger;
}
