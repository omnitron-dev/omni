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
import { computed } from '../core/reactivity/computed.js';
import { createContext, useContext } from '../core/component/context.js';
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

// Create context with default implementation
const noop = () => {};
const noopGetter = () => undefined as string | undefined;
const orientationGetter = () => 'horizontal' as const;
const activationGetter = () => 'automatic' as const;

export const TabsContext = createContext<TabsContextValue>({
  value: noopGetter,
  setValue: noop,
  orientation: orientationGetter,
  activationMode: activationGetter,
  tabsId: '',
  listId: '',
  getTriggerId: (value: string) => value,
  getContentId: (value: string) => value,
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
  const internalValue = signal<string | undefined>(props.defaultValue);
  const valueSignal = props.value || internalValue;

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
  const ctx = useContext(TabsContext);

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

  return () => {
    const { children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      id: ctx.listId,
      role: 'tablist',
      'aria-orientation': ctx.orientation(),
      onKeyDown: handleKeyDown,
      children,
    });
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
  const ctx = useContext(TabsContext);

  const isSelected = computed(() => ctx.value() === props.value);

  const handleClick = () => {
    if (!props.disabled) {
      ctx.setValue(props.value);
    }
  };

  const handleFocus = () => {
    // Automatic activation on focus
    if (!props.disabled && ctx.activationMode() === 'automatic') {
      ctx.setValue(props.value);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Manual activation requires Enter or Space
    if (ctx.activationMode() === 'manual' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      handleClick();
    }
  };

  return () => {
    const { value, disabled, children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      id: ctx.getTriggerId(value),
      type: 'button',
      role: 'tab',
      'aria-selected': isSelected(),
      'aria-controls': ctx.getContentId(value),
      'data-state': isSelected() ? 'active' : 'inactive',
      'data-disabled': disabled ? '' : undefined,
      disabled,
      tabIndex: isSelected() ? 0 : -1,
      onClick: handleClick,
      onFocus: handleFocus,
      onKeyDown: handleKeyDown,
      children,
    });
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
  const ctx = useContext(TabsContext);

  const isSelected = computed(() => ctx.value() === props.value);

  return () => {
    const { value, forceMount, children, ...restProps } = props;

    // Don't render unless selected or force mounted
    if (!isSelected() && !forceMount) {
      return null;
    }

    return jsx('div', {
      ...restProps,
      id: ctx.getContentId(value),
      role: 'tabpanel',
      'aria-labelledby': ctx.getTriggerId(value),
      'data-state': isSelected() ? 'active' : 'inactive',
      tabIndex: 0,
      hidden: !isSelected() ? true : undefined,
      children,
    });
  };
});

// Attach sub-components to Tabs
(Tabs as any).List = TabsList;
(Tabs as any).Trigger = TabsTrigger;
(Tabs as any).Content = TabsContent;
