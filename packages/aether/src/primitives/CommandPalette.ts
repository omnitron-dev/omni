/**
 * Command Palette Primitive
 *
 * A searchable command menu for quick actions (⌘K style).
 * Built on top of Dialog with keyboard navigation.
 *
 * @example
 * ```tsx
 * const open = signal(false);
 * const search = signal('');
 *
 * <CommandPalette open={open()} onOpenChange={open}>
 *   <CommandPalette.Dialog>
 *     <CommandPalette.Input
 *       placeholder="Type a command..."
 *       value={search()}
 *       onInput={(e) => search(e.target.value)}
 *     />
 *     <CommandPalette.List>
 *       <CommandPalette.Group heading="File">
 *         <CommandPalette.Item onSelect={() => newFile()}>
 *           New File
 *           <CommandPalette.Shortcut>⌘N</CommandPalette.Shortcut>
 *         </CommandPalette.Item>
 *       </CommandPalette.Group>
 *     </CommandPalette.List>
 *   </CommandPalette.Dialog>
 * </CommandPalette>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { Dialog } from './Dialog.js';

// ============================================================================
// Types
// ============================================================================

export interface CommandPaletteProps {
  children?: any;
  /** Whether the command palette is open (controlled with WritableSignal for reactive updates, or boolean for simple control) */
  open?: WritableSignal<boolean> | boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Default open state (uncontrolled) */
  defaultOpen?: boolean;
  /** Whether to show keyboard shortcuts */
  showShortcuts?: boolean;
  [key: string]: any;
}

export interface CommandPaletteDialogProps {
  children?: any;
  [key: string]: any;
}

export interface CommandPaletteInputProps {
  value?: string;
  onInput?: (event: Event) => void;
  [key: string]: any;
}

export interface CommandPaletteListProps {
  children?: any;
  [key: string]: any;
}

export interface CommandPaletteGroupProps {
  children?: any;
  /** Heading for the group */
  heading?: string;
  [key: string]: any;
}

export interface CommandPaletteItemProps {
  children?: any;
  /** Value for filtering/search */
  value?: string;
  /** Callback when item is selected */
  onSelect?: () => void;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Keywords for fuzzy search */
  keywords?: string[];
  [key: string]: any;
}

export interface CommandPaletteSeparatorProps {}

export interface CommandPaletteShortcutProps {
  children?: any;
  [key: string]: any;
}

export interface CommandPaletteEmptyProps {
  children?: any;
  [key: string]: any;
}

interface CommandPaletteContextValue {
  open: Signal<boolean>;
  inputValue: WritableSignal<string>;
  highlightedIndex: WritableSignal<number>;
  itemElements: WritableSignal<HTMLElement[]>;
  showShortcuts: boolean;
  setOpen: (open: boolean) => void;
  selectItem: (index: number) => void;
  registerItem: (element: HTMLElement) => void;
  unregisterItem: (element: HTMLElement) => void;
}

// ============================================================================
// Context
// ============================================================================

const CommandPaletteContext = createContext<CommandPaletteContextValue | undefined>(undefined);

