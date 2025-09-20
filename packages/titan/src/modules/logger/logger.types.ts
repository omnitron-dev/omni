/**
 * Logger Module Types
 *
 * Type definitions for the logger module
 */

import type { Level, DestinationStream, Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from 'pino';

/**
 * Log levels
 */
export type LogLevel = Level;

/**
 * Logger interface
 */
export interface ILogger {
  // Log methods - Pino v9.9.x format (object first, then message)
  trace(obj: object, msg?: string, ...args: any[]): void;
  trace(msg: string, ...args: any[]): void;
  debug(obj: object, msg?: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(obj: object, msg?: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(obj: object, msg?: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(obj: object, msg?: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  fatal(obj: object, msg?: string, ...args: any[]): void;
  fatal(msg: string, ...args: any[]): void;

  // Child loggers
  child(bindings: object): ILogger;

  // Timer
  time(label?: string): () => void;

  // Level checking
  isLevelEnabled(level: Level): boolean;

  // Pino instance access
  readonly _pino: PinoLogger;
}

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