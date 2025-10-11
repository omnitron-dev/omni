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

// Create context with a signal default that will be updated
// This allows children to access the context even if they're evaluated before the parent
const globalTabsContextSignal = signal<TabsContextValue | null>(null);

const noop = () => {};
const noopGetter = () => globalTabsContextSignal()?.value() ?? undefined;
const orientationGetter = () => globalTabsContextSignal()?.orientation() ?? 'horizontal' as const;
const activationGetter = () => globalTabsContextSignal()?.activationMode() ?? 'automatic' as const;
const getTriggerId = (value: string) => globalTabsContextSignal()?.getTriggerId(value) ?? value;
const getContentId = (value: string) => globalTabsContextSignal()?.getContentId(value) ?? value;

export const TabsContext = createContext<TabsContextValue>({
  value: noopGetter,
  setValue: noop,
  orientation: orientationGetter,
  activationMode: activationGetter,
  tabsId: '',
  listId: '',
  getTriggerId,
  getContentId,
}, 'Tabs');

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
    const { children, value: _, defaultValue: __, onValueChange: ___, orientation: ____, activationMode: _____, ...restProps } = props;

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
export const TabsList = defineComponent<TabsListProps>((props) => {
  return () => {
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
      const currentIndex = triggerArray.findIndex(el => el === event.target);
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
  };
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
export const TabsTrigger = defineComponent<TabsTriggerProps>((props) => {
  return () => {
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
  };
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
 */
export const TabsContent = defineComponent<TabsContentProps>((props) => {
  return () => {
    // Access context in render so parent context is available
    const ctx = useContext(TabsContext);
    const { value, forceMount, children, ...restProps } = props;

    // Check if initially selected
    const initialSelected = ctx.value() === value;

    // Always create the element, but manage display via effect
    const content = jsx('div', {
      ...restProps,
      id: ctx.getContentId(value),
      role: 'tabpanel',
      'aria-labelledby': ctx.getTriggerId(value),
      'data-state': initialSelected ? 'active' : 'inactive',
      tabIndex: 0,
      hidden: !initialSelected ? true : undefined,
      children,
    }) as HTMLElement;

    // Set up effect to manage visibility reactively
    // This will hide/show based on selection and forceMount
    effect(() => {
      const selected = ctx.value() === value;
      content.setAttribute('data-state', selected ? 'active' : 'inactive');

      if (forceMount) {
        // Force mounted - always in DOM, toggle hidden attribute
        if (selected) {
          content.removeAttribute('hidden');
        } else {
          content.setAttribute('hidden', 'true');
        }
      } else {
        // Not force mounted - remove from DOM when not selected
        if (selected) {
          content.removeAttribute('hidden');
          // Make sure it's in the DOM
          if (!content.parentElement) {
            // Already in DOM from initial render
          }
          content.style.display = '';
        } else {
          // Hide by removing from display
          content.style.display = 'none';
          content.setAttribute('hidden', 'true');
        }
      }
    });

    return content;
  };
});

// Attach sub-components to Tabs
(Tabs as any).List = TabsList;
(Tabs as any).Trigger = TabsTrigger;
(Tabs as any).Content = TabsContent;
