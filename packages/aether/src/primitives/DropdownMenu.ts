/**
 * Dropdown Menu Primitive
 *
 * A menu of actions or links triggered by a button with full keyboard navigation,
 * typeahead search, and checkbox/radio support.
 *
 * Features:
 * - Keyboard navigation (arrows, Home, End, Escape)
 * - Typeahead search
 * - Checkbox and radio items
 * - Disabled items
 * - Separators and labels
 * - Smart positioning (via factory)
 * - ARIA compliance
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/menu/
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/menubutton/
 */

import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';
import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/id.js';
import type { Side, Align } from './utils/position.js';

// ============================================================================
// Create Base DropdownMenu using Factory
// ============================================================================

const DropdownMenuBase = createOverlayPrimitive({
  name: 'dropdown-menu',
  modal: false,
  role: 'menu',
  positioning: true,
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasTitle: false,
  hasDescription: false,
  hasArrow: false,
  supportsSignalControl: true,
});

// ============================================================================
// Types
// ============================================================================

export interface DropdownMenuProps {
  defaultOpen?: boolean;
  open?: WritableSignal<boolean>;
  onOpenChange?: (open: boolean) => void;
  children?: any;
}

export interface DropdownMenuTriggerProps {
  children?: any;
  disabled?: boolean;
  [key: string]: any;
}

export interface DropdownMenuContentProps {
  children?: any;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionPadding?: number;
  loop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: PointerEvent) => void;
  [key: string]: any;
}

export interface DropdownMenuItemProps {
  children?: any;
  disabled?: boolean;
  textValue?: string;
  onSelect?: (event: Event) => void;
  [key: string]: any;
}

export interface DropdownMenuCheckboxItemProps {
  children?: any;
  checked?: WritableSignal<boolean>;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  textValue?: string;
  [key: string]: any;
}

export interface DropdownMenuRadioGroupProps {
  children?: any;
  value?: WritableSignal<string>;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export interface DropdownMenuRadioItemProps {
  children?: any;
  value: string;
  disabled?: boolean;
  [key: string]: any;
}

export interface DropdownMenuLabelProps {
  children?: any;
  [key: string]: any;
}

export interface DropdownMenuSeparatorProps {
  [key: string]: any;
}

export interface DropdownMenuShortcutProps {
  children?: any;
  [key: string]: any;
}

export interface DropdownMenuItemIndicatorProps {
  children?: any;
  [key: string]: any;
}

// ============================================================================
// Menu-Specific Context (extends base context with item management)
// ============================================================================

export interface DropdownMenuContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  anchorElement: () => HTMLElement | null;
  setAnchorElement: (el: HTMLElement | null) => void;
  // Menu-specific: item management for keyboard navigation
  focusedIndex: () => number;
  setFocusedIndex: (index: number) => void;
  items: () => HTMLElement[];
  registerItem: (el: HTMLElement) => void;
  unregisterItem: (el: HTMLElement) => void;
}

export const MenuItemContext = createContext<DropdownMenuContextValue>({
  isOpen: () => false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  triggerId: '',
  contentId: '',
  anchorElement: () => null,
  setAnchorElement: () => {},
  focusedIndex: () => -1,
  setFocusedIndex: () => {},
  items: () => [],
  registerItem: () => {},
  unregisterItem: () => {},
});

// ============================================================================
// Radio Group Context
// ============================================================================

export interface RadioGroupContextValue {
  value: () => string;
  setValue: (value: string) => void;
}

export const RadioGroupContext = createContext<RadioGroupContextValue>({
  value: () => '',
  setValue: () => {},
});

// ============================================================================
// Root Component (wraps factory Root with menu-specific context)
// ============================================================================

