import pino, { Logger, LoggerOptions, DestinationStream } from 'pino';

import { defaultLoggingOptions } from './config';

/**
 * Factory class for creating and managing Pino logger instances.
 * Implements the Singleton pattern to ensure a single root logger instance
 * across the application while allowing for child loggers with specific contexts.
 */
class LoggerFactory {
  /** 
   * The root logger instance that serves as the base for all child loggers.
   * Initialized with default logging options from the configuration.
   * @private
   */
  private static rootLogger: Logger;

  /**
   * Creates and returns a logger instance, optionally with a specific context.
   * If a context is provided, returns a child logger with the specified context.
   * Otherwise, returns the root logger instance.
   * 
   * @param context - Optional context object containing metadata to be included in all log messages
   * @returns A Pino logger instance, either a child logger with context or the root logger
   */
  static getLogger(context?: Record<string, any>): Logger {
    if (!LoggerFactory.rootLogger) {
      LoggerFactory.rootLogger = pino(defaultLoggingOptions);
    }

    return context ? LoggerFactory.rootLogger.child(context) : LoggerFactory.rootLogger;
  }

  /**
   * Initializes or reconfigures the root logger with custom options and optional destination stream.
   * This method provides a flexible way to customize the logging behavior at runtime by:
   * - Merging custom options with default logging configuration
   * - Supporting custom destination streams for log output
   * - Maintaining backward compatibility with default configuration
   * 
   * The method follows a fallback pattern where:
   * 1. If both options and destination are provided, creates a logger with custom options and destination
   * 2. If only options are provided, creates a logger with custom options and default destination
   * 3. In both cases, default options are preserved and merged with custom ones
   * 
   * @param {LoggerOptions} [options] - Optional custom Pino logger configuration options.
   *                                   These options will be merged with defaultLoggingOptions.
   *                                   Can include settings like:
   *                                   - level: Log level (debug, info, warn, error)
   *                                   - formatters: Custom message formatting
   *                                   - redact: Fields to redact from logs
   *                                   - timestamp: Custom timestamp formatting
   * @param {DestinationStream} [destination] - Optional writable stream for log output.
   *                                           If provided, logs will be written to this stream
   *                                           instead of the default destination.
   *                                           Useful for:
   *                                           - File logging
   *                                           - Remote logging services
   *                                           - Custom log processing
   * @returns {void}
   * @example
   * // Initialize with custom options
   * LoggerFactory.initLogger({ level: 'debug' });
   * 
   * // Initialize with custom options and destination
   * const fileStream = fs.createWriteStream('app.log');
   * LoggerFactory.initLogger({ level: 'info' }, fileStream);
   */
  static initLogger(options?: LoggerOptions, destination?: DestinationStream): void {
    const mergedOptions = { ...defaultLoggingOptions, ...options };

    // If destination is provided, we need to remove the transport option
    // as it's not compatible with custom destinations
    if (destination) {
      delete mergedOptions.transport;
      LoggerFactory.rootLogger = pino(mergedOptions, destination);
    } else {
      LoggerFactory.rootLogger = pino(mergedOptions);
    }
  }
}

/**
 * Default logger instance created using the LoggerFactory.
 * This is the primary logger instance that should be used throughout the application
 * when a specific context is not required.
 */
export const logger = LoggerFactory.getLogger();

/**
 * The LoggerFactory class is exported as the default export,
 * allowing for direct access to the factory methods when needed.
 */
export default LoggerFactory;
