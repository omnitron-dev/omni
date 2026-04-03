/**
 * Schema Utilities
 *
 * Pre-built Zod schema helpers for common form field validations.
 * Designed to work seamlessly with React Hook Form + Zod resolver.
 *
 * Features:
 * - Type-safe schema builders
 * - Customizable error messages with i18n support
 * - Common field validations (email, phone, date, file, etc.)
 * - Nullable input handling
 * - Slider range validation
 * - Rich text editor validation
 *
 * @module @omnitron-dev/prism/forms
 */

import * as z from 'zod';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Common error message configuration.
 */
export interface SchemaErrorMessages {
  /** Error message when field is required but empty */
  required?: string;
  /** Error message when field format is invalid */
  invalid?: string;
}

/**
 * Options for file validation.
 */
export interface FileSchemaOptions extends SchemaErrorMessages {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types */
  accept?: string[];
}

/**
 * Options for slider range validation.
 */
export interface SliderRangeOptions extends SchemaErrorMessages {
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
}

// =============================================================================
// DEFAULT ERROR MESSAGES
// =============================================================================

const DEFAULT_ERRORS = {
  email: {
    required: 'Email is required',
    invalid: 'Email must be a valid email address',
  },
  phone: {
    required: 'Phone number is required',
    invalid: 'Invalid phone number',
  },
  date: {
    required: 'Date is required',
    invalid: 'Invalid date',
  },
  file: {
    required: 'File is required',
    invalid: 'Invalid file',
    tooLarge: 'File is too large',
    invalidType: 'File type not allowed',
  },
  boolean: {
    required: 'This field is required',
  },
  editor: {
    required: 'Content is required',
  },
  nullable: {
    required: 'This field is required',
  },
} as const;

// =============================================================================
// SCHEMA UTILS
// =============================================================================

/**
 * Pre-built Zod schema helpers for common form validations.
 *
 * @example
 * ```tsx
 * import { z } from 'zod';
 * import { schemaUtils } from '@omnitron-dev/prism/forms';
 *
 * // Define form schema
 * const UserSchema = z.object({
 *   email: schemaUtils.email(),
 *   phone: schemaUtils.phone(),
 *   birthDate: schemaUtils.date(),
 *   avatar: schemaUtils.file(),
 *   agreeToTerms: schemaUtils.boolean({ error: 'You must accept the terms' }),
 *   bio: schemaUtils.editor(),
 * });
 *
 * // With custom error messages
 * const CustomSchema = z.object({
 *   email: schemaUtils.email({
 *     required: 'Please enter your email',
 *     invalid: 'That email doesn\'t look right',
 *   }),
 * });
 * ```
 */