export const DropdownMenu = defineComponent<DropdownMenuProps>((props) => {
  // Menu-specific signals for keyboard navigation and item management
  const focusedIndex = signal(-1);
  const itemsSignal = signal<HTMLElement[]>([]);

  // Create menu item context value (extends factory's context)
  // This provides item registration and focus management for keyboard navigation
  const menuItemContextValue: Partial<DropdownMenuContextValue> = {
    focusedIndex: () => focusedIndex(),
    setFocusedIndex: (index) => focusedIndex.set(index),
    items: () => itemsSignal(),
    registerItem: (el) => {
      const items = itemsSignal();
      if (!items.includes(el)) {
        itemsSignal.set([...items, el]);
      }
    },
    unregisterItem: (el) => {
      const items = itemsSignal();
      itemsSignal.set(items.filter((item) => item !== el));
    },
  };

  // Provide menu-specific context
  provideContext(MenuItemContext, menuItemContextValue as DropdownMenuContextValue);

  return () =>
    jsx(DropdownMenuBase.Root, {
      open: props.open,
      defaultOpen: props.defaultOpen,
      onOpenChange: (open: boolean) => {
        // Reset focus when closing
        if (!open) {
          focusedIndex.set(-1);
        }
        props.onOpenChange?.(open);
      },
      children: props.children,
    });
});

// ============================================================================
// Trigger (extends factory trigger with menu-specific keyboard shortcuts)
// ============================================================================

export const DropdownMenuTrigger = defineComponent<DropdownMenuTriggerProps>((props) => {
  const baseCtx = useContext(DropdownMenuBase.Context);

  // Add menu-specific keyboard behavior
  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;

    // ArrowDown opens menu and focuses first item (menu pattern)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      baseCtx.open();
    }

    props.onKeyDown?.(e);
  };

  const { disabled, onKeyDown, children, ...restProps } = props;

  return () =>
    jsx(DropdownMenuBase.Trigger, {
      ...restProps,
      disabled,
      onKeyDown: handleKeyDown,
      children,
    });
});

// ============================================================================
// Content (wraps factory Content with menu-specific keyboard navigation)
// ============================================================================

/**
 * Custom Content wrapper that adds:
 * - Keyboard navigation (ArrowUp/Down, Home, End)
 * - Typeahead search
 * - Focus management for menu items
 */
export const DropdownMenuContent = defineComponent<DropdownMenuContentProps>((props) => {
  const baseCtx = useContext(DropdownMenuBase.Context);
  const menuCtx = useContext(MenuItemContext);
  let typeaheadTimeout: ReturnType<typeof setTimeout> | null = null;
  let typeaheadString = '';

  // Menu-specific keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    const items = menuCtx.items().filter((item: HTMLElement) => !item.hasAttribute('data-disabled'));
    const currentIndex = menuCtx.focusedIndex();

    switch (e.key) {
      case 'Escape':
        // Let factory handle Escape, but restore focus to trigger
        e.preventDefault();
        props.onEscapeKeyDown?.(e);
        if (!e.defaultPrevented) {
          baseCtx.close();
          const trigger = document.getElementById(baseCtx.triggerId);
          trigger?.focus();
        }
        break;

      case 'ArrowDown': {
        e.preventDefault();
        if (items.length === 0) break;
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : props.loop ? 0 : currentIndex;
        menuCtx.setFocusedIndex(nextIndex);
        items[nextIndex]?.focus();
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        if (items.length === 0) break;
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : props.loop ? items.length - 1 : currentIndex;
        menuCtx.setFocusedIndex(prevIndex);
        items[prevIndex]?.focus();
        break;
      }

      case 'Home':
        e.preventDefault();
        if (items.length > 0) {
          menuCtx.setFocusedIndex(0);
          items[0]?.focus();
        }
        break;

      case 'End':
        e.preventDefault();
        if (items.length > 0) {
          const lastIndex = items.length - 1;
          menuCtx.setFocusedIndex(lastIndex);
          items[lastIndex]?.focus();
        }
        break;

      default:
        // Typeahead search
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();

          if (typeaheadTimeout) clearTimeout(typeaheadTimeout);
          typeaheadString += e.key.toLowerCase();

          const matchingItem = items.find((item: HTMLElement) => {
            const text = item.getAttribute('data-text-value') || item.textContent || '';
            return text.toLowerCase().startsWith(typeaheadString);
          });

          if (matchingItem) {
            const index = items.indexOf(matchingItem);
            menuCtx.setFocusedIndex(index);
            matchingItem.focus();
          }

          typeaheadTimeout = setTimeout(() => {
            typeaheadString = '';
          }, 500);
        }
        break;
    }
  };

  // Focus first item when menu opens
  onMount(() => {
    if (!baseCtx.isOpen()) return undefined;

    const items = menuCtx.items().filter((item: HTMLElement) => !item.hasAttribute('data-disabled'));
    if (items.length > 0) {
      menuCtx.setFocusedIndex(0);
      setTimeout(() => items[0]?.focus(), 0);
    }

    return () => {
      if (typeaheadTimeout) clearTimeout(typeaheadTimeout);
    };
  });

  const { loop, children, ...restProps } = props;

  return () =>
    jsx(DropdownMenuBase.Content, {
      ...restProps,
      onKeyDown: (e: KeyboardEvent) => {
        handleKeyDown(e);
        restProps.onKeyDown?.(e);
      },
      children,
    });
});

