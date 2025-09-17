/**
 * Logger module for Titan using Pino
 */

import os from 'node:os';
import { Token, createToken } from '@omnitron-dev/nexus';
import pino, { Level, DestinationStream, Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from 'pino';

import { ConfigModuleToken } from './config.module.js';
import { IApplication, IHealthStatus, ApplicationModule } from '../types.js';

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
 * Logger options
 */
export interface ILoggerOptions extends PinoLoggerOptions {
  prettyPrint?: boolean;
  destination?: DestinationStream;
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
}

/**
 * Logger module token
 */
export const LoggerModuleToken: Token<LoggerModule> = createToken<LoggerModule>('LoggerModule');

/**
 * Logger implementation wrapping Pino
 */
class LoggerImpl implements ILogger {
  constructor(public readonly _pino: PinoLogger) { }

  trace(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.trace(objOrMsg, ...args);
    } else {
      this._pino.trace(objOrMsg, ...args);
    }
  }

  debug(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.debug(objOrMsg, ...args);
    } else {
      this._pino.debug(objOrMsg, ...args);
    }
  }

  info(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.info(objOrMsg, ...args);
    } else {
      this._pino.info(objOrMsg, ...args);
    }
  }

  warn(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.warn(objOrMsg, ...args);
    } else {
      this._pino.warn(objOrMsg, ...args);
    }
  }

  error(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.error(objOrMsg, ...args);
    } else {
      this._pino.error(objOrMsg, ...args);
    }
  }

  fatal(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.fatal(objOrMsg, ...args);
    } else {
      this._pino.fatal(objOrMsg, ...args);
    }
  }

  child(bindings: object): ILogger {
    return new LoggerImpl(this._pino.child(bindings));
  }

  time(label?: string): () => void {
    const start = Date.now();
    const id = label || 'time-' + Math.random().toString(36).substr(2, 9);

    return () => {
      const duration = Date.now() - start;
      this._pino.info({ duration, label: id }, `Timer ${id} completed in ${duration}ms`);
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this._pino.isLevelEnabled(level);
  }
}

/**
 * Logger module implementation
 */
export class LoggerModule extends ApplicationModule implements ILoggerModule {
  override readonly name = 'logger';
  override readonly version = '1.0.0';
  override readonly dependencies: (Token<any> | string)[] = [ConfigModuleToken];
  private readonly __isLoggerModule = true; // Marker for type identification

  private rootLogger!: PinoLogger;
  private globalLogger!: ILogger;
  private transports: ITransport[] = [];
  private processors: ILogProcessor[] = [];
  private context: object = {};
  private loggers = new Map<string, ILogger>();

  override async onStart(app: IApplication): Promise<void> {
    // Get configuration
    const config = app.get(ConfigModuleToken);

    // Create root logger with configuration
    const options: ILoggerOptions = {
      level: config.get('logger.level', 'info'),
      name: app.config('name') || 'titan-app',
      serializers: pino.stdSerializers,
      redact: config.get('logger.redact', []),
      base: {
        pid: process.pid,
        hostname: os.hostname(),
        ...config.get('logger.base', {})
      },
      timestamp: (() => {
        const timestampConfig = config.get<boolean>('logger.timestamp', true);
        return !timestampConfig ? false : pino.stdTimeFunctions.isoTime;
      })(),
      messageKey: config.get('logger.messageKey', 'msg'),
      nestedKey: config.get('logger.nestedKey'),
      enabled: config.get('logger.enabled', true)
    };

    // Check if pretty print is enabled (for development)
    const prettyPrint = config.get('logger.prettyPrint', app.config('environment') === 'development');

    if (prettyPrint) {
      // Use pino-pretty for development
      const pretty = (await import('pino-pretty')).default;
      this.rootLogger = pino(options, pretty({
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        ...config.get('logger.pretty', {})
      }));
    } else {
      this.rootLogger = pino(options);
    }

    // Create global logger
    this.globalLogger = new LoggerImpl(this.rootLogger);
  }

