/**
 * Form Primitives - Headless form composition with accessibility
 *
 * Provides ARIA associations and accessibility for forms.
 * Does NOT include state management or validation - use createForm() for that.
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/forms/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface FormRootProps {
  children?: any;
}

export interface FormFieldProps {
  name: string;
  children?: any;
}

export interface FormLabelProps {
  children?: any;
  htmlFor?: string;
}

export interface FormControlProps {
  /**
   * Merge props into child element instead of wrapping
   * @default false
   */
  asChild?: boolean;
  children?: any;
}

export interface FormMessageProps {
  children?: any;
  forceMount?: boolean;
}

export interface FormDescriptionProps {
  children?: any;
}

// ============================================================================
// Context
// ============================================================================

interface FormFieldContextValue {
  name: string;
  id: string;
  labelId: string;
  controlId: string;
  messageId: string;
  descriptionId: string;
  hasError: WritableSignal<boolean>;
  isRequired: WritableSignal<boolean>;
  isDisabled: WritableSignal<boolean>;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null, 'FormField');

function useFormField(): FormFieldContextValue {
  const context = useContext(FormFieldContext);
  if (!context) {
    throw new Error('Form components must be used within <FormField>');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * FormRoot - Root container for form primitives
 *
 * Provides base context for form accessibility.
 */
export const FormRoot = defineComponent<FormRootProps>((props) => () => props.children);

/**
 * FormField - Field wrapper with context
 *
 * Provides field context including IDs for ARIA associations.
 *
 * @example
 * ```tsx
 * <FormField name="email">
 *   <FormLabel>Email</FormLabel>
 *   <FormControl>
 *     <input type="email" />
 *   </FormControl>
 *   <FormMessage>Error message</FormMessage>
 * </FormField>
 * ```
 */
export const FormField = defineComponent<FormFieldProps>((props) => {
  const fieldId = generateId();
  const labelId = `${fieldId}-label`;
  const controlId = `${fieldId}-control`;
  const messageId = `${fieldId}-message`;
  const descriptionId = `${fieldId}-description`;

  const contextValue: FormFieldContextValue = {
    name: props.name,
    id: fieldId,
    labelId,
    controlId,
    messageId,
    descriptionId,
    hasError: signal(false),
    isRequired: signal(false),
    isDisabled: signal(false),
  };

  // Provide context during setup
  provideContext(FormFieldContext, contextValue);

  return () =>
    jsx('div', {
      'data-field': props.name,
      'data-field-id': fieldId,
      children: props.children,
    });
});

/**
 * FormLabel - Accessible label for form control
 *
 * Automatically associates with FormControl via aria-labelledby.
 *
 * @example
 * ```tsx
 * <FormLabel>Email Address</FormLabel>
 * ```
 */
export const FormLabel = defineComponent<FormLabelProps>((props) => {
  const field = useFormField();

  return () =>
    jsx('label', {
      id: field.labelId,
      htmlFor: props.htmlFor || field.controlId,
      'data-disabled': field.isDisabled() ? '' : undefined,
      'data-required': field.isRequired() ? '' : undefined,
      children: props.children,
    });
});

/**
 * FormControl - Wrapper for form input elements
 *
 * Clones child element and adds accessibility attributes.
 *
 * @example
 * ```tsx
 * <FormControl>
 *   <input type="text" value={value()} onInput={handleInput} />
 * </FormControl>
 * ```
 *
 * @example With asChild
 * ```tsx
 * <FormControl asChild>
 *   <Select bind:value={form.values.country}>
 *     <Select.Trigger>
 *       <Select.Value placeholder="Select..." />
 *     </Select.Trigger>
 *   </Select>
 * </FormControl>
 * ```
 */
export const FormControl = defineComponent<FormControlProps>((props) => {
  const field = useFormField();

  return () => {
    const { asChild = false, children } = props;

    // Build accessibility attributes
    const accessibilityProps = {
      id: field.controlId,
      name: field.name,
      'aria-labelledby': field.labelId,
      'aria-describedby': field.hasError() ? field.messageId : field.descriptionId,
      'aria-invalid': field.hasError() ? 'true' : undefined,
      'aria-required': field.isRequired() ? 'true' : undefined,
      'aria-disabled': field.isDisabled() ? 'true' : undefined,
    };

    // If asChild, merge props into child element
    if (asChild) {
      // Clone child with accessibility attributes
      if (children && typeof children === 'object' && 'type' in children) {
        const enhancedChild = {
          ...children,
          props: {
            ...(children.props || {}),
            ...accessibilityProps,
          },
        };
        return enhancedChild;
      }

      // If asChild is true but no valid child, throw error
      throw new Error('FormControl with asChild requires exactly one child element');
    }

    // Default behavior: wrap child with accessibility attributes
    if (children && typeof children === 'object' && 'type' in children) {
      const enhancedChild = {
        ...children,
        props: {
          ...(children.props || {}),
          ...accessibilityProps,
        },
      };
      return enhancedChild;
    }

    return children;
  };
});

/**
 * FormMessage - Error or status message
 *
 * Automatically associated with control via aria-describedby when error is present.
 *
 * @example
 * ```tsx
 * {error() && (
 *   <FormMessage>{error()}</FormMessage>
 * )}
 * ```
 */
export const FormMessage = defineComponent<FormMessageProps>((props) => {
  const field = useFormField();

  return () => {
    const hasChildren = !!props.children;

    // Update field error state
    field.hasError.set(hasChildren);

    if (!hasChildren && !props.forceMount) {
      return null;
    }

    return jsx('div', {
      id: field.messageId,
      role: 'alert',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-field-message': '',
      children: props.children,
    });
  };
});

/**
 * FormDescription - Help text for form field
 *
 * Automatically associated with control via aria-describedby when no error is present.
 *
 * @example
 * ```tsx
 * <FormDescription>
 *   Enter your email address to receive updates.
 * </FormDescription>
 * ```
 */
export const FormDescription = defineComponent<FormDescriptionProps>((props) => {
  const field = useFormField();

  return () =>
    jsx('div', {
      id: field.descriptionId,
      'data-field-description': '',
      children: props.children,
    });
});

// ============================================================================
// Compound Component Pattern
// ============================================================================

export const Form = Object.assign(FormRoot, {
  Field: FormField,
  Label: FormLabel,
  Control: FormControl,
  Message: FormMessage,
  Description: FormDescription,
});

// Export context type for advanced use cases
export type { FormFieldContextValue };
