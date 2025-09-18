/**
 * Validation Decorator
 *
 * Decorator for validating method parameters using Zod schemas.
 * This demonstrates how to create parameter validation decorators.
 */

import 'reflect-metadata';
import { z } from 'zod';
import { TEMPLATE_METADATA } from '../constants.js';

export type ValidationSchema = z.ZodType<any>;

export interface ValidationOptions {
  /**
   * Whether to throw on validation error
   */
  throwOnError?: boolean;

  /**
   * Custom error message
   */
  errorMessage?: string;

  /**
   * Transform function to apply before validation
   */
  transform?: (value: any) => any;
}

/**
 * Validate method parameters
 */
export function Validate(
  schema: ValidationSchema,
  options: ValidationOptions = {}
): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Store metadata
    Reflect.defineMetadata(
      TEMPLATE_METADATA.VALIDATED_METHOD,
      { schema, options },
      target,
      propertyKey
    );

    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = async function (...args: any[]) {
      try {
        // Transform if needed
        const transformedArgs = options.transform
          ? args.map(options.transform)
          : args;

        // Validate arguments
        const validatedArgs = transformedArgs.map((arg, index) => {
          try {
            return schema.parse(arg);
          } catch (error) {
            if (options.throwOnError !== false) {
              const message = options.errorMessage ||
                `Validation failed for ${methodName} parameter ${index}`;
              throw new Error(`${message}: ${(error as z.ZodError).message}`);
            }
            return arg; // Return original if not throwing
          }
        });

        // Call original method with validated arguments
        return await originalMethod.apply(this, validatedArgs);
      } catch (error) {
        // Log error if logger is available
        const logger = (this as any).logger;
        if (logger && logger.error) {
          logger.error(`Validation error in ${methodName}`, error);
        }

        if (options.throwOnError !== false) {
          throw error;
        }

        // Return null or undefined on validation error if not throwing
        return null;
      }
    };

    return descriptor;
  };
}

/**
 * Validate return value
 */
export function ValidateReturn(
  schema: ValidationSchema,
  options: ValidationOptions = {}
): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      try {
        // Transform if needed
        const transformed = options.transform
          ? options.transform(result)
          : result;

        // Validate result
        return schema.parse(transformed);
      } catch (error) {
        const logger = (this as any).logger;
        if (logger && logger.error) {
          logger.error(`Return validation error in ${methodName}`, error);
        }

        if (options.throwOnError !== false) {
          const message = options.errorMessage ||
            `Return validation failed for ${methodName}`;
          throw new Error(`${message}: ${(error as z.ZodError).message}`);
        }

        return result; // Return original if not throwing
      }
    };

    return descriptor;
  };
}

/**
 * Common validation schemas
 */
export const Schemas = {
  /**
   * Non-empty string
   */
  NonEmptyString: z.string().min(1),

  /**
   * Positive number
   */
  PositiveNumber: z.number().positive(),

  /**
   * Valid email
   */
  Email: z.string().email(),

  /**
   * Valid URL
   */
  Url: z.string().url(),

  /**
   * Valid UUID
   */
  UUID: z.string().uuid(),

  /**
   * Object with any properties
   */
  AnyObject: z.record(z.string(), z.any()),

  /**
   * Array of strings
   */
  StringArray: z.array(z.string()),

  /**
   * Optional string
   */
  OptionalString: z.string().optional()
};