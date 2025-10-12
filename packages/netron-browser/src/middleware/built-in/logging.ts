/**
 * Request/Response Logging Middleware
 *
 * Logs request and response information for debugging
 */

import type { MiddlewareFunction } from '../types.js';

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
}

/**
 * Console logger implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private prefix: string = '[Netron]') {}

  debug(message: string, data?: any): void {
    console.debug(`${this.prefix} ${message}`, data || '');
  }

  info(message: string, data?: any): void {
    console.info(`${this.prefix} ${message}`, data || '');
  }

  warn(message: string, data?: any): void {
    console.warn(`${this.prefix} ${message}`, data || '');
  }

  error(message: string, data?: any): void {
    console.error(`${this.prefix} ${message}`, data || '');
  }
}

/**
 * Logging middleware options
 */
export interface LoggingMiddlewareOptions {
  /**
   * Logger instance
   */
  logger?: Logger;

  /**
   * Log level for requests
   * @default 'info'
   */
  requestLogLevel?: LogLevel;

  /**
   * Log level for responses
   * @default 'info'
   */
  responseLogLevel?: LogLevel;

  /**
   * Log level for errors
   * @default 'error'
   */
  errorLogLevel?: LogLevel;

  /**
   * Include request payload in logs
   * @default false
   */
  logRequestPayload?: boolean;

  /**
   * Include response payload in logs
   * @default false
   */
  logResponsePayload?: boolean;

  /**
   * Skip logging for specific services
   */
  skipServices?: string[];

  /**
   * Skip logging for specific methods
   */
  skipMethods?: string[];
}

/**
 * Create logging middleware
 */
export function createLoggingMiddleware(options: LoggingMiddlewareOptions = {}): MiddlewareFunction {
  const {
    logger = new ConsoleLogger(),
    requestLogLevel = 'info',
    responseLogLevel = 'info',
    errorLogLevel = 'error',
    logRequestPayload = false,
    logResponsePayload = false,
    skipServices = [],
    skipMethods = [],
  } = options;

  return async (ctx, next) => {
    // Skip if service or method is in skip list
    if (skipServices.includes(ctx.service) || skipMethods.includes(`${ctx.service}.${ctx.method}`)) {
      return next();
    }

    const startTime = performance.now();

    // Log request
    const requestData: any = {
      service: ctx.service,
      method: ctx.method,
      transport: ctx.transport,
    };

    if (logRequestPayload) {
      requestData.args = ctx.args;
    }

    logger[requestLogLevel]('RPC Request', requestData);

    try {
      await next();

      // Log response
      const duration = performance.now() - startTime;
      const responseData: any = {
        service: ctx.service,
        method: ctx.method,
        duration: `${duration.toFixed(2)}ms`,
      };

      if (logResponsePayload && ctx.response?.data) {
        responseData.data = ctx.response.data;
      }

      logger[responseLogLevel]('RPC Response', responseData);
    } catch (error: any) {
      // Log error
      const duration = performance.now() - startTime;
      logger[errorLogLevel]('RPC Error', {
        service: ctx.service,
        method: ctx.method,
        duration: `${duration.toFixed(2)}ms`,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  };
}
