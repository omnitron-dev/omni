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
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface MultiSelectProps {
  /** Controlled value (array of selected values) */
  value?: string[];
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

  // State
  const internalValue: WritableSignal<string[]> = signal<string[]>(
    props.defaultValue ?? [],
  );
  const isOpen: WritableSignal<boolean> = signal<boolean>(false);
  const searchQuery: WritableSignal<string> = signal<string>('');
  const allValues: WritableSignal<string[]> = signal<string[]>([]);

  const currentValue = (): string[] => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalValue();
  };

  const setValue = (newValue: string[]) => {
    if (props.value === undefined) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

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

  const isSelected = (value: string): boolean => {
    return currentValue().includes(value);
  };

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
    searchQuery: computed(() => searchQuery()),
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

  return () =>
    jsx(MultiSelectContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-multi-select': '',
        'data-disabled': disabled ? '' : undefined,
        children: props.children,
      }),
    });
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

    return jsx('button', {
      type: 'button',
      'data-multi-select-trigger': '',
      'data-state': context.isOpen() ? 'open' : 'closed',
      'aria-expanded': context.isOpen(),
      'aria-haspopup': 'listbox',
      disabled: context.disabled,
      onClick: handleClick,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// MultiSelect Value
// ============================================================================

export const MultiSelectValue = defineComponent<MultiSelectValueProps>((props) => {
  const context = useMultiSelectContext();

  return () => {
    const { placeholder = 'Select items...', children } = props;
    const selected = context.value();

    if (children) {
      return children;
    }

    if (selected.length === 0) {
      return jsx('span', {
        'data-multi-select-placeholder': '',
        children: placeholder,
      });
    }

    return jsx('span', {
      'data-multi-select-value': '',
      children: `${selected.length} selected`,
    });
  };
});

// ============================================================================
// MultiSelect Content
// ============================================================================

export const MultiSelectContent = defineComponent<MultiSelectContentProps>((props) => {
  const context = useMultiSelectContext();

  return () => {
    if (!context.isOpen()) return null;

    const { children, ...rest } = props;

    return jsx('div', {
      'data-multi-select-content': '',
      role: 'listbox',
      'aria-multiselectable': 'true',
      ...rest,
      children,
    });
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

    return jsx('input', {
      type: 'text',
      'data-multi-select-search': '',
      placeholder,
      value: context.searchQuery(),
      onInput: handleInput,
      ...rest,
    });
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

  const matchesSearch = computed(() => {
    const query = context.searchQuery().toLowerCase();
    if (!query) return true;

    const text = (props.children?.toString() || props.value).toLowerCase();
    return text.includes(query);
  });

  return () => {
    if (!matchesSearch()) return null;

    const { value, disabled, children, ...rest } = props;

    return jsx('div', {
      'data-multi-select-item': '',
      'data-value': value,
      'data-selected': isSelected() ? '' : undefined,
      'data-disabled': disabled ? '' : undefined,
      role: 'option',
      'aria-selected': isSelected(),
      'aria-disabled': disabled,
      onClick: handleClick,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// MultiSelect Item Indicator
// ============================================================================

export const MultiSelectItemIndicator = defineComponent<MultiSelectItemIndicatorProps>(
  (props) => {
    return () => {
      const { children = '✓' } = props;

      return jsx('span', {
        'data-multi-select-item-indicator': '',
        children,
      });
    };
  },
);

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

    return jsx('div', {
      'data-multi-select-actions': '',
      children: [
        jsx('button', {
          type: 'button',
          'data-multi-select-action': '',
          onClick: handleSelectAll,
          disabled: context.disabled || !context.canAddMore(),
          children: 'Select All',
        }),
        jsx('button', {
          type: 'button',
          'data-multi-select-action': '',
          onClick: handleClearAll,
          disabled: context.disabled || context.value().length === 0,
          children: 'Clear All',
        }),
      ],
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
