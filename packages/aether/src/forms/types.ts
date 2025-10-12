/**
 * Forms - Type Definitions
 *
 * Core types for the Aether forms system
 */

/**
 * Validation function for a field
 */
export type FieldValidator<T = any> = (value: T) => string | undefined | Promise<string | undefined>;

/**
 * Validation schema
 */
export type ValidationSchema<T> = {
  [K in keyof T]?: FieldValidator<T[K]>;
};

/**
 * Zod-like schema interface
 */
export interface SchemaValidator<T> {
  parse(value: unknown): T;
  safeParse(
    value: unknown
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };
}

/**
 * Validation mode
 */
export type ValidationMode = 'blur' | 'change' | 'submit';

/**
 * Form configuration
 */
export interface FormConfig<T extends Record<string, any>> {
  /**
   * Initial form values
   */
  initialValues: T;

  /**
   * Validation function or schema
   */
  validate?: ValidationSchema<T> | SchemaValidator<T>;

  /**
   * When to validate fields
   * @default 'blur'
   */
  validateOn?: ValidationMode;

  /**
   * Form submission handler
   */
  onSubmit?: (values: T) => void | Promise<void>;

  /**
   * Called when validation fails
   */
  onError?: (errors: FormErrors<T>) => void;

  /**
   * Called when form is reset
   */
  onReset?: () => void;
}

/**
 * Form errors
 */
export type FormErrors<T> = {
  [K in keyof T]?: string;
};

/**
 * Form touched state
 */
export type FormTouched<T> = {
  [K in keyof T]?: boolean;
};

/**
 * Field properties for binding to inputs
 */
export interface FieldProps {
  name: string;
  value: any;
  onInput: (e: Event) => void;
  onBlur: (e: Event) => void;
}

/**
 * Form instance
 */
export interface Form<T extends Record<string, any>> {
  /**
   * Current form values
   */
  readonly values: T;

  /**
   * Current form errors
   */
  readonly errors: FormErrors<T>;

  /**
   * Touched fields
   */
  readonly touched: FormTouched<T>;

  /**
   * Is form currently submitting
   */
  readonly isSubmitting: boolean;

  /**
   * Is form valid (no errors)
   */
  readonly isValid: boolean;

  /**
   * Is form dirty (values changed from initial)
   */
  readonly isDirty: boolean;

  /**
   * Set value for a field
   */
  setFieldValue<K extends keyof T>(field: K, value: T[K]): void;

  /**
   * Set error for a field
   */
  setFieldError<K extends keyof T>(field: K, error: string | undefined): void;

  /**
   * Set touched state for a field
   */
  setFieldTouched<K extends keyof T>(field: K, touched: boolean): void;

  /**
   * Validate a single field
   */
  validateField<K extends keyof T>(field: K): Promise<boolean>;

  /**
   * Validate entire form
   */
  validateForm(): Promise<boolean>;

  /**
   * Reset form to initial values
   */
  reset(): void;

  /**
   * Submit form
   */
  handleSubmit(e?: Event): Promise<void>;

  /**
   * Get props for binding to an input element
   */
  getFieldProps<K extends keyof T>(field: K): FieldProps;
}
