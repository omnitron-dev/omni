/**
 * Textarea Component
 *
 * A headless textarea component with auto-resize support and validation states.
 *
 * @example
 * ```tsx
 * <Textarea
 *   placeholder="Enter your message"
 *   autoResize
 *   minRows={3}
 *   maxRows={10}
 * />
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';
import { signal, type WritableSignal } from '../core/reactivity/index.js';
import { onMount } from '../core/component/lifecycle.js';
import { useControlledState } from '../utils/controlled-state.js';

export interface TextareaProps {
  /**
   * Controlled value (supports WritableSignal for reactive updates - Pattern 19)
   */
  value?: WritableSignal<string> | string;

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: string;

  /**
   * Value change handler
   */
  onValueChange?: (value: string) => void;

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
   * Auto-resize to fit content
   */
  autoResize?: boolean;

  /**
   * Minimum rows (for auto-resize)
   */
  minRows?: number;

  /**
   * Maximum rows (for auto-resize)
   */
  maxRows?: number;

  /**
   * Rows attribute (fixed height)
   */
  rows?: number;

  /**
   * Columns attribute
   */
  cols?: number;

  /**
   * Textarea name
   */
  name?: string;

  /**
   * Textarea ID
   */
  id?: string;

  /**
   * Max length
   */
  maxLength?: number;

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
   * Change handler
   */
  onChange?: (value: string) => void;

  /**
   * Input handler
   */
  onInput?: (value: string) => void;

  /**
   * Blur handler
   */
  onBlur?: (event: FocusEvent) => void;

  /**
   * Focus handler
   */
  onFocus?: (event: FocusEvent) => void;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

/**
 * Textarea
 *
 * A headless textarea component with auto-resize support.
 *
 * Features:
 * - Auto-resize to fit content
 * - Min/max rows constraints
 * - Validation states (invalid)
 * - Disabled and read-only states
 * - Full ARIA support
 * - Controlled and uncontrolled modes
 */
export const Textarea = defineComponent<TextareaProps>((props) => {
  const [getValue, setValue] = useControlledState(
    props.value,
    props.defaultValue ?? '',
    props.onValueChange
  );

  const textareaRef = signal<HTMLTextAreaElement | null>(null);

  const adjustHeight = (element: HTMLTextAreaElement) => {
    if (!props.autoResize) return;

    // Reset height to auto to get the correct scrollHeight
    element.style.height = 'auto';

    const minRows = props.minRows ?? 1;
    const maxRows = props.maxRows ?? Infinity;

    // Get line height
    const computedStyle = window.getComputedStyle(element);
    let lineHeight = parseFloat(computedStyle.lineHeight);

    // Fallback for environments where lineHeight is not computed (e.g., happy-dom)
    // Use fontSize as baseline, or default to 20px
    if (isNaN(lineHeight)) {
      const fontSize = parseFloat(computedStyle.fontSize);
      lineHeight = isNaN(fontSize) ? 20 : fontSize * 1.2; // 1.2 is typical line-height multiplier
    }

    // Calculate height based on content
    let height = element.scrollHeight;

    // Apply min/max constraints
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    height = Math.max(minHeight, Math.min(height, maxHeight));

    element.style.height = `${height}px`;
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    const value = target.value;

    // Update controlled state
    setValue(value);

    // Auto-resize if enabled
    if (props.autoResize) {
      adjustHeight(target);
    }

    // Call legacy handlers for compatibility
    props.onInput?.(value);
    props.onChange?.(value);
  };

  const handleBlur = (e: Event) => {
    props.onBlur?.(e as FocusEvent);
  };

  const handleFocus = (e: Event) => {
    props.onFocus?.(e as FocusEvent);
  };

  const handleRef = (element: HTMLTextAreaElement | null) => {
    textareaRef.set(element);

    // Initial resize - call immediately for testing environments
    if (element && props.autoResize) {
      adjustHeight(element);
    }
  };

  onMount(() => {
    const element = textareaRef();
    if (element && props.autoResize) {
      adjustHeight(element);
    }
  });

  return () => {
    const {
      value,
      defaultValue,
      onValueChange,
      placeholder,
      disabled,
      readOnly,
      required,
      invalid,
      autoResize,
      minRows,
      maxRows,
      rows,
      cols,
      name,
      id,
      maxLength,
      onChange,
      onInput,
      onBlur,
      onFocus,
      ...restProps
    } = props;

    return jsx('textarea', {
      ...restProps,
      ref: handleRef as any,
      value: getValue(),
      placeholder,
      disabled,
      readOnly,
      required,
      name,
      id,
      maxLength,
      rows: autoResize ? undefined : rows,
      cols,
      'data-textarea': '',
      'data-disabled': disabled ? '' : undefined,
      'data-readonly': readOnly ? '' : undefined,
      'data-invalid': invalid ? '' : undefined,
      'data-autoresize': autoResize ? '' : undefined,
      'aria-invalid': invalid ? 'true' : undefined,
      onInput: handleInput,
      onBlur: handleBlur,
      onFocus: handleFocus,
      style: {
        ...(props.style || {}),
        ...(autoResize && {
          overflow: 'hidden',
          resize: 'none',
        }),
      },
    });
  };
});

// Attach display name
Textarea.displayName = 'Textarea';
