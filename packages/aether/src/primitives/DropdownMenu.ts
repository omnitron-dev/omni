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
 * - Smart positioning (via Popover)
 * - ARIA compliance
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/menu/
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/menubutton/
 */

import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { createContext, useContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { jsx } from '../jsx-runtime.js';
import { Portal } from '../control-flow/Portal.js';
import { generateId } from './utils/id.js';
import { calculatePosition, applyPosition, type Side, type Align } from './utils/position.js';

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
// Context
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
  focusedIndex: () => number;
  setFocusedIndex: (index: number) => void;
  items: () => HTMLElement[];
  registerItem: (el: HTMLElement) => void;
  unregisterItem: (el: HTMLElement) => void;
}

export const DropdownMenuContext = createContext<DropdownMenuContextValue>({
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
// Root Component
// ============================================================================

export const DropdownMenu = defineComponent<DropdownMenuProps>((props) => {
  const isOpen = props.open || signal(props.defaultOpen || false);
  const anchorElement = signal<HTMLElement | null>(null);
  const focusedIndex = signal(-1);
  const itemsSignal = signal<HTMLElement[]>([]);

  const contextValue: DropdownMenuContextValue = {
    isOpen: () => isOpen(),
    open: () => {
      isOpen.set(true);
      props.onOpenChange?.(true);
    },
    close: () => {
      isOpen.set(false);
      props.onOpenChange?.(false);
      focusedIndex.set(-1);
    },
    toggle: () => {
      const newState = !isOpen();
      isOpen.set(newState);
      props.onOpenChange?.(newState);
      if (!newState) {
        focusedIndex.set(-1);
      }
    },
    triggerId: generateId('dropdown-trigger'),
    contentId: generateId('dropdown-content'),
    anchorElement: () => anchorElement(),
    setAnchorElement: (el) => anchorElement.set(el),
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

  return () =>
    jsx(DropdownMenuContext.Provider, {
      value: contextValue,
      children: props.children,
    });
});

// ============================================================================
// Trigger
// ============================================================================

export const DropdownMenuTrigger = defineComponent<DropdownMenuTriggerProps>((props) => {
  const ctx = useContext(DropdownMenuContext);

  onMount(() => {
    const el = document.getElementById(ctx.triggerId);
    if (el instanceof HTMLElement) {
      ctx.setAnchorElement(el);
    }
  });

  const handleClick = (e: MouseEvent) => {
    if (props.disabled) return;
    ctx.toggle();
    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;

    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      ctx.open();
    }

    props.onKeyDown?.(e);
  };

  const { disabled, onClick, onKeyDown, children, ...restProps } = props;

  return () =>
    jsx('button', {
      ...restProps,
      id: ctx.triggerId,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': ctx.isOpen() ? 'true' : 'false',
      'aria-controls': ctx.contentId,
      'data-disabled': disabled ? 'true' : undefined,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
});

// ============================================================================
// Content
// ============================================================================

export const DropdownMenuContent = defineComponent<DropdownMenuContentProps>((props) => {
  const ctx = useContext(DropdownMenuContext);
  let typeaheadTimeout: ReturnType<typeof setTimeout> | null = null;
  let typeaheadString = '';

  const updatePosition = () => {
    const anchor = ctx.anchorElement();
    const content = document.getElementById(ctx.contentId);

    if (!anchor || !content) return;

    const position = calculatePosition(anchor, content, {
      side: props.side || 'bottom',
      align: props.align || 'start',
      sideOffset: props.sideOffset,
      alignOffset: props.alignOffset,
      avoidCollisions: props.avoidCollisions,
      collisionPadding: props.collisionPadding,
    });

    applyPosition(content, position);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = ctx.items().filter((item: HTMLElement) => !item.hasAttribute('data-disabled'));
    const currentIndex = ctx.focusedIndex();

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        props.onEscapeKeyDown?.(e);
        if (!e.defaultPrevented) {
          ctx.close();
          const trigger = document.getElementById(ctx.triggerId);
          trigger?.focus();
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (items.length === 0) break;
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : (props.loop ? 0 : currentIndex);
        ctx.setFocusedIndex(nextIndex);
        items[nextIndex]?.focus();
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (items.length === 0) break;
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : (props.loop ? items.length - 1 : currentIndex);
        ctx.setFocusedIndex(prevIndex);
        items[prevIndex]?.focus();
        break;

      case 'Home':
        e.preventDefault();
        if (items.length > 0) {
          ctx.setFocusedIndex(0);
          items[0]?.focus();
        }
        break;

      case 'End':
        e.preventDefault();
        if (items.length > 0) {
          const lastIndex = items.length - 1;
          ctx.setFocusedIndex(lastIndex);
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
            ctx.setFocusedIndex(index);
            matchingItem.focus();
          }

          typeaheadTimeout = setTimeout(() => {
            typeaheadString = '';
          }, 500);
        }
        break;
    }
  };

  const handlePointerDownOutside = (e: PointerEvent) => {
    const target = e.target as Node;
    const content = document.getElementById(ctx.contentId);
    const trigger = document.getElementById(ctx.triggerId);

    if (
      content &&
      !content.contains(target) &&
      trigger &&
      !trigger.contains(target)
    ) {
      props.onPointerDownOutside?.(e);
      if (!e.defaultPrevented) {
        ctx.close();
      }
    }
  };

  onMount(() => {
    if (!ctx.isOpen()) return;

    updatePosition();

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();
    const handleOutsideClick = (e: Event) => handlePointerDownOutside(e as PointerEvent);

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    document.addEventListener('pointerdown', handleOutsideClick);

    // Focus first item on open
    const items = ctx.items().filter((item: HTMLElement) => !item.hasAttribute('data-disabled'));
    if (items.length > 0) {
      ctx.setFocusedIndex(0);
      setTimeout(() => items[0]?.focus(), 0);
    }

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('pointerdown', handleOutsideClick);
      if (typeaheadTimeout) clearTimeout(typeaheadTimeout);
    };
  });

  const {
    side,
    align,
    sideOffset,
    alignOffset,
    avoidCollisions,
    collisionPadding,
    loop,
    onEscapeKeyDown,
    onPointerDownOutside,
    children,
    ...restProps
  } = props;

  return () => {
    if (!ctx.isOpen()) return null;

    return jsx(Portal, {
      children: jsx('div', {
        ...restProps,
        id: ctx.contentId,
        role: 'menu',
        'aria-labelledby': ctx.triggerId,
        'aria-orientation': 'vertical',
        tabIndex: -1,
        onKeyDown: handleKeyDown,
        children,
      }),
    });
  };
});

// ============================================================================
// Item
// ============================================================================

export const DropdownMenuItem = defineComponent<DropdownMenuItemProps>((props) => {
  const ctx = useContext(DropdownMenuContext);
  const itemId = generateId('dropdown-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      ctx.registerItem(el);
      return () => ctx.unregisterItem(el);
    }
    return undefined;
  });

  const handleClick = (e: MouseEvent) => {
    if (props.disabled) return;

    props.onSelect?.(e);

    if (!e.defaultPrevented) {
      ctx.close();
      const trigger = document.getElementById(ctx.triggerId);
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
  const ctx = useContext(DropdownMenuContext);
  const checked = props.checked || signal(props.defaultChecked || false);
  const itemId = generateId('dropdown-checkbox-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      ctx.registerItem(el);
      return () => ctx.unregisterItem(el);
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
  const ctx = useContext(DropdownMenuContext);
  const radioCtx = useContext(RadioGroupContext);
  const itemId = generateId('dropdown-radio-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      ctx.registerItem(el);
      return () => ctx.unregisterItem(el);
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

export const DropdownMenuItemIndicator = defineComponent<DropdownMenuItemIndicatorProps>((props) => () =>
    jsx('span', {
      ...props,
      'data-item-indicator': 'true',
      children: props.children,
    }));

// ============================================================================
// Shortcut
// ============================================================================

export const DropdownMenuShortcut = defineComponent<DropdownMenuShortcutProps>((props) => () =>
    jsx('span', {
      ...props,
      'data-shortcut': 'true',
      'aria-hidden': 'true',
      children: props.children,
    }));

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
