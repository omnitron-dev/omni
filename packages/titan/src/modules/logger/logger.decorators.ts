/**
 * Logger Decorators
 *
 * Decorators for logging functionality in Titan framework
 */

import { createDecorator } from '../../decorators/index.js';
// Re-export Log and Monitor from utility decorators to avoid duplication
export { Log, Monitor } from '../../decorators/utility.js';

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
 * Note: Log and Monitor decorators are re-exported from utility.ts
 * to avoid code duplication. The implementations in utility.ts are
 * used throughout the framework for consistency.
 *
 * @see ../../decorators/utility.ts for implementation details
 */
