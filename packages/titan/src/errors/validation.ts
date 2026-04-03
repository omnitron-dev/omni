/**
 * Canonical validation error classes for Titan framework.
 *
 * This module contains the canonical (rich) implementations of ValidationError
 * and ServiceError that extend TitanError. These classes provide comprehensive
 * error handling features suitable for most use cases in the Titan framework.
 *
 * ## Usage
 *
 * For most error handling needs, import from this module:
 * ```typescript
 * import { ValidationError, ServiceError } from '@omnitron-dev/titan/errors';
 * ```
 *
 * ## ValidationEngine Compatibility
 *
 * The validation module (`@omnitron-dev/titan/validation`) provides lightweight
 * adapter classes that are optimized for use with ValidationEngine. Those adapters
 * include `toCanonical()` methods to convert to these rich implementations when needed.
 *
 * @module errors/validation
 */

import { z } from 'zod';
import { TitanError, ErrorOptions } from './core.js';
import { ErrorCode } from './codes.js';

/**
 * Validation error that wraps Zod errors.
 *
 * This is the canonical ValidationError implementation for the Titan framework.
 * It extends TitanError and provides rich functionality for handling validation
 * errors including:
 * - Zod error wrapping with `zodError` property
 * - Parsed validation errors with `validationErrors` array
 * - Static factory methods: `fromZodError`, `fromFieldErrors`
 * - Field-specific error queries: `hasFieldError`, `getFieldErrors`
 * - Multiple output formats: `getSimpleFormat`, `getDetailedFormat`
 *
 * @example
 * ```typescript
 * // Create from Zod error
 * const error = ValidationError.fromZodError(zodError, {
 *   message: 'Invalid user data'
 * });
 *
 * // Create from field errors
 * const error = ValidationError.fromFieldErrors([
 *   { field: 'email', message: 'Invalid email format' },
 *   { field: 'age', message: 'Must be at least 18' }
 * ]);
 *
 * // Query specific fields
 * if (error.hasFieldError('email')) {
 *   const emailErrors = error.getFieldErrors('email');
 * }
 * ```
 */
export class ValidationError extends TitanError {
  /**
   * The original Zod error, if this ValidationError was created from one
   */
  public readonly zodError?: z.ZodError;

  /**
   * Parsed validation errors with path, message, code, and optional expected/received values
   */
  public readonly validationErrors: Array<{
    path: string;
    message: string;
    code: string;
    expected?: any;
    received?: any;
  }>;

