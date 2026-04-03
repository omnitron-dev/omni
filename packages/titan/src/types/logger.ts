/**
 * Core Logger Types for Titan Framework
 *
 * These types are extracted to the shared types layer to avoid circular dependencies
 * between core infrastructure (Nexus, Netron, Rotif) and the modules layer.
 *
 * @packageDocumentation
 * @since 0.5.0
 */

/**
 * Log levels supported by the logger.
 * Compatible with Pino log levels.
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/**
 * Core logger interface for Titan framework.
 *
 * This interface defines the contract for all loggers in the system.
 * It is intentionally minimal and decoupled from implementation details
 * to allow core infrastructure to use logging without depending on the
 * full logger module.
 *
 * @example
 * ```typescript
 * // Basic usage
 * logger.info('User logged in');
 *
 * // With structured data (Pino v9.9.x format - object first)
 * logger.info({ userId: '123', action: 'login' }, 'User logged in');
 *
 * // Create child logger with bindings
 * const childLogger = logger.child({ module: 'auth' });
 * ```
 *
 * @stable
 * @since 0.1.0
 */
export interface ILogger {
  // Log methods - Pino v9.9.x format (object first, then message)
  /**
   * Log at trace level (most verbose)
   */
  trace(obj: object, msg?: string, ...args: any[]): void;
  trace(msg: string, ...args: any[]): void;

  /**
   * Log at debug level
   */
  debug(obj: object, msg?: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;

  /**
   * Log at info level
   */
  info(obj: object, msg?: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;

  /**
   * Log at warn level
   */
  warn(obj: object, msg?: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;

  /**
   * Log at error level
   */
  error(obj: object, msg?: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;

  /**
   * Log at fatal level (most severe)
   */
  fatal(obj: object, msg?: string, ...args: any[]): void;
  fatal(msg: string, ...args: any[]): void;

  /**
   * Create a child logger with additional context bindings.
   * Child loggers inherit the parent's configuration but add
   * additional context to all log messages.
   *
   * @param bindings - Additional context to include in all child logs
   * @returns A new logger instance with the bindings applied
   */
  child(bindings: object): ILogger;

  /**
   * Create a timer for measuring operation duration.
   * Returns a function that when called, logs the elapsed time.
   *
   * @param label - Optional label for the timer
   * @returns Function to call when operation completes
   */
  time(label?: string): () => void;

  /**
   * Check if a specific log level is enabled.
   *
   * @param level - The log level to check
   * @returns True if the level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean;

  /**
   * Set the current log level.
   *
   * @param level - The new log level
   */
  setLevel(level: LogLevel): void;

  /**
   * Get the current log level.
   *
   * @returns The current log level
   */
  getLevel(): LogLevel;
}

/**
 * Create a null logger that does nothing.
 * Useful for testing or when logging should be disabled.
 *
 * @returns Logger instance that silently discards all log calls
 *
 * @example
 * ```typescript
 * const logger = createNullLogger();
 * logger.info('This goes nowhere'); // No output
 * ```
 */
export function createNullLogger(): ILogger {
  const noop = () => {};
  let level: LogLevel = 'info';

  const nullLogger: ILogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => nullLogger,
    time: () => noop,
    isLevelEnabled: () => false,
    setLevel: (l: LogLevel) => {
      level = l;
    },
    getLevel: () => level,
  };

  return nullLogger;
}

/**
 * Type guard to check if a value is a Logger.
 * Checks for the presence of core logging methods.
 *
 * @param value - The value to check
 * @returns True if the value implements ILogger
 *
 * @example
 * ```typescript
 * if (isLogger(maybeLogger)) {
 *   maybeLogger.info('This is a valid logger');
 * }
 * ```
 */
export function isLogger(value: unknown): value is ILogger {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    'info' in obj &&
    'error' in obj &&
    'warn' in obj &&
    'debug' in obj &&
    typeof obj['info'] === 'function' &&
    typeof obj['error'] === 'function'
  );
}
