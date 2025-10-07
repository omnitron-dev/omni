/**
 * Browser-compatible logger that mimics Pino API
 *
 * This logger provides a console-based logging implementation that is compatible
 * with the Pino logger interface used in Titan, allowing Netron code to work
 * seamlessly in the browser environment.
 */

/**
 * Logger interface compatible with Pino
 */
export interface ILogger {
  /**
   * Log debug message with optional object context
   */
  debug(obj: any, msg?: string): void;
  debug(msg: string): void;

  /**
   * Log info message with optional object context
   */
  info(obj: any, msg?: string): void;
  info(msg: string): void;

  /**
   * Log warning message with optional object context
   */
  warn(obj: any, msg?: string): void;
  warn(msg: string): void;

  /**
   * Log error message with optional object context
   */
  error(obj: any, msg?: string): void;
  error(msg: string): void;

  /**
   * Create a child logger with additional context
   */
  child(context: any): ILogger;
}

/**
 * Browser-based logger implementation using console API
 *
 * Features:
 * - Mimics Pino API for compatibility
 * - Context accumulation via child()
 * - Handles both Pino v9.7 (msg, obj) and v9.9 (obj, msg) signatures
 * - Uses native console methods for browser devtools integration
 *
 * @example
 * ```typescript
 * const logger = new BrowserLogger({ service: 'netron' });
 * logger.info({ userId: 123 }, 'User logged in');
 *
 * const childLogger = logger.child({ requestId: 'abc-123' });
 * childLogger.debug('Processing request');
 * ```
 */
export class BrowserLogger implements ILogger {
  constructor(private context: Record<string, any> = {}) {}

  /**
   * Format message for logging
   * Handles both signatures: (msg) and (obj, msg)
   */
  private formatMessage(obj: any, msg?: string): [string, any?] {
    if (typeof obj === 'string') {
      // First arg is message
      return [obj];
    }
    // First arg is object, second is message
    return [msg || '', { ...this.context, ...obj }];
  }

  debug(obj: any, msg?: string): void {
    const [message, data] = this.formatMessage(obj, msg);
    if (data) {
      console.debug('[Netron]', message, data);
    } else {
      console.debug('[Netron]', message);
    }
  }

  info(obj: any, msg?: string): void {
    const [message, data] = this.formatMessage(obj, msg);
    if (data) {
      console.info('[Netron]', message, data);
    } else {
      console.info('[Netron]', message);
    }
  }

  warn(obj: any, msg?: string): void {
    const [message, data] = this.formatMessage(obj, msg);
    if (data) {
      console.warn('[Netron]', message, data);
    } else {
      console.warn('[Netron]', message);
    }
  }

  error(obj: any, msg?: string): void {
    const [message, data] = this.formatMessage(obj, msg);
    if (data) {
      console.error('[Netron]', message, data);
    } else {
      console.error('[Netron]', message);
    }
  }

  /**
   * Create a child logger with additional context
   * Context is accumulated from parent to child
   */
  child(context: any): ILogger {
    return new BrowserLogger({ ...this.context, ...context });
  }
}

/**
 * Create a default browser logger instance
 */
export function createLogger(context?: Record<string, any>): ILogger {
  return new BrowserLogger(context);
}
