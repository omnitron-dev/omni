'use client';

/**
 * Schema Provider
 *
 * Provides i18n-aware schema validation with customizable error messages.
 * Integrates with any i18n library (i18next, react-intl, etc.).
 *
 * @module @omnitron-dev/prism/forms
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import * as z from 'zod';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Translation function type.
 * Compatible with i18next t() function signature.
 */
export type TranslateFunction = (key: string, options?: Record<string, unknown>) => string;

/**
 * Default translation keys for schema error messages.
 */
export interface SchemaTranslationKeys {
  // Required fields
  'validation.required': string;
  'validation.email.required': string;
  'validation.email.invalid': string;
  'validation.phone.required': string;
  'validation.phone.invalid': string;
  'validation.date.required': string;
  'validation.date.invalid': string;
  'validation.file.required': string;
  'validation.file.tooLarge': string;
  'validation.file.invalidType': string;
  'validation.boolean.required': string;
  'validation.editor.required': string;
  'validation.url.required': string;
  'validation.url.invalid': string;
  'validation.password.minLength': string;
  'validation.password.uppercase': string;
  'validation.password.lowercase': string;
  'validation.password.number': string;
  'validation.password.special': string;
  'validation.confirm.mismatch': string;
  // Array of all keys
  [key: string]: string;
}

/**
 * Schema provider configuration.
 */
export interface SchemaProviderConfig {
  /**
   * Translation function from your i18n library.
   * If not provided, keys will be used as-is.
   */
  t?: TranslateFunction;
  /**
   * Default locale for error messages.
   * @default 'en'
   */
  locale?: string;
  /**
   * Custom error message overrides.
   */
  messages?: Partial<SchemaTranslationKeys>;
}

/**
 * Schema context value.
 */
export interface SchemaContextValue {
  /**
   * Translate a validation key.
   */
  t: TranslateFunction;
  /**
   * Current locale.
   */
  locale: string;
  /**
   * Get schema helpers with translated messages.
   */
  schema: ReturnType<typeof createTranslatedSchemaUtils>;
}

// =============================================================================
// DEFAULT MESSAGES
// =============================================================================

/**
 * Default English error messages.
 */
const DEFAULT_MESSAGES: SchemaTranslationKeys = {
  'validation.required': 'This field is required',
  'validation.email.required': 'Email is required',
  'validation.email.invalid': 'Please enter a valid email address',
  'validation.phone.required': 'Phone number is required',
  'validation.phone.invalid': 'Please enter a valid phone number',
  'validation.date.required': 'Date is required',
  'validation.date.invalid': 'Please enter a valid date',
  'validation.file.required': 'File is required',
  'validation.file.tooLarge': 'File size exceeds the maximum allowed',
  'validation.file.invalidType': 'File type is not supported',
  'validation.boolean.required': 'This field must be accepted',
  'validation.editor.required': 'Content is required',
  'validation.url.required': 'URL is required',
  'validation.url.invalid': 'Please enter a valid URL',
  'validation.password.minLength': 'Password must be at least {{minLength}} characters',
  'validation.password.uppercase': 'Password must contain at least one uppercase letter',
  'validation.password.lowercase': 'Password must contain at least one lowercase letter',
  'validation.password.number': 'Password must contain at least one number',
  'validation.password.special': 'Password must contain at least one special character',
  'validation.confirm.mismatch': '{{fieldName}} does not match',
};

// =============================================================================
// CONTEXT
// =============================================================================

const SchemaContext = createContext<SchemaContextValue | null>(null);

// =============================================================================
// TRANSLATED SCHEMA UTILS FACTORY
// =============================================================================

/**
 * Create schema utilities with translated error messages.
 */
