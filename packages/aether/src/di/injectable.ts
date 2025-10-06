/**
 * Dependency Injection - Injectable Decorator and Function
 *
 * Mark classes and functions as injectable
 */

import type { InjectableOptions, Type } from './types.js';

/**
 * Injectable decorator for classes
 *
 * @param options - Injectable options (scope, providedIn, deps)
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   // ...
 * }
 *
 * @Injectable({ scope: 'transient' })
 * export class IdGenerator {
 *   // ...
 * }
 *
 * @Injectable({ deps: [HttpService, ConfigService] })
 * export class ApiService {
 *   constructor(http: HttpService, config: ConfigService) {}
 * }
 * ```
 */
export function Injectable(options?: InjectableOptions & { deps?: any[] }): ClassDecorator {
  return (target: any) => {
    // Store injectable metadata
    const metadata: any = {
      scope: options?.scope ?? 'singleton',
      providedIn: options?.providedIn,
    };

    // Add deps if provided
    if (options?.deps) {
      metadata.deps = options.deps;
    }

    Reflect.defineMetadata?.('injectable:options', metadata, target);

    // Store original class
    Reflect.defineMetadata?.('injectable:class', target, target);

    return target;
  };
}

/**
 * Function-based injectable service
 *
 * @param factory - Factory function that creates the service instance
 * @param options - Injectable options
 * @returns Injectable service class
 *
 * @example
 * ```typescript
 * export const CounterService = injectable(() => {
 *   const count = signal(0);
 *   return {
 *     count,
 *     increment: () => count.set(count() + 1)
 *   };
 * });
 * ```
 */
export function injectable<T>(
  factory: () => T,
  options?: InjectableOptions
): Type<T> {
  // Create a wrapper class
  class InjectableService {
    private static instance: T | null = null;

    constructor() {
      // For transient scope, always create new instance
      if (options?.scope === 'transient') {
        return factory() as any;
      }

      // For singleton scope, reuse instance
      if (!InjectableService.instance) {
        InjectableService.instance = factory();
      }
      return InjectableService.instance as any;
    }
  }

  // Store injectable metadata
  Reflect.defineMetadata?.(
    'injectable:options',
    {
      scope: options?.scope ?? 'singleton',
      providedIn: options?.providedIn,
    },
    InjectableService
  );

  Reflect.defineMetadata?.('injectable:factory', factory, InjectableService);

  return InjectableService as any;
}

/**
 * Check if a class is injectable
 */
export function isInjectable(target: any): boolean {
  return Reflect.hasMetadata?.('injectable:options', target) ?? false;
}

/**
 * Get injectable options from a class
 */
export function getInjectableOptions(target: any): InjectableOptions | undefined {
  return Reflect.getMetadata?.('injectable:options', target);
}