function useCommandPaletteContext(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error('CommandPalette components must be used within a CommandPalette component');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Command Palette Root
 * Container with state management
 */
export const CommandPalette = defineComponent<CommandPaletteProps>((props) => {
  // Reset item creation index for this palette instance
  itemCreationIndex = 0;

  // Pattern 19: Support both signal and value-based control
  const isSignal = (val: any): val is WritableSignal<boolean> => typeof val === 'function' && 'set' in val;
  const openSignal = isSignal(props.open) ? props.open : signal<boolean>(props.defaultOpen ?? false);

  const inputValue: WritableSignal<string> = signal<string>('');
  const highlightedIndex: WritableSignal<number> = signal<number>(0);
  const itemElements: WritableSignal<HTMLElement[]> = signal<HTMLElement[]>([]);

  // Support both value and signal-based open prop
  const currentOpen = () => {
    if (typeof props.open === 'boolean') {
      return props.open;
    }
    return openSignal();
  };

  const setOpen = (value: boolean) => {
    // Pattern 19: Update signal directly if using signal-based control
    if (!isSignal(props.open)) {
      openSignal.set(value);
    }
    props.onOpenChange?.(value);

    // Reset state when closing or opening
    if (!value) {
      inputValue.set('');
      highlightedIndex.set(0);
    } else {
      // Reset item creation index synchronously when opening
      itemCreationIndex = 0;
    }
  };

  // Pattern 19: Watch for open state changes to reset state
  effect(() => {
    const isOpen = currentOpen();
    if (isOpen) {
      // Reset state when opening
      inputValue.set('');
      highlightedIndex.set(0);
      // Reset item creation index for proper first-item detection
      itemCreationIndex = 0;
    }
  });

  const selectItem = (index: number) => {
    const items = itemElements();
    const item = items[index];
    if (item) {
      item.click();
    }
  };

  const registerItem = (element: HTMLElement) => {
    const items = itemElements();
    if (!items.includes(element)) {
      itemElements.set([...items, element]);
    }
  };

  const unregisterItem = (element: HTMLElement) => {
    const items = itemElements();
    itemElements.set(items.filter((el) => el !== element));
  };

  const contextValue: CommandPaletteContextValue = {
    open: computed(() => currentOpen()),
    inputValue,
    highlightedIndex,
    itemElements,
    showShortcuts: props.showShortcuts ?? true,
    setOpen,
    selectItem,
    registerItem,
    unregisterItem,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(CommandPaletteContext, contextValue);

  return () => {
    // Pattern 19: Pass signal for reactive control, boolean for static control
    // Dialog accepts both WritableSignal<boolean> and boolean
    const openProp =
      typeof props.open === 'boolean'
        ? props.open // Pass boolean as-is for static control
        : isSignal(props.open)
          ? props.open // Pass signal for reactive control
          : openSignal; // Use internal signal for uncontrolled mode

    // Pattern 17: Pass children as-is to Dialog, let Dialog evaluate them
    // This ensures Dialog's context is provided BEFORE children are created
    return jsx(Dialog, {
      open: openProp,
      onOpenChange: setOpen,
      children: props.children, // Pass unevaluated - Dialog will evaluate after providing context
    });
  };
});

/**
 * Command Palette Dialog
 * Modal dialog container
 */
export const CommandPaletteDialog = defineComponent<CommandPaletteDialogProps>((props) => () => {
  const { children } = props;

  // Evaluate function children (Pattern 17)
  const evaluatedChildren = typeof children === 'function' ? children() : children;

  // Factory Content already wraps in Portal and checks isOpen(), so we return
  // both Overlay and Content. They will both handle their own rendering logic.
  // Cannot wrap in a div because Content portals itself to document.body.
  return [
    jsx((Dialog as any).Overlay, {}),
    jsx((Dialog as any).Content, {
      'data-command-palette-dialog': '',
      children: evaluatedChildren,
    }),
  ];
});

/**
 * Command Palette Input
 * Search input with keyboard navigation
 */
export const CommandPaletteInput = defineComponent<CommandPaletteInputProps>((props) => {
  const context = useCommandPaletteContext();

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = context.itemElements();
    const currentIndex = context.highlightedIndex();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      context.highlightedIndex.set(nextIndex);
      items[nextIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      context.highlightedIndex.set(prevIndex);
      items[prevIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentIndex >= 0 && currentIndex < items.length) {
        context.selectItem(currentIndex);
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
    context.highlightedIndex.set(0); // Reset highlight on input
    props.onInput?.(e);
  };

  return () => {
    const { value, ...restProps } = props;

    return jsx('input', {
      ...restProps,
      type: 'text',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-autocomplete': 'list',
      'data-command-palette-input': '',
      value,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
      autofocus: true,
    });
  };
});

/**
 * Command Palette List
 * Container for command groups and items
 */
export const CommandPaletteList = defineComponent<CommandPaletteListProps>((props) => () => {
  const { children, ...restProps } = props;

  // Evaluate function children (Pattern 17)
  const evaluatedChildren = typeof children === 'function' ? children() : children;

  return jsx('div', {
    ...restProps,
    role: 'listbox',
    'data-command-palette-list': '',
    children: evaluatedChildren,
  });
});

/**
 * Command Palette Group
 * Group of related commands with optional heading
 */
export const CommandPaletteGroup = defineComponent<CommandPaletteGroupProps>((props) => () => {
  const { children, heading, ...restProps } = props;

  // Evaluate function children (Pattern 17)
  const evaluatedChildren = typeof children === 'function' ? children() : children;

  return jsx('div', {
    ...restProps,
    role: 'group',
    'data-command-palette-group': '',
    children: [
      heading
        ? jsx('div', {
            'data-command-palette-group-heading': '',
            children: heading,
          })
        : null,
      evaluatedChildren,
    ],
  });
});

// Track item creation order globally (reset when CommandPalette opens)
let itemCreationIndex = 0;

/**
 * Command Palette Item
 * Selectable command item
 */
export const CommandPaletteItem = defineComponent<CommandPaletteItemProps>((props) => {
  const context = useCommandPaletteContext();
  let element: HTMLElement | null = null;
  // Capture creation index for this item
  const creationIndex = itemCreationIndex++;

  const handleRef = (el: HTMLElement | null) => {
    if (element && element !== el) {
      context.unregisterItem(element);
    }
    element = el;
    if (el) {
      // Set initial highlighted state BEFORE registering
      // First item (creationIndex === 0) is highlighted by default
      const isInitiallyHighlighted = creationIndex === 0 && context.highlightedIndex() === 0;
      el.setAttribute('aria-selected', String(isInitiallyHighlighted));
      if (isInitiallyHighlighted) {
        el.setAttribute('data-highlighted', '');
      }

      // Now register the item
      context.registerItem(el);
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (!props.disabled) {
      props.onSelect?.();
      context.setOpen(false);
    }
    props.onClick?.(e);
  };

  const handleMouseEnter = (e: MouseEvent) => {
    if (!props.disabled) {
      const items = context.itemElements();
      const index = items.indexOf(element!);
      if (index >= 0) {
        context.highlightedIndex.set(index);
      }
    }
    props.onMouseEnter?.(e);
  };

  return () => {
    const { children, value: _value, onSelect: _onSelect, disabled, keywords: _keywords, ...restProps } = props;

    // Evaluate function children (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    const item = jsx('div', {
      ...restProps,
      ref: handleRef as any,
      role: 'option',
      'data-command-palette-item': '',
      onClick: handleClick,
      onMouseEnter: handleMouseEnter,
      children: evaluatedChildren,
    }) as HTMLElement;

    // Set initial disabled state synchronously
    if (disabled) {
      item.setAttribute('aria-disabled', 'true');
      item.setAttribute('data-disabled', '');
    }

    // Reactively update highlighted state (Pattern 18)
    effect(() => {
      // Track dependencies so effect re-runs when they change
      const items = context.itemElements();
      const highlightedIdx = context.highlightedIndex();

      // Only update attributes after element is registered
      if (!element) return;

      const index = items.indexOf(element);
      const isHighlighted = highlightedIdx === index;

      item.setAttribute('aria-selected', String(isHighlighted));
      if (isHighlighted) {
        item.setAttribute('data-highlighted', '');
      } else {
        item.removeAttribute('data-highlighted');
      }
    });

    // Reactively update disabled state (Pattern 18)
    effect(() => {
      if (disabled) {
        item.setAttribute('aria-disabled', 'true');
        item.setAttribute('data-disabled', '');
      } else {
        item.removeAttribute('aria-disabled');
        item.removeAttribute('data-disabled');
      }
    });

    return item;
  };
});

/**
 * Command Palette Separator
 * Visual separator between groups
 */
export const CommandPaletteSeparator = defineComponent<CommandPaletteSeparatorProps>(
  (props) => () =>
    jsx('div', {
      ...props,
      role: 'separator',
      'data-command-palette-separator': '',
    })
);

/**
 * Command Palette Shortcut
 * Displays keyboard shortcut hint
 */
export const CommandPaletteShortcut = defineComponent<CommandPaletteShortcutProps>((props) => {
  const context = useCommandPaletteContext();

  return () => {
    const { children, ...restProps } = props;

    const shortcut = jsx('span', {
      ...restProps,
      'data-command-palette-shortcut': '',
      'aria-hidden': 'true',
      children,
    }) as HTMLElement;

    // Reactively toggle visibility (Pattern 18)
    effect(() => {
      const show = context.showShortcuts;
      shortcut.style.display = show ? 'inline' : 'none';
    });

    return shortcut;
  };
});

/**
 * Command Palette Empty
 * Shown when no commands match the search
 */
export const CommandPaletteEmpty = defineComponent<CommandPaletteEmptyProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    role: 'status',
    'data-command-palette-empty': '',
    children,
  });
});

// ============================================================================
// Attach sub-components
// ============================================================================

(CommandPalette as any).Dialog = CommandPaletteDialog;
(CommandPalette as any).Input = CommandPaletteInput;
(CommandPalette as any).List = CommandPaletteList;
(CommandPalette as any).Group = CommandPaletteGroup;
(CommandPalette as any).Item = CommandPaletteItem;
(CommandPalette as any).Separator = CommandPaletteSeparator;
(CommandPalette as any).Shortcut = CommandPaletteShortcut;
(CommandPalette as any).Empty = CommandPaletteEmpty;

// ============================================================================
// Type augmentation for sub-components
// ============================================================================

export interface CommandPaletteComponent {
  (props: CommandPaletteProps): any;
  Dialog: typeof CommandPaletteDialog;
  Input: typeof CommandPaletteInput;
  List: typeof CommandPaletteList;
  Group: typeof CommandPaletteGroup;
  Item: typeof CommandPaletteItem;
  Separator: typeof CommandPaletteSeparator;
  Shortcut: typeof CommandPaletteShortcut;
  Empty: typeof CommandPaletteEmpty;
  [key: string]: any;
}