  constructor(
    options: ErrorOptions & {
      zodError?: z.ZodError;
      validationErrors?: Array<{
        path: string;
        message: string;
        code: string;
        expected?: any;
        received?: any;
      }>;
    }
  ) {
    super({
      ...options,
      code: options.code || ErrorCode.VALIDATION_ERROR,
    });

    this.name = 'ValidationError';
    this.zodError = options.zodError;

    // Extract validation errors
    if (options.zodError) {
      this.validationErrors = options.zodError.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
        expected: (issue as any).expected,
        received: (issue as any).received,
      }));
    } else {
      this.validationErrors = options.validationErrors || [];
    }

    // Add to details
    this.details.errors = this.validationErrors;
  }

  /**
   * Create a ValidationError from a Zod error.
   *
   * @param zodError - The Zod error to wrap
   * @param options - Additional options for the error
   * @returns A new ValidationError instance
   */
  static fromZodError(
    zodError: z.ZodError,
    options?: {
      message?: string;
      code?: ErrorCode;
      context?: any;
    }
  ): ValidationError {
    return new ValidationError({
      code: options?.code || ErrorCode.VALIDATION_ERROR,
      message: options?.message || 'Validation failed',
      zodError,
      context: options?.context,
    });
  }

  /**
   * Create a ValidationError from field errors.
   *
   * @param errors - Array of field errors with field name, message, and optional code
   * @param options - Additional options for the error
   * @returns A new ValidationError instance
   */
  static fromFieldErrors(
    errors: Array<{
      field: string;
      message: string;
      code?: string;
    }>,
    options?: {
      message?: string;
      code?: ErrorCode;
    }
  ): ValidationError {
    const validationErrors = errors.map((error) => ({
      path: error.field,
      message: error.message,
      code: error.code || 'custom',
    }));

    return new ValidationError({
      code: options?.code || ErrorCode.VALIDATION_ERROR,
      message: options?.message || 'Validation failed',
      validationErrors,
    });
  }

  /**
   * Get a simplified error format with just error messages.
   *
   * @returns Simplified error object with code, message, and array of error messages
   */
  getSimpleFormat(): {
    code: string;
    message: string;
    errors: string[];
  } {
    return {
      code: 'VALIDATION_ERROR',
      message: this.message,
      errors: this.validationErrors.map((e) => e.message),
    };
  }

  /**
   * Get detailed error format with full error information.
   *
   * @returns Detailed error object with code, message, and full error details
   */
  getDetailedFormat(): {
    code: string;
    message: string;
    errors: Array<{
      path: string;
      message: string;
      code: string;
      expected?: any;
      received?: any;
    }>;
  } {
    return {
      code: 'VALIDATION_ERROR',
      message: this.message,
      errors: this.validationErrors,
    };
  }

  /**
   * Check if a specific field has errors.
   *
   * @param field - The field name to check
   * @returns True if the field has validation errors
   */
  hasFieldError(field: string): boolean {
    return this.validationErrors.some((e) => e.path === field);
  }

  /**
   * Get errors for a specific field.
   *
   * @param field - The field name to get errors for
   * @returns Array of error messages and codes for the specified field
   */
  getFieldErrors(field: string): Array<{
    message: string;
    code: string;
  }> {
    return this.validationErrors.filter((e) => e.path === field).map((e) => ({ message: e.message, code: e.code }));
  }

  /**
   * Convert to JSON representation.
   *
   * @returns JSON-serializable object with all error information
   */
  override toJSON(): any {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
    };
  }
}

/**
 * Service error with validation support.
 *
 * This is the canonical ServiceError implementation for the Titan framework.
 * It extends TitanError and provides functionality for service-level errors
 * including a static factory method for creating errors with validated payloads.
 *
 * @example
 * ```typescript
 * // Create a simple service error
 * const error = new ServiceError(404, { resource: 'user', id: '123' });
 *
 * // Create with validation
 * const errorSchema = z.object({ resource: z.string(), id: z.string() });
 * const error = ServiceError.withValidation(404, errorSchema, data);
 * ```
 *
 * @typeParam TCode - The type of the error code (typically a number like HTTP status code)
 */
export class ServiceError<TCode extends number = number> extends TitanError {
  constructor(code: TCode, data: any, message?: string) {
    super({
      code,
      message: message || `Service error: ${code}`,
      details: data,
    });
    this.name = 'ServiceError';
  }

  /**
   * Create a service error with validated payload.
   *
   * This method validates the error payload against a schema before creating
   * the error. If validation fails, a ValidationError is thrown instead.
   *
   * @param code - The error code (typically HTTP status code)
   * @param schema - Zod schema to validate the payload
   * @param data - The payload data to validate
   * @returns A new ServiceError with the validated payload
   * @throws ValidationError if the payload doesn't match the schema
   */
  static withValidation<T>(code: number, schema: z.ZodSchema<T>, data: unknown): ServiceError {
    const result = schema.safeParse(data);

    if (!result.success) {
      throw new ValidationError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Invalid error payload',
        zodError: result.error,
      });
    }

    return new ServiceError(code, result.data);
  }
}

/**
 * Input validation decorator.
 *
 * Decorates a method to automatically validate its first argument against
 * the provided Zod schema before executing the method.
 *
 * @param schema - Zod schema to validate input against
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class UserService {
 *   @ValidateInput(userSchema)
 *   async createUser(input: unknown) {
 *     // input is validated and typed
 *   }
 * }
 * ```
 */
