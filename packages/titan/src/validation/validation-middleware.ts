/**
 * Transport middleware that handles validation
 */

import { ValidationEngine, CompiledValidator, ValidationOptions } from './validation-engine.js';
import { Contract, MethodContract } from './contract.js';
import { Errors } from '../errors/index.js';

/**
 * Method wrapper type
 */
export type MethodWrapper = (...args: any[]) => any;

/**
 * Wrapped service type
 */
export type WrappedService<T = any> = T;

/**
 * Validation middleware for automatic method validation
 */
export class ValidationMiddleware {
  constructor(private engine: ValidationEngine) {}

  /**
   * Wrap a single method with automatic validation
   */
  wrapMethod(
    target: any,
    method: string,
    contract?: MethodContract,
    overrideOptions?: ValidationOptions
  ): MethodWrapper {
    // If no contract, return original method
    if (!contract || (!contract.input && !contract.output)) {
      const original = target[method];
      if (!original) {
        throw Errors.notFound('Method', method);
      }
      return original.bind(target);
    }

    const original = target[method];
    if (!original) {
      throw Errors.notFound('Method', method);
    }

    // Merge contract options with override options
    const effectiveOptions = overrideOptions ? { ...contract.options, ...overrideOptions } : contract.options;

    // Compile validators if needed
    const inputValidator = contract.input ? this.engine.compile(contract.input, effectiveOptions) : null;

    const outputValidator = contract.output ? this.engine.compile(contract.output, effectiveOptions) : null;

    // Handle streaming methods
    if (contract.stream) {
      return this.wrapStreamingMethod(original, target, inputValidator, outputValidator);
    }

    // Handle regular async methods
    return this.wrapAsyncMethod(original, target, inputValidator, outputValidator);
  }

  /**
   * Wrap an async method
   */
  private wrapAsyncMethod(
    original: Function,
    target: any,
    inputValidator: CompiledValidator | null,
    outputValidator: CompiledValidator | null
  ): MethodWrapper {
    return async function (this: any, ...args: any[]) {
      // Use provided context or target
      const context = this || target;

      // Validate input
      let validatedInput = args[0];
      if (inputValidator) {
        validatedInput = await inputValidator.validateAsync(args[0]);
      }

      // Call original method
      let result = await original.call(context, validatedInput, ...args.slice(1));

      // Validate output
      if (outputValidator) {
        result = await outputValidator.validateAsync(result);
      }

      return result;
    };
  }

  /**
   * Wrap a streaming method
   */
  private wrapStreamingMethod(
    original: Function,
    target: any,
    inputValidator: CompiledValidator | null,
    outputValidator: CompiledValidator | null
  ): MethodWrapper {
    return async function* (this: any, ...args: any[]) {
      // Use provided context or target
      const context = this || target;

      // Validate input once at the beginning
      let validatedInput = args[0];
      if (inputValidator) {
        try {
          validatedInput = inputValidator.validate(args[0]);
        } catch (error) {
          // Throw immediately if input validation fails
          throw error;
        }
      }

      // Call original generator method
      let generator;
      try {
        const result = original.call(context, validatedInput, ...args.slice(1));

        // Ensure we have an async generator
        if (!result || typeof result[Symbol.asyncIterator] !== 'function') {
          throw Errors.badRequest('Stream method must return an async generator');
        }

        generator = result;
      } catch (error) {
        throw error;
      }

      // Validate each streamed item
      try {
        for await (const item of generator) {
          if (outputValidator) {
            // Validate each item
            const validatedItem = outputValidator.validate(item);
            yield validatedItem;
          } else {
            yield item;
          }
        }
      } catch (error) {
        // Re-throw any errors (including validation errors)
        throw error;
      }
    };
  }

  /**
   * Wrap all methods of a service based on contract
   */
  wrapService<T>(service: T, contract: Contract, overrideOptions?: ValidationOptions): WrappedService<T> {
    // Create a proxy to intercept method calls
    const wrappedMethods = new Map<string, MethodWrapper>();

    // Pre-wrap all contract methods
    for (const methodName of contract.getMethods()) {
      const methodContract = contract.getMethod(methodName);

      if ((service as any)[methodName] && typeof (service as any)[methodName] === 'function') {
        wrappedMethods.set(methodName, this.wrapMethod(service, methodName, methodContract, overrideOptions));
      }
    }

    // Create proxy for the service
    return new Proxy(service as any, {
      get(target, prop, receiver) {
        // If it's a wrapped method, return the wrapped version
        if (typeof prop === 'string' && wrappedMethods.has(prop)) {
          return wrappedMethods.get(prop);
        }

        // Otherwise, return the original property
        return Reflect.get(target, prop, receiver);
      },
    }) as WrappedService<T>;
  }

  /**
   * Create a validation handler for a specific service
   */
  createHandler<T>(
    service: T,
    contract: Contract,
    options?: {
      beforeValidation?: (method: string, input: any) => void;
      afterValidation?: (method: string, output: any) => void;
      onError?: (method: string, error: any) => void;
      validationOptions?: ValidationOptions;
    }
  ): T {
    const wrappedService = this.wrapService(service, contract, options?.validationOptions);

    // Add hooks if provided
    if (options) {
      return new Proxy(wrappedService as any, {
        get(target, prop) {
          const original = target[prop];

          if (typeof original === 'function') {
            return async function (...args: any[]) {
              const methodName = String(prop);

              try {
                // Before validation hook
                if (options.beforeValidation) {
                  options.beforeValidation(methodName, args[0]);
                }

                // Call wrapped method
                const result = await original.apply(target, args);

                // After validation hook
                if (options.afterValidation) {
                  options.afterValidation(methodName, result);
                }

                return result;
              } catch (error) {
                // Error hook
                if (options.onError) {
                  options.onError(methodName, error);
                }
                throw error;
              }
            };
          }

          return original;
        },
      }) as T;
    }

    return wrappedService as T;
  }

  /**
   * Check if validation should be skipped for a method
   */
  shouldSkipValidation(target: any, method: string, metadata?: any): boolean {
    // Check for @NoValidation decorator metadata
    if (metadata?.skipValidation) {
      return true;
    }

    // Check if method has validation disabled
    const isDisabled = Reflect.getMetadata('validation:disabled', target, method);
    if (isDisabled) {
      return true;
    }

    return false;
  }

  /**
   * Get method validation contract from metadata
   */
  getMethodContract(target: any, method: string, classContract?: Contract): MethodContract | undefined {
    // First check for method-level validation
    const methodValidation = Reflect.getMetadata('validation:method', target, method);
    if (methodValidation) {
      return methodValidation;
    }

    // Then check class contract
    if (classContract) {
      return classContract.getMethod(method);
    }

    return undefined;
  }

  /**
   * Apply validation to a class instance
   */
  applyToInstance<T>(instance: T, contract?: Contract, options?: ValidationOptions): T {
    // Get class contract if not provided
    const classContract = contract || Reflect.getMetadata('validation:contract', (instance as any).constructor);

    if (!classContract) {
      return instance; // No validation needed
    }

    // Get class-level validation options
    const classOptions = Reflect.getMetadata('validation:options', (instance as any).constructor) || {};
    const mergedOptions = { ...classOptions, ...options };

    // Create wrapped instance with merged validation options
    return this.createHandler(instance, classContract, {
      validationOptions: mergedOptions,
      beforeValidation: (method, input) => {
        // Can add logging or metrics here
      },
      afterValidation: (method, output) => {
        // Can add logging or metrics here
      },
      onError: (method, error) => {
        // Can add error handling here
      },
    });
  }
}
