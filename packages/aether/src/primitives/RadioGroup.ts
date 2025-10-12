/**
 * Radio Group Primitive
 *
 * A set of radio buttons where only one can be selected.
 *
 * Based on WAI-ARIA Radio Group pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { createRef } from '../core/component/refs.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface RadioGroupProps {
  /**
   * Controlled selected value
   */
  value?: WritableSignal<string | undefined>;

  /**
   * Initial value (uncontrolled)
   */
  defaultValue?: string;

  /**
   * Callback when value changes
   */
  onValueChange?: (value: string) => void;

  /**
   * Disable all items
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
   * Orientation for keyboard navigation
   * @default 'vertical'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Loop focus with arrow keys
   * @default true
   */
  loop?: boolean;

  /**
   * Children
   */
  children: any;
}

export interface RadioGroupItemProps {
  /**
   * Item value
   */
  value: string;

  /**
   * Disable this item
   */
  disabled?: boolean;

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

export interface RadioGroupIndicatorProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface RadioGroupContextValue {
  value: () => string | undefined;
  setValue: (value: string) => void;
  disabled: boolean;
  required: boolean;
  name?: string;
  orientation: 'horizontal' | 'vertical';
  loop: boolean;
  groupId: string;
}

export interface RadioGroupItemContextValue {
  value: string;
  checked: () => boolean;
  disabled: boolean;
  itemId: string;
}

const noop = () => {};
const noopGetter = () => undefined;

export const RadioGroupContext = createContext<RadioGroupContextValue>({
  value: noopGetter,
  setValue: noop,
  disabled: false,
  required: false,
  name: undefined,
  orientation: 'vertical',
  loop: true,
  groupId: '',
}, 'RadioGroup');

export const RadioGroupItemContext = createContext<RadioGroupItemContextValue>({
  value: '',
  checked: () => false,
  disabled: false,
  itemId: '',
}, 'RadioGroupItem');

// ============================================================================
// Components
// ============================================================================

/**
 * RadioGroup root component
 *
 * @example
 * ```tsx
 * <RadioGroup value={selectedValue} onValueChange={setSelectedValue}>
 *   <RadioGroup.Item value="option1" id="opt1">
 *     <RadioGroup.Indicator />
 *   </RadioGroup.Item>
 *   <label htmlFor="opt1">Option 1</label>
 * </RadioGroup>
 * ```
 */
export const RadioGroup = defineComponent<RadioGroupProps>((props) => {
  const groupId = generateId();

  // Use controlled or uncontrolled value
  const internalValue = signal<string | undefined>(props.defaultValue);
  const valueSignal = props.value || internalValue;

  const setValue = (value: string) => {
    // Only update internal signal if uncontrolled (following Checkbox pattern)
    if (!props.value) {
      valueSignal.set(value);
    }
    // Always call callback (for both controlled and uncontrolled)
    props.onValueChange?.(value);
  };

  const orientation = () => props.orientation || 'vertical';
  const loop = () => props.loop !== false;
  const disabled = () => !!props.disabled;
  const required = () => !!props.required;

  const contextValue: RadioGroupContextValue = {
    value: () => valueSignal(),
    setValue,
    disabled: disabled(),
    required: required(),
    name: props.name,
    orientation: orientation(),
    loop: loop(),
    groupId,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(RadioGroupContext, contextValue);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled()) return;

    const isHorizontal = orientation() === 'horizontal';
    const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';

    if (e.key !== nextKey && e.key !== prevKey && e.key !== 'Home' && e.key !== 'End') {
      return;
    }

    e.preventDefault();

    const target = e.currentTarget as HTMLElement;
    const items = Array.from(
      target.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')
    );

    if (items.length === 0) return;

    // Find currently focused radio button using document.activeElement
    // (e.target may be the group container when event is dispatched on it)
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex = currentIndex;

    if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = items.length - 1;
    } else if (e.key === nextKey) {
      nextIndex = currentIndex + 1;
      if (nextIndex >= items.length) {
        nextIndex = loop() ? 0 : currentIndex;
      }
    } else if (e.key === prevKey) {
      nextIndex = currentIndex - 1;
      if (nextIndex < 0) {
        nextIndex = loop() ? items.length - 1 : currentIndex;
      }
    }

    if (nextIndex !== currentIndex) {
      items[nextIndex]?.focus();
      const value = items[nextIndex]?.getAttribute('data-value');
      if (value) {
        setValue(value);
      }
    }
  };

  // Set up ref callback for hidden input
  const hiddenInputRef = createRef<HTMLInputElement>();
  const hiddenInputRefCallback = (element: HTMLInputElement | null) => {
    hiddenInputRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update hidden input value when signal changes
    effect(() => {
      const value = valueSignal();
      element.value = value || '';
    });
  };

