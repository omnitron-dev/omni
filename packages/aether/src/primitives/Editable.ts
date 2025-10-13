/**
 * Editable - Inline text editing component
 *
 * Features:
 * - Click to edit pattern
 * - Enter to submit, Escape to cancel
 * - Auto-focus on edit mode
 * - Controlled and uncontrolled modes
 * - Custom validation
 * - Preview and edit states
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface EditableProps {
  /** Controlled value - can be static string or signal for reactive updates */
  value?: string | Signal<string>;
  /** Value change callback */
  onValueChange?: (value: string) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the editable is disabled */
  disabled?: boolean;
  /** Whether to start in edit mode */
  startWithEditView?: boolean;
  /** Whether to submit on blur */
  submitOnBlur?: boolean;
  /** Whether to select text on focus */
  selectOnFocus?: boolean;
  /** Custom validator */
  validator?: (value: string) => boolean;
  /** Called when editing starts */
  onEdit?: () => void;
  /** Called when value is submitted */
  onSubmit?: (value: string) => void;
  /** Called when edit is cancelled */
  onCancel?: () => void;
  /** Children */
  children?: any | (() => any);
}

export interface EditablePreviewProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface EditableInputProps {
  /** Additional props */
  [key: string]: any;
}

export interface EditableControlsProps {
  /** Children */
  children?: any;
}

export interface EditableSubmitProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface EditableCancelProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface EditableContextValue {
  /** Current value */
  value: Signal<string>;
  /** Is editing */
  isEditing: Signal<boolean>;
  /** Start editing */
  startEdit: () => void;
  /** Submit value */
  submit: () => void;
  /** Cancel editing */
  cancel: () => void;
  /** Disabled state */
  disabled: boolean;
  /** Placeholder */
  placeholder: string;
  /** Select on focus */
  selectOnFocus: boolean;
  /** Submit on blur */
  submitOnBlur: boolean;
  /** Input value (temp during edit) */
  inputValue: Signal<string>;
  /** Set input value */
  setInputValue: (value: string) => void;
  /** Input ref */
  inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null };
}

// ============================================================================
// Context
// ============================================================================

// Create context
const EditableContext = createContext<EditableContextValue | null>(null, 'Editable');

const useEditableContext = (): EditableContextValue => {
  const context = useContext(EditableContext);
  if (!context) {
    throw new Error('Editable components must be used within an Editable');
  }
  return context;
};

// ============================================================================
// Editable Root
// ============================================================================

export const Editable = defineComponent<EditableProps>((props) => {
  const disabled = props.disabled ?? false;
  const selectOnFocus = props.selectOnFocus ?? true;
  const submitOnBlur = props.submitOnBlur ?? true;
  const placeholder = props.placeholder ?? 'Enter text...';

  // State
  const internalValue: WritableSignal<string> = signal<string>(props.defaultValue ?? '');
  const isEditing: WritableSignal<boolean> = signal<boolean>(props.startWithEditView ?? false);

  const inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null } = {
    current: null,
  };

  const currentValue = (): string => {
    if (props.value !== undefined) {
      // Support both static values and signals
      return typeof props.value === 'function' ? props.value() : props.value;
    }
    return internalValue();
  };

  // Initialize inputValue with current value if starting in edit mode
  const inputValue: WritableSignal<string> = signal<string>(props.startWithEditView ? currentValue() : '');

  const setValue = (newValue: string) => {
    if (props.value === undefined) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

  const startEdit = () => {
    if (disabled) return;

    // Set input value BEFORE changing edit state
    // This ensures the value is ready when the input becomes visible
    inputValue.set(currentValue());
    isEditing.set(true);
    props.onEdit?.();

    // Focus input after state update
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        if (selectOnFocus) {
          inputRef.current.select();
        }
      }
    }, 0);
  };

  const submit = () => {
    const newValue = inputValue();

    // Validate if validator provided
    if (props.validator && !props.validator(newValue)) {
      return;
    }

    setValue(newValue);
    isEditing.set(false);
    props.onSubmit?.(newValue);
  };

  const cancel = () => {
    inputValue.set(currentValue());
    isEditing.set(false);
    props.onCancel?.();
  };

  const setInputValue = (value: string) => {
    inputValue.set(value);
  };

  const contextValue: EditableContextValue = {
    value: computed(() => currentValue()),
    isEditing: computed(() => isEditing()),
    startEdit,
    submit,
    cancel,
    disabled,
    placeholder,
    selectOnFocus,
    submitOnBlur,
    inputValue: computed(() => inputValue()),
    setInputValue,
    inputRef,
  };

  // Provide context for children
  provideContext(EditableContext, contextValue);

  // Create ref callback to set up reactive updates
  const rootRefCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update data-editing attribute
    effect(() => {
      if (isEditing()) {
        element.setAttribute('data-editing', '');
      } else {
        element.removeAttribute('data-editing');
      }
    });
  };

  return () => {
    // Support function children
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      ref: rootRefCallback,
      'data-editable': '',
      'data-disabled': disabled ? '' : undefined,
      children,
    }) as HTMLElement;
  };
});

