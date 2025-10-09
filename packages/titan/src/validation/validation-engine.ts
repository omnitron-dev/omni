/**
 * High-performance validation engine with caching
 */

import { z } from 'zod';

/**
 * Validation options for customizing behavior
 */
export interface ValidationOptions {
  mode?: 'strip' | 'strict' | 'passthrough';
  abortEarly?: boolean;
  coerce?: boolean;
  skipValidation?: boolean;
  errorFormat?: 'simple' | 'detailed';
  errorMap?: z.ZodErrorMap;
  cacheValidators?: boolean;
  lazyCompilation?: boolean;
  stripUnknown?: boolean;
  coerceTypes?: boolean;
  parseAsync?: boolean;
}

/**
 * Compiled validator interface
 */
export interface CompiledValidator<T = any> {
  validate(data: unknown): T;
  validateAsync(data: unknown): Promise<T>;
  is(data: unknown): data is T;
}

/**
 * Validation error with detailed information
 */
export class ValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR';
  public readonly statusCode = 422;

  constructor(
    public readonly zodError: z.ZodError,
    public readonly options?: ValidationOptions
  ) {
    super('Validation failed');
    this.name = 'ValidationError';
  }

  /**
   * Transform to user-friendly error format
   */
  toJSON() {
    // Zod uses 'issues' not 'errors'
    const errors = this.zodError?.issues || [];

    if (this.options?.errorFormat === 'simple') {
      return {
        code: this.code,
        message: errors[0]?.message || 'Validation failed',
        errors: errors.map((e) => e.message),
      };
    }

    return {
      code: this.code,
      message: 'Validation failed',
      errors: errors.map((error) => ({
        path: error.path.join('.'),
        message: error.message,
        code: error.code,
        expected: (error as any).expected,
        received: (error as any).received,
      })),
    };
  }
}

/**
 * Service error with contract validation
 */
export class ServiceError<TCode extends number = number> extends Error {
  constructor(
    public readonly statusCode: TCode,
    public readonly data: any
  ) {
    super(`Service error: ${statusCode}`);
    this.name = 'ServiceError';
  }
}

/**
 * High-performance validation engine with caching
 */
export class ValidationEngine {
  // Cache compiled validators for performance
  private validators = new Map<string, CompiledValidator>();
  private cacheKeyCounter = 0;
  private schemaCache = new WeakMap<z.ZodSchema<any>, string>();

  /**
   * Compile and cache validator from schema
   */
  compile<T>(schema: z.ZodSchema<T>, options?: ValidationOptions): CompiledValidator<T> {
    const key = this.getCacheKey(schema, options);

    if (!this.validators.has(key)) {
      // Lazy compilation - only compile when first used
      const validator = this.compileValidator(schema, options);
      this.validators.set(key, validator);
    }

    return this.validators.get(key)! as CompiledValidator<T>;
  }

  /**
   * Generate unique cache key for schema and options
   */
  private getCacheKey(schema: z.ZodSchema<any>, options?: ValidationOptions): string {
    // Get or create schema identifier
    let schemaId = this.schemaCache.get(schema);
    if (!schemaId) {
      schemaId = `schema_${++this.cacheKeyCounter}`;
      this.schemaCache.set(schema, schemaId);
    }

    // Create options key
    const optionsKey = options
      ? JSON.stringify({
          mode: options.mode,
          abortEarly: options.abortEarly,
          coerce: options.coerce,
          skipValidation: options.skipValidation,
          errorFormat: options.errorFormat,
          stripUnknown: options.stripUnknown,
          coerceTypes: options.coerceTypes,
        })
      : 'default';

    return `${schemaId}_${optionsKey}`;
  }

