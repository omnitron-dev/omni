/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  message?: string;
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

/**
 * Verification options
 */
export interface VerifyOptions {
  targets?: string[];
  checks?: string[];
}

/**
 * Verification result
 */
export interface VerificationResult {
  passed: boolean;
  failures: VerificationFailure[];
  remediable: boolean;
}

/**
 * Verification failure
 */
export interface VerificationFailure {
  check: string;
  target?: string;
  message: string;
  actual?: any;
  expected?: any;
  remediable: boolean;
}

/**
 * Environment contract
 */
export interface EnvironmentContract {
  version: string;
  required: string[];
  types?: Record<string, string>;
  constraints?: Record<string, any>;
}

/**
 * Contract verification result
 */
export interface ContractResult {
  satisfied: boolean;
  violations: ContractViolation[];
}

/**
 * Contract violation
 */
export interface ContractViolation {
  type: 'missing' | 'type-mismatch' | 'constraint-violation';
  path: string;
  message: string;
  expected?: any;
  actual?: any;
}