export const schemaUtils = {
  /**
   * Email validation schema.
   * Validates format and provides clear error messages.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   email: schemaUtils.email(),
   * });
   * ```
   */
  email: (errors?: SchemaErrorMessages) =>
    z
      .string()
      .min(1, { message: errors?.required ?? DEFAULT_ERRORS.email.required })
      .max(320, { message: 'Email address is too long' })
      .email({ message: errors?.invalid ?? DEFAULT_ERRORS.email.invalid }),

  /**
   * Phone number validation schema.
   * Basic validation with optional custom validator.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   phone: schemaUtils.phone({
   *     isValid: (val) => /^\+?[1-9]\d{1,14}$/.test(val),
   *   }),
   * });
   * ```
   */
  phone: (options?: SchemaErrorMessages & { isValid?: (val: string) => boolean }) => {
    let schema = z.string().min(1, { message: options?.required ?? DEFAULT_ERRORS.phone.required });

    if (options?.isValid) {
      schema = schema.refine(options.isValid, {
        message: options?.invalid ?? DEFAULT_ERRORS.phone.invalid,
      });
    }

    return schema;
  },

  /**
   * Date validation schema.
   * Works with Date objects, timestamps, and ISO strings.
   * Compatible with date pickers.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   birthDate: schemaUtils.date(),
   *   appointmentTime: schemaUtils.date({ required: 'Please select a time' }),
   * });
   * ```
   */
  date: (errors?: SchemaErrorMessages) =>
    z
      .union([z.string(), z.number(), z.date(), z.null()])
      .refine((val) => val !== null && val !== '' && val !== undefined, {
        message: errors?.required ?? DEFAULT_ERRORS.date.required,
      })
      .refine(
        (val) => {
          // At this point, val passed the required check (non-null, non-empty, defined)
          if (val instanceof Date) return Number.isFinite(val.getTime());
          const date = new Date(val as string | number);
          return Number.isFinite(date.getTime());
        },
        { message: errors?.invalid ?? DEFAULT_ERRORS.date.invalid }
      ),

  /**
   * Optional date schema (nullable).
   * For date fields that aren't required.
   */
  dateOptional: (errors?: SchemaErrorMessages) =>
    z
      .union([z.string(), z.number(), z.date(), z.null()])
      .refine(
        (val) => {
          if (val === null || val === '' || val === undefined) return true;
          if (val instanceof Date) return Number.isFinite(val.getTime());
          const date = new Date(val as string | number);
          return Number.isFinite(date.getTime());
        },
        { message: errors?.invalid ?? DEFAULT_ERRORS.date.invalid }
      )
      .nullable(),

  /**
   * Rich text editor validation schema.
   * Treats empty paragraphs as empty content.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   description: schemaUtils.editor(),
   * });
   * ```
   */
  editor: (error?: string) =>
    z.string().refine(
      (val) => {
        const cleaned = val.trim();
        // Common empty editor states
        return cleaned !== '' && cleaned !== '<p></p>' && cleaned !== '<p><br></p>' && cleaned !== '<p><br/></p>';
      },
      { message: error ?? DEFAULT_ERRORS.editor.required }
    ),

  /**
   * Boolean validation schema.
   * For checkboxes/switches that must be true (e.g., terms acceptance).
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   agreeToTerms: schemaUtils.boolean({ error: 'You must accept the terms' }),
   * });
   * ```
   */
  boolean: (options?: { error?: string }) =>
    z.boolean().refine((val) => val === true, {
      message: options?.error ?? DEFAULT_ERRORS.boolean.required,
    }),

  /**
   * Optional boolean schema.
   * For optional checkboxes.
   */
  booleanOptional: () => z.boolean().optional(),

  /**
   * Nullable input wrapper.
   * Wraps any schema to handle null values as required errors.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   country: schemaUtils.nullableInput(
   *     z.string().min(1),
   *     { error: 'Please select a country' }
   *   ),
   * });
   * ```
   */
  nullableInput: <T extends z.ZodTypeAny>(schema: T, options?: { error?: string }) =>
    schema.nullable().refine((val) => val !== null && val !== undefined, {
      message: options?.error ?? DEFAULT_ERRORS.nullable.required,
    }),

  /**
   * Single file upload validation.
   * Supports File objects and URL strings (for existing files).
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   avatar: schemaUtils.file(),
   *   document: schemaUtils.file({
   *     maxSize: 5 * 1024 * 1024, // 5MB
   *     accept: ['application/pdf'],
   *   }),
   * });
   * ```
   */
  file: (options?: FileSchemaOptions) =>
    z
      .union([z.instanceof(File), z.string(), z.null()])
      .refine(
        (val) => {
          if (val === null || val === undefined) return false;
          if (typeof val === 'string') return val.length > 0;
          return true;
        },
        { message: options?.required ?? DEFAULT_ERRORS.file.required }
      )
      .refine(
        (val) => {
          if (!options?.maxSize || typeof val === 'string' || val === null) return true;
          return (val as File).size <= options.maxSize;
        },
        { message: options?.invalid ?? DEFAULT_ERRORS.file.tooLarge }
      )
      .refine(
        (val) => {
          if (!options?.accept || typeof val === 'string' || val === null) return true;
          return options.accept.includes((val as File).type);
        },
        { message: options?.invalid ?? DEFAULT_ERRORS.file.invalidType }
      ),

  /**
   * Optional single file upload.
   */
  fileOptional: (options?: Omit<FileSchemaOptions, 'required'>) =>
    z
      .union([z.instanceof(File), z.string(), z.null()])
      .refine(
        (val) => {
          if (!options?.maxSize || typeof val === 'string' || val === null || val === undefined) return true;
          return (val as File).size <= options.maxSize;
        },
        { message: options?.invalid ?? DEFAULT_ERRORS.file.tooLarge }
      )
      .refine(
        (val) => {
          if (!options?.accept || typeof val === 'string' || val === null || val === undefined) return true;
          return options.accept.includes((val as File).type);
        },
        { message: options?.invalid ?? DEFAULT_ERRORS.file.invalidType }
      )
      .nullable(),

  /**
   * Multiple file upload validation.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   images: schemaUtils.files({ minFiles: 1, error: 'Upload at least one image' }),
   * });
   * ```
   */
  files: (options?: { error?: string; minFiles?: number }) =>
    z
      .array(z.union([z.instanceof(File), z.string()]))
      .min(options?.minFiles ?? 1, { message: options?.error ?? DEFAULT_ERRORS.file.required }),

  /**
   * Slider range validation.
   * For dual-thumb sliders with [min, max] value.
   *
   * @example
   * ```tsx
   * const schema = z.object({
   *   priceRange: schemaUtils.sliderRange({ min: 0, max: 1000 }),
   * });
   * ```
   */
  sliderRange: (options: SliderRangeOptions) =>
    z.tuple([z.number(), z.number()]).refine(([min, max]) => min >= options.min && max <= options.max && min <= max, {
      message: options?.invalid ?? `Range must be between ${options.min} and ${options.max}`,
    }),

  /**
   * URL validation schema.
   */
  url: (errors?: SchemaErrorMessages) =>
    z
      .string()
      .min(1, { message: errors?.required ?? 'URL is required' })
      .url({ message: errors?.invalid ?? 'Invalid URL' }),

  /**
   * Optional URL schema.
   */
  urlOptional: (errors?: SchemaErrorMessages) =>
    z
      .string()
      .url({ message: errors?.invalid ?? 'Invalid URL' })
      .optional()
      .or(z.literal('')),

  /**
   * Password validation with strength requirements.
   */
  password: (options?: {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumber?: boolean;
    requireSpecial?: boolean;
    error?: string;
  }) => {
    const {
      minLength = 8,
      requireUppercase = true,
      requireLowercase = true,
      requireNumber = true,
      requireSpecial = false,
    } = options ?? {};

    return z
      .string()
      .min(minLength, { message: `Password must be at least ${minLength} characters` })
      .refine((val) => val.trim().length > 0, {
        message: 'Password must not be only whitespace',
      })
      .refine((val) => !requireUppercase || /[A-Z]/.test(val), {
        message: 'Password must contain at least one uppercase letter',
      })
      .refine((val) => !requireLowercase || /[a-z]/.test(val), {
        message: 'Password must contain at least one lowercase letter',
      })
      .refine((val) => !requireNumber || /[0-9]/.test(val), {
        message: 'Password must contain at least one number',
      })
      .refine((val) => !requireSpecial || /[!@#$%^&*(),.?":{}|<>]/.test(val), {
        message: 'Password must contain at least one special character',
      });
  },

  /**
   * Confirmation field (e.g., confirm password).
   * Use with z.object().refine() for cross-field validation.
   */
  confirm: (fieldName: string, error?: string) => ({
    message: error ?? `${fieldName} does not match`,
    path: ['confirm'],
  }),
};

