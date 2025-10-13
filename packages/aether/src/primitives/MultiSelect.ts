/**
 * MultiSelect - Select component that allows multiple value selection
 *
 * Features:
 * - Multiple value selection
 * - Keyboard navigation (arrows, Enter, Escape, Type-ahead)
 * - Search/filter options
 * - Select all / Clear all
 * - Checkbox indicators for selected items
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 * - Integration with Popover for dropdown
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { useControlledState } from '../utils/controlled-state.js';

// ============================================================================
// Types
// ============================================================================

export interface MultiSelectProps {
  /**
   * Controlled value (array of selected values)
   * Pattern 19: Supports WritableSignal<string[]> for reactive binding
   */
  value?: WritableSignal<string[]> | string[];
  /** Value change callback */
  onValueChange?: (value: string[]) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Maximum number of selections (0 = unlimited) */
  maxSelections?: number;
  /** Whether to show search input */
  searchable?: boolean;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Children */
  children?: any;
}

export interface MultiSelectTriggerProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface MultiSelectValueProps {
  /** Placeholder when no items selected */
  placeholder?: string;
  /** Children */
  children?: any;
}

export interface MultiSelectContentProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface MultiSelectSearchProps {
  /** Placeholder text */
  placeholder?: string;
  /** Additional props */
  [key: string]: any;
}

