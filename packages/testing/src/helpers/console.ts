/**
 * Console Output Suppression
 *
 * Utilities for suppressing console output during tests
 */

/**
 * Suppress console output during tests
 *
 * Temporarily replaces console methods with no-op functions to prevent
 * noise during test execution. Returns a restore function to restore
 * the original console methods.
 *
 * @returns Restore function that restores the original console methods
 *
 * @example
 * ```typescript
 * describe('My Test Suite', () => {
 *   let restore: () => void;
 *
 *   beforeEach(() => {
 *     restore = suppressConsole();
 *   });
 *
 *   afterEach(() => {
 *     restore();
 *   });
 *
 *   it('should not log anything', () => {
 *     console.log('This will not appear');
 *     // Test logic...
 *   });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Using in a single test
 * it('should suppress console', () => {
 *   const restore = suppressConsole();
 *   try {
 *     console.log('Hidden');
 *     // Test logic...
 *   } finally {
 *     restore();
 *   }
 * });
 * ```
 */
export function suppressConsole(): () => void {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };

  // Use noop functions to avoid test framework dependencies
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;
  console.info = noop;

  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
  };
}
