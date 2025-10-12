/**
 * ContextMenu Primitive
 *
 * A menu triggered by right-clicking (or long-pressing on touch devices) on an element.
 *
 * Based on WAI-ARIA Menu pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/menu/
 */

import { defineComponent } from '../core/component/define.js';
import { signal } from '../core/reactivity/signal.js';
import { createContext, useContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { jsx } from '../jsx-runtime.js';
import { Portal } from '../control-flow/Portal.js';
import { generateId } from './utils/id.js';

// ============================================================================
// Types
// ============================================================================

export interface ContextMenuProps {
  children?: any;
  onOpenChange?: (open: boolean) => void;
}

export interface ContextMenuTriggerProps {
  children?: any;
  disabled?: boolean;
  [key: string]: any;
}

export interface ContextMenuContentProps {
  children?: any;
  loop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface ContextMenuContextValue {
  isOpen: () => boolean;
  open: (x: number, y: number) => void;
  close: () => void;
  position: () => { x: number; y: number } | null;
  menuId: string;
}

const noop = () => {};
const noopGetter = () => false;
const noopPositionGetter = () => null;

export const ContextMenuContext = createContext<ContextMenuContextValue>(
  {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    position: noopPositionGetter,
    menuId: '',
  },
  'ContextMenu'
);

// ============================================================================
// Components
// ============================================================================

/**
 * ContextMenu root component
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenu.Trigger>
 *     <div>Right click here</div>
 *   </ContextMenu.Trigger>
 *   <ContextMenu.Content>
 *     <ContextMenu.Item>Cut</ContextMenu.Item>
 *     <ContextMenu.Item>Copy</ContextMenu.Item>
 *     <ContextMenu.Item>Paste</ContextMenu.Item>
 *   </ContextMenu.Content>
 * </ContextMenu>
 * ```
 */
export const ContextMenu = defineComponent<ContextMenuProps>((props) => {
  const isOpen = signal(false);
  const position = signal<{ x: number; y: number } | null>(null);

  const menuId = generateId('context-menu');

  const contextValue: ContextMenuContextValue = {
    isOpen: () => isOpen(),
    open: (x: number, y: number) => {
      position.set({ x, y });
      isOpen.set(true);
      props.onOpenChange?.(true);
    },
    close: () => {
      isOpen.set(false);
      props.onOpenChange?.(false);
    },
    position: () => position(),
    menuId,
  };

  return () =>
    jsx(ContextMenuContext.Provider, {
      value: contextValue,
      children: props.children,
    });
});

/**
 * ContextMenu Trigger component
 */
export const ContextMenuTrigger = defineComponent<ContextMenuTriggerProps>((props) => {
  const ctx = useContext(ContextMenuContext);

  const handleContextMenu = (e: MouseEvent) => {
    if (props.disabled) return;

    e.preventDefault();
    e.stopPropagation();

    ctx.open(e.clientX, e.clientY);
  };

  return () =>
    jsx('div', {
      ...props,
      onContextMenu: handleContextMenu,
    });
});

/**
 * ContextMenu Content component
 */
export const ContextMenuContent = defineComponent<ContextMenuContentProps>((props) => {
  const ctx = useContext(ContextMenuContext);
  let contentRef: HTMLElement | null = null;

  onMount(() => {
    if (!ctx.isOpen() || !contentRef) return;

    const pos = ctx.position();
    if (!pos) return;

    // Position at click location
    contentRef.style.position = 'fixed';
    contentRef.style.left = `${pos.x}px`;
    contentRef.style.top = `${pos.y}px`;

    // Adjust if off-screen
    const rect = contentRef.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contentRef.style.left = `${pos.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      contentRef.style.top = `${pos.y - rect.height}px`;
    }

    // Focus first item
    const firstItem = contentRef.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    firstItem?.focus();
  });

  const handleEscapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      ctx.close();
      props.onEscapeKeyDown?.(e);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (contentRef && e.target instanceof Node && !contentRef.contains(e.target)) {
      ctx.close();
    }
  };

  onMount(() => {
    if (ctx.isOpen()) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('contextmenu', handleClickOutside);

      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('contextmenu', handleClickOutside);
      };
    }
    return undefined;
  });

  return () => {
    if (!ctx.isOpen()) return null;

    return jsx(Portal, {
      children: jsx('div', {
        ...props,
        ref: ((el: HTMLElement) => (contentRef = el)) as any,
        id: ctx.menuId,
        role: 'menu',
        'data-state': 'open',
        tabIndex: -1,
        onKeyDown: handleEscapeKey,
      }),
    });
  };
});

/**
 * ContextMenu Item component
 */
export const ContextMenuItem = defineComponent<{
  children?: any;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  [key: string]: any;
}>((props) => {
  const ctx = useContext(ContextMenuContext);

  const handleClick = (e: Event) => {
    if (props.disabled) return;

    props.onSelect?.(e);
    ctx.close();
  };

  return () =>
    jsx('div', {
      ...props,
      role: 'menuitem',
      tabIndex: props.disabled ? -1 : 0,
      'data-disabled': props.disabled ? '' : undefined,
      onClick: handleClick,
    });
});

/**
 * ContextMenu Separator component
 */
export const ContextMenuSeparator = defineComponent<{ [key: string]: any }>(
  (props) => () =>
    jsx('div', {
      ...props,
      role: 'separator',
      'aria-orientation': 'horizontal',
    })
);

/**
 * ContextMenu Label component
 */
export const ContextMenuLabel = defineComponent<{ children?: any; [key: string]: any }>(
  (props) => () =>
    jsx('div', {
      ...props,
      'data-context-menu-label': '',
    })
);

// ============================================================================
// Sub-component Attachment
// ============================================================================

(ContextMenu as any).Trigger = ContextMenuTrigger;
(ContextMenu as any).Content = ContextMenuContent;
(ContextMenu as any).Item = ContextMenuItem;
(ContextMenu as any).Separator = ContextMenuSeparator;
(ContextMenu as any).Label = ContextMenuLabel;
