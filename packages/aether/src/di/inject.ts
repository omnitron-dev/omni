/**
 * Dependency Injection - Inject Function
 *
 * Resolve dependencies from the DI container
 */

import 'reflect-metadata';
import { getRootInjector } from './container.js';
import type { InjectableToken, InjectOptions, Injector } from './types.js';

/**
 * Current injector context
 */
let currentInjectorContext: Injector | null = null;

/**
 * Inject a dependency from the DI container
 *
 * @param token - Injection token (class, abstract class, or InjectionToken)
 * @param options - Injection options
 * @returns Instance of the requested type
 *
 * @example
 * ```typescript
 * const userService = inject(UserService);
 * const apiUrl = inject(API_URL);
 * const logger = inject(LOGGER, { optional: true });
 * ```
 */
export function inject<T>(token: InjectableToken<T>, options?: InjectOptions): T {
  // Use current injector context or fallback to root injector
  const injector = currentInjectorContext ?? getRootInjector();

  return injector.get(token, options);
}

/**
 * Inject decorator for class properties
 *
 * @param token - Injection token (optional, uses property type if not provided)
 * @param options - Injection options
 *
 * @example
 * ```typescript
 * class MyService {
 *   @Inject(UserService)
 *   userService!: UserService;
 *
 *   @Inject(API_URL)
 *   apiUrl!: string;
 *
 *   @Inject(LOGGER, { optional: true })
 *   logger?: Logger;
 * }
 * ```
 */
export function Inject<T = any>(token?: InjectableToken<T>, options?: InjectOptions): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // Store injection metadata
    const injectMetadata = Reflect.getMetadata?.('inject:properties', target.constructor) ?? [];
    injectMetadata.push({
      propertyKey,
      token: token ?? Reflect.getMetadata?.('design:type', target, propertyKey),
      options,
    });
    Reflect.defineMetadata?.('inject:properties', injectMetadata, target.constructor);
  };
}

/**
 * Optional decorator for optional dependencies
 *
 * @example
 * ```typescript
 * constructor(
 *   @Optional() private tracker?: TrackerService
 * ) {}
 * ```
 */
export function Optional(): ParameterDecorator {
  return (target: any, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const metadata = Reflect.getMetadata?.('inject:optional', target) ?? [];
    metadata.push(parameterIndex);
    Reflect.defineMetadata?.('inject:optional', metadata, target);
  };
}

/**
 * Self decorator to search only in current injector
 *
 * @example
 * ```typescript
 * constructor(
 *   @Self() private local: LocalService
 * ) {}
 * ```
 */
export function Self(): ParameterDecorator {
  return (target: any, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const metadata = Reflect.getMetadata?.('inject:self', target) ?? [];
    metadata.push(parameterIndex);
    Reflect.defineMetadata?.('inject:self', metadata, target);
  };
}

/**
 * SkipSelf decorator to skip current injector
 *
 * @example
 * ```typescript
 * constructor(
 *   @SkipSelf() private parent: ParentService
 * ) {}
 * ```
 */
export function SkipSelf(): ParameterDecorator {
  return (target: any, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const metadata = Reflect.getMetadata?.('inject:skipSelf', target) ?? [];
    metadata.push(parameterIndex);
    Reflect.defineMetadata?.('inject:skipSelf', metadata, target);
  };
}

/**
 * Set the current injector context
 */
export function setInjectorContext(injector: Injector | null): void {
  currentInjectorContext = injector;
}

/**
 * Get the current injector context
 */
export function getInjectorContext(): Injector | null {
  return currentInjectorContext;
}
