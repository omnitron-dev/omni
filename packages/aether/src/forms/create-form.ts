/**
 * Forms - createForm Implementation
 *
 * Core form state management and validation
 */

import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { batch } from '../core/reactivity/batch.js';
import type {
  Form,
  FormConfig,
  FormErrors,
  FormTouched,
  SchemaValidator,
  ValidationSchema,
  FieldProps,
} from './types.js';

/**
 * Check if value is a Zod-like schema
 */
function isSchema<T>(validate: any): validate is SchemaValidator<T> {
  return validate && typeof validate.safeParse === 'function';
}

/**
 * Get nested value from object using dot notation
 * Reserved for future nested field support
 */
// function getNestedValue(obj: any, path: string): any {
//   return path.split('.').reduce((acc, part) => acc?.[part], obj);
// }

/**
 * Set nested value in object using dot notation
 * Reserved for future nested field support
 */
// function setNestedValue(obj: any, path: string, value: any): void {
//   const parts = path.split('.');
//   const last = parts.pop()!;
//   const target = parts.reduce((acc, part) => {
//     if (!acc[part]) acc[part] = {};
//     return acc[part];
//   }, obj);
//   target[last] = value;
// }

/**
 * Create a form instance with state management and validation
 *
 * @param config - Form configuration
 * @returns Form instance
 *
 * @example
 * ```typescript
 * const form = createForm({
 *   initialValues: { email: '', password: '' },
 *   validate: {
 *     email: (value) => !value ? 'Required' : undefined,
 *     password: (value) => value.length < 8 ? 'Too short' : undefined
 *   },
 *   onSubmit: async (values) => {
 *     await api.login(values);
 *   }
 * });
 * ```
 */
export function createForm<T extends Record<string, any>>(config: FormConfig<T>): Form<T> {
  const { initialValues, validate, validateOn = 'blur', onSubmit, onError, onReset } = config;

  // Form state
  const values = signal<T>(structuredClone(initialValues));
  const errors = signal<FormErrors<T>>({});
  const touched = signal<FormTouched<T>>({});
  const isSubmitting = signal(false);

  // Computed state
  const isValid = computed(() => Object.keys(errors()).length === 0);
  const isDirty = computed(() => JSON.stringify(values()) !== JSON.stringify(initialValues));

  /**
   * Validate a single field
   */
  async function validateField<K extends keyof T>(field: K): Promise<boolean> {
    if (!validate) return true;

    try {
      let error: string | undefined;

      if (isSchema(validate)) {
        // Schema-based validation
        const result = validate.safeParse(values());
        if (!result.success) {
          const fieldError = result.error.issues.find(
            (issue) => issue.path[0] === field
          );
          error = fieldError?.message;
        }
      } else {
        // Function-based validation
        const validator = (validate as ValidationSchema<T>)[field];
        if (validator) {
          error = await validator(values()[field]);
        }
      }

      // Update errors
      batch(() => {
        const currentErrors = { ...errors() };
        if (error) {
          currentErrors[field] = error;
        } else {
          delete currentErrors[field];
        }
        errors.set(currentErrors);
      });

      return !error;
    } catch (err) {
      console.error(`Validation error for field ${String(field)}:`, err);
      return false;
    }
  }

  /**
   * Validate entire form
   */
  async function validateForm(): Promise<boolean> {
    if (!validate) return true;

    try {
      const newErrors: FormErrors<T> = {};

      if (isSchema(validate)) {
        // Schema-based validation
        const result = validate.safeParse(values());
        if (!result.success) {
          for (const issue of result.error.issues) {
            const field = issue.path[0] as keyof T;
            if (field) {
              newErrors[field] = issue.message;
            }
          }
        }
      } else {
        // Function-based validation
        const validators = validate as ValidationSchema<T>;
        const validationPromises = Object.keys(validators).map(async (key) => {
          const field = key as keyof T;
          const validator = validators[field];
          if (validator) {
            const error = await validator(values()[field]);
            if (error) {
              newErrors[field] = error;
            }
          }
        });
        await Promise.all(validationPromises);
      }

      errors.set(newErrors);
      return Object.keys(newErrors).length === 0;
    } catch (err) {
      console.error('Form validation error:', err);
      return false;
    }
  }

  /**
   * Set value for a field
   */
  function setFieldValue<K extends keyof T>(field: K, value: T[K]): void {
    batch(() => {
      const currentValues = { ...values() };
      currentValues[field] = value;
      values.set(currentValues);

      // Validate on change if configured
      if (validateOn === 'change') {
        validateField(field);
      }
    });
  }

  /**
   * Set error for a field
   */
  function setFieldError<K extends keyof T>(field: K, error: string | undefined): void {
    const currentErrors = { ...errors() };
    if (error) {
      currentErrors[field] = error;
    } else {
      delete currentErrors[field];
    }
    errors.set(currentErrors);
  }

  /**
   * Set touched state for a field
   */
  function setFieldTouched<K extends keyof T>(field: K, isTouched: boolean): void {
    batch(() => {
      const currentTouched = { ...touched() };
      currentTouched[field] = isTouched;
      touched.set(currentTouched);

      // Validate on blur if configured
      if (isTouched && validateOn === 'blur') {
        validateField(field);
      }
    });
  }

  /**
   * Reset form to initial values
   */
  function reset(): void {
    batch(() => {
      values.set(structuredClone(initialValues));
      errors.set({});
      touched.set({});
      isSubmitting.set(false);
    });

    if (onReset) {
      onReset();
    }
  }

  /**
   * Submit form
   */
  async function handleSubmit(e?: Event): Promise<void> {
    if (e) {
      e.preventDefault();
    }

    // Mark all fields as touched
    const allTouched: FormTouched<T> = {};
    for (const key in initialValues) {
      allTouched[key] = true;
    }
    touched.set(allTouched);

    // Validate form
    const valid = await validateForm();

    if (!valid) {
      if (onError) {
        onError(errors());
      }
      return;
    }

    // Submit
    if (onSubmit) {
      try {
        isSubmitting.set(true);
        await onSubmit(values());
      } catch (err) {
        console.error('Form submission error:', err);
        throw err;
      } finally {
        isSubmitting.set(false);
      }
    }
  }

  /**
   * Get field props for binding to input
   */
  function getFieldProps<K extends keyof T>(field: K): FieldProps {
    return {
      name: String(field),
      value: values()[field],
      onInput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        setFieldValue(field, target.value as T[K]);
      },
      onBlur: () => {
        setFieldTouched(field, true);
      },
    };
  }

  return {
    get values() {
      return values();
    },
    get errors() {
      return errors();
    },
    get touched() {
      return touched();
    },
    get isSubmitting() {
      return isSubmitting();
    },
    get isValid() {
      return isValid();
    },
    get isDirty() {
      return isDirty();
    },
    setFieldValue,
    setFieldError,
    setFieldTouched,
    validateField,
    validateForm,
    reset,
    handleSubmit,
    getFieldProps,
  };
}
