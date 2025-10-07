/**
 * Select Primitive
 *
 * A form control for selecting a single value from a list of options.
 *
 * Features:
 * - Keyboard navigation (arrows, Home, End, Escape, Enter, Space)
 * - Typeahead search
 * - Option grouping
 * - Form integration (name, disabled, required)
 * - Smart positioning (via Popover)
 * - ARIA compliance
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/listbox/
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

export interface SelectProps {
  value?: WritableSignal<string>;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: WritableSignal<boolean>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  children?: any;
}

export interface SelectTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface SelectValueProps {
  placeholder?: string;
  children?: any;
  [key: string]: any;
}

export interface SelectIconProps {
  children?: any;
  [key: string]: any;
}

export interface SelectContentProps {
  children?: any;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionPadding?: number;
  position?: 'item-aligned' | 'popper';
  [key: string]: any;
}

export interface SelectViewportProps {
  children?: any;
  [key: string]: any;
}

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  textValue?: string;
  children?: any;
  [key: string]: any;
}

export interface SelectItemTextProps {
  children?: any;
  [key: string]: any;
}

export interface SelectItemIndicatorProps {
  children?: any;
  [key: string]: any;
}

export interface SelectGroupProps {
  children?: any;
  [key: string]: any;
}

export interface SelectLabelProps {
  children?: any;
  [key: string]: any;
}

export interface SelectSeparatorProps {
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface SelectContextValue {
  value: () => string;
  setValue: (value: string) => void;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  disabled: () => boolean;
  required: () => boolean;
  name: () => string;
  triggerId: string;
  valueId: string;
  contentId: string;
  anchorElement: () => HTMLElement | null;
  setAnchorElement: (el: HTMLElement | null) => void;
  highlightedIndex: () => number;
  setHighlightedIndex: (index: number) => void;
  items: () => HTMLElement[];
  registerItem: (el: HTMLElement) => void;
  unregisterItem: (el: HTMLElement) => void;
  itemTexts: Map<string, string>;
}

export const SelectContext = createContext<SelectContextValue>({
  value: () => '',
  setValue: () => {},
  isOpen: () => false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  disabled: () => false,
  required: () => false,
  name: () => '',
  triggerId: '',
  valueId: '',
  contentId: '',
  anchorElement: () => null,
  setAnchorElement: () => {},
  highlightedIndex: () => -1,
  setHighlightedIndex: () => {},
  items: () => [],
  registerItem: () => {},
  unregisterItem: () => {},
  itemTexts: new Map(),
});

// ============================================================================
// Root Component
// ============================================================================

export const Select = defineComponent<SelectProps>((props) => {
  const value = props.value || signal(props.defaultValue || '');
  const isOpen = props.open || signal(props.defaultOpen || false);
  const anchorElement = signal<HTMLElement | null>(null);
  const highlightedIndex = signal(-1);
  const itemsSignal = signal<HTMLElement[]>([]);
  const itemTexts = new Map<string, string>();

  const contextValue: SelectContextValue = {
    value: () => value(),
    setValue: (newValue) => {
      value.set(newValue);
      props.onValueChange?.(newValue);
    },
    isOpen: () => isOpen(),
    open: () => {
      if (props.disabled) return;
      isOpen.set(true);
      props.onOpenChange?.(true);
    },
    close: () => {
      isOpen.set(false);
      props.onOpenChange?.(false);
      highlightedIndex.set(-1);
    },
    toggle: () => {
      if (props.disabled) return;
      const newState = !isOpen();
      isOpen.set(newState);
      props.onOpenChange?.(newState);
      if (!newState) {
        highlightedIndex.set(-1);
      }
    },
    disabled: () => props.disabled || false,
    required: () => props.required || false,
    name: () => props.name || '',
    triggerId: generateId('select-trigger'),
    valueId: generateId('select-value'),
    contentId: generateId('select-content'),
    anchorElement: () => anchorElement(),
    setAnchorElement: (el) => anchorElement.set(el),
    highlightedIndex: () => highlightedIndex(),
    setHighlightedIndex: (index) => highlightedIndex.set(index),
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
    itemTexts,
  };

  return () =>
    jsx(SelectContext.Provider, {
      value: contextValue,
      children: props.children,
    });
});

// ============================================================================
// Trigger
// ============================================================================

export const SelectTrigger = defineComponent<SelectTriggerProps>((props) => {
  const ctx = useContext(SelectContext);

  onMount(() => {
    const el = document.getElementById(ctx.triggerId);
    if (el instanceof HTMLElement) {
      ctx.setAnchorElement(el);
    }
  });

  const handleClick = (e: MouseEvent) => {
    if (ctx.disabled()) return;
    ctx.toggle();
    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (ctx.disabled()) return;

    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        e.preventDefault();
        ctx.open();
        break;
      case 'ArrowUp':
        e.preventDefault();
        ctx.open();
        break;
    }

    props.onKeyDown?.(e);
  };

  const { onClick, onKeyDown, children, ...restProps } = props;

  return () =>
    jsx('button', {
      ...restProps,
      id: ctx.triggerId,
      type: 'button',
      role: 'combobox',
      'aria-controls': ctx.contentId,
      'aria-expanded': ctx.isOpen() ? 'true' : 'false',
      'aria-haspopup': 'listbox',
      'aria-required': ctx.required() ? 'true' : undefined,
      'aria-disabled': ctx.disabled() ? 'true' : undefined,
      'data-state': ctx.isOpen() ? 'open' : 'closed',
      'data-disabled': ctx.disabled() ? 'true' : undefined,
      'data-placeholder': ctx.value() ? undefined : 'true',
      disabled: ctx.disabled(),
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
});

// ============================================================================
// Value
// ============================================================================

export const SelectValue = defineComponent<SelectValueProps>((props) => {
  const ctx = useContext(SelectContext);

  return () => {
    const currentValue = ctx.value();
    const hasValue = currentValue !== '';

    // If has custom children, use them
    if (props.children) {
      return jsx('span', {
        ...props,
        id: ctx.valueId,
        children: props.children,
      });
    }

    // Show selected value text or placeholder
    const displayText = hasValue ? ctx.itemTexts.get(currentValue) || currentValue : props.placeholder;

    return jsx('span', {
      ...props,
      id: ctx.valueId,
      children: displayText,
    });
  };
});

// ============================================================================
// Icon
// ============================================================================

export const SelectIcon = defineComponent<SelectIconProps>((props) => () =>
    jsx('span', {
      ...props,
      'aria-hidden': 'true',
      children: props.children,
    }));

// ============================================================================
// Content
// ============================================================================

export const SelectContent = defineComponent<SelectContentProps>((props) => {
  const ctx = useContext(SelectContext);
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

    // Match trigger width
    content.style.minWidth = `${anchor.offsetWidth}px`;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = ctx.items().filter((item: HTMLElement) => !item.hasAttribute('data-disabled'));
    const currentIndex = ctx.highlightedIndex();

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        ctx.close();
        const trigger = document.getElementById(ctx.triggerId);
        trigger?.focus();
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (currentIndex >= 0 && items[currentIndex]) {
          const itemValue = items[currentIndex].getAttribute('data-value');
          if (itemValue) {
            ctx.setValue(itemValue);
            ctx.close();
            const trigger = document.getElementById(ctx.triggerId);
            trigger?.focus();
          }
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (items.length === 0) break;
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : currentIndex;
        ctx.setHighlightedIndex(nextIndex);
        items[nextIndex]?.scrollIntoView({ block: 'nearest' });
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (items.length === 0) break;
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        ctx.setHighlightedIndex(prevIndex);
        items[prevIndex]?.scrollIntoView({ block: 'nearest' });
        break;

      case 'Home':
        e.preventDefault();
        if (items.length > 0) {
          ctx.setHighlightedIndex(0);
          items[0]?.scrollIntoView({ block: 'nearest' });
        }
        break;

      case 'End':
        e.preventDefault();
        if (items.length > 0) {
          const lastIndex = items.length - 1;
          ctx.setHighlightedIndex(lastIndex);
          items[lastIndex]?.scrollIntoView({ block: 'nearest' });
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
            ctx.setHighlightedIndex(index);
            matchingItem.scrollIntoView({ block: 'nearest' });
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
      ctx.close();
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

    // Highlight selected item or first item
    const items = ctx.items().filter((item: HTMLElement) => !item.hasAttribute('data-disabled'));
    const selectedIndex = items.findIndex(
      (item: HTMLElement) => item.getAttribute('data-value') === ctx.value()
    );

    if (selectedIndex >= 0) {
      ctx.setHighlightedIndex(selectedIndex);
      setTimeout(() => items[selectedIndex]?.scrollIntoView({ block: 'nearest' }), 0);
    } else if (items.length > 0) {
      ctx.setHighlightedIndex(0);
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
    position,
    children,
    ...restProps
  } = props;

  return () => {
    if (!ctx.isOpen()) return null;

    return jsx(Portal, {
      children: jsx('div', {
        ...restProps,
        id: ctx.contentId,
        role: 'listbox',
        'aria-labelledby': ctx.triggerId,
        tabIndex: -1,
        onKeyDown: handleKeyDown,
        children,
      }),
    });
  };
});

// ============================================================================
// Viewport
// ============================================================================

export const SelectViewport = defineComponent<SelectViewportProps>((props) => () =>
    jsx('div', {
      ...props,
      style: {
        ...(typeof props.style === 'object' ? props.style : {}),
      },
      children: props.children,
    }));

// ============================================================================
// Item
// ============================================================================

export const SelectItem = defineComponent<SelectItemProps>((props) => {
  const ctx = useContext(SelectContext);
  const itemId = generateId('select-item');

  onMount(() => {
    const el = document.getElementById(itemId);
    if (el instanceof HTMLElement) {
      ctx.registerItem(el);

      // Store item text for display in SelectValue
      const text = props.textValue || el.textContent || props.value;
      ctx.itemTexts.set(props.value, text);

      return () => {
        ctx.unregisterItem(el);
        ctx.itemTexts.delete(props.value);
      };
    }
    return undefined;
  });

  const handleClick = (e: MouseEvent) => {
    if (props.disabled) return;

    ctx.setValue(props.value);
    ctx.close();

    const trigger = document.getElementById(ctx.triggerId);
    trigger?.focus();

    props.onClick?.(e);
  };

  const handlePointerMove = () => {
    if (props.disabled) return;

    const el = document.getElementById(itemId);
    if (el) {
      const items = ctx.items();
      const index = items.indexOf(el);
      if (index >= 0) {
        ctx.setHighlightedIndex(index);
      }
    }
  };

  const { value, disabled, textValue, onClick, children, ...restProps } = props;
  const isSelected = ctx.value() === value;
  const isHighlighted = () => {
    const items = ctx.items();
    const el = document.getElementById(itemId);
    if (!el) return false;
    const index = items.indexOf(el);
    return index === ctx.highlightedIndex();
  };

  return () =>
    jsx('div', {
      ...restProps,
      id: itemId,
      role: 'option',
      'aria-selected': isSelected ? 'true' : 'false',
      'aria-disabled': disabled ? 'true' : undefined,
      'data-state': isSelected ? 'checked' : 'unchecked',
      'data-disabled': disabled ? 'true' : undefined,
      'data-highlighted': isHighlighted() ? 'true' : undefined,
      'data-value': value,
      'data-text-value': textValue || (typeof children === 'string' ? children : undefined),
      onClick: handleClick,
      onPointerMove: handlePointerMove,
      children,
    });
});

// ============================================================================
// ItemText
// ============================================================================

export const SelectItemText = defineComponent<SelectItemTextProps>((props) => () =>
    jsx('span', {
      ...props,
      children: props.children,
    }));

// ============================================================================
// ItemIndicator
// ============================================================================

export const SelectItemIndicator = defineComponent<SelectItemIndicatorProps>((props) => () =>
    jsx('span', {
      ...props,
      'data-item-indicator': 'true',
      children: props.children,
    }));

// ============================================================================
// Group
// ============================================================================

export const SelectGroup = defineComponent<SelectGroupProps>((props) => {
  const groupId = generateId('select-group');

  return () =>
    jsx('div', {
      ...props,
      id: groupId,
      role: 'group',
      children: props.children,
    });
});

// ============================================================================
// Label
// ============================================================================

export const SelectLabel = defineComponent<SelectLabelProps>((props) => {
  const labelId = generateId('select-label');

  return () =>
    jsx('div', {
      ...props,
      id: labelId,
      role: 'presentation',
      children: props.children,
    });
});

// ============================================================================
// Separator
// ============================================================================

export const SelectSeparator = defineComponent<SelectSeparatorProps>((props) => {
  const separatorId = generateId('select-separator');

  return () =>
    jsx('div', {
      ...props,
      id: separatorId,
      role: 'separator',
      'aria-orientation': 'horizontal',
    });
});

// ============================================================================
// Sub-component Attachments
// ============================================================================

(Select as any).Trigger = SelectTrigger;
(Select as any).Value = SelectValue;
(Select as any).Icon = SelectIcon;
(Select as any).Content = SelectContent;
(Select as any).Viewport = SelectViewport;
(Select as any).Item = SelectItem;
(Select as any).ItemText = SelectItemText;
(Select as any).ItemIndicator = SelectItemIndicator;
(Select as any).Group = SelectGroup;
(Select as any).Label = SelectLabel;
(Select as any).Separator = SelectSeparator;