  override async onStop(app: IApplication): Promise<void> {
    // Flush all transports
    await Promise.all(
      this.transports
        .filter(t => t.flush)
        .map(t => t.flush!())
    );
  }

  /**
   * Create a named logger
   */
  create(name: string, options?: ILoggerOptions): ILogger {
    if (this.loggers.has(name)) {
      return this.loggers.get(name)!;
    }

    const childLogger = this.rootLogger.child({
      name,
      ...this.context
    });

    const logger = new LoggerImpl(childLogger);
    this.loggers.set(name, logger);

    return logger;
  }

  /**
   * Create a child logger with additional bindings
   */
  child(bindings: object): ILogger {
    return new LoggerImpl(this.rootLogger.child({
      ...this.context,
      ...bindings
    }));
  }

  /**
   * Get the global logger
   */
  get logger(): ILogger {
    return this.globalLogger;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.rootLogger.level = level;

    // Update all child loggers
    for (const logger of this.loggers.values()) {
      logger._pino.level = level;
    }
  }

  /**
   * Add a transport
   */
  addTransport(transport: ITransport): void {
    this.transports.push(transport);

    // For now, we'll just store transports - proper implementation would
    // require using pino.transport() or pino.destination()
    // This is a simplified version for the minimal framework
  }

  /**
   * Add a processor
   */
  addProcessor(processor: ILogProcessor): void {
    this.processors.push(processor);

    // For now, we'll just store processors - proper implementation would
    // require custom pino serializers or formatters
    // This is a simplified version for the minimal framework
  }

  /**
   * Set global context
   */
  setContext(context: object): void {
    this.context = { ...this.context, ...context };

    // Update global logger
    this.globalLogger = new LoggerImpl(
      this.rootLogger.child(this.context)
    );
  }

  /**
   * Create logger with additional context
   */
  withContext(context: object): ILogger {
    return new LoggerImpl(
      this.rootLogger.child({ ...this.context, ...context })
    );
  }

  /**
   * Health check
   */
  override async health(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      details: {
        level: this.rootLogger.level,
        enabled: this.rootLogger.isLevelEnabled('trace'),
        transportCount: this.transports.length,
        processorCount: this.processors.length,
        loggerCount: this.loggers.size
      }
    };
  }
}

/**
 * Create a logger module
 */
export function createLoggerModule(options?: {
  level?: LogLevel;
  prettyPrint?: boolean;
  transports?: ITransport[];
  processors?: ILogProcessor[];
  context?: object;
}): LoggerModule {
  const module = new LoggerModule();
  (module as any).__isLoggerModule = true; // Ensure marker is set

  // These will be applied during onStart
  if (options) {
    const originalOnStart = module.onStart.bind(module);
    module.onStart = async function (app: IApplication) {
      await originalOnStart(app);

      if (options.level) {
        this.setLevel(options.level);
      }

      if (options.transports) {
        for (const transport of options.transports) {
          this.addTransport(transport);
        }
      }

      if (options.processors) {
        for (const processor of options.processors) {
          this.addProcessor(processor);
        }
      }

      if (options.context) {
        this.setContext(options.context);
      }
    };
  }

  return module;
}

/**
 * Console transport for testing
 */
export class ConsoleTransport implements ITransport {
  name = 'console';

  write(log: any): void {
    console.log(JSON.stringify(log));
  }
}

/**
 * Redaction processor
 */
export class RedactionProcessor implements ILogProcessor {
  constructor(private paths: string[]) { }

  process(log: any): any {
    const processed = { ...log };

    for (const path of this.paths) {
      const parts = path.split('.');
      let current = processed;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!part || !current[part]) break;
        current = current[part];
      }

      if (current && parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart in current) {
          current[lastPart] = '[REDACTED]';
        }
      }
    }

    return processed;
  }
}