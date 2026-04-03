/**
 * Logger Module Types
 *
 * Type definitions for the logger module.
 *
 * NOTE: Core types (ILogger, LogLevel, createNullLogger, isLogger) have been
 * moved to `../../types/logger.js` to resolve architectural layering violations.
 * These are re-exported here for backward compatibility.
 *
 * @deprecated Import core logger types from `@omnitron-dev/titan/types` or
 * `../../types/logger.js` instead of directly from this module.
 * This module will continue to work but direct imports from here are discouraged.
 */

import type { DestinationStream, LoggerOptions as PinoLoggerOptions } from 'pino';

// Re-export core types from shared types layer for backward compatibility
export { type ILogger, type LogLevel, createNullLogger, isLogger } from '../../types/logger.js';

// Import for use in this file
import type { ILogger, LogLevel } from '../../types/logger.js';

/**
 * Logger options (extends Pino options)
 */
export interface ILoggerOptions extends PinoLoggerOptions {
  prettyPrint?: boolean;
  destination?: DestinationStream;
}

/**
 * Logger module options (for module configuration)
 */
export interface ILoggerModuleOptions {
  level?: LogLevel;
  prettyPrint?: boolean;
  transports?: ITransport[];
  processors?: ILogProcessor[];
  context?: object;
  enabled?: boolean;
  redact?: string[];
  base?: object;
  timestamp?: boolean | (() => string);
  messageKey?: string;
  nestedKey?: string;

  /**
   * Additional writable streams to send JSON log output to (e.g., file streams).
   * Each stream receives pino-formatted JSON lines alongside stdout.
   * Use `pino.destination()` or `fs.createWriteStream()` for file targets.
   */
  destinations?: Array<NodeJS.WritableStream | { stream: NodeJS.WritableStream; level?: LogLevel }>;
}

/**
 * Transport configuration
 */
export interface ITransport {
  name: string;
  write(log: any): void | Promise<void>;
  flush?(): Promise<void>;
}

/**
 * Log processor
 */
export interface ILogProcessor {
  process(log: any): any | null;
}

/**
 * Logger module interface
 */
export interface ILoggerModule {
  // Logger creation
  create(name: string, options?: ILoggerOptions): ILogger;
  child(bindings: object): ILogger;

  // Global logger
  readonly logger: ILogger;

  // Configuration
  setLevel(level: LogLevel): void;
  addTransport(transport: ITransport): void;
  addProcessor(processor: ILogProcessor): void;

  // Context
  setContext(context: object): void;
  withContext(context: object): ILogger;

  // Flush logs
  flush(): Promise<void>;
}
