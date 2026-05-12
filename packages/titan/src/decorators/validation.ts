/**
 * Validation decorators for Titan services
 */

import 'reflect-metadata';
import { z } from 'zod';
import { Contract as ContractClass, MethodContract } from '../validation/contract.js';
import type { ValidationOptions as IValidationOptions } from '../validation/validation-engine.js';

/**
 * Apply a validation contract to a service class
 */
export function Contract<T extends ContractClass>(contract: T): ClassDecorator {
  return function contractDecorator(target: any) {
    // Store contract in reflection metadata for retrieval
    Reflect.defineMetadata('validation:contract', contract, target);

    // Also merge into service metadata if it exists (for proper propagation to transport servers)
    const serviceMetadata = Reflect.getMetadata('netron:service', target);
    if (serviceMetadata) {
      serviceMetadata.contract = contract;
      Reflect.defineMetadata('netron:service', serviceMetadata, target);
    }

    return target;
  };
}

/**
 * Apply validation to a specific method
 */
export function Validate(options: MethodContract): MethodDecorator {
  return function validateDecorator(target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) {
    Reflect.defineMetadata('validation:method', options, target, propertyKey);
    return descriptor;
  };
}

/**
 * Disable validation for a specific method
 */
export function NoValidation(): MethodDecorator {
  return function noValidationDecorator(target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) {
    Reflect.defineMetadata('validation:disabled', true, target, propertyKey);
    return descriptor;
  };
}

/**
 * Apply global validation options to a service
 * @decorator
 * @example
 * @WithValidationOptions({ strict: true, stripUnknown: false })
 * class MyService { }
 */
export function WithValidationOptions(options: IValidationOptions): ClassDecorator {
  return function withValidationOptionsDecorator(target: any) {
    Reflect.defineMetadata('validation:options', options, target);
    return target;
  };
}

/**
 * Helper decorators for common validation patterns
 */

/**
 * Validate input only (skip output validation)
 */
export function ValidateInput(schema: z.ZodSchema<any>, options?: IValidationOptions): MethodDecorator {
  return Validate({ input: schema, options });
}

/**
 * Validate output only (skip input validation)
 */
export function ValidateOutput(schema: z.ZodSchema<any>, options?: IValidationOptions): MethodDecorator {
  return Validate({ output: schema, options });
}

/**
 * Re-export validation types and utilities.
 *
 * The `ValidationSchemas` and `ValidationPresets` namespaces (a 170-line
 * grab-bag of pre-built zod schemas + CRUD/auth presets) were removed in
 * the T#77 cleanup — they had zero consumers across the monorepo and
 * encapsulated nothing that callers can't express directly with the
 * re-exported `z` (`zod`) namespace.
 */
export type {
  Contract as ContractType,
  MethodContract,
  ValidationOptions as ValidationOptionsType,
  ValidationOptions, // Also export without alias
} from '../validation/index.js';
export { contract, contractBuilder, Contracts } from '../validation/index.js';
