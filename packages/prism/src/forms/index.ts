/**
 * Prism Forms Module
 *
 * Utilities and helpers for form validation and handling.
 * Designed to work seamlessly with React Hook Form and Zod.
 *
 * @module @omnitron-dev/prism/forms
 */

export {
  // Schema utilities
  schemaUtils,
  // Testing utilities
  testSchema,
  testSchemaDebug,
  // Types
  type SchemaErrorMessages,
  type FileSchemaOptions,
  type SliderRangeOptions,
  type SchemaTestResult,
} from './schema-utils.js';

// =============================================================================
// SCHEMA PROVIDER (i18n integration)
// =============================================================================

export {
  // Components
  SchemaProvider,
  // Hooks
  useSchema,
  useSchemaOptional,
  // Factory (for standalone usage)
  createSchemaUtils,
  // Types
  type TranslateFunction,
  type SchemaTranslationKeys,
  type SchemaProviderConfig,
  type SchemaProviderProps,
  type SchemaContextValue,
} from './schema-provider.js';