function createTranslatedSchemaUtils(t: TranslateFunction) {
  return {
    /**
     * Email validation with i18n messages.
     */
    email: (options?: { required?: string; invalid?: string }) =>
      z
        .string()
        .min(1, { message: options?.required ?? t('validation.email.required') })
        .email({ message: options?.invalid ?? t('validation.email.invalid') }),

    /**
     * Phone validation with i18n messages.
     */
    phone: (options?: { required?: string; invalid?: string; isValid?: (val: string) => boolean }) => {
      let schema = z.string().min(1, { message: options?.required ?? t('validation.phone.required') });

      if (options?.isValid) {
        schema = schema.refine(options.isValid, {
          message: options?.invalid ?? t('validation.phone.invalid'),
        });
      }

      return schema;
    },

    /**
     * Date validation with i18n messages.
     */
    date: (options?: { required?: string; invalid?: string }) =>
      z
        .union([z.string(), z.number(), z.date(), z.null()])
        .refine((val) => val !== null && val !== '' && val !== undefined, {
          message: options?.required ?? t('validation.date.required'),
        })
        .refine(
          (val) => {
            if (val === null || val === '' || val === undefined) return true;
            const date = new Date(val as string | number | Date);
            return !isNaN(date.getTime());
          },
          { message: options?.invalid ?? t('validation.date.invalid') }
        ),

    /**
     * Optional date schema.
     */
    dateOptional: (options?: { invalid?: string }) =>
      z
        .union([z.string(), z.number(), z.date(), z.null()])
        .refine(
          (val) => {
            if (val === null || val === '' || val === undefined) return true;
            const date = new Date(val as string | number | Date);
            return !isNaN(date.getTime());
          },
          { message: options?.invalid ?? t('validation.date.invalid') }
        )
        .nullable(),

    /**
     * Boolean (checkbox) validation with i18n messages.
     */
    boolean: (options?: { error?: string }) =>
      z.boolean().refine((val) => val === true, {
        message: options?.error ?? t('validation.boolean.required'),
      }),

    /**
     * Optional boolean schema.
     */
    booleanOptional: () => z.boolean().optional(),

    /**
     * Rich text editor validation with i18n messages.
     */
    editor: (options?: { error?: string }) =>
      z.string().refine(
        (val) => {
          const cleaned = val.trim();
          return cleaned !== '' && cleaned !== '<p></p>' && cleaned !== '<p><br></p>' && cleaned !== '<p><br/></p>';
        },
        { message: options?.error ?? t('validation.editor.required') }
      ),

    /**
     * File validation with i18n messages.
     */
    file: (options?: {
      required?: string;
      tooLarge?: string;
      invalidType?: string;
      maxSize?: number;
      accept?: string[];
    }) =>
      z
        .union([z.instanceof(File), z.string(), z.null()])
        .refine(
          (val) => {
            if (val === null || val === undefined) return false;
            if (typeof val === 'string') return val.length > 0;
            return true;
          },
          { message: options?.required ?? t('validation.file.required') }
        )
        .refine(
          (val) => {
            if (!options?.maxSize || typeof val === 'string' || val === null) return true;
            return (val as File).size <= options.maxSize;
          },
          { message: options?.tooLarge ?? t('validation.file.tooLarge') }
        )
        .refine(
          (val) => {
            if (!options?.accept || typeof val === 'string' || val === null) return true;
            return options.accept.includes((val as File).type);
          },
          { message: options?.invalidType ?? t('validation.file.invalidType') }
        ),

    /**
     * Optional file schema.
     */
    fileOptional: (options?: { tooLarge?: string; invalidType?: string; maxSize?: number; accept?: string[] }) =>
      z
        .union([z.instanceof(File), z.string(), z.null()])
        .refine(
          (val) => {
            if (!options?.maxSize || typeof val === 'string' || val === null || val === undefined) return true;
            return (val as File).size <= options.maxSize;
          },
          { message: options?.tooLarge ?? t('validation.file.tooLarge') }
        )
        .refine(
          (val) => {
            if (!options?.accept || typeof val === 'string' || val === null || val === undefined) return true;
            return options.accept.includes((val as File).type);
          },
          { message: options?.invalidType ?? t('validation.file.invalidType') }
        )
        .nullable(),

    /**
     * Multiple files validation.
     */
    files: (options?: { error?: string; minFiles?: number }) =>
      z
        .array(z.union([z.instanceof(File), z.string()]))
        .min(options?.minFiles ?? 1, { message: options?.error ?? t('validation.file.required') }),

    /**
     * URL validation with i18n messages.
     */
    url: (options?: { required?: string; invalid?: string }) =>
      z
        .string()
        .min(1, { message: options?.required ?? t('validation.url.required') })
        .url({ message: options?.invalid ?? t('validation.url.invalid') }),

    /**
     * Optional URL schema.
     */
    urlOptional: (options?: { invalid?: string }) =>
      z
        .string()
        .url({ message: options?.invalid ?? t('validation.url.invalid') })
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
        .min(minLength, { message: t('validation.password.minLength', { minLength }) })
        .refine((val) => !requireUppercase || /[A-Z]/.test(val), {
          message: t('validation.password.uppercase'),
        })
        .refine((val) => !requireLowercase || /[a-z]/.test(val), {
          message: t('validation.password.lowercase'),
        })
        .refine((val) => !requireNumber || /[0-9]/.test(val), {
          message: t('validation.password.number'),
        })
        .refine((val) => !requireSpecial || /[!@#$%^&*(),.?":{}|<>]/.test(val), {
          message: t('validation.password.special'),
        });
    },

    /**
     * Nullable input wrapper.
     */
    nullableInput: <T extends z.ZodTypeAny>(schema: T, options?: { error?: string }) =>
      schema
        .nullable()
        .refine((val) => val !== null && val !== undefined, { message: options?.error ?? t('validation.required') }),

    /**
     * Slider range validation.
     */
    sliderRange: (options: { min: number; max: number; invalid?: string }) =>
      z.tuple([z.number(), z.number()]).refine(([min, max]) => min >= options.min && max <= options.max && min <= max, {
        message: options?.invalid ?? `Range must be between ${options.min} and ${options.max}`,
      }),

    /**
     * Required string with i18n message.
     */
    required: (options?: { error?: string }) =>
      z.string().min(1, { message: options?.error ?? t('validation.required') }),

    /**
     * Confirmation field helper.
     */
    confirm: (fieldName: string, error?: string) => ({
      message: error ?? t('validation.confirm.mismatch', { fieldName }),
      path: ['confirm'],
    }),
  };
}

