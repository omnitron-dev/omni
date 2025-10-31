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
        expected: 'expected' in error ? String(error.expected) : undefined,
        received: 'received' in error ? String(error.received) : undefined,
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
    public readonly data: Record<string, unknown>
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

    const validator = this.validators.get(key);
    if (!validator) {
      throw new Error(`Validator not found in cache for key: ${key}`);
    }
    return validator as CompiledValidator<T>;
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

        // Note: Zod v4 changed errorMap handling - it's now global or passed differently
        // For now, we use safeParse without custom errorMap support in parse call
        // errorMap can be set globally via z.setErrorMap() if needed

        // Handle abort early mode
        if (options?.abortEarly === false) {
          // Zod collects all errors by default
        } else if (options?.abortEarly === true) {
          // We'll handle this in error processing
        }

        // Use safeParse for better error handling
        const result = processedSchema.safeParse(data);

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

        // Note: Zod v4 changed errorMap handling - it's now global or passed differently
        // For now, we use safeParseAsync without custom errorMap support in parse call
        // errorMap can be set globally via z.setErrorMap() if needed

        const result = await processedSchema.safeParseAsync(data);

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
    // Detect mode from optimized schema for inheritance
    let mode: 'strip' | 'strict' | 'passthrough' | undefined;
    if (schema instanceof z.ZodObject) {
      const catchall = (schema as any)._def?.catchall;
      // Check both ._def.typeName and .type for compatibility
      const catchallType = catchall?._def?.typeName || catchall?.type;
      if (catchallType === 'ZodNever' || catchallType === 'never') {
        mode = 'strict';
      } else if (catchallType === 'ZodUnknown' || catchallType === 'unknown' || catchallType === 'ZodAny') {
        mode = 'passthrough';
      } else {
        mode = 'strip';
      }
    }
    return this.applyCoercionRecursive(schema, mode) as z.ZodSchema<T>;
  }

  /**
   * Recursively apply coercion to schema and all nested schemas
   * @param schema The schema to apply coercion to
   * @param inheritedMode The mode inherited from parent object
   * @param insideArray Whether we're currently inside an array (to avoid Zod v4 preprocess issues)
   */
  private applyCoercionRecursive(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any, // Zod internal structures - not all types are exported
    inheritedMode?: 'strip' | 'strict' | 'passthrough',
    insideArray = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    // Get the base type name - check both .type and ._def.typeName for compatibility
    const typeName = schema.type || schema._def?.typeName;
    const constructorName = schema.constructor?.name;

    // Handle wrapper types (optional, nullable, default) by unwrapping and re-wrapping
    if (typeName === 'optional' || constructorName === 'ZodOptional') {
      const innerSchema = schema._def.innerType;
      const coercedInner = this.applyCoercionRecursive(innerSchema, inheritedMode, insideArray);
      return coercedInner.optional();
    }

    if (typeName === 'nullable' || constructorName === 'ZodNullable') {
      const innerSchema = schema._def.innerType;
      const coercedInner = this.applyCoercionRecursive(innerSchema, inheritedMode, insideArray);
      return coercedInner.nullable();
    }

    if (typeName === 'default' || constructorName === 'ZodDefault') {
      const innerSchema = schema._def.innerType;
      const defaultValue = schema._def.defaultValue;
      const coercedInner = this.applyCoercionRecursive(innerSchema, inheritedMode, insideArray);
      return coercedInner.default(typeof defaultValue === 'function' ? defaultValue : () => defaultValue);
    }

    // Handle effects (refinements, transforms) - need to coerce the base type
    if (typeName === 'ZodEffects' || constructorName === 'ZodEffects') {
      const innerSchema = schema._def.schema;
      const coercedInner = this.applyCoercionRecursive(innerSchema, inheritedMode, insideArray);

      // Preserve effects by reconstructing them on top of the coerced schema
      const effectType = schema._def.effect?.type;
      if (effectType === 'refinement') {
        const refinement = schema._def.effect;
        return coercedInner.refine(refinement.refinement, {
          message: refinement.message,
          path: refinement.path,
        });
      } else if (effectType === 'transform') {
        const transform = schema._def.effect;
        return coercedInner.transform(transform.transform);
      } else if (effectType === 'preprocess') {
        // For preprocess, we need to apply it before coercion
        return schema;
      }

      // Fallback: return coerced inner schema if effect type is unknown
      return coercedInner;
    }

    // Handle basic coercible types with checks (min, max, int, positive, etc)
    // Note: Inside arrays, we skip coercion entirely to avoid Zod v4 internal compilation errors
    if (typeName === 'number' || constructorName === 'ZodNumber') {
      if (insideArray) {
        // Inside arrays: return original schema without coercion to avoid Zod v4 bugs
        // This is a limitation - coercion won't work for primitives inside arrays
        return schema;
      }

      // Outside arrays: use custom preprocess for proper edge case handling
      // This preserves all validation logic including .positive(), .int(), etc.
      // IMPORTANT: Preserve undefined for optional fields
      return z.preprocess((val) => {
        if (val === undefined) return undefined; // Preserve undefined for optional fields
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          // Empty string should fail - this is critical for data integrity
          if (val.trim() === '') {
            throw new Error('Cannot coerce empty string to number');
          }
          const parsed = Number(val);
          if (Number.isNaN(parsed)) {
            throw new Error(`Cannot coerce "${val}" to number`);
          }
          return parsed;
        }
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (val === null) {
          throw new Error('Cannot coerce null to number');
        }
        return Number(val);
      }, schema) as any;
    }

    if (typeName === 'boolean' || constructorName === 'ZodBoolean') {
      if (insideArray) {
        // Inside arrays: return original schema without coercion to avoid Zod v4 bugs
        // This is a limitation - coercion won't work for primitives inside arrays
        return schema;
      }

      // Outside arrays: use custom preprocess for proper edge case handling
      // Properly handles 'false', '0', etc.
      // IMPORTANT: Return undefined for undefined input to maintain optional semantics
      return z.preprocess((val) => {
        if (val === undefined) return undefined; // Preserve undefined for optional fields
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.toLowerCase().trim();
          if (lower === 'false' || lower === '0' || lower === '') return false;
          if (lower === 'true' || lower === '1') return true;
          // For any other string, throw to fail validation
          throw new Error(`Cannot coerce "${val}" to boolean`);
        }
        if (typeof val === 'number') return val !== 0;
        return Boolean(val);
      }, z.boolean()) as any;
    }

    if (typeName === 'date' || constructorName === 'ZodDate') {
      let coerced = z.coerce.date();

      // Preserve date checks
      const checks = schema._def?.checks || [];
      for (const check of checks) {
        if (check.kind === 'min') {
          coerced = coerced.min(check.value, check.message);
        } else if (check.kind === 'max') {
          coerced = coerced.max(check.value, check.message);
        }
      }

      return coerced;
    }

    if (typeName === 'bigint' || constructorName === 'ZodBigInt') {
      return z.coerce.bigint();
    }

    // Handle arrays - Skip coercion entirely to avoid Zod v4 internal compilation errors
    // This is a known limitation with Zod v4 - coercion inside arrays causes internal errors
    if (typeName === 'array' || constructorName === 'ZodArray') {
      // Return original array schema without any coercion
      // This means validation will work but coercion won't for array elements
      return schema;
    }

    // Handle objects - recursively coerce all fields and inherit mode
    if (typeName === 'object' || constructorName === 'ZodObject') {
      const shape = schema.shape || schema._def.shape();

      // Determine current object's mode from catchall
      const catchall = schema._def.catchall;
      // Check both ._def.typeName and .type for compatibility
      const catchallType = catchall?._def?.typeName || catchall?.type;
      let mode: 'strip' | 'strict' | 'passthrough' | undefined;
      if (catchallType === 'ZodNever' || catchallType === 'never') {
        mode = 'strict';
      } else if (catchallType === 'ZodUnknown' || catchallType === 'unknown' || catchallType === 'ZodAny') {
        mode = 'passthrough';
      } else if (inheritedMode) {
        // Inherit mode from parent if current schema doesn't have explicit mode
        mode = inheritedMode;
      } else {
        mode = 'strip'; // Default
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const coercedShape: Record<string, any> = {};

      // Recursively coerce all fields, passing down the mode and insideArray flag
      for (const key in shape) {
        const fieldSchema = shape[key];
        coercedShape[key] = this.applyCoercionRecursive(fieldSchema, mode, insideArray);
      }

      // Create new object with coerced shape
      let baseObject = z.object(coercedShape);

      // Apply the mode to the object
      // Note: Inside arrays, skip mode application to avoid Zod v4 compilation errors
      if (!insideArray) {
        if (mode === 'strict') {
          baseObject = baseObject.strict() as any;
        } else if (mode === 'passthrough') {
          baseObject = baseObject.passthrough() as any;
        } else {
          baseObject = baseObject.strip() as any;
        }
      }

      return baseObject;
    }

    // For all other types, return as-is
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
