/**
 * Menubar Component
 *
 * A horizontal menu bar with dropdown menus (like desktop application menus).
 *
 * @example
 * ```tsx
 * <Menubar>
 *   <Menubar.Menu>
 *     <Menubar.Trigger>File</Menubar.Trigger>
 *     <Menubar.Content>
 *       <Menubar.Item>New</Menubar.Item>
 *       <Menubar.Item>Open</Menubar.Item>
 *       <Menubar.Separator />
 *       <Menubar.Item>Exit</Menubar.Item>
 *     </Menubar.Content>
 *   </Menubar.Menu>
 * </Menubar>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';
import { signal, type WritableSignal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { Portal } from '../control-flow/Portal.js';
import { generateId, calculatePosition, applyPosition, type Side, type Align } from './utils/index.js';

export interface MenubarProps {
  /**
   * Children (Menubar.Menu components)
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

export interface MenubarMenuProps {
  /**
   * Children (Trigger and Content)
   */
  children?: any;

  [key: string]: any;
}

export interface MenubarTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface MenubarContentProps {
  /**
   * Side to position content
   */
  side?: Side;

  /**
   * Alignment
   */
  align?: Align;

  /**
   * Offset from trigger
   */
  sideOffset?: number;

  /**
   * Alignment offset
   */
  alignOffset?: number;

  children?: any;
  [key: string]: any;
}

export interface MenubarItemProps {
  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Click handler
   */
  onSelect?: () => void;

  children?: any;
  [key: string]: any;
}

export interface MenubarSeparatorProps {
  [key: string]: any;
}

export interface MenubarLabelProps {
  children?: any;
  [key: string]: any;
}

export interface MenubarShortcutProps {
  children?: any;
  [key: string]: any;
}

export interface MenubarContextValue {
  openMenuId: () => string | null;
  setOpenMenuId: (id: string | null) => void;
}

export interface MenubarMenuContextValue {
  menuId: string;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
}

const MenubarContext = createContext<MenubarContextValue>({
  openMenuId: () => null,
  setOpenMenuId: () => {},
});

const MenubarMenuContext = createContext<MenubarMenuContextValue>({
  menuId: '',
  isOpen: () => false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  triggerId: '',
  contentId: '',
});

/**
 * Menubar Root
 */
export const Menubar = defineComponent<MenubarProps>((props) => {
  const openMenuId: WritableSignal<string | null> = signal<string | null>(null);

  const contextValue: MenubarContextValue = {
    openMenuId: () => openMenuId(),
    setOpenMenuId: (id) => openMenuId.set(id),
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(MenubarContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      ...props,
      'data-menubar': '',
      role: 'menubar',
      children,
    });
  };
});

/**
 * Menubar Menu
 *
 * A single menu within the menubar.
 */
