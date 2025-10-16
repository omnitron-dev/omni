/**
 * Validation Utilities
 *
 * Collection of validation functions for common use cases.
 */

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export type Validator<T = any> = (value: T) => ValidationResult;

// ============================================================================
// Basic Validators
// ============================================================================

/**
 * Validate required field
 */
export function required(message = 'This field is required'): Validator {
  return (value: any): ValidationResult => {
    if (value === null || value === undefined || value === '') {
      return { valid: false, error: message };
    }
    if (Array.isArray(value) && value.length === 0) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate minimum length
 */
export function minLength(min: number, message?: string): Validator<string | any[]> {
  return (value: string | any[]): ValidationResult => {
    if (!value || value.length < min) {
      return {
        valid: false,
        error: message || `Minimum length is ${min} characters`,
      };
    }
    return { valid: true };
  };
}

/**
 * Validate maximum length
 */
export function maxLength(max: number, message?: string): Validator<string | any[]> {
  return (value: string | any[]): ValidationResult => {
    if (value && value.length > max) {
      return {
        valid: false,
        error: message || `Maximum length is ${max} characters`,
      };
    }
    return { valid: true };
  };
}

/**
 * Validate exact length
 */
export function exactLength(length: number, message?: string): Validator<string | any[]> {
  return (value: string | any[]): ValidationResult => {
    if (value && value.length !== length) {
      return {
        valid: false,
        error: message || `Length must be exactly ${length} characters`,
      };
    }
    return { valid: true };
  };
}

// ============================================================================
// Number Validators
// ============================================================================

/**
 * Validate minimum value
 */
export function min(minimum: number, message?: string): Validator<number> {
  return (value: number): ValidationResult => {
    if (value < minimum) {
      return {
        valid: false,
        error: message || `Value must be at least ${minimum}`,
      };
    }
    return { valid: true };
  };
}

/**
 * Validate maximum value
 */
export function max(maximum: number, message?: string): Validator<number> {
  return (value: number): ValidationResult => {
    if (value > maximum) {
      return {
        valid: false,
        error: message || `Value must be at most ${maximum}`,
      };
    }
    return { valid: true };
  };
}

/**
 * Validate value is within range
 */
export function range(minimum: number, maximum: number, message?: string): Validator<number> {
  return (value: number): ValidationResult => {
    if (value < minimum || value > maximum) {
      return {
        valid: false,
        error: message || `Value must be between ${minimum} and ${maximum}`,
      };
    }
    return { valid: true };
  };
}

/**
 * Validate value is a number
 */
export function isNumber(message = 'Value must be a number'): Validator {
  return (value: any): ValidationResult => {
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate value is an integer
 */
export function isInteger(message = 'Value must be an integer'): Validator {
  return (value: any): ValidationResult => {
    if (!Number.isInteger(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

// ============================================================================
// String Validators
// ============================================================================

/**
 * Validate email address
 */
export function isEmail(message = 'Invalid email address'): Validator<string> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return (value: string): ValidationResult => {
    if (!emailRegex.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate URL
 */
export function isUrl(message = 'Invalid URL'): Validator<string> {
  return (value: string): ValidationResult => {
    try {
      new URL(value);
      return { valid: true };
    } catch {
      return { valid: false, error: message };
    }
  };
}

/**
 * Validate against regex pattern
 */
export function pattern(regex: RegExp, message = 'Invalid format'): Validator<string> {
  return (value: string): ValidationResult => {
    if (!regex.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate alphanumeric string
 */
export function isAlphanumeric(message = 'Value must be alphanumeric'): Validator<string> {
  const alphanumericRegex = /^[a-zA-Z0-9]+$/;
  return (value: string): ValidationResult => {
    if (!alphanumericRegex.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate phone number (basic)
 */
export function isPhoneNumber(message = 'Invalid phone number'): Validator<string> {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return (value: string): ValidationResult => {
    if (!phoneRegex.test(value) || value.replace(/\D/g, '').length < 10) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate contains only letters
 */
export function isAlpha(message = 'Value must contain only letters'): Validator<string> {
  const alphaRegex = /^[a-zA-Z]+$/;
  return (value: string): ValidationResult => {
    if (!alphaRegex.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

// ============================================================================
// Comparison Validators
// ============================================================================

/**
 * Validate value matches another value
 */
export function matches<T>(otherValue: T, message = 'Values do not match'): Validator<T> {
  return (value: T): ValidationResult => {
    if (value !== otherValue) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate value is one of allowed values
 */
export function oneOf<T>(allowedValues: T[], message = 'Invalid value'): Validator<T> {
  return (value: T): ValidationResult => {
    if (!allowedValues.includes(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

// ============================================================================
// Date Validators
// ============================================================================

/**
 * Validate date is in the past
 */
export function isPastDate(message = 'Date must be in the past'): Validator<Date> {
  return (value: Date): ValidationResult => {
    if (value.getTime() >= Date.now()) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate date is in the future
 */
export function isFutureDate(message = 'Date must be in the future'): Validator<Date> {
  return (value: Date): ValidationResult => {
    if (value.getTime() <= Date.now()) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate date is after another date
 */
export function isAfter(compareDate: Date, message = 'Date must be after comparison date'): Validator<Date> {
  return (value: Date): ValidationResult => {
    if (value.getTime() <= compareDate.getTime()) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

/**
 * Validate date is before another date
 */
export function isBefore(compareDate: Date, message = 'Date must be before comparison date'): Validator<Date> {
  return (value: Date): ValidationResult => {
    if (value.getTime() >= compareDate.getTime()) {
      return { valid: false, error: message };
    }
    return { valid: true };
  };
}

// ============================================================================
// Composite Validators
// ============================================================================

/**
 * Combine multiple validators with AND logic
 */
export function all(...validators: Validator[]): Validator {
  return (value: any): ValidationResult => {
    for (const validator of validators) {
      const result = validator(value);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  };
}

/**
 * Combine multiple validators with OR logic
 */
export function any(...validators: Validator[]): Validator {
  return (value: any): ValidationResult => {
    const errors: string[] = [];

    for (const validator of validators) {
      const result = validator(value);
      if (result.valid) {
        return { valid: true };
      }
      if (result.error) {
        errors.push(result.error);
      }
    }

    return {
      valid: false,
      error: errors.join(' OR '),
    };
  };
}

/**
 * Negate a validator
 */
export function not(validator: Validator, message?: string): Validator {
  return (value: any): ValidationResult => {
    const result = validator(value);
    if (result.valid) {
      return {
        valid: false,
        error: message || 'Value must not match the condition',
      };
    }
    return { valid: true };
  };
}

/**
 * Conditional validator
 */
export function when(condition: (value: any) => boolean, validator: Validator): Validator {
  return (value: any): ValidationResult => {
    if (condition(value)) {
      return validator(value);
    }
    return { valid: true };
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate a value against multiple validators
 */
export function validate(value: any, validators: Validator[]): ValidationResult {
  return all(...validators)(value);
}

/**
 * Check if value is valid
 */
export function isValid(value: any, validators: Validator[]): boolean {
  return validate(value, validators).valid;
}

/**
 * Get validation error message
 */
export function getError(value: any, validators: Validator[]): string | undefined {
  return validate(value, validators).error;
}