// =============================================================================
// TESTING UTILITY
// =============================================================================

/**
 * Test schema validation with multiple values.
 * Useful for development and debugging.
 *
 * @example
 * ```ts
 * testSchema(schemaUtils.email(), [
 *   'valid@email.com',
 *   'invalid-email',
 *   '',
 *   null,
 * ]);
 * ```
 */
/**
 * Test results from schema validation.
 */
export interface SchemaTestResult {
  value: unknown;
  success: boolean;
  data?: unknown;
  errors?: string[];
}

/**
 * Test a schema against multiple values.
 * Returns structured results instead of logging to console.
 * Use testSchemaDebug for console output during development.
 */
export function testSchema<T extends z.ZodTypeAny>(schema: T, values: unknown[]): SchemaTestResult[] {
  return values.map((value) => {
    const result = schema.safeParse(value);
    if (result.success) {
      return { value, success: true, data: result.data };
    }
    return {
      value,
      success: false,
      errors: result.error.issues.map((issue) => issue.message),
    };
  });
}

/**
 * Test a schema with console output (development only).
 * This function does nothing in production builds.
 *
 * @example
 * ```ts
 * testSchemaDebug(schemaUtils.email(), [
 *   'valid@email.com',
 *   'invalid-email',
 *   '',
 *   null,
 * ]);
 * ```
 */
export function testSchemaDebug<T extends z.ZodTypeAny>(schema: T, values: unknown[]): void {
  // Only run in development
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return;
  }

  const colors = {
    green: (txt: string) => `\x1b[32m${txt}\x1b[0m`,
    red: (txt: string) => `\x1b[31m${txt}\x1b[0m`,
    gray: (txt: string) => `\x1b[90m${txt}\x1b[0m`,
  };

  console.log('\n--- Schema Test Results ---\n');

  values.forEach((value) => {
    const result = schema.safeParse(value);
    const type = colors.gray(`(${typeof value})`);
    const serialized = JSON.stringify(value);

    if (result.success) {
      console.log(`${colors.green('✓')} ${serialized} ${type}`);

      console.log(`  Result: ${JSON.stringify(result.data)}`);
    } else {
      console.log(`${colors.red('✗')} ${serialized} ${type}`);
      result.error.issues.forEach((issue) => {
        console.log(`  Error: ${issue.message}`);
      });
    }

    console.log('');
  });
}
