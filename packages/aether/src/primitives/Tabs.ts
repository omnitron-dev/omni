/**
 * Tabs Primitive
 *
 * A set of layered sections of content (tab panels) displayed one at a time
 *
 * Based on WAI-ARIA Tabs pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 */

import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

/**
 * Tabs context
 */
export interface TabsContextValue {
  value: () => string | undefined;
  setValue: (value: string) => void;
  orientation: () => 'horizontal' | 'vertical';
  activationMode: () => 'automatic' | 'manual';
  tabsId: string;
  listId: string;
  getTriggerId: (value: string) => string;
  getContentId: (value: string) => string;
}

// Create a default context value that can be used before parent is set up
const defaultValueSignal = signal<string | undefined>(undefined);

const defaultContextValue: TabsContextValue = {
  value: () => defaultValueSignal(),
  setValue: (value: string) => defaultValueSignal.set(value),
  orientation: () => 'horizontal' as const,
  activationMode: () => 'automatic' as const,
  tabsId: '',
  listId: '',
  getTriggerId: (value: string) => value,
  getContentId: (value: string) => value,
};

// Create context with a signal that delegates to global or default
// This allows children to access the context even if they're evaluated before the parent
const globalTabsContextSignal = signal<TabsContextValue>(defaultContextValue);

const noopGetter = () => globalTabsContextSignal().value();
const orientationGetter = () => globalTabsContextSignal().orientation();
const activationGetter = () => globalTabsContextSignal().activationMode();
const getTriggerId = (value: string) => globalTabsContextSignal().getTriggerId(value);
const getContentId = (value: string) => globalTabsContextSignal().getContentId(value);

export const TabsContext = createContext<TabsContextValue>(
  {
    value: noopGetter,
    setValue: (value: string) => globalTabsContextSignal().setValue(value),
    orientation: orientationGetter,
    activationMode: activationGetter,
    get tabsId() {
      return globalTabsContextSignal().tabsId;
    },
    get listId() {
      return globalTabsContextSignal().listId;
    },
    getTriggerId,
    getContentId,
  },
  'Tabs'
);

/**
 * Tabs props
 */
export interface TabsProps {
  /**
   * Controlled active tab value
   */
  value?: WritableSignal<string | undefined>;

  /**
   * Initial active tab value
   */
  defaultValue?: string;

  /**
   * Callback when active tab changes
   */
  onValueChange?: (value: string) => void;

  /**
   * Layout orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Activation mode
   * @default 'automatic'
   */
  activationMode?: 'automatic' | 'manual';

  /**
   * Children
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Tabs root component
 *
 * @example
 * ```tsx
 * <Tabs defaultValue="account">
 *   <Tabs.List>
 *     <Tabs.Trigger value="account">Account</Tabs.Trigger>
 *     <Tabs.Trigger value="password">Password</Tabs.Trigger>
 *   </Tabs.List>
 *   <Tabs.Content value="account">Account settings</Tabs.Content>
 *   <Tabs.Content value="password">Password settings</Tabs.Content>
 * </Tabs>
 * ```
 */
export const Tabs = defineComponent<TabsProps>((props) => {
  // Match Accordion's pattern - create valueSignal directly or use provided one
  const valueSignal = props.value || signal<string | undefined>(props.defaultValue);

  const orientation = signal(props.orientation || 'horizontal');
  const activationMode = signal(props.activationMode || 'automatic');

  // Generate stable IDs for accessibility
  const baseId = generateId('tabs');
  const tabsId = baseId;
  const listId = `${baseId}-list`;

  const getTriggerId = (value: string) => `${baseId}-trigger-${value}`;
  const getContentId = (value: string) => `${baseId}-content-${value}`;

  // Context value
  const contextValue: TabsContextValue = {
    value: () => valueSignal(),
    setValue: (value: string) => {
      valueSignal.set(value);
      props.onValueChange?.(value);
    },
    orientation: () => orientation(),
    activationMode: () => activationMode(),
    tabsId,
    listId,
    getTriggerId,
    getContentId,
  };

  // CRITICAL FIX: Set global context signal so children can access it even if evaluated before parent
  globalTabsContextSignal.set(contextValue);

  // CRITICAL FIX: Manually set up context in setup phase so children can access it
  // This is necessary because Context.Provider is called during render, which is too late
  provideContext(TabsContext, contextValue);

  return () => {
    const {
      children,
      value: _,
      defaultValue: __,
      onValueChange: ___,
      orientation: ____,
      activationMode: _____,
      ...restProps
    } = props;

    return jsx('div', {
      ...restProps,
      id: tabsId,
      'data-orientation': orientation(),
      children: jsx(TabsContext.Provider, {
        value: contextValue,
        children,
      }),
    });
  };
});

/**
 * Tabs list props
 */
export interface TabsListProps {
  /**
   * Children
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Tabs list component - container for triggers
 */
export const TabsList = defineComponent<TabsListProps>((props) => () => {
  // Access context in render so parent context is available
  const ctx = useContext(TabsContext);
  const { children, ...restProps } = props;

  // Handle keyboard navigation
  const handleKeyDown = (event: KeyboardEvent) => {
    const orientation = ctx.orientation();
    const isHorizontal = orientation === 'horizontal';
    const isVertical = orientation === 'vertical';

    // Get all trigger buttons from the current target (the tablist)
    const listElement = event.currentTarget as HTMLElement;
    const triggers = listElement.querySelectorAll('[role="tab"]:not([disabled])');
    if (!triggers || triggers.length === 0) return;

    const triggerArray = Array.from(triggers) as HTMLElement[];
    // Use document.activeElement instead of event.target for keyboard navigation
    // event.target is the element that dispatched the event (tablist), but we want the focused element
    const currentIndex = triggerArray.findIndex((el) => el === document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;

    // Navigate based on orientation
    if ((isHorizontal && event.key === 'ArrowRight') || (isVertical && event.key === 'ArrowDown')) {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % triggerArray.length;
    } else if ((isHorizontal && event.key === 'ArrowLeft') || (isVertical && event.key === 'ArrowUp')) {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + triggerArray.length) % triggerArray.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIndex = triggerArray.length - 1;
    }

    if (nextIndex !== currentIndex) {
      triggerArray[nextIndex]?.focus();
    }
  };

  const list = jsx('div', {
    ...restProps,
    id: ctx.listId,
    role: 'tablist',
    'aria-orientation': ctx.orientation(),
    onKeyDown: handleKeyDown,
    children,
  }) as HTMLElement;

  // Set up effect to update orientation reactively
  effect(() => {
    list.setAttribute('aria-orientation', ctx.orientation());
  });

  return list;
});

/**
 * Tabs trigger props
 */
export interface TabsTriggerProps {
  /**
   * Tab identifier
   */
  value: string;

