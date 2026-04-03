/**
 * DevTools module - placeholder for future implementation
 *
 * Will include:
 * - Query inspector panel
 * - Mutation log
 * - Cache explorer
 * - Subscription monitor
 * - Network panel
 * - Time travel debugging
 */

export interface DevToolsConfig {
  /** Position on screen */
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Initial open state */
  initialIsOpen?: boolean;
  /** Panels to show */
  panels?: ('queries' | 'mutations' | 'cache' | 'subscriptions' | 'network')[];
  /** Button position offset */
  buttonPosition?: { bottom: number; right: number };
}

/**
 * DevTools component - placeholder
 * TODO: Implement full DevTools panel
 */
export function NetronDevtools(_config?: DevToolsConfig): null {
  // Placeholder - full implementation in Phase 9
  if (process.env.NODE_ENV === 'development') {
    console.log('[netron-react] DevTools not yet implemented');
  }
  return null;
}

/**
 * DevTools logger
 */
export interface Logger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

let logger: Logger = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

/**
 * Set custom logger
 */
export function setLogger(customLogger: Partial<Logger>): void {
  logger = { ...logger, ...customLogger };
}

/**
 * Get current logger
 */
export function getLogger(): Logger {
  return logger;
}

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

let logLevel: LogLevel = process.env.NODE_ENV === 'development' ? 'warn' : 'error';

/**
 * Set log level
 */
export function setLogLevel(level: LogLevel): void {
  logLevel = level;
}

/**
 * Internal logging function
 */
export function log(level: Exclude<LogLevel, 'none'>, ...args: unknown[]): void {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
  };

  if (levels[level] >= levels[logLevel]) {
    switch (level) {
      case 'debug':
      case 'info':
        logger.log('[netron-react]', ...args);
        break;
      case 'warn':
        logger.warn('[netron-react]', ...args);
        break;
      case 'error':
        logger.error('[netron-react]', ...args);
        break;
      default:
        // 'none' level - don't log
        break;
    }
  }
}
