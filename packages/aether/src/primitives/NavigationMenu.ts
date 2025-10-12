/**
 * Navigation Menu Primitive
 *
 * A complex navigation menu with nested sub-menus and trigger-based navigation.
 * Supports keyboard navigation and ARIA for accessibility.
 *
 * @example
 * ```tsx
 * <NavigationMenu>
 *   <NavigationMenu.List>
 *     <NavigationMenu.Item>
 *       <NavigationMenu.Trigger>Products</NavigationMenu.Trigger>
 *       <NavigationMenu.Content>
 *         <NavigationMenu.Link href="/products/new">New</NavigationMenu.Link>
 *         <NavigationMenu.Link href="/products/sale">Sale</NavigationMenu.Link>
 *       </NavigationMenu.Content>
 *     </NavigationMenu.Item>
 *   </NavigationMenu.List>
 * </NavigationMenu>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface NavigationMenuProps {
  children?: any;
  /** Default value for uncontrolled */
  defaultValue?: string;
  /** Current active value (controlled) */
  value?: string;
  /** Callback when value changes */
  onValueChange?: (value: string) => void;
  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
  [key: string]: any;
}

export interface NavigationMenuListProps {
  children?: any;
  [key: string]: any;
}

export interface NavigationMenuItemProps {
  children?: any;
  /** Unique value for this item */
  value?: string;
  [key: string]: any;
}

export interface NavigationMenuTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface NavigationMenuContentProps {
  children?: any;
  /** Whether to render in portal */
  portal?: boolean;
  [key: string]: any;
}

export interface NavigationMenuLinkProps {
  children?: any;
  /** Link href */
  href?: string;
  /** Whether link is active */
  active?: boolean;
  [key: string]: any;
}

export interface NavigationMenuIndicatorProps {
  children?: any;
  [key: string]: any;
}

export interface NavigationMenuViewportProps {
  children?: any;
  [key: string]: any;
}

interface NavigationMenuContextValue {
  value: Signal<string>;
  orientation: 'horizontal' | 'vertical';
  setValue: (value: string) => void;
  isActive: (value: string) => boolean;
}

interface NavigationMenuItemContextValue {
  value: string;
  isActive: Signal<boolean>;
  trigger: () => void;
}

// ============================================================================
// Context
// ============================================================================

const NavigationMenuContext = createContext<NavigationMenuContextValue | undefined>(undefined);
const NavigationMenuItemContext = createContext<NavigationMenuItemContextValue | undefined>(undefined);

function useNavigationMenuContext(): NavigationMenuContextValue {
  const context = useContext(NavigationMenuContext);
  if (!context) {
    throw new Error('NavigationMenu components must be used within NavigationMenu');
  }
  return context;
}

function useNavigationMenuItemContext(): NavigationMenuItemContextValue {
  const context = useContext(NavigationMenuItemContext);
  if (!context) {
    throw new Error('NavigationMenu.Item components must be used within NavigationMenu.Item');
  }
  return context;
}

// ============================================================================
// Utilities
// ============================================================================

