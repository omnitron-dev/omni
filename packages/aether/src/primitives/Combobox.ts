/**
 * Combobox Primitive
 *
 * A searchable select with autocomplete and keyboard navigation.
 * Implements WAI-ARIA combobox pattern.
 *
 * @example
 * ```tsx
 * const options = signal(['React', 'Vue', 'Angular']);
 * const selected = signal<string | null>(null);
 * const search = signal('');
 *
 * <Combobox value={selected()} onValueChange={selected}>
 *   <Combobox.Trigger>
 *     <Combobox.Input
 *       placeholder="Search..."
 *       value={search()}
 *       onInput={(e) => search(e.target.value)}
 *     />
 *   </Combobox.Trigger>
 *   <Combobox.Content>
 *     {options().map(opt => (
 *       <Combobox.Item value={opt}>{opt}</Combobox.Item>
 *     ))}
 *   </Combobox.Content>
 * </Combobox>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { Portal } from '../control-flow/Portal.js';
import { useControlledState, useControlledBooleanState } from '../utils/controlled-state.js';

// ============================================================================
// Types
// ============================================================================

export interface ComboboxProps {
  children?: any;
  /**
   * Current selected value
   * Pattern 19: Supports WritableSignal<string | null> for reactive binding
   */
  value?: WritableSignal<string | null> | string | null;
  /** Callback when value changes */
  onValueChange?: (value: string | null) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string | null;
  /** Whether the combobox is open by default */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   * Pattern 19: Supports WritableSignal<boolean> for reactive binding
   */
  open?: WritableSignal<boolean> | boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Whether the combobox is disabled */
  disabled?: boolean;
  [key: string]: any;
}

export interface ComboboxTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface ComboboxInputProps {
  value?: string;
  onInput?: (event: Event) => void;
  [key: string]: any;
}

export interface ComboboxIconProps {
  children?: any;
  [key: string]: any;
}

export interface ComboboxContentProps {
  children?: any;
  /** Whether to render in a portal */
  portal?: boolean;
  /** Z-index for the content */
  zIndex?: number;
  [key: string]: any;
}

export interface ComboboxViewportProps {
  children?: any;
  [key: string]: any;
}

export interface ComboboxItemProps {
  children?: any;
  /** Value of the item */
  value: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  [key: string]: any;
}

export interface ComboboxEmptyProps {
  children?: any;
  [key: string]: any;
}

