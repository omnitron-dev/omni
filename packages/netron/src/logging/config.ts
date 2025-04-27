import { LoggerOptions } from 'pino';

/**
 * Default logging configuration for the application.
 * 
 * This configuration object defines the base settings for the Pino logger,
 * which is used throughout the application for structured logging.
 * 
 * @property {string} level - The minimum logging level to output.
 *   Can be overridden by the LOG_LEVEL environment variable.
 *   Defaults to 'info' if not specified.
 * 
 * @property {Object} [transport] - Optional transport configuration for log output formatting.
 *   Only enabled in non-production environments for better readability.
 * 
 * @property {string} transport.target - The transport module to use for log formatting.
 *   Uses 'pino-pretty' for human-readable output in development.
 * 
 * @property {Object} transport.options - Configuration options for the transport.
 *   @property {boolean} colorize - Enables colored output for different log levels.
 *   @property {string} translateTime - Configures timestamp formatting.
 *     'SYS:standard' uses the system's standard time format.
 *   @property {string} ignore - Comma-separated list of log properties to exclude.
 *     Excludes process ID and hostname for cleaner output.
 */
export const defaultLoggingOptions: LoggerOptions = {
  level: process.env['LOG_LEVEL'] || 'info',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
      : undefined,
};