  /**
   * Whether the trigger is disabled
   */
  disabled?: boolean;

  /**
   * Children
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Tabs trigger component - tab button
 */
export const TabsTrigger = defineComponent<TabsTriggerProps>((props) => () => {
  // Access context in render, not setup, so parent context is available
  const ctx = useContext(TabsContext);
  const { value, disabled, children, ...restProps } = props;

  // Compute isSelected directly in render
  const isSelected = ctx.value() === value;

  const handleClick = () => {
    if (!disabled) {
      ctx.setValue(value);
    }
  };

  const handleFocus = () => {
    // Automatic activation on focus
    if (!disabled && ctx.activationMode() === 'automatic') {
      ctx.setValue(value);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Manual activation requires Enter or Space
    if (ctx.activationMode() === 'manual' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      handleClick();
    }
  };

  const button = jsx('button', {
    ...restProps,
    id: ctx.getTriggerId(value),
    type: 'button',
    role: 'tab',
    'aria-selected': String(isSelected),
    'aria-controls': ctx.getContentId(value),
    'data-state': isSelected ? 'active' : 'inactive',
    'data-disabled': disabled ? '' : undefined,
    disabled,
    tabIndex: isSelected ? 0 : -1,
    onClick: handleClick,
    onFocus: handleFocus,
    onKeyDown: handleKeyDown,
    children,
  }) as HTMLElement;

  // Set up effect to update attributes reactively when context value changes
  effect(() => {
    const selected = ctx.value() === value;
    button.setAttribute('aria-selected', String(selected));
    button.setAttribute('data-state', selected ? 'active' : 'inactive');
    button.setAttribute('tabindex', selected ? '0' : '-1');
  });

  return button;
});

/**
 * Tabs content props
 */
export interface TabsContentProps {
  /**
   * Tab identifier
   */
  value: string;

  /**
   * Keep mounted when inactive (for animations)
   */
  forceMount?: boolean;

  /**
   * Children
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Tabs content component - tab panel
 *
 * IMPORTANT PATTERN: Aether Framework Reactivity
 * ===============================================
 * Components in Aether do NOT re-render when signals change. The render function
 * runs ONCE per component instance. Reactivity is achieved through effect() blocks
 * that update existing DOM nodes.
 *
 * ❌ WRONG (doesn't work):
 * ```typescript
 * return () => {
 *   if (!isSelected()) return null;  // Never re-renders when isSelected changes!
 *   return <div>Content</div>;
 * }
 * ```
 *
 * ✅ CORRECT (works):
 * ```typescript
 * return () => {
 *   const div = <div>Content</div>;  // Always create element
 *   effect(() => {
 *     div.style.display = isSelected() ? '' : 'none';  // Effect updates visibility
 *   });
 *   return div;
 * }
 * ```
 */
export const TabsContent = defineComponent<TabsContentProps>((props) => () => {
  // Access context in render so parent context is available
  const ctx = useContext(TabsContext);
  const { value, forceMount, children, ...restProps } = props;

  // Compute initial state
  const isSelected = ctx.value() === value;

  // Always create the element (framework doesn't support conditional rendering)
  const panel = jsx('div', {
    ...restProps,
    id: ctx.getContentId(value),
    role: 'tabpanel',
    'aria-labelledby': ctx.getTriggerId(value),
    'data-state': isSelected ? 'active' : 'inactive',
    tabIndex: 0,
    style: forceMount ? (isSelected ? undefined : 'display: none;') : isSelected ? undefined : 'display: none;',
    children,
  }) as HTMLElement;

  // Set up effect to update visibility reactively when context value changes
  effect(() => {
    const selected = ctx.value() === value;
    panel.setAttribute('data-state', selected ? 'active' : 'inactive');

    // Handle visibility based on forceMount
    if (forceMount) {
      // Keep in DOM but toggle visibility
      if (selected) {
        panel.style.display = '';
      } else {
        panel.style.display = 'none';
      }
    } else {
      // Toggle visibility - always keep in DOM for reactivity
      if (selected) {
        panel.style.display = '';
      } else {
        panel.style.display = 'none';
      }
    }
  });

  return panel;
});

// Attach sub-components to Tabs
(Tabs as any).List = TabsList;
(Tabs as any).Trigger = TabsTrigger;
(Tabs as any).Content = TabsContent;
