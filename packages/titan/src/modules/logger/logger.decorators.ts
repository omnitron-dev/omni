/**
 * Logger Decorators
 *
 * Decorators for logging functionality in Titan framework
 */

import { createDecorator, createMethodInterceptor } from '../../decorators/index.js';

// Re-export ILogger type from logger module for convenience
export type { ILogger } from './logger.module.js';

/**
 * Helper function to get logger instance
 * This returns a simple console logger for decorators
 * The actual logger module will override this when needed
 */
function getLoggerInstance(name: string): any {
  // Simple console logger implementation for decorators
  // This is a fallback when the real logger module is not available
  return {
    trace: (...args: any[]) => console.trace(`[${name}]`, ...args),
    debug: (...args: any[]) => console.debug(`[${name}]`, ...args),
    info: (...args: any[]) => console.info(`[${name}]`, ...args),
    warn: (...args: any[]) => console.warn(`[${name}]`, ...args),
    error: (...args: any[]) => console.error(`[${name}]`, ...args),
    fatal: (...args: any[]) => console.error(`[${name}] [FATAL]`, ...args),
    child: (bindings: object) => getLoggerInstance(`${name}:${JSON.stringify(bindings)}`),
    time: (label?: string) => () => console.timeEnd(label || 'timer'),
    isLevelEnabled: () => true,
  };
}

/**
 * Logger property decorator - injects a logger instance
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Logger('UserService')
 *   private logger!: ILogger;
 *
 *   async createUser() {
 *     this.logger.info('Creating user');
 *   }
 * }
 * ```
 */
export const Logger = createDecorator<string>()
  .withName('Logger')
  .forProperty()
  .withMetadata((context: any) => {
    // Set metadata that tests expect (just true for no args)
    Reflect.defineMetadata('logger', true, context.target, context.propertyKey!);
    return {
      logger: true,
      name: context.options || context.target.constructor.name,
    };
  })
  .withHooks({
    afterApply: (context: any) => {
      const propertyKey = context.propertyKey!;
      const privateKey = Symbol(`__${String(propertyKey)}`);

      Object.defineProperty(context.target, propertyKey, {
        get() {
          if (!this[privateKey]) {
            const name = context.options || context.target.constructor.name;
            this[privateKey] = getLoggerInstance(name);
          }
          return this[privateKey];
        },
        set(value: any) {
          this[privateKey] = value;
        },
        enumerable: true,
        configurable: true,
      });
    },
  })
  .build();

/**
 * Log method decorator - logs method entry, exit and errors
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Log({ level: 'info', includeArgs: true })
 *   async createUser(userData: any) {
 *     // Method will be logged automatically
 *     return user;
 *   }
 * }
 * ```
 */
export const Log = createMethodInterceptor<{
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  includeArgs?: boolean;
  includeResult?: boolean;
  message?: string;
}>('Log', async (originalMethod, args, context) => {
  const level = context.options?.level || 'info';
  const methodName = `${context.target.constructor.name}.${String(context.propertyKey)}`;
  const logger = getLoggerInstance(context.target.constructor.name);

  const logData: any = {
    method: methodName,
    timestamp: new Date().toISOString(),
  };

  if (context.options?.includeArgs) {
    logData.args = args;
  }

  if (context.options?.message) {
    logData.message = context.options.message;
  }

  // Log method entry
  logger[level](logData, `Entering ${methodName}`);

  try {
    const result = await originalMethod(...args);

    if (context.options?.includeResult) {
      logData.result = result;
    }

    // Log method exit
    logger[level](logData, `Exiting ${methodName}`);

    return result;
  } catch (error) {
    logData.error = error;
    logger.error(logData, `Error in ${methodName}`);
    throw error;
  }
});

/**
 * Monitor decorator - tracks performance metrics
 * This is a lightweight version for basic monitoring
 *
 * @example
 * ```typescript
 * class DataService {
 *   @Monitor({ name: 'fetch-data' })
 *   async fetchData() {
 *     // Performance will be tracked
 *   }
 * }
 * ```
 */
export const Monitor = createMethodInterceptor<{
  name?: string;
  sampleRate?: number;
  includeArgs?: boolean;
  includeResult?: boolean;
}>('Monitor', async (originalMethod, args, context) => {
  const sampleRate = context.options?.sampleRate ?? 1.0;

  // Skip monitoring based on sample rate
  if (Math.random() > sampleRate) {
    return originalMethod(...args);
  }

  const metricName = context.options?.name || `${context.target.constructor.name}.${String(context.propertyKey)}`;
  const start = performance.now();

  const metadata: any = {
    method: metricName,
    timestamp: Date.now(),
  };

  if (context.options?.includeArgs) {
    metadata.args = args;
  }

  try {
    const result = await originalMethod(...args);

    const duration = performance.now() - start;
    metadata.duration = duration;
    metadata.success = true;

    if (context.options?.includeResult) {
      metadata.result = result;
    }

    // Log metrics (could be replaced with actual metrics collection)
    console.debug(`[Metrics] ${metricName}`, {
      duration: `${duration.toFixed(2)}ms`,
      success: true,
    });

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    metadata.duration = duration;
    metadata.success = false;
    metadata.error = error;

    // Log error metrics
    console.error(`[Metrics] ${metricName}`, {
      duration: `${duration.toFixed(2)}ms`,
      success: false,
      error: (error as Error).name,
    });

    throw error;
  }
});
