/**
 * createInputPrimitive Factory
 *
 * Factory function to eliminate duplicated code across input components (Input, Textarea, NumberInput).
 * Provides a unified base for creating form input primitives with consistent:
 * - Controlled/uncontrolled state management (Pattern 19: WritableSignal support)
 * - Validation API
 * - Error handling patterns
 * - Focus management utilities
 * - ARIA attributes
 *
 * PATTERNS IDENTIFIED:
 * 1. useControlledState for value management (Pattern 19)
 * 2. Event handlers: onInput, onChange, onBlur, onFocus
 * 3. State attributes: disabled, readOnly, required, invalid
 * 4. ARIA attributes: aria-label, aria-labelledby, aria-describedby, aria-invalid
 * 5. Data attributes: data-{type}, data-disabled, data-readonly, data-invalid
 * 6. Common props filtering and spreading
 *
 * VARIATIONS HANDLED:
 * - Input element vs textarea element
 * - Different input types (text, email, password, number, etc.)
 * - Custom value transformation (e.g., number parsing)
 * - Additional element-specific props (rows, cols, maxLength, etc.)
 * - Custom validation logic
 * - Focus management behaviors
 */

import { defineComponent } from '../../core/component/define.js';
import { signal, type WritableSignal } from '../../core/reactivity/index.js';
import { jsx } from '../../jsx-runtime.js';
import { useControlledState } from '../../utils/controlled-state.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for creating an input primitive
 */
export interface InputConfig<TValue = string> {
  /**
   * Name of the input (e.g., 'input', 'textarea', 'number-input')
   * Used for data attributes
   */
  name: string;

  /**
   * HTML element type to create
   * @default 'input'
   */
  elementType?: 'input' | 'textarea';

  /**
   * Default input type (for input elements)
   * @default 'text'
   */
  defaultInputType?: string;

  /**
   * Transform raw input value before setting state
   * Useful for number inputs, formatting, etc.
   * @param value - Raw string from input event
   * @returns Transformed value
   */
  transformValue?: (value: string, currentValue: TValue) => TValue;

  /**
   * Transform state value before rendering
   * @param value - Current state value
   * @returns String to display in input
   */
  formatValue?: (value: TValue) => string;

  /**
   * Validate value before accepting change
   * @param value - New value to validate
   * @param currentValue - Current value
   * @returns true if valid, false or error message if invalid
   */
  validateValue?: (value: TValue, currentValue: TValue) => boolean | string;

  /**
   * Custom props to exclude from spreading to element
   */
  excludeProps?: string[];

  /**
   * Additional attributes to always include
   */
  additionalAttributes?: Record<string, any>;

  /**
   * Whether to support auto-focus
   * @default true
   */
  supportsAutoFocus?: boolean;
}

// ============================================================================
// Base Props Types
// ============================================================================

/**
 * Base props shared by all input primitives
 */
export interface BaseInputProps<TValue = string> {
  /**
   * Controlled value (supports WritableSignal for reactive updates - Pattern 19)
   */
  value?: WritableSignal<TValue> | TValue;

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: TValue;

  /**
   * Value change handler
   */
  onValueChange?: (value: TValue) => void;

  /**
   * Placeholder text
   */
  placeholder?: string;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Read-only state
   */
  readOnly?: boolean;

  /**
   * Required field
   */
  required?: boolean;

  /**
   * Invalid state (for validation errors)
   */
  invalid?: boolean;

  /**
   * Input name
   */
  name?: string;

  /**
   * Input ID
   */
  id?: string;

  /**
   * ARIA label
   */
  'aria-label'?: string;

  /**
   * ARIA labelledby
   */
  'aria-labelledby'?: string;

  /**
   * ARIA describedby
   */
  'aria-describedby'?: string;

  /**
   * ARIA invalid (auto-set from invalid prop)
   */
  'aria-invalid'?: boolean;

  /**
   * Change handler (legacy compatibility)
   */
  onChange?: (value: TValue) => void;

  /**
   * Input handler (legacy compatibility)
   */
  onInput?: (value: TValue) => void;

  /**
   * Blur handler
   */
  onBlur?: (event: FocusEvent) => void;

  /**
   * Focus handler
   */
  onFocus?: (event: FocusEvent) => void;

  /**
   * Validation error message (optional)
   */
  error?: string;

  /**
   * Auto focus on mount
   */
  autoFocus?: boolean;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

// ============================================================================
// Focus Management Utilities
// ============================================================================

/**
 * Focus management utilities for input components
 */
export interface FocusManager {
  /**
   * Get the input element
   */
  getElement: () => HTMLInputElement | HTMLTextAreaElement | null;

  /**
   * Focus the input
   */
  focus: () => void;

  /**
   * Blur the input
   */
  blur: () => void;

  /**
   * Select all text in the input
   */
  select: () => void;

