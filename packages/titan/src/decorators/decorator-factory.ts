/**
 * Custom Decorator Creation API for Nexus DI Container
 *
 * @module custom-decorators
 * @packageDocumentation
 *
 * This module provides a fluent API for creating custom decorators
 * that integrate with the Nexus DI container system.
 *
 * @example
 * ```typescript
 * // Create a custom decorator
 * const Cacheable = createDecorator()
 *   .withMetadata('cacheable', true)
 *   .withOptions<{ ttl?: number }>()
 *   .forMethod((target, propertyKey, descriptor, options) => {
 *     const originalMethod = descriptor.value;
 *     descriptor.value = function(...args: any[]) {
 *       // Add caching logic here
 *       return originalMethod.apply(this, args);
 *     };
 *   })
 *   .build();
 *
 * // Use the decorator
 * class Service {
 *   @Cacheable({ ttl: 5000 })
 *   getData() { ... }
 * }
 * ```
 */

import 'reflect-metadata';

import { Container } from '@nexus/container.js';
import { Errors } from '../errors/index.js';

/**
 * Decorator target types
 */
export enum DecoratorTarget {
  Class = 'class',
  Method = 'method',
  Property = 'property',
  Parameter = 'parameter',
  Accessor = 'accessor',
}

/**
 * Decorator context containing information about the decoration target
 */
export interface DecoratorContext<TOptions = any> {
  target: any;
  propertyKey?: string | symbol;
  descriptor?: PropertyDescriptor;
  parameterIndex?: number;
  options?: TOptions;
  container?: Container;
  metadata: Map<string, any>;
}

/**
 * Transform function for modifying the decoration target
 */
export type DecoratorTransform<TOptions = any> = (
  context: DecoratorContext<TOptions>
) => void | PropertyDescriptor | any;

/**
 * Metadata transformer for custom metadata handling
 */
export type MetadataTransform<TOptions = any> = (context: DecoratorContext<TOptions>) => Record<string, any>;

/**
 * Validation function for decorator options
 */
export type OptionsValidator<TOptions> = (options: TOptions) => void | string;

/**
 * Hook that runs when the decorator is applied
 */
export type DecoratorHook<TOptions = any> = (context: DecoratorContext<TOptions>) => void;

/**
 * Custom decorator builder configuration
 */
export interface CustomDecoratorConfig<TOptions = any> {
  name: string;
  targets: DecoratorTarget[];
  transform?: DecoratorTransform<TOptions>;
  metadata?: Record<string, any> | MetadataTransform<TOptions>;
  validate?: OptionsValidator<TOptions>;
  hooks?: {
    beforeApply?: DecoratorHook<TOptions>;
    afterApply?: DecoratorHook<TOptions>;
    onResolve?: DecoratorHook<TOptions>;
  };
  compose?: Array<(...args: any[]) => any>;
  inheritable?: boolean;
  stackable?: boolean;
  priority?: number;
}

/**
 * Fluent builder for creating custom decorators
 */
export class CustomDecoratorBuilder<TOptions = any> {
  private config: Partial<CustomDecoratorConfig<TOptions>> = {
    targets: [],
    inheritable: true,
    stackable: false,
    priority: 0,
  };