  return () => {
    // Evaluate function children (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    // Context provided via provideContext, no Provider needed
    return jsx('div', {
      id: groupId,
      role: 'radiogroup',
      'aria-required': required() ? 'true' : undefined,
      'aria-orientation': orientation(),
      'data-orientation': orientation(),
      'data-disabled': disabled() ? '' : undefined,
      onKeyDown: handleKeyDown,
      children: [
        // Hidden input for form integration
        props.name
          ? jsx('input', {
              ref: hiddenInputRefCallback,
              type: 'hidden',
              name: props.name,
              value: valueSignal() || '',
              'aria-hidden': 'true',
              style: {
                position: 'absolute',
                opacity: 0,
                pointerEvents: 'none',
                margin: 0,
                width: '1px',
                height: '1px',
              },
            })
          : null,
        children,
      ],
    });
  };
});

/**
 * RadioGroup Item component
 *
 * @example
 * ```tsx
 * <RadioGroup.Item value="option1" id="opt1">
 *   <RadioGroup.Indicator />
 * </RadioGroup.Item>
 * ```
 */
export const RadioGroupItem = defineComponent<RadioGroupItemProps>((props) => {
  const group = useContext(RadioGroupContext);
  const itemId = props.id || generateId();

  const checked = computed(() => group.value() === props.value);
  const disabled = () => props.disabled || group.disabled;

  const buttonRef = createRef<HTMLButtonElement>();

  const contextValue: RadioGroupItemContextValue = {
    value: props.value,
    checked: () => checked(),
    disabled: disabled(),
    itemId,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(RadioGroupItemContext, contextValue);

  const handleClick = () => {
    if (disabled()) return;
    group.setValue(props.value);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled()) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      group.setValue(props.value);
    }
  };

  // Set up ref callback for button
  const buttonRefCallback = (element: HTMLButtonElement | null) => {
    buttonRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      const isChecked = checked();
      const isDisabled = disabled();

      element.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      element.setAttribute('data-state', isChecked ? 'checked' : 'unchecked');
      element.setAttribute('tabindex', isChecked ? '0' : '-1');

      if (isDisabled) {
        element.setAttribute('data-disabled', '');
        element.setAttribute('disabled', '');
      } else {
        element.removeAttribute('data-disabled');
        element.removeAttribute('disabled');
      }
    });
  };

  return () => {
    // Evaluate function children (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { value: _, disabled: __, id: ___, children: ____, ...restProps } = props;

    // Context provided via provideContext, no Provider needed
    return jsx('button', {
      ...restProps,
      ref: buttonRefCallback,
      id: itemId,
      type: 'button',
      role: 'radio',
      'aria-checked': checked() ? 'true' : 'false',
      'data-state': checked() ? 'checked' : 'unchecked',
      'data-value': props.value,
      'data-disabled': disabled() ? '' : undefined,
      disabled: disabled(),
      tabIndex: checked() ? 0 : -1,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
  };
});

/**
 * RadioGroup Indicator component
 *
 * Only renders when item is checked.
 *
 * @example
 * ```tsx
 * <RadioGroup.Indicator>
 *   <CheckIcon />
 * </RadioGroup.Indicator>
 * ```
 */
export const RadioGroupIndicator = defineComponent<RadioGroupIndicatorProps>((props) => {
  const item = useContext(RadioGroupItemContext);

  // Variables to manage DOM manipulation
  let indicatorElement: HTMLSpanElement | null = null;
  let placeholder: Comment | null = null;
  let parentContainer: HTMLElement | null = null;

  // Set up ref callback with reactive effect to manage DOM presence
  const refCallback = (container: HTMLSpanElement | null) => {
    if (!container) return;

    parentContainer = container;
    placeholder = document.createComment('RadioGroupIndicator');

    // Evaluate function children once
    const children = typeof props.children === 'function' ? props.children() : props.children;

    // Create the actual indicator element
    indicatorElement = jsx('span', {
      ...props,
      'data-state': 'checked',
      children,
    }) as HTMLSpanElement;

    // Set up effect to add/remove element from DOM when checked state changes
    effect(() => {
      const checked = item.checked();

      if (checked) {
        // Add element to DOM if checked
        if (indicatorElement && parentContainer && !indicatorElement.parentNode) {
          // Remove placeholder if present
          if (placeholder?.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
          }
          // Add indicator
          parentContainer.appendChild(indicatorElement);
        }
        // Update data-state
        indicatorElement?.setAttribute('data-state', 'checked');
      } else {
        // Remove element from DOM and add placeholder
        if (indicatorElement && parentContainer) {
          if (indicatorElement.parentNode) {
            indicatorElement.parentNode.removeChild(indicatorElement);
          }
          // Add placeholder to keep position
          if (!placeholder?.parentNode && parentContainer) {
            parentContainer.appendChild(placeholder!);
          }
        }
      }
    });
  };

  return () => 
    // Return a container span that will hold the indicator or placeholder
     jsx('span', {
      ref: refCallback,
      style: { display: 'contents' }, // Don't affect layout
    })
  ;
});

// ============================================================================
// Export sub-components for convenience
// ============================================================================

// Note: Compound component pattern (RadioGroup.Item, RadioGroup.Indicator)
// is set up in the index.ts exports
