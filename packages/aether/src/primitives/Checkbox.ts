/**
 * Checkbox Primitive
 *
 * A checkbox input with accessibility and indeterminate state support.
 *
 * Based on WAI-ARIA Checkbox pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { createRef } from '../core/component/refs.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export type CheckedState = boolean | 'indeterminate';

export interface CheckboxProps {
  /**
   * Controlled checked state
   */
  checked?: WritableSignal<CheckedState>;

  /**
   * Initial checked state (uncontrolled)
   */
  defaultChecked?: CheckedState;

  /**
   * Callback when checked state changes
   */
  onCheckedChange?: (checked: CheckedState) => void;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Required for forms
   */
  required?: boolean;

  /**
   * Form field name
   */
  name?: string;

  /**
   * Form field value
   */
  value?: string;

  /**
   * ID for label association
   */
  id?: string;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface CheckboxIndicatorProps {
  /**
   * Children (typically an icon)
   */
  children?: any;

  /**
   * Force mount even when unchecked (for animations)
   */
  forceMount?: boolean;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface CheckboxContextValue {
  checked: () => CheckedState;
  disabled: boolean;
  checkboxId: string;
}

const noop = () => false as CheckedState;

export const CheckboxContext = createContext<CheckboxContextValue>({
  checked: noop,
  disabled: false,
  checkboxId: '',
}, 'Checkbox');

// ============================================================================
// Components
// ============================================================================

/**
 * Checkbox root component
 *
 * @example
 * ```tsx
 * <Checkbox checked={isChecked} onCheckedChange={setIsChecked}>
 *   <Checkbox.Indicator>
 *     <CheckIcon />
 *   </Checkbox.Indicator>
 * </Checkbox>
 * ```
 */
export const Checkbox = defineComponent<CheckboxProps>((props) => {
  const checkboxId = props.id || generateId();

  // Use controlled or uncontrolled checked state
  const internalChecked = signal<CheckedState>(props.defaultChecked ?? false);
  const checkedSignal = props.checked || internalChecked;

  const disabled = () => !!props.disabled;
  const required = () => !!props.required;

  // Create refs
  const buttonRef = createRef<HTMLButtonElement>();
  const hiddenInputRef = createRef<HTMLInputElement>();

  const contextValue: CheckboxContextValue = {
    checked: () => checkedSignal(),
    disabled: disabled(),
    checkboxId,
  };

  const handleClick = (e: MouseEvent) => {
    if (disabled()) {
      e.preventDefault();
      return;
    }

    const currentChecked = checkedSignal();
    const nextChecked = currentChecked === 'indeterminate' ? true : !currentChecked;

    // Only update internal signal if uncontrolled
    if (!props.checked) {
      checkedSignal.set(nextChecked);
    }

    // Always call callback (for both controlled and uncontrolled)
    props.onCheckedChange?.(nextChecked);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled()) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick(e as any);
    }
  };

  // Set up ref callback for button
  const buttonRefCallback = (element: HTMLButtonElement | null) => {
    buttonRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      const checked = checkedSignal();
      const ariaChecked = checked === 'indeterminate' ? 'mixed' : checked ? 'true' : 'false';
      const dataState = checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked';

      element.setAttribute('aria-checked', ariaChecked);
      element.setAttribute('data-state', dataState);

      if (required()) {
        element.setAttribute('aria-required', 'true');
      } else {
        element.removeAttribute('aria-required');
      }

      if (disabled()) {
        element.setAttribute('data-disabled', '');
        element.setAttribute('disabled', '');
      } else {
        element.removeAttribute('data-disabled');
        element.removeAttribute('disabled');
      }
    });
  };

  // Set up ref callback for hidden input
  const hiddenInputRefCallback = (element: HTMLInputElement | null) => {
    hiddenInputRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update hidden input checked state
    effect(() => {
      const checked = checkedSignal();
      element.checked = checked === true;
    });
  };

  return () =>
    jsx(CheckboxContext.Provider, {
      value: contextValue,
      children: jsx('button', {
        ...props,
        ref: buttonRefCallback,
        id: checkboxId,
        type: 'button',
        role: 'checkbox',
        'aria-checked': checkedSignal() === 'indeterminate' ? 'mixed' : checkedSignal() ? 'true' : 'false',
        'aria-required': required() ? 'true' : undefined,
        'data-state': checkedSignal() === 'indeterminate' ? 'indeterminate' : checkedSignal() ? 'checked' : 'unchecked',
        'data-disabled': disabled() ? '' : undefined,
        disabled: disabled(),
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        children: [
          // Hidden input for form integration
          props.name
            ? jsx('input', {
                ref: hiddenInputRefCallback,
                type: 'checkbox',
                name: props.name,
                value: props.value || 'on',
                checked: checkedSignal() === true,
                required: required(),
                disabled: disabled(),
                'aria-hidden': 'true',
                tabIndex: -1,
                style: {
                  position: 'absolute',
                  opacity: 0,
                  pointerEvents: 'none',
                  margin: 0,
                  width: '1px',
                  height: '1px',
                },
                // Prevent default checkbox behavior
                onClick: (e: Event) => e.preventDefault(),
              })
            : null,
          props.children,
        ],
      }),
    });
});