// ============================================================================
// Editable Preview
// ============================================================================

export const EditablePreview = defineComponent<EditablePreviewProps>((props) => {
  const context = useEditableContext();

  const handleClick = () => {
    if (!context.disabled) {
      context.startEdit();
    }
  };

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update visibility and content when state changes
    effect(() => {
      const isEditing = context.isEditing();
      const value = context.value();

      // Update visibility
      if (isEditing) {
        element.style.display = 'none';
      } else {
        element.style.display = '';
      }

      // Update text content if no children provided
      if (!props.children) {
        element.textContent = value || context.placeholder;
      }
    });
  };

  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      ref: refCallback,
      'data-editable-preview': '',
      onClick: handleClick,
      tabIndex: context.disabled ? -1 : 0,
      role: 'button',
      'aria-label': 'Click to edit',
      ...rest,
      children, // Let the effect handle content updates
    });
  };
});

// ============================================================================
// Editable Input
// ============================================================================

export const EditableInput = defineComponent<EditableInputProps>((props) => {
  const context = useEditableContext();

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    context.setInputValue(target.value);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      context.submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      context.cancel();
    }
  };

  const handleBlur = () => {
    if (context.submitOnBlur) {
      context.submit();
    }
  };

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLInputElement | null) => {
    if (!element) return;

    // Store ref for focus management
    context.inputRef.current = element;

    // Set up effect to reactively update visibility AND value when state changes
    effect(() => {
      const isEditing = context.isEditing();
      const inputValue = context.inputValue();

      // Always update value to keep it in sync
      element.value = inputValue;

      // Update visibility
      if (!isEditing) {
        element.style.display = 'none';
      } else {
        element.style.display = '';
      }
    });
  };

  return () => {
    const { ...rest } = props;

    return jsx('input', {
      ref: refCallback,
      type: 'text',
      'data-editable-input': '',
      placeholder: context.placeholder,
      disabled: context.disabled,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
      onBlur: handleBlur,
      ...rest,
    });
  };
});

// ============================================================================
// Editable Controls
// ============================================================================

export const EditableControls = defineComponent<EditableControlsProps>((props) => {
  const context = useEditableContext();

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update visibility when editing state changes
    effect(() => {
      const isEditing = context.isEditing();

      if (!isEditing) {
        element.style.display = 'none';
      } else {
        element.style.display = '';
      }
    });
  };

  return () => {
    const { children } = props;

    return jsx('div', {
      ref: refCallback,
      'data-editable-controls': '',
      children,
    });
  };
});

// ============================================================================
// Editable Submit
// ============================================================================

export const EditableSubmit = defineComponent<EditableSubmitProps>((props) => {
  const context = useEditableContext();

  const handleClick = () => {
    context.submit();
  };

  return () => {
    const { children = '✓', ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-editable-submit': '',
      onClick: handleClick,
      disabled: context.disabled,
      'aria-label': 'Submit',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Editable Cancel
// ============================================================================

export const EditableCancel = defineComponent<EditableCancelProps>((props) => {
  const context = useEditableContext();

  const handleClick = () => {
    context.cancel();
  };

  return () => {
    const { children = '×', ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-editable-cancel': '',
      onClick: handleClick,
      disabled: context.disabled,
      'aria-label': 'Cancel',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Editable as any).Preview = EditablePreview;
(Editable as any).Input = EditableInput;
(Editable as any).Controls = EditableControls;
(Editable as any).Submit = EditableSubmit;
(Editable as any).Cancel = EditableCancel;

// ============================================================================
// Export types
// ============================================================================

export type { EditableContextValue };
