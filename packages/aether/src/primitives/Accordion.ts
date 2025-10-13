/**
 * Accordion Primitive
 *
 * Vertically stacked set of interactive headings that expand/collapse content panels
 *
 * Based on WAI-ARIA Accordion pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
 */

import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';
import { useControlledState } from '../utils/controlled-state.js';

/**
 * Accordion context
 */
export interface AccordionContextValue {
  type: () => 'single' | 'multiple';
  value: () => string | string[] | undefined;
  setValue: (value: string | string[]) => void;
  collapsible: () => boolean;
  disabled: () => boolean;
  orientation: () => 'horizontal' | 'vertical';
  accordionId: string;
}

// Global reactive context signal that will be updated during Accordion setup
// This allows children to access the context even if they're evaluated before the parent
// Using a SIGNAL makes the context reactive, so effects will rerun when it updates
const globalAccordionContextSignal = signal<AccordionContextValue | null>(null);

// Create context with default implementation that delegates to global signal
const noopGetter = () => globalAccordionContextSignal()?.value() ?? undefined;
const typeGetter = () => globalAccordionContextSignal()?.type() ?? ('single' as const);
const booleanGetter = () => globalAccordionContextSignal()?.collapsible() ?? false;
const disabledGetter = () => globalAccordionContextSignal()?.disabled() ?? false;
const orientationGetter = () => globalAccordionContextSignal()?.orientation() ?? ('vertical' as const);

export const AccordionContext = createContext<AccordionContextValue>(
  {
    type: typeGetter,
    value: noopGetter,
    setValue: (value) => globalAccordionContextSignal()?.setValue(value),
    collapsible: booleanGetter,
    disabled: disabledGetter,
    orientation: orientationGetter,
    accordionId: globalAccordionContextSignal()?.accordionId ?? '',
  },
  'Accordion'
);

/**
 * Accordion item context
 */
export interface AccordionItemContextValue {
  value: string;
  isOpen: () => boolean;
  toggle: () => void;
  disabled: () => boolean;
  triggerId: string;
  contentId: string;
}

// Global reactive signal for item context (same pattern as accordion context)
const globalAccordionItemContextSignal = signal<AccordionItemContextValue | null>(null);

export const AccordionItemContext = createContext<AccordionItemContextValue>(
  {
    value: globalAccordionItemContextSignal()?.value ?? '',
    isOpen: () => globalAccordionItemContextSignal()?.isOpen() ?? false,
    toggle: () => globalAccordionItemContextSignal()?.toggle(),
    disabled: () => globalAccordionItemContextSignal()?.disabled() ?? false,
    triggerId: globalAccordionItemContextSignal()?.triggerId ?? '',
    contentId: globalAccordionItemContextSignal()?.contentId ?? '',
  },
  'AccordionItem'
);

/**
 * Accordion props for single type
 */
export interface AccordionSingleProps {
  /**
   * Single or multiple items open
   */
  type: 'single';

  /**
   * Controlled active item value
   * Pattern 19: Accepts WritableSignal<string | undefined> | string | undefined
   */
  value?: WritableSignal<string | undefined> | string;

  /**
   * Initial active item value
   */
  defaultValue?: string;

  /**
   * Callback when active item changes
   */
  onValueChange?: (value: string | undefined) => void;

  /**
   * Allow all items to close
   * @default false
   */
  collapsible?: boolean;

  /**
   * Disable all items
   */
  disabled?: boolean;

  /**
   * Orientation for keyboard navigation
   * @default 'vertical'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Children
   */
  children: any | (() => any);

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion props for multiple type
 */
export interface AccordionMultipleProps {
  /**
   * Single or multiple items open
   */
  type: 'multiple';

  /**
   * Controlled active items value
   * Pattern 19: Accepts WritableSignal<string[]> | string[]
   */
  value?: WritableSignal<string[]> | string[];

