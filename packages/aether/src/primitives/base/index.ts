/**
 * Base Input Primitives
 *
 * Shared base components for form inputs with consistent:
 * - State management (Pattern 19)
 * - Validation API
 * - Error handling
 * - Focus management
 * - ARIA support
 */

export {
  createInputPrimitive,
  createFocusManager,
  createValidator,
  type InputConfig,
  type BaseInputProps,
  type FocusManager,
  type ValidationResult,
} from './createInputPrimitive.js';
