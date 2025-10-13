/**
 * ToggleGroup - A group of toggle buttons with single or multiple selection
 *
 * Features:
 * - Single or multiple selection modes
 * - Keyboard navigation (arrows, Home, End)
 * - Disabled state support
 * - Controlled and uncontrolled modes
 * - ARIA toolbar/radiogroup pattern
 * - Horizontal and vertical orientation
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { computed, effect } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';
import { useControlledState } from '../utils/controlled-state.js';

// ============================================================================
// Types
// ============================================================================

export interface ToggleGroupProps {
  /**
   * Controlled value (single mode: string, multiple mode: string[])
   * Pattern 19: Accepts WritableSignal<T> | T
   */
  value?: WritableSignal<string | string[]> | string | string[];
  /** Value change callback */
  onValueChange?: (value: string | string[]) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string | string[];
  /** Selection type: single or multiple */
  type?: 'single' | 'multiple';
  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Whether the group is disabled */
  disabled?: boolean;
  /** Whether to loop keyboard navigation */
  loop?: boolean;
  /** Whether selection is required (single mode only) */
  required?: boolean;
  /** Children - can be array or function returning array */
  children?: any | (() => any);
}

export interface ToggleGroupItemProps {
  /** Unique value for this item */
  value: string;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface ToggleGroupContextValue {
  /** Current value(s) */
  value: Signal<string | string[]>;
  /** Selection type */
  type: 'single' | 'multiple';
  /** Orientation */
  orientation: 'horizontal' | 'vertical';
  /** Disabled state */
  disabled: boolean;
  /** Required state */
  required: boolean;
  /** Check if value is selected */
  isSelected: (value: string) => boolean;
  /** Toggle a value */
  toggleValue: (value: string) => void;
  /** Register an item */
  registerItem: (value: string, element: HTMLElement) => void;
  /** Unregister an item */
  unregisterItem: (value: string) => void;
  /** Navigate to next item */
  navigateNext: () => void;
  /** Navigate to previous item */
  navigatePrevious: () => void;
  /** Navigate to first item */
  navigateFirst: () => void;
  /** Navigate to last item */
  navigateLast: () => void;
}

// ============================================================================
// Context
// ============================================================================

const noop = () => {};
const noopBool = () => false;
const noopSignal = computed(() => '');

const defaultContextValue: ToggleGroupContextValue = {
  value: noopSignal,
  type: 'single',
  orientation: 'horizontal',
  disabled: false,
  required: false,
  isSelected: noopBool,
  toggleValue: noop,
  registerItem: noop,
  unregisterItem: noop,
  navigateNext: noop,
  navigatePrevious: noop,
  navigateFirst: noop,
  navigateLast: noop,
};

const ToggleGroupContext = createContext<ToggleGroupContextValue>(defaultContextValue, 'ToggleGroup');

const useToggleGroupContext = (): ToggleGroupContextValue => useContext(ToggleGroupContext);

// ============================================================================
// ToggleGroup Root
// ============================================================================

export const ToggleGroup = defineComponent<ToggleGroupProps>((props) => {
  const type = props.type ?? 'single';
  const orientation = props.orientation ?? 'horizontal';
  const disabled = props.disabled ?? false;
  const required = props.required ?? false;
  const loop = props.loop ?? true;

  // Pattern 19: Use useControlledState for flexible value handling
  const defaultValue = props.defaultValue ?? (type === 'single' ? '' : []);
  const [currentValue, setValue] = useControlledState<string | string[]>(
    props.value,
    defaultValue,
    props.onValueChange
  );

  // Items registry
  const items = new Map<string, HTMLElement>();
  const itemOrder: string[] = [];

  const isSelected = (value: string): boolean => {
    const current = currentValue();
    if (type === 'single') {
      return current === value;
    } else {
      return Array.isArray(current) && current.includes(value);
    }
  };

  const toggleValue = (value: string) => {
    if (disabled) return;

    const current = currentValue();

    if (type === 'single') {
      // In single mode, toggle off if required=false
      if (current === value && !required) {
        setValue('');
      } else {
        setValue(value);
      }
    } else {
      // In multiple mode, toggle presence in array
      const currentArray = Array.isArray(current) ? current : [];
      if (currentArray.includes(value)) {
        setValue(currentArray.filter((v) => v !== value));
      } else {
        setValue([...currentArray, value]);
      }
    }
  };

  const registerItem = (value: string, element: HTMLElement) => {
    items.set(value, element);
    if (!itemOrder.includes(value)) {
      itemOrder.push(value);
    }
  };

  const unregisterItem = (value: string) => {
    items.delete(value);
    const index = itemOrder.indexOf(value);
    if (index !== -1) {
      itemOrder.splice(index, 1);
    }
  };

  const navigateNext = () => {
    const focusedValue = document.activeElement?.getAttribute('data-value');
    if (!focusedValue) return;

    const currentIndex = itemOrder.indexOf(focusedValue as string);
    if (currentIndex === -1) return;

    // Keep looking for next non-disabled item
    let nextIndex = currentIndex + 1;
    let attempts = 0;
    const maxAttempts = itemOrder.length;

    while (attempts < maxAttempts) {
      if (nextIndex >= itemOrder.length) {
        if (loop) nextIndex = 0;
        else return;
      }

      const nextValue = itemOrder[nextIndex];
      const nextElement = items.get(nextValue as string);
      if (nextElement && !(nextElement as HTMLButtonElement).disabled) {
        nextElement.focus();
        return;
      }

      nextIndex++;
      attempts++;
    }
  };

  const navigatePrevious = () => {
    const focusedValue = document.activeElement?.getAttribute('data-value');
    if (!focusedValue) return;

    const currentIndex = itemOrder.indexOf(focusedValue as string);
    if (currentIndex === -1) return;

    // Keep looking for previous non-disabled item
    let prevIndex = currentIndex - 1;
    let attempts = 0;
    const maxAttempts = itemOrder.length;

    while (attempts < maxAttempts) {
      if (prevIndex < 0) {
        if (loop) prevIndex = itemOrder.length - 1;
        else return;
      }

      const prevValue = itemOrder[prevIndex];
      const prevElement = items.get(prevValue as string);
      if (prevElement && !(prevElement as HTMLButtonElement).disabled) {
        prevElement.focus();
        return;
      }

      prevIndex--;
      attempts++;
    }
  };

  const navigateFirst = () => {
    if (itemOrder.length === 0) return;
    const firstValue = itemOrder[0];
    const firstElement = items.get(firstValue as string);
    if (firstElement && !(firstElement as HTMLButtonElement).disabled) {
      firstElement.focus();
    }
  };

  const navigateLast = () => {
    if (itemOrder.length === 0) return;
    const lastValue = itemOrder[itemOrder.length - 1];
    const lastElement = items.get(lastValue as string);
    if (lastElement && !(lastElement as HTMLButtonElement).disabled) {
      lastElement.focus();
    }
  };

  const contextValue: ToggleGroupContextValue = {
    value: computed(() => currentValue()),
    type,
    orientation,
    disabled,
    required,
    isSelected,
    toggleValue,
    registerItem,
    unregisterItem,
    navigateNext,
    navigatePrevious,
    navigateFirst,
    navigateLast,
  };

  // CRITICAL: Provide context in setup so children can access it immediately
  provideContext(ToggleGroupContext, contextValue);

  const handleKeyDown = (e: KeyboardEvent) => {
    const isHorizontal = orientation === 'horizontal';
    const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';

    if (e.key === nextKey) {
      e.preventDefault();
      navigateNext();
    } else if (e.key === prevKey) {
      e.preventDefault();
      navigatePrevious();
    } else if (e.key === 'Home') {
      e.preventDefault();
      navigateFirst();
    } else if (e.key === 'End') {
      e.preventDefault();
      navigateLast();
    }
  };

  return () => {
    // Call children if it's a function (lazy evaluation for correct context)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    // Extract known props to avoid spreading them
    const {
      value: _value,
      onValueChange: _onValueChange,
      defaultValue: _defaultValue,
      type: _type,
      orientation: _orientation,
      disabled: _disabled,
      loop: _loop,
      required: _required,
      children: _children,
      ...rest
    } = props;

    return jsx('div', {
      'data-toggle-group': '',
      'data-orientation': orientation,
      'data-disabled': disabled ? '' : undefined,
      role: type === 'single' ? 'radiogroup' : 'group',
      'aria-orientation': orientation,
      onKeyDown: handleKeyDown,
      ...rest, // Forward custom props like class, data-testid, etc.
      children,
    });
  };
});

// ============================================================================
// ToggleGroup Item
// ============================================================================

export const ToggleGroupItem = defineComponent<ToggleGroupItemProps>((props) => {
  // Get context in setup - now works because parent uses provideContext in setup
  const context = useToggleGroupContext();
  const itemDisabled = props.disabled ?? context.disabled;

  const buttonRef: { current: HTMLButtonElement | null } = { current: null };

  const handleClick = () => {
    if (!itemDisabled) {
      context.toggleValue(props.value);
    }
  };

  return () => {
    const { value, _disabled, children, ...rest } = props;

    // Check if selected
    const isSelected = context.isSelected(value);

    // Create button element with current values
    const button = jsx('button', {
      ref: buttonRef,
      type: 'button',
      role: context.type === 'single' ? 'radio' : 'button',
      'aria-checked': context.type === 'single' ? (isSelected ? 'true' : 'false') : undefined,
      'aria-pressed': context.type === 'multiple' ? (isSelected ? 'true' : 'false') : undefined,
      'data-state': isSelected ? 'on' : 'off',
      'data-value': value,
      'data-disabled': itemDisabled ? '' : undefined,
      disabled: itemDisabled,
      onClick: handleClick,
      tabIndex: isSelected ? 0 : -1,
      ...rest,
      children,
    }) as HTMLButtonElement;

    // Register/unregister on mount/unmount
    if (buttonRef.current) {
      context.registerItem(value, buttonRef.current);
    } else {
      context.unregisterItem(value);
    }

    // Reactive updates for selection state
    effect(() => {
      // Call isSelected directly in effect for proper signal tracking
      const isSelectedInEffect = context.isSelected(value);

      // Update ARIA attributes
      if (context.type === 'single') {
        button.setAttribute('aria-checked', isSelectedInEffect ? 'true' : 'false');
      } else {
        button.setAttribute('aria-pressed', isSelectedInEffect ? 'true' : 'false');
      }

      // Update data-state
      button.setAttribute('data-state', isSelectedInEffect ? 'on' : 'off');

      // Update tabIndex for roving tabindex pattern
      button.tabIndex = isSelectedInEffect ? 0 : -1;
    });

    return button;
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(ToggleGroup as any).Item = ToggleGroupItem;

// ============================================================================
// Export types
// ============================================================================

export type { ToggleGroupContextValue };