  /**
   * Initial active items value
   */
  defaultValue?: string[];

  /**
   * Callback when active items change
   */
  onValueChange?: (value: string[]) => void;

  /**
   * Disable all items
   */
  disabled?: boolean;

  /**
   * Orientation for keyboard navigation
   * @default 'vertical'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Children
   */
  children: any | (() => any);

  /**
   * Additional props
   */
  [key: string]: any;
}

export type AccordionProps = AccordionSingleProps | AccordionMultipleProps;

/**
 * Accordion root component
 *
 * @example
 * ```tsx
 * <Accordion type="single" collapsible>
 *   <Accordion.Item value="item-1">
 *     <Accordion.Trigger>Item 1</Accordion.Trigger>
 *     <Accordion.Content>Content 1</Accordion.Content>
 *   </Accordion.Item>
 *   <Accordion.Item value="item-2">
 *     <Accordion.Trigger>Item 2</Accordion.Trigger>
 *     <Accordion.Content>Content 2</Accordion.Content>
 *   </Accordion.Item>
 * </Accordion>
 * ```
 */
export const Accordion = defineComponent<AccordionProps>((props) => {
  // Pattern 19: Use useControlledState for flexible value handling
  // Handle both single and multiple modes
  const isSingleMode = props.type === 'single';

  const defaultValue = isSingleMode
    ? ((props as AccordionSingleProps).defaultValue ?? undefined)
    : ((props as AccordionMultipleProps).defaultValue ?? []);

  const onValueChange = isSingleMode
    ? (props as AccordionSingleProps).onValueChange
    : (props as AccordionMultipleProps).onValueChange;

  const [getValue, setValue] = useControlledState(
    props.value as any,
    defaultValue as any,
    onValueChange as any
  );

  const type = signal(props.type);
  const collapsible = signal((props as AccordionSingleProps).collapsible ?? false);
  const disabled = signal(props.disabled ?? false);
  const orientation = signal(props.orientation || 'vertical');

  // Generate stable ID
  const accordionId = generateId('accordion');

  // Context value
  const contextValue: AccordionContextValue = {
    type: () => type(),
    value: getValue,
    setValue: (value: string | string[]) => {
      setValue(value as any);
    },
    collapsible: () => collapsible(),
    disabled: () => disabled(),
    orientation: () => orientation(),
    accordionId,
  };

  // CRITICAL FIX: Set global context signal so children can access it
  // Using a signal makes this reactive - effects will rerun when it updates!
  globalAccordionContextSignal.set(contextValue);

  // Also provide context via the standard API
  provideContext(AccordionContext, contextValue);

  return () => {
    const {
      children: childrenProp,
      type: _type,
      value: _value,
      defaultValue: _defaultValue,
      onValueChange: _onValueChange,
      collapsible: _collapsible,
      disabled: _disabled,
      orientation: _orientation,
      ...restProps
    } = props;

    // Support function children
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    return jsx('div', {
      ...restProps,
      id: accordionId,
      'data-orientation': orientation(),
      children,
    });
  };
});

/**
 * Accordion item props
 */
export interface AccordionItemProps {
  /**
   * Item identifier
   */
  value: string;

  /**
   * Whether the item is disabled
   */
  disabled?: boolean;

