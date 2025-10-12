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

export interface CommandPaletteProps
   {
  children?: any;
  /** Whether the command palette is open */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Default open state (uncontrolled) */
  defaultOpen?: boolean;
  /** Whether to show keyboard shortcuts */
  showShortcuts?: boolean;
  [key: string]: any;
}

export interface CommandPaletteDialogProps
   {
  children?: any;
  [key: string]: any;
}

export interface CommandPaletteInputProps
   {
  value?: string;
  onInput?: (event: Event) => void;
  [key: string]: any;
}

export interface CommandPaletteListProps
   {
  children?: any;
  [key: string]: any;
}

export interface CommandPaletteGroupProps
   {
  children?: any;
  /** Heading for the group */
  heading?: string;
  [key: string]: any;
}

export interface CommandPaletteItemProps
   {
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

export interface CommandPaletteSeparatorProps
   {}

export interface CommandPaletteShortcutProps
   {
  children?: any;
  [key: string]: any;
}

export interface CommandPaletteEmptyProps
   {
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
    throw new Error(
      'CommandPalette components must be used within a CommandPalette component',
    );
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
  const internalOpen: WritableSignal<boolean> = signal<boolean>(props.defaultOpen ?? false);
  const inputValue: WritableSignal<string> = signal<string>('');
  const highlightedIndex: WritableSignal<number> = signal<number>(0);
  const itemElements: WritableSignal<HTMLElement[]> = signal<HTMLElement[]>([]);

  const isControlled = () => props.open !== undefined;
  const currentOpen = () => (isControlled() ? props.open ?? false : internalOpen());

  const setOpen = (open: boolean) => {
    if (!isControlled()) {
      internalOpen.set(open);
    }
    props.onOpenChange?.(open);

    // Reset state when closing
    if (!open) {
      inputValue.set('');
      highlightedIndex.set(0);
    }
  };

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
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx(Dialog, {
      open: currentOpen(),
      onOpenChange: setOpen,
      children,
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

  return jsx((Dialog as any).Content, {
    'data-command-palette-dialog': '',
    children: evaluatedChildren,
  });
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

/**
 * Command Palette Item
 * Selectable command item
 */
export const CommandPaletteItem = defineComponent<CommandPaletteItemProps>((props) => {
  const context = useCommandPaletteContext();
  let element: HTMLElement | null = null;

  const handleRef = (el: HTMLElement | null) => {
    if (element && element !== el) {
      context.unregisterItem(element);
    }
    element = el;
    if (el) {
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
    const { children, value, onSelect, disabled, keywords, ...restProps } = props;

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

    // Reactively update highlighted state (Pattern 18)
    effect(() => {
      const items = context.itemElements();
      const index = element ? items.indexOf(element) : -1;
      const isHighlighted = context.highlightedIndex() === index;

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
  (props) => () => jsx('div', {
      ...props,
      role: 'separator',
      'data-command-palette-separator': '',
    }),
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
