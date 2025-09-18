/**
 * Logger Service
 *
 * Wrapper around Pino logger for the template module.
 * Provides consistent logging with module context.
 */

import { Injectable, Inject, Optional } from '@omnitron-dev/nexus';
import pino, { Logger } from 'pino';
import { TEMPLATE_MODULE_OPTIONS } from '../constants.js';
import type { TemplateModuleOptions } from '../types.js';

@Injectable()
export class LoggerService {
  private logger: Logger;

  constructor(
    @Inject(TEMPLATE_MODULE_OPTIONS) private readonly options: TemplateModuleOptions,
    @Optional() @Inject('PINO_LOGGER') existingLogger?: Logger
  ) {
    if (existingLogger) {
      this.logger = existingLogger.child({
        module: 'TemplateModule',
        prefix: options.prefix
      });
    } else {
      this.logger = pino({
        name: 'TemplateModule',
        level: options.debug ? 'debug' : 'info',
        transport: options.debug ? {
          target: 'pino-pretty',
          options: {
            colorize: true
          }
        } : undefined
      });
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: any): void {
    if (data) {
      this.logger.debug(data, message);
    } else {
      this.logger.debug(message);
    }
  }

  /**
   * Log info message
   */
  info(message: string, data?: any): void {
    if (data) {
      this.logger.info(data, message);
    } else {
      this.logger.info(message);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any): void {
    if (data) {
      this.logger.warn(data, message);
    } else {
      this.logger.warn(message);
    }
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, data?: any): void {
    const errorData = {
      ...data,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined
    };

    this.logger.error(errorData, message);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, any>): LoggerService {
    const childLogger = Object.create(this);
    childLogger.logger = this.logger.child(context);
    return childLogger;
  }

  /**
   * Get the underlying Pino logger
   */
  getPinoLogger(): Logger {
    return this.logger;
  }
}