  /**
   * Children
   */
  children: any | (() => any);

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion item component
 */
export const AccordionItem = defineComponent<AccordionItemProps>((props) => {
  // Access context during setup to prepare item context
  const ctx = useContext(AccordionContext);

  // Create item context value during setup so it can be provided early
  const itemValue = props.value;
  const itemDisabled = () => ctx.disabled() || props.disabled === true;

  const toggle = () => {
    if (itemDisabled()) return;

    const currentValue = ctx.value();
    const type = ctx.type();

    if (type === 'single') {
      if (currentValue === itemValue) {
        if (ctx.collapsible()) {
          ctx.setValue(undefined as any);
        }
      } else {
        ctx.setValue(itemValue);
      }
    } else {
      const currentArray = Array.isArray(currentValue) ? currentValue : [];
      if (currentArray.includes(itemValue)) {
        ctx.setValue(currentArray.filter((v) => v !== itemValue));
      } else {
        ctx.setValue([...currentArray, itemValue]);
      }
    }
  };

  // Generate stable IDs during setup
  const baseId = `${ctx.accordionId}-item-${itemValue}`;
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  const itemContextValue: AccordionItemContextValue = {
    value: itemValue,
    isOpen: () => {
      const currentValue = ctx.value();
      const type = ctx.type();
      return type === 'single'
        ? currentValue === itemValue
        : Array.isArray(currentValue) && currentValue.includes(itemValue);
    },
    toggle,
    disabled: itemDisabled,
    triggerId,
    contentId,
  };

  // Provide item context during setup so children can access it
  provideContext(AccordionItemContext, itemContextValue);

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update attributes when context value changes
    effect(() => {
      const currentValue = ctx.value();
      const type = ctx.type();
      const isOpen =
        type === 'single'
          ? currentValue === itemValue
          : Array.isArray(currentValue) && currentValue.includes(itemValue);

      element.setAttribute('data-state', isOpen ? 'open' : 'closed');

      if (itemDisabled()) {
        element.setAttribute('data-disabled', '');
      } else {
        element.removeAttribute('data-disabled');
      }
    });
  };

  return () => {
    const { value: _value, disabled: _disabled, children: childrenProp, ...restProps } = props;

    // Support function children
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    // Compute initial isOpen state
    const currentValue = ctx.value();
    const type = ctx.type();
    const initialIsOpen =
      type === 'single' ? currentValue === itemValue : Array.isArray(currentValue) && currentValue.includes(itemValue);

    // Create the div element with ref callback for reactivity
    return jsx('div', {
      ...restProps,
      ref: refCallback,
      'data-state': initialIsOpen ? 'open' : 'closed',
      'data-disabled': itemDisabled() ? '' : undefined,
      children,
    });
  };
});

/**
 * Accordion trigger props
 */
export interface AccordionTriggerProps {
  /**
   * Children
   */
  children: any | (() => any);

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion trigger component - expand/collapse button
 */
export const AccordionTrigger = defineComponent<AccordionTriggerProps>((props) => {
  // Access context during setup
  const ctx = useContext(AccordionContext);
  const itemCtx = useContext(AccordionItemContext);

  const handleClick = () => {
    itemCtx.toggle();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const orientation = ctx.orientation();

    // Handle arrow keys for navigation
    if (
      (orientation === 'vertical' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) ||
      (orientation === 'horizontal' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft'))
    ) {
      event.preventDefault();

      // Find all triggers
      const accordion = document.getElementById(ctx.accordionId);
      const triggers = accordion?.querySelectorAll('[role="button"][aria-expanded]');
      if (!triggers) return;

      const triggerArray = Array.from(triggers) as HTMLElement[];
      const currentIndex = triggerArray.findIndex((el) => el === event.target);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      const isNext = event.key === 'ArrowDown' || event.key === 'ArrowRight';

      if (isNext) {
        nextIndex = (currentIndex + 1) % triggerArray.length;
      } else {
        nextIndex = (currentIndex - 1 + triggerArray.length) % triggerArray.length;
      }

      triggerArray[nextIndex]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      const accordion = document.getElementById(ctx.accordionId);
      const firstTrigger = accordion?.querySelector('[role="button"][aria-expanded]') as HTMLElement;
      firstTrigger?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      const accordion = document.getElementById(ctx.accordionId);
      const triggers = accordion?.querySelectorAll('[role="button"][aria-expanded]');
      const lastTrigger = triggers?.[triggers.length - 1] as HTMLElement;
      lastTrigger?.focus();
    }
  };

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLButtonElement | null) => {
    if (!element) return;

    // Set up effect to reactively update attributes
    // IMPORTANT: We need to directly access context value to ensure reactivity
    effect(() => {
      // Read directly from accordion context to track dependency
      const accordionValue = ctx.value();
      const type = ctx.type();
      const itemValue = itemCtx.value;

      // Compute isOpen based on current accordion value
      const isOpen =
        type === 'single'
          ? accordionValue === itemValue
          : Array.isArray(accordionValue) && accordionValue.includes(itemValue);

      element.setAttribute('aria-expanded', String(isOpen));
      element.setAttribute('data-state', isOpen ? 'open' : 'closed');

      if (itemCtx.disabled()) {
        element.setAttribute('data-disabled', '');
        element.setAttribute('disabled', '');
      } else {
        element.removeAttribute('data-disabled');
        element.removeAttribute('disabled');
      }
    });
  };

  return () => {
    const { children: childrenProp, ...restProps } = props;

    // Support function children
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    // Compute initial isOpen state directly from accordion context
    const accordionValue = ctx.value();
    const type = ctx.type();
    const itemValue = itemCtx.value || props.value; // Fallback to props if itemCtx not set
    const initialIsOpen =
      type === 'single'
        ? accordionValue === itemValue
        : Array.isArray(accordionValue) && accordionValue.includes(itemValue);

    // Create button element with ref callback for reactivity
    return jsx('button', {
      ...restProps,
      ref: refCallback,
      id: itemCtx.triggerId,
      type: 'button',
      role: 'button',
      'aria-expanded': String(initialIsOpen),
      'aria-controls': itemCtx.contentId,
      'data-state': initialIsOpen ? 'open' : 'closed',
      'data-disabled': itemCtx.disabled() ? '' : undefined,
      disabled: itemCtx.disabled(),
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children,
    });
  };
});

/**
 * Accordion content props
 */
export interface AccordionContentProps {
  /**
   * Keep mounted when closed (for animations)
   */
  forceMount?: boolean;

