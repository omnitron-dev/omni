/**
 * Logger Decorators
 *
 * Decorators for logging functionality in Titan framework
 */

import { createDecorator, DECORATOR_METADATA } from '../../decorators/index.js';
import { createNullLogger } from './logger.types.js';
import { LOGGER_SERVICE_TOKEN } from './logger.tokens.js';
import type { ILoggerModule } from './logger.types.js';

// Re-export Log and Monitor from utility decorators to avoid duplication
export { Log, Monitor } from '../../decorators/utility.js';

// Re-export ILogger type from logger module for convenience
export type { ILogger } from './logger.module.js';

/**
 * A null logger shared by every un-injected property, so the fallback path
 * allocates nothing per access.
 */
const sharedNullLogger = createNullLogger();

/**
 * Logger property decorator - injects a named logger instance.
 *
 * Resolves `LOGGER_SERVICE_TOKEN` on first access through the container that
 * created the host instance — the same back-reference `@Lazy` uses — and
 * returns `loggerService.create(name)`, so the emitted lines carry the name.
 *
 * It used to return `createNullLogger()` and nothing else: the decorator wrote
 * a `logger` metadata entry no reader consumed, and no DI path ever assigned
 * the property. Every line logged through it was discarded, silently, with the
 * full ILogger surface answering — and the module's own README example was
 * exactly this shape. Losing startup output once cost seven hours of
 * debugging; a logger that swallows is worse than one that is absent.
 *
 * The null logger remains the fallback for an app that never configured
 * LoggerModule, and for access from inside a constructor (the container sets
 * its back-reference just after construction). That fallback is NOT cached, so
 * the first access after the container is attached gets the real logger.
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
    // Introspection marker: "this property is a logger". Nothing in the
    // resolution path reads it — the wiring is the getter below — so do not
    // add behaviour behind this key without giving it a reader.
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
      const name: string | undefined = context.options;

      Object.defineProperty(context.target, propertyKey, {
        get() {
          if (this[privateKey]) return this[privateKey];

          const container = Reflect.getMetadata(DECORATOR_METADATA.CONTAINER, this);
          if (container?.has?.(LOGGER_SERVICE_TOKEN)) {
            const service = container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
            this[privateKey] = service.create(name || this.constructor?.name || 'Logger');
            return this[privateKey];
          }

          // No container yet (constructor-time access) or no LoggerModule in
          // this app. Do not cache — the next access may find both.
          return sharedNullLogger;
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
