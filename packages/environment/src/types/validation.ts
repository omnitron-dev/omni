/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  value?: any;
  schema?: any;
}

/**
 * Custom validator function
 */
export type ValidatorFunction = (
  value: any,
  context: ValidationContext
) => Promise<ValidationResult> | ValidationResult;

/**
 * Validation context
 */
export interface ValidationContext {
  get(path: string): any;
  has(path: string): boolean;
  root: any;
}