  /**
   * Children
   */
  children: any | (() => any);

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion content component - expandable content
 *
 * IMPORTANT: Aether framework does NOT support conditional rendering (return null).
 * Instead, we always create the element and use display:none to hide it.
 */
export const AccordionContent = defineComponent<AccordionContentProps>((props) => {
  const itemCtx = useContext(AccordionItemContext);

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update attributes and visibility when state changes
    effect(() => {
      const isOpen = itemCtx.isOpen();

      element.setAttribute('data-state', isOpen ? 'open' : 'closed');

      // Handle visibility based on forceMount
      if (props.forceMount) {
        // Keep in DOM but toggle visibility
        if (isOpen) {
          element.removeAttribute('hidden');
          element.style.display = '';
        } else {
          element.setAttribute('hidden', '');
          element.style.display = 'none';
        }
      } else {
        // Always keep in DOM for reactivity, toggle visibility
        if (isOpen) {
          element.removeAttribute('hidden');
          element.style.display = '';
        } else {
          element.setAttribute('hidden', '');
          element.style.display = 'none';
        }
      }
    });
  };

  return () => {
    const { forceMount: _forceMount, children: childrenProp, ...restProps } = props;

    // Support function children
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    // Compute initial state
    const isOpen = itemCtx.isOpen();

    // Always create the element (framework doesn't support conditional rendering)
    return jsx('div', {
      ...restProps,
      ref: refCallback,
      id: itemCtx.contentId,
      role: 'region',
      'aria-labelledby': itemCtx.triggerId,
      'data-state': isOpen ? 'open' : 'closed',
      hidden: !isOpen ? true : undefined,
      style: isOpen ? undefined : 'display: none;',
      children,
    });
  };
});

// Attach sub-components to Accordion
(Accordion as any).Item = AccordionItem;
(Accordion as any).Trigger = AccordionTrigger;
(Accordion as any).Content = AccordionContent;
