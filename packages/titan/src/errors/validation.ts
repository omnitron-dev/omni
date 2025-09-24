/**
 * Validation error integration
 */

import { z } from 'zod';
import { TitanError, ErrorOptions } from './core.js';
import { ErrorCode } from './codes.js';

/**
 * Validation error that wraps Zod errors
 */
export class ValidationError extends TitanError {
  public readonly zodError?: z.ZodError;
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
      code: options.code || ErrorCode.VALIDATION_ERROR
    });

    this.name = 'ValidationError';
    this.zodError = options.zodError;

    // Extract validation errors
    if (options.zodError) {
      this.validationErrors = options.zodError.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
        expected: (issue as any).expected,
        received: (issue as any).received
      }));
    } else {
      this.validationErrors = options.validationErrors || [];
    }

    // Add to details
    this.details.errors = this.validationErrors;
  }

  /**
   * Create a ValidationError from a Zod error
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
      context: options?.context
    });
  }

  /**
   * Create a ValidationError from field errors
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
    const validationErrors = errors.map(error => ({
      path: error.field,
      message: error.message,
      code: error.code || 'custom'
    }));

    return new ValidationError({
      code: options?.code || ErrorCode.VALIDATION_ERROR,
      message: options?.message || 'Validation failed',
      validationErrors
    });
  }

  /**
   * Get a simplified error format
   */
  getSimpleFormat(): {
    code: string;
    message: string;
    errors: string[];
  } {
    return {
      code: 'VALIDATION_ERROR',
      message: this.message,
      errors: this.validationErrors.map(e => e.message)
    };
  }

  /**
   * Get detailed error format
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
      errors: this.validationErrors
    };
  }

  /**
   * Check if a specific field has errors
   */
  hasFieldError(field: string): boolean {
    return this.validationErrors.some(e => e.path === field);
  }

  /**
   * Get errors for a specific field
   */
  getFieldErrors(field: string): Array<{
    message: string;
    code: string;
  }> {
    return this.validationErrors
      .filter(e => e.path === field)
      .map(e => ({ message: e.message, code: e.code }));
  }

  /**
   * Convert to JSON representation
   */
  override toJSON(): any {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors
    };
  }
}

/**
 * Service error with validation support
 */
export class ServiceError<TCode extends number = number> extends TitanError {
  constructor(code: TCode, data: any, message?: string) {
    super({
      code,
      message: message || `Service error: ${code}`,
      details: data
    });
    this.name = 'ServiceError';
  }

  /**
   * Create a service error with validation
   */
  static withValidation<T>(
    code: number,
    schema: z.ZodSchema<T>,
    data: unknown
  ): ServiceError {
    const result = schema.safeParse(data);

    if (!result.success) {
      throw new ValidationError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Invalid error payload',
        zodError: result.error
      });
    }

    return new ServiceError(code, result.data);
  }
}

/**
 * Input validation decorator
 */
export function ValidateInput<T>(schema: z.ZodSchema<T>) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (input: unknown) {
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
 * Output validation decorator
 */
export function ValidateOutput<T>(schema: z.ZodSchema<T>) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const output = await originalMethod.apply(this, args);
      const result = schema.safeParse(output);

      if (!result.success) {
        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Invalid output from method',
          cause: ValidationError.fromZodError(result.error)
        });
      }

      return result.data;
    };

    return descriptor;
  };
}

/**
 * Composite validation decorator for both input and output
 */
export function Validate<TInput, TOutput>(
  inputSchema: z.ZodSchema<TInput>,
  outputSchema: z.ZodSchema<TOutput>
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (input: unknown) {
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
          cause: ValidationError.fromZodError(outputResult.error)
        });
      }

      return outputResult.data;
    };

    return descriptor;
  };
}

/**
 * Create a validation middleware for method contracts
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
          throw ValidationError.fromZodError(
            new z.ZodError([firstError])
          );
        }
      }

      throw ValidationError.fromZodError(result.error);
    }

    return result.data;
  };
}