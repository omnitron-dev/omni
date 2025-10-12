/**
 * Switch Primitive
 *
 * An on/off control (like iOS toggle)
 *
 * Based on WAI-ARIA Switch pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/switch/
 */

import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { createRef } from '../core/component/refs.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

/**
 * Switch context
 */
export interface SwitchContextValue {
  checked: () => boolean;
  toggle: () => void;
  disabled: () => boolean;
  required: () => boolean;
  switchId: string;
  thumbId: string;
  name?: string;
  value?: string;
}

// Create context with default implementation
const noop = () => {};
const booleanGetter = () => false;

export const SwitchContext = createContext<SwitchContextValue>(
  {
    checked: booleanGetter,
    toggle: noop,
    disabled: booleanGetter,
    required: booleanGetter,
    switchId: '',
    thumbId: '',
  },
  'Switch'
);

/**
 * Switch props
 */
export interface SwitchProps {
  /**
   * Controlled checked state
   */
  checked?: WritableSignal<boolean>;

  /**
   * Initial checked state
   */
  defaultChecked?: boolean;

  /**
   * Callback when checked state changes
   */
  onCheckedChange?: (checked: boolean) => void;

  /**
   * Whether the switch is disabled
   */
  disabled?: boolean;

  /**
   * Whether the switch is required
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
   * ID for the switch
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

/**
 * Switch component
 *
 * @example
 * ```tsx
 * <Switch defaultChecked={true}>
 *   <Switch.Thumb />
 * </Switch>
 * ```
 */
export const Switch = defineComponent<SwitchProps>((props) => {
  const internalChecked = signal(props.defaultChecked ?? false);
  const checkedSignal = props.checked || internalChecked;

  const disabled = () => !!props.disabled;
  const required = () => !!props.required;

  // Generate stable IDs
  const switchId = props.id || generateId('switch');
  const thumbId = `${switchId}-thumb`;

  const toggle = () => {
    if (disabled()) return;

    const newChecked = !checkedSignal();
    checkedSignal.set(newChecked);
    props.onCheckedChange?.(newChecked);
  };

  const handleClick = () => {
    toggle();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  };

  // Create ref to button element and set up reactive updates
  const buttonRef = createRef<HTMLButtonElement>();

  // Set up ref callback that initializes effects when element is attached
  const refCallback = (element: HTMLButtonElement | null) => {
    buttonRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      // Update reactive attributes
      element.setAttribute('aria-checked', checkedSignal() ? 'true' : 'false');
      element.setAttribute('aria-required', required() ? 'true' : 'false');
      element.setAttribute('data-state', checkedSignal() ? 'checked' : 'unchecked');

      if (disabled()) {
        element.setAttribute('data-disabled', '');
        element.setAttribute('disabled', '');
      } else {
        element.removeAttribute('data-disabled');
        element.removeAttribute('disabled');
      }
    });
  };

  // Context value
  const contextValue: SwitchContextValue = {
    checked: () => checkedSignal(),
    toggle,
    disabled,
    required,
    switchId,
    thumbId,
    name: props.name,
    value: props.value,
  };

  // Provide context during setup so children can access it
  provideContext(SwitchContext, contextValue);

  return () => {
    const {
      children,
      checked: _,
      defaultChecked: __,
      onCheckedChange: ___,
      disabled: ____,
      required: _____,
      name: ______,
      value: _______,
      id: ________,
      ...restProps
    } = props;

    return jsx(SwitchContext.Provider, {
      value: contextValue,
      children: jsx('button', {
        ...restProps,
        ref: refCallback,
        id: switchId,
        type: 'button',
        role: 'switch',
        'aria-checked': checkedSignal() ? 'true' : 'false',
        'aria-required': required() ? 'true' : 'false',
        'data-state': checkedSignal() ? 'checked' : 'unchecked',
        'data-disabled': disabled() ? '' : undefined,
        disabled: disabled() ? true : undefined,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        children: [
          // Hidden input for form integration
          props.name
            ? jsx('input', {
                type: 'checkbox',
                name: props.name,
                value: props.value || 'on',
                checked: checkedSignal(),
                required: required(),
                disabled: disabled(),
                'aria-hidden': 'true',
                tabIndex: -1,
                style: {
                  position: 'absolute',
                  width: '1px',
                  height: '1px',
                  padding: '0',
                  margin: '-1px',
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  borderWidth: '0',
                },
              })
            : null,
          children,
        ],
      }),
    });
  };
});

/**
 * Switch thumb props
 */
export interface SwitchThumbProps {
  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Switch thumb component - moving thumb element
 */
export const SwitchThumb = defineComponent<SwitchThumbProps>((props) => {
  // Create ref to span element
  const thumbRef = createRef<HTMLSpanElement>();

  // Set up ref callback that initializes effects when element is attached
  const refCallback = (element: HTMLSpanElement | null) => {
    thumbRef.current = element || undefined;
    if (!element) return;

    // The parent switch should be attached by the time this ref is called
    // Look for the parent switch element
    let switchElement: HTMLElement | null = element.parentElement;
    while (switchElement && switchElement.getAttribute('role') !== 'switch') {
      switchElement = switchElement.parentElement;
    }

    if (!switchElement) {
      // Parent not found yet, element might not be attached
      // Try again after a microtask
      queueMicrotask(() => refCallback(element));
      return;
    }

    // Set up function to mirror parent switch's state
    const updateFromParent = () => {
      if (!switchElement) return;

      const checked = switchElement.getAttribute('aria-checked') === 'true';
      const disabled = switchElement.hasAttribute('data-disabled');

      element.setAttribute('data-state', checked ? 'checked' : 'unchecked');
      if (disabled) {
        element.setAttribute('data-disabled', '');
      } else {
        element.removeAttribute('data-disabled');
      }
    };

    // Set initial state
    updateFromParent();

    // Set up MutationObserver to watch for changes
    const observer = new MutationObserver(updateFromParent);
    observer.observe(switchElement, {
      attributes: true,
      attributeFilter: ['aria-checked', 'data-disabled'],
    });
  };

  return () => {
    const { ...restProps } = props;

    // Get context for id, even though it might be default
    // The id doesn't change so it's okay
    const ctx = useContext(SwitchContext);

    return jsx('span', {
      ...restProps,
      ref: refCallback,
      id: ctx.thumbId,
      // Don't set initial attributes here - let the effect handle all updates
      // to ensure they use the correct context values
    });
  };
});

// Attach sub-component to Switch
(Switch as any).Thumb = SwitchThumb;