let navMenuIdCounter = 0;
function generateNavMenuId(prefix: string): string {
  return `${prefix}-${++navMenuIdCounter}`;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Navigation Menu Root
 */
export const NavigationMenu = defineComponent<NavigationMenuProps>((props) => {
  const internalValue: WritableSignal<string> = signal<string>(props.defaultValue ?? '');

  const isControlled = () => props.value !== undefined;
  const currentValue = () => (isControlled() ? (props.value ?? '') : internalValue());

  const setValue = (value: string) => {
    if (!isControlled()) {
      internalValue.set(value);
    }
    props.onValueChange?.(value);
  };

  const isActive = (value: string) => currentValue() === value;

  const contextValue: NavigationMenuContextValue = {
    value: computed(() => currentValue()),
    orientation: props.orientation ?? 'horizontal',
    setValue,
    isActive,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(NavigationMenuContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const orientation = props.orientation ?? 'horizontal';

    return jsx('nav', {
      'data-navigation-menu': '',
      'data-orientation': orientation,
      'aria-label': 'Main navigation',
      children,
    });
  };
});

/**
 * Navigation Menu List
 */
export const NavigationMenuList = defineComponent<NavigationMenuListProps>((props) => {
  const context = useNavigationMenuContext();

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { children: _children, ...restProps } = props;

    return jsx('ul', {
      ...restProps,
      'data-navigation-menu-list': '',
      'data-orientation': context.orientation,
      children,
    });
  };
});

/**
 * Navigation Menu Item
 */
export const NavigationMenuItem = defineComponent<NavigationMenuItemProps>((props) => {
  const context = useNavigationMenuContext();
  const value = props.value ?? generateNavMenuId('nav-item');

  const trigger = () => {
    const currentValue = context.value();
    // Toggle: if already active, close it; otherwise activate
    context.setValue(currentValue === value ? '' : value);
  };

  // Create a computed signal for isActive
  const isActive = computed(() => context.isActive(value));

  const itemContextValue: NavigationMenuItemContextValue = {
    value,
    isActive,
    trigger,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(NavigationMenuItemContext, itemContextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    const item = jsx('li', {
      'data-navigation-menu-item': '',
      children,
    }) as HTMLElement;

    // Reactively update data-active attribute (Pattern 18)
    effect(() => {
      const active = isActive();
      if (active) {
        item.setAttribute('data-active', '');
      } else {
        item.removeAttribute('data-active');
      }
    });

    return item;
  };
});

/**
 * Navigation Menu Trigger
 */
export const NavigationMenuTrigger = defineComponent<NavigationMenuTriggerProps>((props) => {
  const itemContext = useNavigationMenuItemContext();

  const handleClick = (e: MouseEvent) => {
    itemContext.trigger();
    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      itemContext.trigger();
    }
    props.onKeyDown?.(e);
  };

  return () => {
    const { children, ...restProps } = props;

    const trigger = jsx('button', {
      ...restProps,
      type: 'button',
      'data-navigation-menu-trigger': '',
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    }) as HTMLButtonElement;

    // Reactively update state attributes (Pattern 18)
    effect(() => {
      const active = itemContext.isActive();
      trigger.setAttribute('data-state', active ? 'open' : 'closed');
      trigger.setAttribute('aria-expanded', String(active));
    });

    return trigger;
  };
});

/**
 * Navigation Menu Content
 */
export const NavigationMenuContent = defineComponent<NavigationMenuContentProps>((props) => {
  const itemContext = useNavigationMenuItemContext();

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { children: _children, portal = false, ...restProps } = props;

    const content = jsx('div', {
      ...restProps,
      'data-navigation-menu-content': '',
      children,
    }) as HTMLElement;

    // Reactively toggle visibility and state (Pattern 18)
    effect(() => {
      const active = itemContext.isActive();
      content.style.display = active ? 'block' : 'none';
      content.setAttribute('data-state', active ? 'open' : 'closed');
    });

    return content;
  };
});

/**
 * Navigation Menu Link
 */
export const NavigationMenuLink = defineComponent<NavigationMenuLinkProps>((props) => {
  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { children: _children, href, active, ...restProps } = props;

    return jsx('a', {
      ...restProps,
      href,
      'data-navigation-menu-link': '',
      'data-active': active ? '' : undefined,
      'aria-current': active ? 'page' : undefined,
      children,
    });
  };
});

/**
 * Navigation Menu Indicator
 * Visual indicator showing which item is active
 */
export const NavigationMenuIndicator = defineComponent<NavigationMenuIndicatorProps>((props) => {
  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { children: _children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-navigation-menu-indicator': '',
      'aria-hidden': 'true',
      children,
    });
  };
});

/**
 * Navigation Menu Viewport
 * Container for content positioning
 */
export const NavigationMenuViewport = defineComponent<NavigationMenuViewportProps>((props) => {
  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { children: _children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-navigation-menu-viewport': '',
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(NavigationMenu as any).List = NavigationMenuList;
(NavigationMenu as any).Item = NavigationMenuItem;
(NavigationMenu as any).Trigger = NavigationMenuTrigger;
(NavigationMenu as any).Content = NavigationMenuContent;
(NavigationMenu as any).Link = NavigationMenuLink;
(NavigationMenu as any).Indicator = NavigationMenuIndicator;
(NavigationMenu as any).Viewport = NavigationMenuViewport;

// ============================================================================
// Type augmentation
// ============================================================================

export interface NavigationMenuComponent {
  (props: NavigationMenuProps): any;
  List: typeof NavigationMenuList;
  Item: typeof NavigationMenuItem;
  Trigger: typeof NavigationMenuTrigger;
  Content: typeof NavigationMenuContent;
  Link: typeof NavigationMenuLink;
  Indicator: typeof NavigationMenuIndicator;
  Viewport: typeof NavigationMenuViewport;
}