// ============================================================================
// Item
// ============================================================================

export const DropdownMenuItem = defineComponent<DropdownMenuItemProps>((props) => {
  const baseCtx = useContext(DropdownMenuBase.Context);
  const menuCtx = useContext(MenuItemContext);
  const itemId = generateId('dropdown-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      menuCtx.registerItem(el);
      return () => menuCtx.unregisterItem(el);
    }
    return undefined;
  });

  const handleClick = (e: MouseEvent) => {
    if (props.disabled) return;

    props.onSelect?.(e);

    if (!e.defaultPrevented) {
      baseCtx.close();
      const trigger = document.getElementById(baseCtx.triggerId);
      trigger?.focus();
    }

    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e as any);
    }

    props.onKeyDown?.(e);
  };

  const { disabled, textValue, onSelect, onClick, onKeyDown, children, ...restProps } = props;

  return () =>
    jsx('div', {
      ...restProps,
      id: itemId,
      role: 'menuitem',
      tabIndex: -1,
      'data-disabled': disabled ? 'true' : undefined,
      'data-text-value': textValue || (typeof children === 'string' ? children : undefined),
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
});

// ============================================================================
// CheckboxItem
// ============================================================================

export const DropdownMenuCheckboxItem = defineComponent<DropdownMenuCheckboxItemProps>((props) => {
  const menuCtx = useContext(MenuItemContext);
  const checked = props.checked || signal(props.defaultChecked || false);
  const itemId = generateId('dropdown-checkbox-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      menuCtx.registerItem(el);
      return () => menuCtx.unregisterItem(el);
    }
    return undefined;
  });

  const handleClick = (e: MouseEvent) => {
    if (props.disabled) return;

    const newChecked = !checked();
    checked.set(newChecked);
    props.onCheckedChange?.(newChecked);

    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e as any);
    }

    props.onKeyDown?.(e);
  };

  const { disabled, textValue, onCheckedChange, onClick, onKeyDown, children, ...restProps } = props;

  return () =>
    jsx('div', {
      ...restProps,
      id: itemId,
      role: 'menuitemcheckbox',
      tabIndex: -1,
      'aria-checked': checked() ? 'true' : 'false',
      'data-disabled': disabled ? 'true' : undefined,
      'data-state': checked() ? 'checked' : 'unchecked',
      'data-text-value': textValue || (typeof children === 'string' ? children : undefined),
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
});

// ============================================================================
// RadioGroup
// ============================================================================

