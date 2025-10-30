/**
 * Logger factory utility for the database module
 *
 * Provides a consistent way to create loggers across the module,
 * reducing code duplication and ensuring type safety.
 */

import type { Logger } from '../database.internal-types.js';

/**
 * Create a default console logger with a prefix
 *
 * @param prefix - The prefix to add to all log messages
 * @returns Logger instance
 */
export function createDefaultLogger(prefix: string): Logger {
  return {
    info: (...args: unknown[]) => console.info(`[${prefix}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${prefix}]`, ...args),
    debug: (...args: unknown[]) => console.debug(`[${prefix}]`, ...args),
    trace: (...args: unknown[]) => console.trace(`[${prefix}]`, ...args),
    fatal: (...args: unknown[]) => console.error(`[${prefix}] FATAL:`, ...args),
  };
}

/**
 * Create a null logger that does nothing
 *
 * Useful for testing or when logging should be disabled
 *
 * @returns Logger instance that does nothing
 */
export function createNullLogger(): Logger {
  const noop = () => {};
  return {
    info: noop,
    error: noop,
    warn: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  };
}

/**
 * Create a logger that delegates to another logger with a prefix
 *
 * @param logger - The logger to delegate to
 * @param prefix - The prefix to add to all messages
 * @returns Logger instance
 */
export function createPrefixedLogger(logger: Logger, prefix: string): Logger {
  return {
    info: (...args: unknown[]) => logger.info(`[${prefix}]`, ...args),
    error: (...args: unknown[]) => logger.error(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => logger.warn(`[${prefix}]`, ...args),
    debug: (...args: unknown[]) => logger.debug(`[${prefix}]`, ...args),
    trace: (...args: unknown[]) => logger.trace(`[${prefix}]`, ...args),
    fatal: (...args: unknown[]) => logger.fatal(`[${prefix}]`, ...args),
  };
}

/**
 * Create a logger that filters by log level
 *
 * @param logger - The logger to wrap
 * @param level - The minimum log level to allow
 * @returns Logger instance
 */
export function createFilteredLogger(
  logger: Logger,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
): Logger {
  const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const minLevel = levels.indexOf(level);

  return {
    trace: minLevel <= 0 ? logger.trace : () => {},
    debug: minLevel <= 1 ? logger.debug : () => {},
    info: minLevel <= 2 ? logger.info : () => {},
    warn: minLevel <= 3 ? logger.warn : () => {},
    error: minLevel <= 4 ? logger.error : () => {},
    fatal: logger.fatal, // Always log fatal
  };
}

/**
 * Type guard to check if a value is a Logger
 *
 * @param value - The value to check
 * @returns True if the value is a Logger
 */
export function isLogger(value: unknown): value is Logger {
  return (
    typeof value === 'object' &&
    value !== null &&
    'info' in value &&
    'error' in value &&
    'warn' in value &&
    'debug' in value &&
    'trace' in value &&
    'fatal' in value &&
    typeof (value as any).info === 'function' &&
    typeof (value as any).error === 'function'
  );
}