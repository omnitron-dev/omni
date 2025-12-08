/**
 * Logger Decorators
 *
 * Decorators for logging functionality in Titan framework
 */

import { createDecorator } from '../../decorators/index.js';
import { createNullLogger, type ILogger } from './logger.types.js';

// Re-export Log and Monitor from utility decorators to avoid duplication
export { Log, Monitor } from '../../decorators/utility.js';

// Re-export ILogger type from logger module for convenience
export type { ILogger } from './logger.module.js';

/**
 * Logger property decorator - injects a logger instance
 *
 * The actual logger should be injected via DI using LOGGER_SERVICE_TOKEN.
 * This decorator provides a null logger fallback that does nothing,
 * ensuring no runtime errors if DI is not configured.
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
            // Use null logger as fallback - actual logger should be injected via DI
            this[privateKey] = createNullLogger();
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
