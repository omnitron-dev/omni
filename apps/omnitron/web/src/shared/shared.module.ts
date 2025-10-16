/**
 * SharedModule
 *
 * Module containing reusable UI components and utilities for the Omnitron application.
 *
 * This module provides:
 * - Common UI components (Button, Icon, Loading, ErrorBoundary)
 * - Formatting utilities (dates, numbers, strings, durations)
 * - Validation utilities (form validation, data validation)
 *
 * @module SharedModule
 */

// ============================================================================
// Components
// ============================================================================

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export { Icon, type IconProps, type IconSize, type IconColor } from './components/Icon';
export { Loading, type LoadingProps, type LoadingVariant, type LoadingSize } from './components/Loading';
export { ErrorBoundary, type ErrorBoundaryProps, type ErrorInfo } from './components/ErrorBoundary';

// ============================================================================
// Utilities - Formatting
// ============================================================================

export {
  // Date formatting
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatTime,

  // Number formatting
  formatNumber,
  formatCurrency,
  formatPercentage,
  formatCompactNumber,
  formatOrdinal,

  // File size formatting
  formatFileSize,

  // String formatting
  truncate,
  truncateMiddle,
  toTitleCase,
  toSentenceCase,
  fromCamelCase,
  fromKebabCase,
  pluralize,

  // Duration formatting
  formatDuration,
  formatHumanDuration,
} from './utils/format';

// ============================================================================
// Utilities - Validation
// ============================================================================

export {
  // Types
  type ValidationResult,
  type Validator,

  // Basic validators
  required,
  minLength,
  maxLength,
  exactLength,

  // Number validators
  min,
  max,
  range,
  isNumber,
  isInteger,

  // String validators
  isEmail,
  isUrl,
  pattern,
  isAlphanumeric,
  isPhoneNumber,
  isAlpha,

  // Comparison validators
  matches,
  oneOf,

  // Date validators
  isPastDate,
  isFutureDate,
  isAfter,
  isBefore,

  // Composite validators
  all,
  any,
  not,
  when,

  // Utility functions
  validate,
  isValid,
  getError,
} from './utils/validation';

// ============================================================================
// Module Metadata
// ============================================================================

/**
 * Shared module metadata
 */
export const SharedModuleMetadata = {
  id: 'shared',
  version: '1.0.0',
  name: 'Shared Module',
  description: 'Reusable UI components and utilities',
  author: 'Omnitron Team',
  components: ['Button', 'Icon', 'Loading', 'ErrorBoundary'],
  utilities: ['format', 'validation'],
} as const;
