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

    checkedSignal.set(nextChecked);
    props.onCheckedChange?.(nextChecked);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled()) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick(e as any);
    }
  };

  const getAriaChecked = () => {
    const checked = checkedSignal();
    if (checked === 'indeterminate') return 'mixed';
    return checked ? 'true' : 'false';
  };

  const getDataState = () => {
    const checked = checkedSignal();
    if (checked === 'indeterminate') return 'indeterminate';
    return checked ? 'checked' : 'unchecked';
  };

  return () =>
    jsx(CheckboxContext.Provider, {
      value: contextValue,
      children: jsx('button', {
        ...props,
        id: checkboxId,
        type: 'button',
        role: 'checkbox',
        'aria-checked': getAriaChecked(),
        'aria-required': props.required ? 'true' : undefined,
        'data-state': getDataState(),
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
                checked: checkedSignal() === true,
                required: props.required,
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

  return () => {
    const checked = checkbox.checked();
    const shouldRender = checked === true || checked === 'indeterminate';

    if (!shouldRender && !props.forceMount) {
      return null;
    }

    return jsx('span', {
      ...props,
      'data-state': checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked',
    });
  };
});

// ============================================================================
// Export sub-components for convenience
// ============================================================================

// Note: Compound component pattern (Checkbox.Indicator)
// is set up in the index.ts exports
