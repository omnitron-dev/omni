/**
 * Number Input Transform Utilities
 *
 * Three-phase number input handling for controlled inputs.
 * Allows users to type freely while maintaining valid numeric state.
 *
 * @module @omnitron/prism/utils/transform-number
 */

/**
 * Options for number transformation.
 */
export interface TransformNumberOptions {
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Decimal places to allow */
  decimals?: number;
  /** Allow negative numbers */
  allowNegative?: boolean;
  /** Default value when input is empty or invalid */
  defaultValue?: number;
}

/**
 * Parse a string to a number, handling edge cases.
 *
 * @param value - String value to parse
 * @param options - Transformation options
 * @returns Parsed number or undefined if invalid
 */
export function parseNumber(value: string, options: TransformNumberOptions = {}): number | undefined {
  const { allowNegative = true } = options;

  // Handle empty or whitespace-only strings
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.') {
    return undefined;
  }

  // Handle negative sign
  if (!allowNegative && trimmed.startsWith('-')) {
    return undefined;
  }

  const num = parseFloat(trimmed);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Clamp a number to min/max bounds.
 *
 * @param value - Value to clamp
 * @param options - Options with min/max
 * @returns Clamped value
 */
export function clampNumber(value: number, options: TransformNumberOptions = {}): number {
  const { min, max } = options;
  let result = value;

  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }

  return result;
}

/**
 * Round a number to specified decimal places.
 *
 * @param value - Value to round
 * @param decimals - Number of decimal places
 * @returns Rounded value
 */
export function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Transform value during onChange (while typing).
 * Allows intermediate states like empty string, single minus, or trailing decimal.
 *
 * @param value - Current input value
 * @param options - Transformation options
 * @returns Transformed string value (may include intermediate states)
 */
export function transformOnChange(value: string, options: TransformNumberOptions = {}): string {
  const { allowNegative = true, decimals } = options;

  // Allow empty string for clearing
  if (value === '') return '';

  // Allow single minus at start (user is typing negative number)
  if (allowNegative && value === '-') return '-';

  // Allow trailing decimal point (user is typing decimal)
  if (value.endsWith('.') && decimals !== 0) {
    const withoutDot = value.slice(0, -1);
    const num = parseNumber(withoutDot, options);
    if (num !== undefined) return value;
  }

  // Allow trailing zeros after decimal (e.g., "1.50" while typing "1.500")
  if (decimals !== 0 && value.includes('.')) {
    const parts = value.split('.');
    if (parts.length === 2 && /^0*$/.test(parts[1])) {
      const num = parseNumber(parts[0], options);
      if (num !== undefined) return value;
    }
  }

  // Parse and validate
  const num = parseNumber(value, options);
  if (num === undefined) {
    // Invalid input, return empty to trigger validation
    return '';
  }

  // Keep the original string representation to preserve user formatting
  return value;
}

/**
 * Transform value during onBlur (when input loses focus).
 * Finalizes the value with proper formatting and validation.
 *
 * @param value - Current input value
 * @param options - Transformation options
 * @returns Finalized numeric value
 */
export function transformOnBlur(value: string, options: TransformNumberOptions = {}): number {
  const { min, max, decimals, defaultValue = 0 } = options;

  const num = parseNumber(value, options);
  if (num === undefined) {
    return defaultValue;
  }

  let result = num;

  // Apply decimal rounding
  if (decimals !== undefined) {
    result = roundToDecimals(result, decimals);
  }

  // Apply min/max clamping
  result = clampNumber(result, { min, max });

  return result;
}

/**
 * Transform a number for display in an input.
 * Converts number back to string representation.
 *
 * @param value - Numeric value
 * @param options - Transformation options
 * @returns String representation for input value
 */
export function transformForDisplay(value: number | null | undefined, options: TransformNumberOptions = {}): string {
  if (value === null || value === undefined) {
    return '';
  }

  const { decimals } = options;

  if (decimals !== undefined) {
    return value.toFixed(decimals);
  }

  return String(value);
}

/**
 * Create a complete number input handler.
 * Returns handlers for onChange, onBlur, and value display.
 *
 * @example
 * ```tsx
 * const [price, setPrice] = useState(0);
 * const handlers = createNumberInputHandlers({
 *   value: price,
 *   onChange: setPrice,
 *   min: 0,
 *   decimals: 2,
 * });
 *
 * <TextField
 *   value={handlers.displayValue}
 *   onChange={(e) => handlers.handleChange(e.target.value)}
 *   onBlur={handlers.handleBlur}
 * />
 * ```
 *
 * @param config - Handler configuration
 * @returns Object with handlers and display value
 */
export function createNumberInputHandlers(config: {
  value: number;
  onChange: (value: number) => void;
  options?: TransformNumberOptions;
}): {
  displayValue: string;
  handleChange: (value: string) => void;
  handleBlur: () => void;
} {
  const { value, onChange, options = {} } = config;
  let intermediateValue: string | null = null;

  return {
    displayValue: intermediateValue ?? transformForDisplay(value, options),

    handleChange: (newValue: string) => {
      const transformed = transformOnChange(newValue, options);
      intermediateValue = transformed;

      // Try to parse for immediate feedback
      const num = parseNumber(transformed, options);
      if (num !== undefined) {
        onChange(num);
      }
    },

    handleBlur: () => {
      const finalValue = transformOnBlur(intermediateValue ?? String(value), options);
      intermediateValue = null;
      onChange(finalValue);
    },
  };
}
