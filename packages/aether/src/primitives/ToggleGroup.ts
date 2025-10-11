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
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed, effect } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface ToggleGroupProps {
  /** Controlled value (single mode: string, multiple mode: string[]) */
  value?: string | string[];
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
  /** Children */
  children?: any;
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

// Global context signal for late binding (Pattern 1 from audit)
const globalContextSignal = signal<ToggleGroupContextValue | null>(null);

const noop = () => {};

const defaultContextValue: ToggleGroupContextValue = {
  value: computed(() => globalContextSignal()?.value() ?? ''),
  get type() { return globalContextSignal()?.type ?? 'single'; },
  get orientation() { return globalContextSignal()?.orientation ?? 'horizontal'; },
  get disabled() { return globalContextSignal()?.disabled ?? false; },
  get required() { return globalContextSignal()?.required ?? false; },
  isSelected: (value) => globalContextSignal()?.isSelected(value) ?? false,
  toggleValue: (value) => globalContextSignal()?.toggleValue(value),
  registerItem: (value, element) => globalContextSignal()?.registerItem(value, element),
  unregisterItem: (value) => globalContextSignal()?.unregisterItem(value),
  navigateNext: () => globalContextSignal()?.navigateNext(),
  navigatePrevious: () => globalContextSignal()?.navigatePrevious(),
  navigateFirst: () => globalContextSignal()?.navigateFirst(),
  navigateLast: () => globalContextSignal()?.navigateLast(),
};

const ToggleGroupContext = createContext<ToggleGroupContextValue>(
  defaultContextValue,
  'ToggleGroup'
);

const useToggleGroupContext = (): ToggleGroupContextValue => {
  return useContext(ToggleGroupContext);
};

// ============================================================================
// ToggleGroup Root
// ============================================================================

export const ToggleGroup = defineComponent<ToggleGroupProps>((props) => {
  const type = props.type ?? 'single';
  const orientation = props.orientation ?? 'horizontal';
  const disabled = props.disabled ?? false;
  const required = props.required ?? false;
  const loop = props.loop ?? true;

  // State
  const internalValue: WritableSignal<string | string[]> = signal<string | string[]>(
    props.defaultValue ?? (type === 'single' ? '' : []),
  );

  // Items registry
  const items = new Map<string, HTMLElement>();
  const itemOrder: string[] = [];

  const currentValue = (): string | string[] => {
    if (props.value !== undefined) {
      // Handle signal props - if value is a function (signal), call it
      return typeof props.value === 'function' ? (props.value as any)() : props.value;
    }
    return internalValue();
  };

  const setValue = (newValue: string | string[]) => {
    if (props.value === undefined) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

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

    let nextIndex = currentIndex + 1;
    if (nextIndex >= itemOrder.length) {
      if (loop) nextIndex = 0;
      else return;
    }

    const nextValue = itemOrder[nextIndex];
    const nextElement = items.get(nextValue as string);
    if (nextElement && !(nextElement as HTMLButtonElement).disabled) {
      nextElement.focus();
    }
  };

  const navigatePrevious = () => {
    const focusedValue = document.activeElement?.getAttribute('data-value');
    if (!focusedValue) return;

    const currentIndex = itemOrder.indexOf(focusedValue as string);
    if (currentIndex === -1) return;

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      if (loop) prevIndex = itemOrder.length - 1;
      else return;
    }

    const prevValue = itemOrder[prevIndex];
    const prevElement = items.get(prevValue as string);
    if (prevElement && !(prevElement as HTMLButtonElement).disabled) {
      prevElement.focus();
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

  // Set global context immediately for late binding (Pattern 1)
  globalContextSignal.set(contextValue);

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

  return () =>
    jsx(ToggleGroupContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-toggle-group': '',
        'data-orientation': orientation,
        'data-disabled': disabled ? '' : undefined,
        role: type === 'single' ? 'radiogroup' : 'group',
        'aria-orientation': orientation,
        onKeyDown: handleKeyDown,
        children: props.children,
      }),
    });
});

// ============================================================================
// ToggleGroup Item
// ============================================================================

export const ToggleGroupItem = defineComponent<ToggleGroupItemProps>((props) => {
  const context = useToggleGroupContext();
  const itemDisabled = props.disabled ?? context.disabled;

  const buttonRef: { current: HTMLButtonElement | null } = { current: null };

  const handleClick = () => {
    if (!itemDisabled) {
      context.toggleValue(props.value);
    }
  };

  return () => {
    const { value, disabled, children, ...rest } = props;

    // Check if selected initially
    const isSelectedInitially = context.isSelected(value);

    // Create button element with initial values
    const button = jsx('button', {
      ref: buttonRef,
      type: 'button',
      role: context.type === 'single' ? 'radio' : 'button',
      'aria-checked': context.type === 'single' ? (isSelectedInitially ? 'true' : 'false') : undefined,
      'aria-pressed': context.type === 'multiple' ? (isSelectedInitially ? 'true' : 'false') : undefined,
      'data-state': isSelectedInitially ? 'on' : 'off',
      'data-value': value,
      'data-disabled': itemDisabled ? '' : undefined,
      disabled: itemDisabled,
      onClick: handleClick,
      tabIndex: isSelectedInitially ? 0 : -1,
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
      const isSelected = context.isSelected(value);

      // Update ARIA attributes
      if (context.type === 'single') {
        button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      } else {
        button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      }

      // Update data-state
      button.setAttribute('data-state', isSelected ? 'on' : 'off');

      // Update tabIndex for roving tabindex pattern
      button.tabIndex = isSelected ? 0 : -1;
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
