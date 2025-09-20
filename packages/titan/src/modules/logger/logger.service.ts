/**
 * Logger Service Implementation
 */

import os from 'node:os';
import pino, { Logger as PinoLogger } from 'pino';
import { Injectable, Inject, Optional } from '@omnitron-dev/nexus';

import {
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN
} from './logger.tokens.js';

import { CONFIG_SERVICE_TOKEN } from '../config/config.tokens.js';

import type {
  ILogger,
  ILoggerModule,
  ILoggerOptions,
  ILoggerModuleOptions,
  ITransport,
  ILogProcessor,
  LogLevel
} from './logger.types.js';

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
 * Logger Service
 */
@Injectable()
export class LoggerService implements ILoggerModule {
  private rootLogger!: PinoLogger;
  private globalLogger!: ILogger;
  private transports: ITransport[] = [];
  private processors: ILogProcessor[] = [];
  private context: object = {};
  private loggers = new Map<string, ILogger>();
  private initialized = false;

  constructor(
    @Optional() @Inject(LOGGER_OPTIONS_TOKEN) private options: ILoggerModuleOptions = {},
    @Optional() @Inject(LOGGER_TRANSPORTS_TOKEN) initialTransports?: ITransport[],
    @Optional() @Inject(LOGGER_PROCESSORS_TOKEN) initialProcessors?: ILogProcessor[],
    @Optional() @Inject(CONFIG_SERVICE_TOKEN) private configService?: any
  ) {
    // Initialize immediately
    this.initialize();

    // Add initial transports and processors if provided
    if (initialTransports) {
      this.transports.push(...initialTransports);
    }
    if (initialProcessors) {
      this.processors.push(...initialProcessors);
    }
  }

  private initialize(): void {
    if (this.initialized) return;

    // Get configuration from options or config service
    const config = this.getConfiguration();

    // Create root logger with configuration
    const pinoOptions: ILoggerOptions = {
      level: config.level || 'info',
      name: config.name || 'titan-app',
      serializers: pino.stdSerializers,
      redact: config.redact || [],
      base: {
        pid: process.pid,
        hostname: os.hostname(),
        ...config.base
      },
      timestamp: (() => {
        const timestampConfig = config.timestamp ?? true;
        return !timestampConfig ? false : pino.stdTimeFunctions.isoTime;
      })(),
      messageKey: config.messageKey || 'msg',
      nestedKey: config.nestedKey,
      enabled: config.enabled !== false
    };

    // Check if pretty print is enabled (for development)
    const prettyPrint = config.prettyPrint ||
      (config.environment === 'development' && config.prettyPrint !== false);

    if (prettyPrint) {
      // Try to use pino-pretty for development (synchronously)
      try {
        // Note: This requires pino-pretty to be installed
        // For now, just use regular pino
        this.rootLogger = pino(pinoOptions);
      } catch {
        // Fallback to regular pino if pino-pretty is not available
        this.rootLogger = pino(pinoOptions);
      }
    } else {
      this.rootLogger = pino(pinoOptions);
    }

    // Create global logger
    this.globalLogger = new LoggerImpl(this.rootLogger);

    // Apply initial context if provided
    if (this.options.context) {
      this.setContext(this.options.context);
    }

    this.initialized = true;
  }

  private getConfiguration(): any {
    const config: any = { ...this.options };

    // Try to get configuration from ConfigService if available
    // Note: ConfigService might not be initialized yet during construction
    if (this.configService && typeof this.configService.get === 'function') {
      try {
        config.level = this.configService.get('logger.level', config.level);
        config.prettyPrint = this.configService.get('logger.prettyPrint', config.prettyPrint);
        config.redact = this.configService.get('logger.redact', config.redact);
        config.base = this.configService.get('logger.base', config.base);
        config.timestamp = this.configService.get('logger.timestamp', config.timestamp);
        config.messageKey = this.configService.get('logger.messageKey', config.messageKey);
        config.nestedKey = this.configService.get('logger.nestedKey', config.nestedKey);
        config.enabled = this.configService.get('logger.enabled', config.enabled);
        config.pretty = this.configService.get('logger.pretty', config.pretty);
        config.environment = this.configService.get('environment', 'development');
        config.name = this.configService.get('name', config.name);
      } catch (error) {
        // ConfigService might not be fully initialized, use defaults
        // This is expected during early initialization phase
      }
    }

    return config;
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
    if (!this.initialized) {
      this.initialize();
    }
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
  }

  /**
   * Add a processor
   */
  addProcessor(processor: ILogProcessor): void {
    this.processors.push(processor);
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
   * Flush all transports
   */
  async flush(): Promise<void> {
    await Promise.all(
      this.transports
        .filter(t => t.flush)
        .map(t => t.flush!())
    );
  }
}