  /**
   * Compile a validator from schema
   */
  private compileValidator<T>(schema: z.ZodSchema<T>, options?: ValidationOptions): CompiledValidator<T> {
    // Pre-process schema for optimal performance
    const optimized = this.optimizeSchema(schema, options);

    return {
      validate: (data: unknown): T => {
        // Fast path for common cases
        if (options?.skipValidation) return data as T;

        // Apply coercion if needed
        let processedSchema = optimized;
        if (options?.coerce || options?.coerceTypes) {
          processedSchema = this.applyCoercion(optimized);
        }

        // Configure parse options
        const parseOptions: any = {};
        if (options?.errorMap) {
          parseOptions.errorMap = options.errorMap;
        }

        // Handle abort early mode
        if (options?.abortEarly === false) {
          // Zod collects all errors by default
        } else if (options?.abortEarly === true) {
          // We'll handle this in error processing
        }

        // Use safeParse for better error handling
        const result = processedSchema.safeParse(data, parseOptions);

        if (!result.success) {
          // Handle abortEarly by limiting errors
          if (options?.abortEarly === true && result.error.issues.length > 1) {
            // Create new error with only first issue
            const firstIssue = result.error.issues[0];
            if (firstIssue) {
              const firstError = new z.ZodError([firstIssue]);
              throw new ValidationError(firstError, options);
            }
          }
          throw new ValidationError(result.error, options);
        }

        return result.data;
      },

      // Async validation for complex schemas
      validateAsync: async (data: unknown): Promise<T> => {
        if (options?.skipValidation) return data as T;

        // Apply coercion if needed
        let processedSchema = optimized;
        if (options?.coerce || options?.coerceTypes) {
          processedSchema = this.applyCoercion(optimized);
        }

        const parseOptions: any = {};
        if (options?.errorMap) {
          parseOptions.errorMap = options.errorMap;
        }

        const result = await processedSchema.safeParseAsync(data, parseOptions);

        if (!result.success) {
          // Handle abortEarly by limiting errors
          if (options?.abortEarly === true && result.error.issues.length > 1) {
            const firstIssue = result.error.issues[0];
            if (firstIssue) {
              const firstError = new z.ZodError([firstIssue]);
              throw new ValidationError(firstError, options);
            }
          }
          throw new ValidationError(result.error, options);
        }

        return result.data;
      },

      // Type guard for runtime type checking
      is: (data: unknown): data is T => {
        const result = optimized.safeParse(data);
        return result.success;
      },
    };
  }

  /**
   * Optimize schema for better performance
   */
  private optimizeSchema<T>(schema: z.ZodSchema<T>, options?: ValidationOptions): z.ZodSchema<T> {
    // Check if this is a ZodEffects (transform, refine, etc)
    const isEffects = (schema as any)._def?.typeName === 'ZodEffects';

    // Don't modify schemas with transforms or effects
    if (isEffects) {
      return schema;
    }

    // Apply mode-based optimizations only to object schemas
    if (schema instanceof z.ZodObject) {
      if (options?.mode === 'strip' || options?.stripUnknown) {
        // Strip unknown properties
        return (schema as any).strip() as z.ZodSchema<T>;
      } else if (options?.mode === 'strict') {
        // Fail fast on unknown properties
        return (schema as any).strict() as z.ZodSchema<T>;
      } else if (options?.mode === 'passthrough') {
        // Pass through unknown properties
        return (schema as any).passthrough() as z.ZodSchema<T>;
      }
      // Don't apply strict by default - let Zod handle it
    }

    return schema;
  }

  /**
   * Apply type coercion to schema
   */
  private applyCoercion<T>(schema: z.ZodSchema<T>): z.ZodSchema<T> {
    // For basic types, wrap with coercion
    if (schema instanceof z.ZodNumber) {
      return z.coerce.number() as any;
    }
    if (schema instanceof z.ZodBoolean) {
      return z.coerce.boolean() as any;
    }
    if (schema instanceof z.ZodDate) {
      return z.coerce.date() as any;
    }

    // For objects, recursively apply coercion
    if (schema instanceof z.ZodObject) {
      const shape = (schema as any).shape;
      const unknownKeys = (schema as any)._def.unknownKeys; // Get mode BEFORE creating new object
      const coercedShape: any = {};

      for (const key in shape) {
        const fieldSchema = shape[key];
        if (fieldSchema instanceof z.ZodNumber) {
          coercedShape[key] = z.coerce.number();
        } else if (fieldSchema instanceof z.ZodBoolean) {
          coercedShape[key] = z.coerce.boolean();
        } else if (fieldSchema instanceof z.ZodDate) {
          coercedShape[key] = z.coerce.date();
        } else {
          coercedShape[key] = fieldSchema;
        }
      }

      // Preserve the mode settings
      const baseObject = z.object(coercedShape);
      if (unknownKeys === 'strip') {
        return baseObject.strip() as any;
      } else if (unknownKeys === 'strict') {
        return baseObject.strict() as any;
      } else if (unknownKeys === 'passthrough') {
        return baseObject.passthrough() as any;
      }
      return baseObject as any;
    }

    return schema;
  }

  /**
   * Clear validator cache
   */
  clearCache(): void {
    this.validators.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.validators.size;
  }
}