interface ComboboxContextValue {
  value: Signal<string | null>;
  open: Signal<boolean>;
  disabled: boolean;
  inputValue: WritableSignal<string>;
  inputRef: WritableSignal<HTMLInputElement | null>;
  contentRef: WritableSignal<HTMLDivElement | null>;
  triggerId: string;
  contentId: string;
  highlightedIndex: WritableSignal<number>;
  itemValues: WritableSignal<string[]>;
  setValue: (value: string | null) => void;
  setOpen: (open: boolean) => void;
  selectItem: (value: string) => void;
  registerItem: (value: string) => void;
  unregisterItem: (value: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const ComboboxContext = createContext<ComboboxContextValue | undefined>(undefined);

function useComboboxContext(): ComboboxContextValue {
  const context = useContext(ComboboxContext);
  if (!context) {
    throw new Error('Combobox components must be used within a Combobox component');
  }
  return context;
}

// ============================================================================
// Utilities
// ============================================================================

let comboboxIdCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${++comboboxIdCounter}`;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Combobox Root
 * Container for the combobox with state management
 */
export const Combobox = defineComponent<ComboboxProps>((props) => {
  // Pattern 19: Use controlled state helpers
  const [currentValue, setValue] = useControlledState<string | null>(
    props.value,
    props.defaultValue ?? null,
    props.onValueChange
  );

  const [currentOpen, setOpenInternal] = useControlledBooleanState(
    props.open,
    props.defaultOpen ?? false,
    props.onOpenChange
  );

  const inputValue: WritableSignal<string> = signal<string>('');
  const inputRef: WritableSignal<HTMLInputElement | null> = signal<HTMLInputElement | null>(null);
  const contentRef: WritableSignal<HTMLDivElement | null> = signal<HTMLDivElement | null>(null);
  const highlightedIndex: WritableSignal<number> = signal<number>(-1);
  const itemValues: WritableSignal<string[]> = signal<string[]>([]);

  const triggerId = generateId('combobox-trigger');
  const contentId = generateId('combobox-content');

  const setOpen = (open: boolean) => {
    if (!props.disabled) {
      setOpenInternal(open);
    }
  };

  const selectItem = (value: string) => {
    setValue(value);
    // Focus input BEFORE closing dropdown to preserve focus
    const input = inputRef();
    if (input) {
      input.focus();
      // Close dropdown in next microtask to allow focus to settle
      queueMicrotask(() => {
        setOpen(false);
      });
    } else {
      // If no input ref, close immediately
      setOpen(false);
    }
  };

  const registerItem = (value: string) => {
    const items = itemValues();
    if (!items.includes(value)) {
      itemValues.set([...items, value]);
    }
  };

  const unregisterItem = (value: string) => {
    const items = itemValues();
    itemValues.set(items.filter((v) => v !== value));
  };

  const contextValue: ComboboxContextValue = {
    value: computed(() => currentValue()),
    open: computed(() => currentOpen()),
    disabled: props.disabled ?? false,
    inputValue,
    inputRef,
    contentRef,
    triggerId,
    contentId,
    highlightedIndex,
    itemValues,
    setValue,
    setOpen,
    selectItem,
    registerItem,
    unregisterItem,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(ComboboxContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { class: className, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      class: className,
      'data-combobox': '',
      'data-state': currentOpen() ? 'open' : 'closed',
      'data-disabled': props.disabled ? '' : undefined,
      children,
    });
  };
});

/**
 * Combobox Trigger
 * Wrapper for the input and icon
 */
export const ComboboxTrigger = defineComponent<ComboboxTriggerProps>((props) => () => {
  const context = useComboboxContext();
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    id: context.triggerId,
    'data-combobox-trigger': '',
    'data-state': context.open() ? 'open' : 'closed',
    'data-disabled': context.disabled ? '' : undefined,
    children,
  });
});

/**
 * Combobox Input
 * Text input with autocomplete and keyboard navigation
 */
export const ComboboxInput = defineComponent<ComboboxInputProps>((props) => {
  const context = useComboboxContext();

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = context.itemValues();
    const currentIndex = context.highlightedIndex();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!context.open()) {
        context.setOpen(true);
      }
      const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      context.highlightedIndex.set(nextIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!context.open()) {
        context.setOpen(true);
      }
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      context.highlightedIndex.set(prevIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (context.open() && currentIndex >= 0 && currentIndex < items.length) {
        const value = items[currentIndex];
        if (value) {
          context.selectItem(value);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      context.setOpen(false);
    }

    props.onKeyDown?.(e);
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    context.inputValue.set(target.value);
    context.setOpen(true);
    context.highlightedIndex.set(-1); // Reset highlight on input
    props.onInput?.(e);
  };

  const handleFocus = (e: FocusEvent) => {
    context.setOpen(true);
    props.onFocus?.(e);
  };

  const handleRef = (el: HTMLInputElement | null) => {
    context.inputRef.set(el);
  };

  return () => {
    const { value, ...restProps } = props;

    return jsx('input', {
      ...restProps,
      ref: handleRef as any,
      type: 'text',
      role: 'combobox',
      'aria-controls': context.contentId,
      'aria-expanded': context.open(),
      'aria-autocomplete': 'list',
      'data-combobox-input': '',
      'data-state': context.open() ? 'open' : 'closed',
      disabled: context.disabled,
      value,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
    });
  };
});

/**
 * Combobox Icon
 * Icon next to the input (usually chevron)
 */
export const ComboboxIcon = defineComponent<ComboboxIconProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-combobox-icon': '',
    'aria-hidden': 'true',
    children,
  });
});

/**
 * Combobox Content
 * Dropdown content with positioning
 */
export const ComboboxContent = defineComponent<ComboboxContentProps>((props) => {
  const context = useComboboxContext();

  const handleRef = (el: HTMLDivElement | null) => {
    context.contentRef.set(el);
  };

  return () => {
    const { children, portal = true, zIndex = 50, style, ...restProps } = props;

    if (!context.open()) {
      return null;
    }

    const content = jsx('div', {
      ...restProps,
      ref: handleRef as any,
      id: context.contentId,
      role: 'listbox',
      'data-combobox-content': '',
      'data-state': 'open',
      style: {
        position: 'absolute',
        zIndex,
        ...style,
      },
      children,
    });

    if (portal) {
      return jsx(Portal, { children: content });
    }

    return content;
  };
});

/**
 * Combobox Viewport
 * Scrollable container for items
 */
export const ComboboxViewport = defineComponent<ComboboxViewportProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-combobox-viewport': '',
    children,
  });
});

/**
 * Combobox Item
 * Selectable option in the dropdown
 */
export const ComboboxItem = defineComponent<ComboboxItemProps>((props) => {
  const context = useComboboxContext();

  // Register/unregister item
  let registered = false;
  const ensureRegistered = () => {
    if (!registered) {
      context.registerItem(props.value);
      registered = true;
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (!props.disabled) {
      context.selectItem(props.value);
    }
    props.onClick?.(e);
  };

  const handleMouseEnter = (e: MouseEvent) => {
    if (!props.disabled) {
      const items = context.itemValues();
      const index = items.indexOf(props.value);
      if (index >= 0) {
        context.highlightedIndex.set(index);
      }
    }
    props.onMouseEnter?.(e);
  };

  return () => {
    ensureRegistered();

    const { children, value, disabled, ...restProps } = props;
    const isSelected = context.value() === value;

    const item = jsx('div', {
      ...restProps,
      role: 'option',
      'aria-selected': isSelected,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-combobox-item': '',
      'data-state': isSelected ? 'checked' : 'unchecked',
      'data-disabled': disabled ? '' : undefined,
      onClick: handleClick,
      onMouseEnter: handleMouseEnter,
      children,
    }) as HTMLElement;

    // Reactively update highlighted state (Pattern 18)
    effect(() => {
      const items = context.itemValues();
      const index = items.indexOf(value);
      const isHighlighted = context.highlightedIndex() === index;

      if (isHighlighted) {
        item.setAttribute('data-highlighted', '');
      } else {
        item.removeAttribute('data-highlighted');
      }
    });

    return item;
  };
});

/**
 * Combobox Empty
 * Shown when no items match the search
 */
export const ComboboxEmpty = defineComponent<ComboboxEmptyProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    role: 'status',
    'data-combobox-empty': '',
    children,
  });
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Combobox as any).Trigger = ComboboxTrigger;
(Combobox as any).Input = ComboboxInput;
(Combobox as any).Icon = ComboboxIcon;
(Combobox as any).Content = ComboboxContent;
(Combobox as any).Viewport = ComboboxViewport;
(Combobox as any).Item = ComboboxItem;
(Combobox as any).Empty = ComboboxEmpty;

// ============================================================================
// Type augmentation for sub-components
// ============================================================================

export interface ComboboxComponent {
  (props: ComboboxProps): any;
  Trigger: typeof ComboboxTrigger;
  Input: typeof ComboboxInput;
  Icon: typeof ComboboxIcon;
  Content: typeof ComboboxContent;
  Viewport: typeof ComboboxViewport;
  Item: typeof ComboboxItem;
  Empty: typeof ComboboxEmpty;
}