/**
 * Checkbox Indicator component
 *
 * Only renders when checkbox is checked or indeterminate.
 *
 * @example
 * ```tsx
 * <Checkbox.Indicator>
 *   <CheckIcon />
 * </Checkbox.Indicator>
 * ```
 */
export const CheckboxIndicator = defineComponent<CheckboxIndicatorProps>((props) => {
  const checkbox = useContext(CheckboxContext);

  // Create ref for the indicator span
  const indicatorRef = createRef<HTMLSpanElement>();

  // Set up ref callback
  const refCallback = (element: HTMLSpanElement | null) => {
    indicatorRef.current = element || undefined;
    if (!element) return;

    // Find the parent checkbox button
    let checkboxElement: HTMLElement | null = element.parentElement;
    while (checkboxElement && checkboxElement.getAttribute('role') !== 'checkbox') {
      checkboxElement = checkboxElement.parentElement;
    }

    if (!checkboxElement) {
      // Parent not found yet, try again after microtask
      queueMicrotask(() => refCallback(element));
      return;
    }

    // Set up function to update indicator based on checkbox state
    const updateFromCheckbox = () => {
      if (!checkboxElement) return;

      const ariaChecked = checkboxElement.getAttribute('aria-checked');
      const checked = ariaChecked === 'true' ? true : ariaChecked === 'mixed' ? 'indeterminate' : false;
      const shouldShow = checked === true || checked === 'indeterminate';

      // Update data-state
      const dataState = checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked';
      element.setAttribute('data-state', dataState);

      // Control visibility
      if (!props.forceMount) {
        element.style.display = shouldShow ? '' : 'none';
      }
    };

    // Set initial state
    updateFromCheckbox();

    // Watch for checkbox state changes
    const observer = new MutationObserver(updateFromCheckbox);
    observer.observe(checkboxElement, {
      attributes: true,
      attributeFilter: ['aria-checked'],
    });
  };

  return () => {
    const checked = checkbox.checked();
    const shouldRender = checked === true || checked === 'indeterminate';

    const dataState = checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked';

    // Always render the span, but control visibility with display style
    // This ensures the element exists in the DOM and can be updated reactively
    return jsx('span', {
      ...props,
      ref: refCallback,
      'data-state': dataState,
      style: {
        ...((props.style as any) || {}),
        display: (shouldRender || props.forceMount) ? ((props.style as any)?.display || '') : 'none',
      },
    });
  };
});

// ============================================================================
// Export sub-components for convenience
// ============================================================================

// Attach sub-component to Checkbox
(Checkbox as any).Indicator = CheckboxIndicator;