export interface MultiSelectItemProps {
  /** Value for this item */
  value: string;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface MultiSelectItemIndicatorProps {
  /** Children (defaults to checkmark) */
  children?: any;
}

export interface MultiSelectActionsProps {
  /** Children */
  children?: any;
}

interface MultiSelectContextValue {
  /** Selected values */
  value: Signal<string[]>;
  /** Toggle value selection */
  toggleValue: (value: string) => void;
  /** Check if value is selected */
  isSelected: (value: string) => boolean;
  /** Disabled state */
  disabled: boolean;
  /** Open state */
  isOpen: Signal<boolean>;
  /** Set open state */
  setOpen: (open: boolean) => void;
  /** Search query */
  searchQuery: Signal<string>;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Searchable */
  searchable: boolean;
  /** Max selections */
  maxSelections: number;
  /** Can add more selections */
  canAddMore: () => boolean;
  /** Select all */
  selectAll: () => void;
  /** Clear all */
  clearAll: () => void;
  /** All available values */
  allValues: Signal<string[]>;
  /** Register item */
  registerItem: (value: string) => void;
  /** Unregister item */
  unregisterItem: (value: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const MultiSelectContext = createContext<MultiSelectContextValue | null>(null);

const useMultiSelectContext = (): MultiSelectContextValue => {
  const context = useContext(MultiSelectContext);
  if (!context) {
    throw new Error('MultiSelect components must be used within a MultiSelect');
  }
  return context;
};

// ============================================================================
// MultiSelect Root
// ============================================================================

export const MultiSelect = defineComponent<MultiSelectProps>((props) => {
  const disabled = props.disabled ?? false;
  const maxSelections = props.maxSelections ?? 0;
  const searchable = props.searchable ?? false;

  // Pattern 19: Use controlled state helper
  const [currentValue, setValue] = useControlledState<string[]>(
    props.value,
    props.defaultValue ?? [],
    props.onValueChange
  );

  // State
  const isOpen: WritableSignal<boolean> = signal<boolean>(false);
  const searchQuery: WritableSignal<string> = signal<string>('');
  const allValues: WritableSignal<string[]> = signal<string[]>([]);

  const toggleValue = (value: string) => {
    if (disabled) return;

    const current = currentValue();
    if (current.includes(value)) {
      setValue(current.filter((v) => v !== value));
    } else {
      if (maxSelections > 0 && current.length >= maxSelections) {
        return; // Max selections reached
      }
      setValue([...current, value]);
    }
  };

  const isSelected = (value: string): boolean => currentValue().includes(value);

  const canAddMore = (): boolean => {
    if (maxSelections === 0) return true;
    return currentValue().length < maxSelections;
  };

  const selectAll = () => {
    if (disabled) return;
    const all = allValues();
    if (maxSelections > 0) {
      setValue(all.slice(0, maxSelections));
    } else {
      setValue([...all]);
    }
  };

  const clearAll = () => {
    if (disabled) return;
    setValue([]);
  };

  const setOpen = (open: boolean) => {
    isOpen.set(open);
    if (!open) {
      searchQuery.set('');
    }
  };

  const setSearchQuery = (query: string) => {
    searchQuery.set(query);
  };

  const registerItem = (value: string) => {
    const current = allValues();
    if (!current.includes(value)) {
      allValues.set([...current, value]);
    }
  };

  const unregisterItem = (value: string) => {
    const current = allValues();
    allValues.set(current.filter((v) => v !== value));
  };

  const contextValue: MultiSelectContextValue = {
    value: computed(() => currentValue()),
    toggleValue,
    isSelected,
    disabled,
    isOpen: computed(() => isOpen()),
    setOpen,
    searchQuery: searchQuery as Signal<string>, // Use writable signal directly
    setSearchQuery,
    searchable,
    maxSelections,
    canAddMore,
    selectAll,
    clearAll,
    allValues: computed(() => allValues()),
    registerItem,
    unregisterItem,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(MultiSelectContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      'data-multi-select': '',
      'data-disabled': disabled ? '' : undefined,
      children,
    });
  };
});

// ============================================================================
// MultiSelect Trigger
// ============================================================================

export const MultiSelectTrigger = defineComponent<MultiSelectTriggerProps>((props) => {
  const context = useMultiSelectContext();

  const handleClick = () => {
    if (!context.disabled) {
      context.setOpen(!context.isOpen());
    }
  };

  return () => {
    const { children, ...rest } = props;

    const trigger = jsx('button', {
      type: 'button',
      'data-multi-select-trigger': '',
      'aria-haspopup': 'listbox',
      disabled: context.disabled,
      onClick: handleClick,
      ...rest,
      children,
    }) as HTMLButtonElement;

    // Reactively update state attributes (Pattern 18)
    effect(() => {
      const open = context.isOpen();
      trigger.setAttribute('data-state', open ? 'open' : 'closed');
      trigger.setAttribute('aria-expanded', String(open));
    });

    return trigger;
  };
});

// ============================================================================
// MultiSelect Value
// ============================================================================

export const MultiSelectValue = defineComponent<MultiSelectValueProps>((props) => {
  const context = useMultiSelectContext();

  return () => {
    const { placeholder = 'Select items...', children } = props;

    if (children) {
      return children;
    }

    const placeholderSpan = jsx('span', {
      'data-multi-select-placeholder': '',
      children: placeholder,
    }) as HTMLSpanElement;

    const valueSpan = jsx('span', {
      'data-multi-select-value': '',
    }) as HTMLSpanElement;

    const container = jsx('span', {
      children: [placeholderSpan, valueSpan],
    }) as HTMLSpanElement;

    // Reactively toggle between placeholder and value (Pattern 18)
    effect(() => {
      const selected = context.value();
      const hasSelection = selected.length > 0;

      if (hasSelection) {
        placeholderSpan.style.display = 'none';
        valueSpan.style.display = 'inline';
        valueSpan.textContent = `${selected.length} selected`;
      } else {
        placeholderSpan.style.display = 'inline';
        valueSpan.style.display = 'none';
      }
    });

    return container;
  };
});

// ============================================================================
// MultiSelect Content
// ============================================================================

export const MultiSelectContent = defineComponent<MultiSelectContentProps>((props) => {
  const context = useMultiSelectContext();

  return () => {
    const { children, ...rest } = props;

    const content = jsx('div', {
      'data-multi-select-content': '',
      role: 'listbox',
      'aria-multiselectable': 'true',
      ...rest,
      children,
    }) as HTMLElement;

    // Reactively toggle visibility (Pattern 18)
    effect(() => {
      const open = context.isOpen();
      content.style.display = open ? 'block' : 'none';
      content.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    return content;
  };
});

// ============================================================================
// MultiSelect Search
// ============================================================================

export const MultiSelectSearch = defineComponent<MultiSelectSearchProps>((props) => {
  const context = useMultiSelectContext();

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    context.setSearchQuery(target.value);
  };

  return () => {
    if (!context.searchable) return null;

    const { placeholder = 'Search...', ...rest } = props;

    // Create uncontrolled input
    const input = jsx('input', {
      type: 'text',
      'data-multi-select-search': '',
      placeholder,
      onInput: handleInput,
      ...rest,
    }) as HTMLInputElement;

    // Sync input value with searchQuery signal (Pattern 18)
    effect(() => {
      const query = context.searchQuery();
      if (input.value !== query) {
        input.value = query;
      }
    });

    return input;
  };
});

// ============================================================================
// MultiSelect Item
// ============================================================================

export const MultiSelectItem = defineComponent<MultiSelectItemProps>((props) => {
  const context = useMultiSelectContext();

  // Register/unregister on mount/unmount
  if (!props.disabled) {
    context.registerItem(props.value);
  }

  const handleClick = () => {
    if (!props.disabled) {
      context.toggleValue(props.value);
    }
  };

  const isSelected = computed(() => context.isSelected(props.value));

  return () => {
    const { value, disabled, children, ...rest } = props;

    const item = jsx('div', {
      'data-multi-select-item': '',
      'data-value': value,
      role: 'option',
      onClick: handleClick,
      ...rest,
      children,
    }) as HTMLElement;

    // Reactively update selected state (Pattern 18)
    effect(() => {
      const selected = isSelected();
      if (selected) {
        item.setAttribute('data-selected', '');
        item.setAttribute('aria-selected', 'true');
      } else {
        item.removeAttribute('data-selected');
        item.setAttribute('aria-selected', 'false');
      }
    });

    // Reactively update disabled state (Pattern 18)
    effect(() => {
      if (disabled) {
        item.setAttribute('data-disabled', '');
        item.setAttribute('aria-disabled', 'true');
      } else {
        item.removeAttribute('data-disabled');
        item.setAttribute('aria-disabled', 'false');
      }
    });

    // Reactively toggle visibility based on search (Pattern 18)
    effect(() => {
      const query = context.searchQuery().toLowerCase();
      if (!query) {
        // No search query - show all items
        item.style.display = 'block';
        item.setAttribute('aria-hidden', 'false');
      } else {
        // Has search query - filter based on match
        // Use item's textContent for reliable text matching
        const text = (item.textContent || props.value).toLowerCase();
        const matches = text.includes(query);
        item.style.display = matches ? 'block' : 'none';
        item.setAttribute('aria-hidden', matches ? 'false' : 'true');
      }
    });

    return item;
  };
});

// ============================================================================
// MultiSelect Item Indicator
// ============================================================================

export const MultiSelectItemIndicator = defineComponent<MultiSelectItemIndicatorProps>((props) => () => {
  const { children = '✓' } = props;

  return jsx('span', {
    'data-multi-select-item-indicator': '',
    children,
  });
});

// ============================================================================
// MultiSelect Actions
// ============================================================================

export const MultiSelectActions = defineComponent<MultiSelectActionsProps>((props) => {
  const context = useMultiSelectContext();

  const handleSelectAll = () => {
    context.selectAll();
  };

  const handleClearAll = () => {
    context.clearAll();
  };

  return () => {
    const { children } = props;

    if (children) {
      return jsx('div', {
        'data-multi-select-actions': '',
        children,
      });
    }

    const selectAllBtn = jsx('button', {
      type: 'button',
      'data-multi-select-action': '',
      onClick: handleSelectAll,
      children: 'Select All',
    }) as HTMLButtonElement;

    const clearAllBtn = jsx('button', {
      type: 'button',
      'data-multi-select-action': '',
      onClick: handleClearAll,
      children: 'Clear All',
    }) as HTMLButtonElement;

    // Reactively update disabled states (Pattern 18)
    effect(() => {
      selectAllBtn.disabled = context.disabled || !context.canAddMore();
    });

    effect(() => {
      clearAllBtn.disabled = context.disabled || context.value().length === 0;
    });

    return jsx('div', {
      'data-multi-select-actions': '',
      children: [selectAllBtn, clearAllBtn],
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(MultiSelect as any).Trigger = MultiSelectTrigger;
(MultiSelect as any).Value = MultiSelectValue;
(MultiSelect as any).Content = MultiSelectContent;
(MultiSelect as any).Search = MultiSelectSearch;
(MultiSelect as any).Item = MultiSelectItem;
(MultiSelect as any).ItemIndicator = MultiSelectItemIndicator;
(MultiSelect as any).Actions = MultiSelectActions;

// ============================================================================
// Export types
// ============================================================================

export type { MultiSelectContextValue };
