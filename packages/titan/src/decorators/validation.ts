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
  return function (target: any) {
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
  return function (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) {
    Reflect.defineMetadata('validation:method', options, target, propertyKey);
    return descriptor;
  };
}

/**
 * Disable validation for a specific method
 */
export function NoValidation(): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) {
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
  return function (target: any) {
    Reflect.defineMetadata('validation:options', options, target);
    return target;
  };
}

/**
 * Validation batch options for array processing
 */
export interface ValidationBatchOptions {
  batchSize?: number;
  parallel?: boolean;
  continueOnError?: boolean;
}

/**
 * Apply batch validation for array inputs
 */
export function ValidationBatch(options: ValidationBatchOptions): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) {
    Reflect.defineMetadata('validation:batch', options, target, propertyKey);
    return descriptor;
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
 * Validate streaming method
 */
export function ValidateStream(
  input: z.ZodSchema<any>,
  output: z.ZodSchema<any>,
  options?: IValidationOptions
): MethodDecorator {
  return Validate({
    input,
    output,
    stream: true,
    options,
  });
}

/**
 * Common validation schemas
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ValidationSchemas {
  // UUID validation
  export const uuid = z.string().uuid();

  // Email validation
  export const email = z.string().email();

  // URL validation
  export const url = z.string().url();

  // Date string validation
  export const dateString = z.string().datetime();

  // Positive integer
  export const positiveInt = z.number().int().positive();

  // Pagination input
  export const pagination = z.object({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  });

  // Sort input
  export const sort = z.object({
    field: z.string(),
    order: z.enum(['asc', 'desc']).default('asc'),
  });

  // Common filter
  export const filter = z.record(z.string(), z.any()).optional();

  // ID input
  export const idInput = z.union([z.string().uuid(), z.number().int().positive()]);

  // Success response
  export const successResponse = z.object({
    success: z.boolean(),
    message: z.string().optional(),
  });

  // Error response
  export const errorResponse = z.object({
    error: z.boolean(),
    message: z.string(),
    code: z.string().optional(),
    details: z.any().optional(),
  });

  // List response
  export function listResponse<T extends z.ZodSchema<any>>(itemSchema: T) {
    return z.object({
      items: z.array(itemSchema),
      total: z.number(),
      offset: z.number(),
      limit: z.number(),
      hasMore: z.boolean().optional(),
    });
  }

  // Nullable wrapper
  export function nullable<T extends z.ZodSchema<any>>(schema: T) {
    return schema.nullable();
  }

  // Optional wrapper
  export function optional<T extends z.ZodSchema<any>>(schema: T) {
    return schema.optional();
  }
}

/**
 * Validation presets for common use cases
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ValidationPresets {
  /**
   * CRUD validation preset
   */
  export function crud<T extends z.ZodObject<any>>(
    entitySchema: T,
    idSchema: z.ZodSchema<any> = ValidationSchemas.uuid
  ) {
    return {
      create: Validate({
        input: entitySchema,
        output: entitySchema,
      }),
      read: Validate({
        input: idSchema,
        output: entitySchema.nullable(),
      }),
      update: Validate({
        input: z.object({
          id: idSchema,
          data: entitySchema.partial(),
        }),
        output: entitySchema,
      }),
      delete: Validate({
        input: idSchema,
        output: ValidationSchemas.successResponse,
      }),
      list: Validate({
        input: z.object({
          pagination: ValidationSchemas.pagination.optional(),
          filter: ValidationSchemas.filter,
          sort: ValidationSchemas.sort.optional(),
        }),
        output: ValidationSchemas.listResponse(entitySchema),
      }),
    };
  }

  /**
   * Authentication validation preset
   */
  export const auth = {
    login: Validate({
      input: z.object({
        email: ValidationSchemas.email,
        password: z.string().min(8),
      }),
      output: z.object({
        token: z.string(),
        refreshToken: z.string().optional(),
        user: z.any(),
      }),
    }),
    register: Validate({
      input: z
        .object({
          email: ValidationSchemas.email,
          password: z.string().min(8),
          confirmPassword: z.string(),
          name: z.string().min(2).optional(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: "Passwords don't match",
          path: ['confirmPassword'],
        }),
      output: z.object({
        user: z.any(),
        token: z.string().optional(),
      }),
    }),
    logout: Validate({
      input: z.object({
        token: z.string().optional(),
        everywhere: z.boolean().optional(),
      }),
      output: ValidationSchemas.successResponse,
    }),
    refresh: Validate({
      input: z.object({
        refreshToken: z.string(),
      }),
      output: z.object({
        token: z.string(),
        refreshToken: z.string().optional(),
      }),
    }),
  };
}

/**
 * Re-export validation types and utilities
 */
export type {
  Contract as ContractType,
  MethodContract,
  ValidationOptions as ValidationOptionsType,
  ValidationOptions, // Also export without alias
} from '../validation/index.js';
export { contract, contractBuilder, Contracts } from '../validation/index.js';
