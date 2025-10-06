/**
 * Forms Module
 *
 * Form state management and validation for Aether
 */

// Types
export type {
  FieldValidator,
  ValidationSchema,
  SchemaValidator,
  ValidationMode,
  FormConfig,
  FormErrors,
  FormTouched,
  FieldProps,
  Form,
} from './types.js';

// Core API
export { createForm } from './create-form.js';