export const DropdownMenuRadioGroup = defineComponent<DropdownMenuRadioGroupProps>((props) => {
  const value = props.value || signal(props.defaultValue || '');

  const radioContextValue: RadioGroupContextValue = {
    value: () => value(),
    setValue: (newValue) => {
      value.set(newValue);
      props.onValueChange?.(newValue);
    },
  };

  return () =>
    jsx(RadioGroupContext.Provider, {
      value: radioContextValue,
      children: props.children,
    });
});

// ============================================================================
// RadioItem
// ============================================================================

export const DropdownMenuRadioItem = defineComponent<DropdownMenuRadioItemProps>((props) => {
  const menuCtx = useContext(MenuItemContext);
  const radioCtx = useContext(RadioGroupContext);
  const itemId = generateId('dropdown-radio-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      menuCtx.registerItem(el);
      return () => menuCtx.unregisterItem(el);
    }
    return undefined;
  });

  const handleClick = (e: MouseEvent) => {
    if (props.disabled) return;

    radioCtx.setValue(props.value);

    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e as any);
    }

    props.onKeyDown?.(e);
  };

  const { disabled, value, onClick, onKeyDown, children, ...restProps } = props;
  const isChecked = radioCtx.value() === value;

  return () =>
    jsx('div', {
      ...restProps,
      id: itemId,
      role: 'menuitemradio',
      tabIndex: -1,
      'aria-checked': isChecked ? 'true' : 'false',
      'data-disabled': disabled ? 'true' : undefined,
      'data-state': isChecked ? 'checked' : 'unchecked',
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
});

// ============================================================================
// Label
// ============================================================================

export const DropdownMenuLabel = defineComponent<DropdownMenuLabelProps>((props) => {
  const labelId = generateId('dropdown-label');

  return () =>
    jsx('div', {
      ...props,
      id: labelId,
      role: 'none',
      children: props.children,
    });
});

// ============================================================================
// Separator
// ============================================================================

export const DropdownMenuSeparator = defineComponent<DropdownMenuSeparatorProps>((props) => {
  const separatorId = generateId('dropdown-separator');

  return () =>
    jsx('div', {
      ...props,
      id: separatorId,
      role: 'separator',
      'aria-orientation': 'horizontal',
    });
});

// ============================================================================
// ItemIndicator
// ============================================================================

export const DropdownMenuItemIndicator = defineComponent<DropdownMenuItemIndicatorProps>(
  (props) => () =>
    jsx('span', {
      ...props,
      'data-item-indicator': 'true',
      children: props.children,
    })
);

// ============================================================================
// Shortcut
// ============================================================================

export const DropdownMenuShortcut = defineComponent<DropdownMenuShortcutProps>(
  (props) => () =>
    jsx('span', {
      ...props,
      'data-shortcut': 'true',
      'aria-hidden': 'true',
      children: props.children,
    })
);

// ============================================================================
// Context Export (for backward compatibility)
// ============================================================================

/**
 * For backward compatibility, export the context with the expected name
 * Note: The actual menu functionality uses MenuItemContext internally,
 * but we export it as DropdownMenuContext for API compatibility
 */
export const DropdownMenuContext = MenuItemContext;

// ============================================================================
// Sub-component Attachments
// ============================================================================

(DropdownMenu as any).Trigger = DropdownMenuTrigger;
(DropdownMenu as any).Content = DropdownMenuContent;
(DropdownMenu as any).Item = DropdownMenuItem;
(DropdownMenu as any).CheckboxItem = DropdownMenuCheckboxItem;
(DropdownMenu as any).RadioGroup = DropdownMenuRadioGroup;
(DropdownMenu as any).RadioItem = DropdownMenuRadioItem;
(DropdownMenu as any).Label = DropdownMenuLabel;
(DropdownMenu as any).Separator = DropdownMenuSeparator;
(DropdownMenu as any).ItemIndicator = DropdownMenuItemIndicator;
(DropdownMenu as any).Shortcut = DropdownMenuShortcut;