  /**
   * Set the decorator name
   */
  withName(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * Set decorator options type
   */
  withOptions<T = TOptions>(): CustomDecoratorBuilder<T> {
    return this as any;
  }

  /**
   * Add metadata to be stored when decorator is applied
   */
  withMetadata(key: string, value: any): this;
  withMetadata(metadata: Record<string, any>): this;
  withMetadata(transformer: MetadataTransform<TOptions>): this;
  withMetadata(
    keyOrMetadataOrTransformer: string | Record<string, any> | MetadataTransform<TOptions>,
    value?: any
  ): this {
    if (typeof keyOrMetadataOrTransformer === 'string') {
      this.config.metadata = {
        ...(this.config.metadata as Record<string, any>),
        [keyOrMetadataOrTransformer]: value,
      };
    } else if (typeof keyOrMetadataOrTransformer === 'function') {
      this.config.metadata = keyOrMetadataOrTransformer;
    } else {
      this.config.metadata = {
        ...(this.config.metadata as Record<string, any>),
        ...keyOrMetadataOrTransformer,
      };
    }
    return this;
  }

  /**
   * Set decorator for class targets
   */
  forClass(transform?: DecoratorTransform<TOptions>): this {
    this.config.targets!.push(DecoratorTarget.Class);
    if (transform) {
      this.config.transform = transform;
    }
    return this;
  }

  /**
   * Set decorator for method targets
   */
  forMethod(transform?: DecoratorTransform<TOptions>): this {
    this.config.targets!.push(DecoratorTarget.Method);
    if (transform) {
      this.config.transform = transform;
    }
    return this;
  }

  /**
   * Set decorator for property targets
   */
  forProperty(transform?: DecoratorTransform<TOptions>): this {
    this.config.targets!.push(DecoratorTarget.Property);
    if (transform) {
      this.config.transform = transform;
    }
    return this;
  }

  /**
   * Set decorator for parameter targets
   */
  forParameter(transform?: DecoratorTransform<TOptions>): this {
    this.config.targets!.push(DecoratorTarget.Parameter);
    if (transform) {
      this.config.transform = transform;
    }
    return this;
  }

  /**
   * Set decorator for accessor targets
   */
  forAccessor(transform?: DecoratorTransform<TOptions>): this {
    this.config.targets!.push(DecoratorTarget.Accessor);
    if (transform) {
      this.config.transform = transform;
    }
    return this;
  }

  /**
   * Set decorator for multiple targets
   */
  forTargets(targets: DecoratorTarget[], transform?: DecoratorTransform<TOptions>): this {
    this.config.targets!.push(...targets);
    if (transform) {
      this.config.transform = transform;
    }
    return this;
  }

  /**
   * Add validation for decorator options
   */
  withValidation(validator: OptionsValidator<TOptions>): this {
    this.config.validate = validator;
    return this;
  }

  /**
   * Add hooks that run at various stages
   */
  withHooks(hooks: CustomDecoratorConfig<TOptions>['hooks']): this {
    this.config.hooks = { ...this.config.hooks, ...hooks };
    return this;
  }

  /**
   * Compose with other decorators
   */
  compose(...decorators: Array<(...args: any[]) => any>): this {
    this.config.compose = decorators;
    return this;
  }

  /**
   * Set whether decorator is inherited by subclasses
   */
  inheritable(value: boolean = true): this {
    this.config.inheritable = value;
    return this;
  }

  /**
   * Set whether multiple instances of this decorator can be stacked
   */
  stackable(value: boolean = true): this {
    this.config.stackable = value;
    return this;
  }

  /**
   * Set decorator priority (higher priority decorators are applied first)
   */
  withPriority(priority: number): this {
    this.config.priority = priority;
    return this;
  }

  /**
   * Build the custom decorator
   */
  build(): (options?: TOptions) => any {
    const config = this.config as CustomDecoratorConfig<TOptions>;

    if (!config.name) {
      throw Errors.badRequest('Decorator name is required');
    }

    if (config.targets.length === 0) {
      throw Errors.badRequest('At least one target type must be specified');
    }

    return function (optionsOrTarget?: any, propertyKey?: string | symbol, descriptorOrIndex?: any) {
      // Handle different decorator signatures
      const isParameterDecorator = typeof descriptorOrIndex === 'number';
      const _isPropertyDecorator = propertyKey !== undefined && descriptorOrIndex === undefined;
      const _isMethodDecorator = propertyKey !== undefined && descriptorOrIndex !== undefined && !isParameterDecorator;
      const _isClassDecorator = propertyKey === undefined && descriptorOrIndex === undefined;

      // Check if this is a decorator factory call with options
      // If we have exactly one argument and it's not a function (constructor), it's likely options
      const isDecoratorFactory =
        arguments.length === 0 ||
        (arguments.length === 1 &&
          (typeof optionsOrTarget !== 'function' ||
            (optionsOrTarget && typeof optionsOrTarget === 'object' && !optionsOrTarget.prototype)));

      // If called as decorator factory
      if (isDecoratorFactory) {
        const options = optionsOrTarget as TOptions;

        // Validate options if validator is provided
        if (config.validate && options) {
          const error = config.validate(options);
          if (error) {
            throw Errors.validation([{ field: 'options', message: `Invalid options for @${config.name}: ${error}` }]);
          }
        }

        // Return the actual decorator
        return function (target: any, propKey?: string | symbol, descOrIndex?: any) {
          return applyDecorator(target, propKey, descOrIndex, options);
        };
      }

      // Direct application without options
      return applyDecorator(optionsOrTarget, propertyKey, descriptorOrIndex, undefined);

      function applyDecorator(target: any, propKey?: string | symbol, descOrIdx?: any, options?: TOptions) {
        // Determine target type
        let targetType: DecoratorTarget;
        let descriptor: PropertyDescriptor | undefined;
        let parameterIndex: number | undefined;

        if (typeof descOrIdx === 'number') {
          targetType = DecoratorTarget.Parameter;
          parameterIndex = descOrIdx;
        } else if (propKey !== undefined && descOrIdx === undefined) {
          targetType = DecoratorTarget.Property;
        } else if (propKey !== undefined && descOrIdx !== undefined) {
          descriptor = descOrIdx;
          targetType =
            descriptor && (descriptor.get || descriptor.set) ? DecoratorTarget.Accessor : DecoratorTarget.Method;
        } else {
          targetType = DecoratorTarget.Class;
        }

        // Check if decorator can be applied to this target
        if (!config.targets.includes(targetType)) {
          throw Errors.badRequest(`@${config.name} cannot be applied to ${targetType}. Allowed targets: ${config.targets.join(', ')}`);
        }

        // Check for stacking if not stackable
        if (!config.stackable) {
          const metadataKey = `custom:${config.name}`;
          // Use getOwnMetadata to avoid conflicts with inherited metadata
          const existingMetadata = propKey
            ? Reflect.getOwnMetadata(metadataKey, target, propKey)
            : Reflect.getOwnMetadata(metadataKey, target);

          if (existingMetadata) {
            throw Errors.conflict(`@${config.name} has already been applied and is not stackable`);
          }
        }

        // Create context
        const context: DecoratorContext<TOptions> = {
          target,
          propertyKey: propKey,
          descriptor,
          parameterIndex,
          options,
          metadata: new Map(),
        };

        // Run beforeApply hook
        if (config.hooks?.beforeApply) {
          config.hooks.beforeApply(context);
        }

        // Apply composed decorators first (in reverse order for proper composition)
        if (config.compose) {
          for (let i = config.compose.length - 1; i >= 0; i--) {
            const decorator = config.compose[i];
            if (!decorator) continue;
            const result = decorator(target, propKey, descOrIdx);
            if (result !== undefined && result !== target) {
              if (propKey !== undefined && descOrIdx !== undefined) {
                descOrIdx = result;
                context.descriptor = result;
              } else if (propKey === undefined && descOrIdx === undefined) {
                target = result;
                context.target = result;
              }
            }
          }
        }

        // Store metadata
        if (config.metadata) {
          const metadata = typeof config.metadata === 'function' ? config.metadata(context) : config.metadata;

          for (const [key, value] of Object.entries(metadata)) {
            const metadataKey = `custom:${config.name}:${key}`;
            if (propKey !== undefined) {
              Reflect.defineMetadata(metadataKey, value, target, propKey);
            } else {
              Reflect.defineMetadata(metadataKey, value, target);
            }
            context.metadata.set(key, value);
          }

          // Store decorator application metadata
          const applicationKey = `custom:${config.name}`;
          const applicationData = {
            applied: true,
            options,
            timestamp: Date.now(),
            priority: config.priority,
          };

          if (propKey !== undefined) {
            const existing = Reflect.getMetadata(applicationKey, target, propKey);
            const decoratorMetadata = Array.isArray(existing) ? existing : existing ? [existing] : [];
            decoratorMetadata.push(applicationData);
            Reflect.defineMetadata(applicationKey, decoratorMetadata, target, propKey);
          } else {
            const existing = Reflect.getMetadata(applicationKey, target);
            const decoratorMetadata = Array.isArray(existing) ? existing : existing ? [existing] : [];
            decoratorMetadata.push(applicationData);
            Reflect.defineMetadata(applicationKey, decoratorMetadata, target);
          }
        }

        // Apply transformation
        let result: any;
        if (config.transform) {
          result = config.transform(context);
        }

        // Run afterApply hook
        if (config.hooks?.afterApply) {
          config.hooks.afterApply(context);
        }

        // Handle inheritance
        if (config.inheritable && targetType === DecoratorTarget.Class) {
          const inheritanceKey = `custom:${config.name}:inheritable`;
          Reflect.defineMetadata(inheritanceKey, true, target);
        }

        // Return appropriate value
        if (result !== undefined) {
          return result;
        } else if (descriptor !== undefined) {
          return descriptor;
        } else if (targetType === DecoratorTarget.Class) {
          return target;
        }

        // Default return for parameter and property decorators
        return undefined;
      }
    };
  }
}

/**
 * Create a new custom decorator builder
 */
export function createDecorator<TOptions = any>(): CustomDecoratorBuilder<TOptions> {
  return new CustomDecoratorBuilder<TOptions>();
}

/**
 * Helper to get custom decorator metadata
 */
export function getCustomMetadata(decoratorName: string, target: any, propertyKey?: string | symbol): any {
  const applicationKey = `custom:${decoratorName}`;
  return propertyKey
    ? Reflect.getMetadata(applicationKey, target, propertyKey)
    : Reflect.getMetadata(applicationKey, target);
}

/**
 * Helper to get all custom metadata for a target
 */
export function getAllCustomMetadata(target: any, propertyKey?: string | symbol): Map<string, any> {
  const metadata = new Map<string, any>();
  const metadataKeys = propertyKey ? Reflect.getMetadataKeys(target, propertyKey) : Reflect.getMetadataKeys(target);

  for (const key of metadataKeys) {
    if (typeof key === 'string' && key.startsWith('custom:')) {
      const value = propertyKey ? Reflect.getMetadata(key, target, propertyKey) : Reflect.getMetadata(key, target);
      metadata.set(key, value);
    }
  }

  return metadata;
}

/**
 * Check if a decorator has been applied
 */
export function hasDecorator(decoratorName: string, target: any, propertyKey?: string | symbol): boolean {
  const metadata = getCustomMetadata(decoratorName, target, propertyKey);
  return metadata && metadata.length > 0;
}

/**
 * Get decorator options
 */
export function getDecoratorOptions<TOptions = any>(
  decoratorName: string,
  target: any,
  propertyKey?: string | symbol
): TOptions | undefined {
  const metadata = getCustomMetadata(decoratorName, target, propertyKey);
  return metadata && metadata.length > 0 ? metadata[0].options : undefined;
}

/**
 * Combine multiple decorators into one
 */
export function combineDecorators(...decorators: Array<(...args: any[]) => any>): (...args: any[]) => any {
  return function (target: any, propertyKey?: string | symbol, descriptor?: any) {
    // Apply decorators in reverse order for proper composition
    for (let i = decorators.length - 1; i >= 0; i--) {
      const decorator = decorators[i];
      if (!decorator) continue;
      const result = decorator(target, propertyKey, descriptor);
      if (result !== undefined && result !== target) {
        if (propertyKey !== undefined && descriptor !== undefined) {
          descriptor = result;
        } else if (propertyKey === undefined && descriptor === undefined) {
          target = result;
        }
      }
    }
    return descriptor || target;
  };
}

/**
 * Create a parameterized decorator factory
 */
export function createParameterizedDecorator<TOptions>(
  name: string,
  handler: (options: TOptions, context: DecoratorContext<TOptions>) => void
): (options?: TOptions) => any {
  return createDecorator<TOptions>()
    .withName(name)
    .forTargets([DecoratorTarget.Class, DecoratorTarget.Method, DecoratorTarget.Property, DecoratorTarget.Parameter])
    .withMetadata((context: DecoratorContext) => ({ options: context.options }))
    .forClass((context) => handler(context.options!, context))
    .build();
}

/**
 * Create a method interceptor decorator
 */
export function createMethodInterceptor<TOptions = any>(
  name: string,
  interceptor: (originalMethod: (...args: any[]) => any, args: any[], context: DecoratorContext<TOptions>) => any
): (options?: TOptions) => MethodDecorator {
  return createDecorator<TOptions>()
    .withName(name)
    .forMethod((context) => {
      const originalMethod = context.descriptor!.value;
      context.descriptor!.value = function (...args: any[]) {
        return interceptor.call(this, originalMethod.bind(this), args, context);
      };
      return context.descriptor;
    })
    .build() as any;
}

/**
 * Create a property decorator with getter/setter interception
 */
export function createPropertyInterceptor<TOptions = any>(
  name: string,
  interceptor: {
    get?: (value: any, context: DecoratorContext<TOptions>) => any;
    set?: (value: any, context: DecoratorContext<TOptions>) => any;
  }
): (options?: TOptions) => PropertyDecorator {
  return createDecorator<TOptions>()
    .withName(name)
    .forProperty((context) => {
      const propertyKey = context.propertyKey!;
      const privateKey = Symbol(`__${String(propertyKey)}`);

      Object.defineProperty(context.target, propertyKey, {
        get() {
          const value = this[privateKey];
          return interceptor.get ? interceptor.get(value, context) : value;
        },
        set(value: any) {
          const processedValue = interceptor.set ? interceptor.set(value, context) : value;
          this[privateKey] = processedValue;
        },
        enumerable: true,
        configurable: true,
      });
    })
    .build() as any;
}

/**
 * Example custom decorators for common use cases
 */

/**
 * Memoization decorator - caches method results per instance
 *
 * @remarks
 * The cache is stored per-instance using a WeakMap to prevent memory leaks.
 * Cache keys are generated by JSON.stringify(args), so arguments must be serializable.
 *
 * @example
 * ```typescript
 * class Calculator {
 *   @Memoize()
 *   expensiveCalculation(x: number, y: number) {
 *     // This will only run once per unique combination of arguments
 *     return x * y;
 *   }
 * }
 * ```
 */
export const Memoize = createMethodInterceptor('Memoize', (() => {
  // Use WeakMap to store cache per instance, preventing memory leaks
  const cacheMap = new WeakMap<object, Map<string, any>>();

  return function (this: any, originalMethod, args, _context) {
    // `this` is the instance due to interceptor.call(this, ...)
    const instance = this;

    // Get or create cache for this instance
    let cache = cacheMap.get(instance);
    if (!cache) {
      cache = new Map();
      cacheMap.set(instance, cache);
    }

    const cacheKey = JSON.stringify(args);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = originalMethod(...args);
    cache.set(cacheKey, result);
    return result;
  };
})());

/**
 * Retry decorator
 */
export const Retry = createMethodInterceptor<{ attempts?: number; delay?: number }>(
  'Retry',
  async (originalMethod, args, context) => {
    const { attempts = 3, delay = 1000 } = context.options || {};
    let lastError: any;

    for (let i = 0; i < attempts; i++) {
      try {
        return await originalMethod(...args);
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
);

/**
 * Deprecation decorator
 */
export const Deprecated = createDecorator<{ message?: string; version?: string }>()
  .withName('Deprecated')
  .forTargets([DecoratorTarget.Class, DecoratorTarget.Method, DecoratorTarget.Property])
  .withMetadata((context: DecoratorContext<{ message?: string; version?: string }>) => ({
    deprecated: true,
    message: context.options?.message,
    version: context.options?.version,
  }))
  .forMethod((context) => {
    const originalMethod = context.descriptor!.value;
    const { message, version } = context.options || {};

    context.descriptor!.value = function (...args: any[]) {
      const warning =
        message ||
        `${context.target.constructor.name}.${String(context.propertyKey)} is deprecated` +
          (version ? ` since version ${version}` : '');
      console.warn(warning);
      return originalMethod.apply(this, args);
    };

    return context.descriptor;
  })
  .build();

/**
 * Schema validation decorator - validates method arguments using a custom schema function
 *
 * @deprecated Use `@Validate` from `validation.ts` with Zod schemas instead.
 * This will be removed in v1.0.0.
 *
 * @remarks
 * This decorator validates arguments using a custom validator function.
 * For type-safe validation with Zod schemas, use the `@Validate` decorator
 * from the validation module instead.
 *
 * @example
 * ```typescript
 * class Service {
 *   @ValidateSchema({ schema: (x, y) => x > 0 && y > 0 })
 *   calculate(x: number, y: number) {
 *     return x * y;
 *   }
 * }
 * ```
 */
export const ValidateSchema = createDecorator<{ schema: any }>()
  .withName('ValidateSchema')
  .forMethod((context) => {
    const originalMethod = context.descriptor!.value;
    const { schema } = context.options!;

    context.descriptor!.value = function (...args: any[]) {
      // Emit deprecation warning
      if (process.env['NODE_ENV'] !== 'production') {
        console.warn(
          `@ValidateSchema is deprecated and will be removed in v1.0.0. ` +
          `Use @Validate from '@omnitron-dev/titan/decorators' with Zod schemas instead.`
        );
      }

      // Simple validation example - would use a real validation library
      if (schema && typeof schema === 'function') {
        const valid = schema(...args);
        if (!valid) {
          throw Errors.validation([{ field: String(context.propertyKey), message: 'Validation failed' }]);
        }
      }
      return originalMethod.apply(this, args);
    };

    return context.descriptor;
  })
  .withValidation((options) => {
    if (!options?.schema) {
      return 'Schema is required for @ValidateSchema decorator';
    }
    return undefined;
  })
  .build();

// All types and classes are already exported at their declaration