export function ValidateInput<T>(schema: z.ZodSchema<T>) {
  return function validateInputDecorator(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function validateInputHandler(input: unknown) {
      const result = schema.safeParse(input);

      if (!result.success) {
        throw ValidationError.fromZodError(result.error);
      }

      return originalMethod.call(this, result.data);
    };

    return descriptor;
  };
}

/**
 * Output validation decorator.
 *
 * Decorates a method to automatically validate its return value against
 * the provided Zod schema after the method executes.
 *
 * @param schema - Zod schema to validate output against
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class UserService {
 *   @ValidateOutput(userSchema)
 *   async getUser(id: string) {
 *     // return value is validated
 *     return await this.db.findUser(id);
 *   }
 * }
 * ```
 */
export function ValidateOutput<T>(schema: z.ZodSchema<T>) {
  return function validateOutputDecorator(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function validateOutputHandler(...args: any[]) {
      const output = await originalMethod.apply(this, args);
      const result = schema.safeParse(output);

      if (!result.success) {
        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Invalid output from method',
          cause: ValidationError.fromZodError(result.error),
        });
      }

      return result.data;
    };

    return descriptor;
  };
}

/**
 * Composite validation decorator for both input and output.
 *
 * Decorates a method to validate both its input (first argument) and
 * output (return value) against the provided Zod schemas.
 *
 * @param inputSchema - Zod schema to validate input against
 * @param outputSchema - Zod schema to validate output against
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Validate(createUserSchema, userSchema)
 *   async createUser(input: unknown) {
 *     // input is validated, output is validated
 *     return await this.db.createUser(input);
 *   }
 * }
 * ```
 */
export function Validate<TInput, TOutput>(inputSchema: z.ZodSchema<TInput>, outputSchema: z.ZodSchema<TOutput>) {
  return function validateDecorator(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function validateHandler(input: unknown) {
      // Validate input
      const inputResult = inputSchema.safeParse(input);
      if (!inputResult.success) {
        throw ValidationError.fromZodError(inputResult.error);
      }

      // Execute method
      const output = await originalMethod.call(this, inputResult.data);

      // Validate output
      const outputResult = outputSchema.safeParse(output);
      if (!outputResult.success) {
        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Invalid output from method',
          cause: ValidationError.fromZodError(outputResult.error),
        });
      }

      return outputResult.data;
    };

    return descriptor;
  };
}

/**
 * Create a validation middleware for method contracts.
 *
 * Creates a function that validates input against a schema and returns
 * the validated (and optionally transformed) data.
 *
 * @param schema - Zod schema to validate against
 * @param options - Optional configuration for validation behavior
 * @returns Validation function that takes input and returns validated output
 *
 * @example
 * ```typescript
 * const validateUser = createValidationMiddleware(userSchema, {
 *   stripUnknown: true,
 *   abortEarly: true
 * });
 *
 * const validatedData = validateUser(rawInput);
 * ```
 */
export function createValidationMiddleware<T>(
  schema: z.ZodSchema<T>,
  options?: {
    abortEarly?: boolean;
    stripUnknown?: boolean;
    coerceTypes?: boolean;
  }
) {
  return (input: unknown): T => {
    // Apply preprocessing based on options
    let processedSchema = schema;

    if (options?.stripUnknown && schema instanceof z.ZodObject) {
      processedSchema = (schema as any).strip();
    }

    if (options?.coerceTypes) {
      // This would need more sophisticated implementation
      // For now, just use the schema as-is
    }

    const result = processedSchema.safeParse(input);

    if (!result.success) {
      if (options?.abortEarly) {
        // Only throw first error
        const firstError = result.error.issues[0];
        if (firstError) {
          throw ValidationError.fromZodError(new z.ZodError([firstError]));
        }
      }

      throw ValidationError.fromZodError(result.error);
    }

    return result.data;
  };
}