export const MenubarMenu = defineComponent<MenubarMenuProps>((props) => {
  const menubarCtx = useContext(MenubarContext);
  const menuId = generateId('menubar-menu');
  const triggerId = generateId('menubar-trigger');
  const contentId = generateId('menubar-content');

  const isOpen = () => menubarCtx.openMenuId() === menuId;

  const open = () => {
    menubarCtx.setOpenMenuId(menuId);
  };

  const close = () => {
    if (isOpen()) {
      menubarCtx.setOpenMenuId(null);
    }
  };

  const toggle = () => {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  };

  const menuContextValue: MenubarMenuContextValue = {
    menuId,
    isOpen,
    open,
    close,
    toggle,
    triggerId,
    contentId,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(MenubarMenuContext, menuContextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    const menu = jsx('div', {
      ...props,
      'data-menubar-menu': '',
      children,
    }) as HTMLElement;

    // Reactively update data-state (Pattern 18)
    effect(() => {
      menu.setAttribute('data-state', isOpen() ? 'open' : 'closed');
    });

    return menu;
  };
});

/**
 * Menubar Trigger
 */
export const MenubarTrigger = defineComponent<MenubarTriggerProps>((props) => {
  const ctx = useContext(MenubarMenuContext);

  return () => {
    const { children, ...restProps } = props;
    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    const handleClick = () => {
      ctx.toggle();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.toggle();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        ctx.open();
      }
    };

    const trigger = jsx('button', {
      ...restProps,
      id: ctx.triggerId,
      'data-menubar-trigger': '',
      'aria-haspopup': 'menu',
      'aria-controls': ctx.contentId,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children: evaluatedChildren,
    }) as HTMLButtonElement;

    // Reactively update state attributes (Pattern 18)
    effect(() => {
      const open = ctx.isOpen();
      trigger.setAttribute('data-state', open ? 'open' : 'closed');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    return trigger;
  };
});

/**
 * Menubar Content
 */
export const MenubarContent = defineComponent<MenubarContentProps>((props) => {
  const ctx = useContext(MenubarMenuContext);
  const contentRef = signal<HTMLElement | null>(null);
  let cleanupFunctions: (() => void)[] = [];

  const handleClickOutside = (e: Event) => {
    const content = contentRef();
    const target = e.target as Node;

    // Check if click is outside content
    if (content && !content.contains(target)) {
      // Also check if click is on trigger
      const trigger = document.getElementById(ctx.triggerId);
      if (trigger && !trigger.contains(target)) {
        ctx.close();
      }
    }
  };

  const handleEscapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      ctx.close();
    }
  };

  const handleRef = (element: HTMLElement | null) => {
    // Cleanup previous listeners
    cleanupFunctions.forEach((fn) => fn());
    cleanupFunctions = [];

    contentRef.set(element);

    if (element) {
      // Add event listeners
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);

      cleanupFunctions.push(() => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleEscapeKey);
      });

      const trigger = document.getElementById(ctx.triggerId);
      if (trigger) {
        const position = calculatePosition(
          trigger,
          element,
          {
            side: props.side || 'bottom',
            align: props.align || 'start',
            sideOffset: props.sideOffset || 4,
            alignOffset: props.alignOffset || 0,
          },
        );
        applyPosition(element, position);
      }
    }
  };

  return () => {
    const { side, align, sideOffset, alignOffset, children, ...restProps } = props;
    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    const content = jsx('div', {
      ...restProps,
      ref: handleRef as any,
      id: ctx.contentId,
      'data-menubar-content': '',
      role: 'menu',
      'aria-labelledby': ctx.triggerId,
      tabIndex: -1,
      style: {
        display: ctx.isOpen() ? 'block' : 'none',
        ...restProps.style,
      },
      children: evaluatedChildren,
    }) as HTMLElement;

    // Reactively toggle visibility and state (Pattern 18)
    effect(() => {
      const open = ctx.isOpen();
      content.style.display = open ? 'block' : 'none';
      content.setAttribute('data-state', open ? 'open' : 'closed');
      content.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    return jsx(Portal, {
      children: content,
    });
  };
});

/**
 * Menubar Item
 */
export const MenubarItem = defineComponent<MenubarItemProps>((props) => {
  const ctx = useContext(MenubarMenuContext);

  return () => {
    const { disabled, onSelect, children, ...restProps } = props;
    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    const handleClick = () => {
      if (disabled) return;
      onSelect?.();
      ctx.close();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.();
        ctx.close();
      }
    };

    return jsx('div', {
      ...restProps,
      'data-menubar-item': '',
      'data-disabled': disabled ? '' : undefined,
      role: 'menuitem',
      tabIndex: disabled ? -1 : 0,
      'aria-disabled': disabled ? 'true' : undefined,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children: evaluatedChildren,
    });
  };
});

/**
 * Menubar Separator
 */
export const MenubarSeparator = defineComponent<MenubarSeparatorProps>((props) => () => jsx('div', {
      ...props,
      'data-menubar-separator': '',
      role: 'separator',
      'aria-orientation': 'horizontal',
    }));

/**
 * Menubar Label
 */
export const MenubarLabel = defineComponent<MenubarLabelProps>((props) => () => {
    const { children, ...restProps } = props;
    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    return jsx('div', {
      ...restProps,
      'data-menubar-label': '',
      children: evaluatedChildren,
    });
  });

/**
 * Menubar Shortcut
 */
export const MenubarShortcut = defineComponent<MenubarShortcutProps>((props) => () => {
    const { children, ...restProps } = props;
    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    return jsx('span', {
      ...restProps,
      'data-menubar-shortcut': '',
      'aria-hidden': 'true',
      children: evaluatedChildren,
    });
  });

// Attach sub-components
(Menubar as any).Menu = MenubarMenu;
(Menubar as any).Trigger = MenubarTrigger;
(Menubar as any).Content = MenubarContent;
(Menubar as any).Item = MenubarItem;
(Menubar as any).Separator = MenubarSeparator;
(Menubar as any).Label = MenubarLabel;
(Menubar as any).Shortcut = MenubarShortcut;

// Display names
Menubar.displayName = 'Menubar';
MenubarMenu.displayName = 'Menubar.Menu';
MenubarTrigger.displayName = 'Menubar.Trigger';
MenubarContent.displayName = 'Menubar.Content';
MenubarItem.displayName = 'Menubar.Item';
MenubarSeparator.displayName = 'Menubar.Separator';
MenubarLabel.displayName = 'Menubar.Label';
MenubarShortcut.displayName = 'Menubar.Shortcut';