// =============================================================================
// PROVIDER COMPONENT
// =============================================================================

/**
 * Provider props.
 */
export interface SchemaProviderProps extends SchemaProviderConfig {
  children: ReactNode;
}

/**
 * SchemaProvider - Provides i18n-aware schema validation context.
 *
 * @example
 * ```tsx
 * // With i18next
 * import { useTranslation } from 'react-i18next';
 *
 * function App() {
 *   const { t, i18n } = useTranslation();
 *
 *   return (
 *     <SchemaProvider t={t} locale={i18n.language}>
 *       <MyForm />
 *     </SchemaProvider>
 *   );
 * }
 *
 * // In form component
 * function MyForm() {
 *   const { schema } = useSchema();
 *
 *   const formSchema = z.object({
 *     email: schema.email(),
 *     password: schema.password(),
 *   });
 *
 *   // ... form implementation
 * }
 * ```
 */
export function SchemaProvider({ children, t: providedT, locale = 'en', messages = {} }: SchemaProviderProps) {
  // Create translation function with fallbacks
  const t: TranslateFunction = useMemo(() => {
    if (providedT) {
      // Wrap provided t() to include custom messages as fallback
      return (key: string, options?: Record<string, unknown>) => {
        const result = providedT(key, options);
        // If translation returns the key (not found), use custom messages or defaults
        if (result === key) {
          const customMessage = messages[key];
          if (customMessage) {
            return interpolate(customMessage, options);
          }
          const defaultMessage = DEFAULT_MESSAGES[key];
          if (defaultMessage) {
            return interpolate(defaultMessage, options);
          }
        }
        return result;
      };
    }

    // No i18n library provided - use custom messages or defaults
    return (key: string, options?: Record<string, unknown>) => {
      const message = messages[key] ?? DEFAULT_MESSAGES[key] ?? key;
      return interpolate(message, options);
    };
  }, [providedT, messages]);

  // Create schema utilities with translated messages
  const schema = useMemo(() => createTranslatedSchemaUtils(t), [t]);

  const value = useMemo<SchemaContextValue>(() => ({ t, locale, schema }), [t, locale, schema]);

  return <SchemaContext.Provider value={value}>{children}</SchemaContext.Provider>;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access schema context.
 *
 * @throws Error if used outside SchemaProvider
 *
 * @example
 * ```tsx
 * function MyForm() {
 *   const { schema, t } = useSchema();
 *
 *   const formSchema = z.object({
 *     email: schema.email(),
 *     name: z.string().min(1, { message: t('validation.required') }),
 *   });
 *
 *   // ... use formSchema with react-hook-form
 * }
 * ```
 */
export function useSchema(): SchemaContextValue {
  const context = useContext(SchemaContext);

  if (!context) {
    throw new Error('useSchema must be used within a SchemaProvider');
  }

  return context;
}

/**
 * Hook to access schema context safely (returns null if not in provider).
 */
export function useSchemaOptional(): SchemaContextValue | null {
  return useContext(SchemaContext);
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Simple string interpolation for error messages.
 * Replaces {{key}} with values from options.
 */
function interpolate(message: string, options?: Record<string, unknown>): string {
  if (!options) return message;

  return message.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = options[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

// =============================================================================
// STANDALONE FACTORY (for use without provider)
// =============================================================================

/**
 * Create translated schema utilities without provider.
 * Useful for server-side validation or standalone usage.
 *
 * @example
 * ```ts
 * // Server-side validation
 * const t = (key: string) => translations[key] ?? key;
 * const schema = createSchemaUtils(t);
 *
 * const userSchema = z.object({
 *   email: schema.email(),
 * });
 * ```
 */
export function createSchemaUtils(t?: TranslateFunction): ReturnType<typeof createTranslatedSchemaUtils> {
  const translateFn: TranslateFunction = t ?? ((key) => DEFAULT_MESSAGES[key] ?? key);
  return createTranslatedSchemaUtils(translateFn);
}