  /**
   * Set cursor position
   */
  setSelectionRange: (start: number, end: number) => void;
}

/**
 * Create focus management utilities for an input
 */
export function createFocusManager(
  elementRef: WritableSignal<HTMLInputElement | HTMLTextAreaElement | null>
): FocusManager {
  return {
    getElement: () => elementRef(),
    focus: () => {
      const element = elementRef();
      if (element) {
        element.focus();
      }
    },
    blur: () => {
      const element = elementRef();
      if (element) {
        element.blur();
      }
    },
    select: () => {
      const element = elementRef();
      if (element) {
        element.select();
      }
    },
    setSelectionRange: (start: number, end: number) => {
      const element = elementRef();
      if (element && 'setSelectionRange' in element) {
        element.setSelectionRange(start, end);
      }
    },
  };
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  /**
   * Whether the value is valid
   */
  valid: boolean;

  /**
   * Error message if invalid
   */
  error?: string;
}

/**
 * Create validation handler
 */
export function createValidator<TValue>(
  config: InputConfig<TValue>
): (value: TValue, currentValue: TValue) => ValidationResult {
  return (value: TValue, currentValue: TValue): ValidationResult => {
    if (!config.validateValue) {
      return { valid: true };
    }

    const result = config.validateValue(value, currentValue);

    if (typeof result === 'boolean') {
      return { valid: result };
    }

    return { valid: false, error: result };
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates an input primitive component
 *
 * @param config - Configuration for the input behavior
 * @returns Input component
 *
 * @example
 * ```typescript
 * const Input = createInputPrimitive({
 *   name: 'input',
 *   elementType: 'input',
 *   defaultInputType: 'text',
 * });
 *
 * const NumberInput = createInputPrimitive<number>({
 *   name: 'number-input',
 *   elementType: 'input',
 *   defaultInputType: 'number',
 *   transformValue: (value) => parseFloat(value) || 0,
 *   formatValue: (value) => String(value),
 * });
 * ```
 */
export function createInputPrimitive<TValue = string>(config: InputConfig<TValue>) {
  const {
    name,
    elementType = 'input',
    defaultInputType = 'text',
    transformValue,
    formatValue,
    validateValue,
    excludeProps = [],
    additionalAttributes = {},
    supportsAutoFocus = true,
  } = config;

  // Standard props to exclude from spreading
  const standardExcludeProps = [
    'value',
    'defaultValue',
    'onValueChange',
    'onChange',
    'onInput',
    'onBlur',
    'onFocus',
    'invalid',
    'error',
    'autoFocus',
    ...excludeProps,
  ];

  const Component = defineComponent<BaseInputProps<TValue>>((props) => {
    // Default value handling
    const getDefaultValue = (): TValue => {
      if (props.defaultValue !== undefined) {
        return props.defaultValue;
      }
      // For string-based inputs, use empty string
      return '' as unknown as TValue;
    };

    // Pattern 19: Use useControlledState for flexible value handling
    const [getValue, setValue] = useControlledState<TValue>(props.value, getDefaultValue(), props.onValueChange);

    // Element ref for focus management
    const elementRef = signal<HTMLInputElement | HTMLTextAreaElement | null>(null);

    // Create focus manager
    const focusManager = createFocusManager(elementRef);

    // Create validator
    const validator = createValidator(config);

    // Handle input event
    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const rawValue = target.value;

      // Transform value if transform function provided
      let newValue: TValue;
      if (transformValue) {
        newValue = transformValue(rawValue, getValue());
      } else {
        newValue = rawValue as unknown as TValue;
      }

      // Validate if validator provided
      if (validateValue) {
        const result = validator(newValue, getValue());
        if (!result.valid) {
          // Optionally call error handler
          return;
        }
      }

      // Update controlled state
      setValue(newValue);

      // Call legacy handlers for compatibility
      props.onInput?.(newValue);
      props.onChange?.(newValue);
    };

    const handleBlur = (e: Event) => {
      props.onBlur?.(e as FocusEvent);
    };

    const handleFocus = (e: Event) => {
      props.onFocus?.(e as FocusEvent);
    };

    // Handle ref callback
    const handleRef = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      elementRef.set(element);

      // Auto-focus if requested
      if (element && supportsAutoFocus && props.autoFocus) {
        // Use microtask to ensure element is mounted
        queueMicrotask(() => {
          element.focus();
        });
      }
    };

    // Expose focus manager (can be retrieved via component instance if needed)
    (Component as any)._focusManager = focusManager;

    return () => {
      // Filter out control props
      const filteredProps: Record<string, any> = {};
      for (const key in props) {
        if (!standardExcludeProps.includes(key)) {
          filteredProps[key] = props[key];
        }
      }

      // Get current value and format if needed
      const currentValue = getValue();
      const displayValue = formatValue ? formatValue(currentValue) : (currentValue as any);

      // Build base attributes
      const baseAttributes: Record<string, any> = {
        ...filteredProps,
        ...additionalAttributes,
        ref: handleRef as any,
        value: displayValue,
        placeholder: props.placeholder,
        disabled: props.disabled,
        readOnly: props.readOnly,
        required: props.required,
        name: props.name,
        id: props.id,
        [`data-${name}`]: '',
        'data-disabled': props.disabled ? '' : undefined,
        'data-readonly': props.readOnly ? '' : undefined,
        'data-invalid': props.invalid ? '' : undefined,
        'aria-invalid': props.invalid ? 'true' : undefined,
        'aria-label': props['aria-label'],
        'aria-labelledby': props['aria-labelledby'],
        'aria-describedby': props['aria-describedby'],
        onInput: handleInput,
        onBlur: handleBlur,
        onFocus: handleFocus,
      };

      // Add type attribute for input elements
      if (elementType === 'input') {
        baseAttributes.type = (props as any).type || defaultInputType;
      }

      return jsx(elementType, baseAttributes);
    };
  });

  // Attach display name
  Component.displayName = name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  return Component;
}

// Types are exported via the interface declarations above
