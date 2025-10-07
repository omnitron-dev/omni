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
import { createContext, useContext } from '../core/component/context.js';
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

export const SwitchContext = createContext<SwitchContextValue>({
  checked: booleanGetter,
  toggle: noop,
  disabled: booleanGetter,
  required: booleanGetter,
  switchId: '',
  thumbId: '',
}, 'Switch');

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

  const disabled = signal(props.disabled ?? false);
  const required = signal(props.required ?? false);

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

  // Context value
  const contextValue: SwitchContextValue = {
    checked: () => checkedSignal(),
    toggle,
    disabled: () => disabled(),
    required: () => required(),
    switchId,
    thumbId,
    name: props.name,
    value: props.value,
  };

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
        id: switchId,
        type: 'button',
        role: 'switch',
        'aria-checked': checkedSignal(),
        'aria-required': required(),
        'data-state': checkedSignal() ? 'checked' : 'unchecked',
        'data-disabled': disabled() ? '' : undefined,
        disabled: disabled(),
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
                'aria-hidden': true,
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
  const ctx = useContext(SwitchContext);

  return () => {
    const { ...restProps } = props;

    return jsx('span', {
      ...restProps,
      id: ctx.thumbId,
      'data-state': ctx.checked() ? 'checked' : 'unchecked',
      'data-disabled': ctx.disabled() ? '' : undefined,
    });
  };
});

// Attach sub-component to Switch
(Switch as any).Thumb = SwitchThumb;
