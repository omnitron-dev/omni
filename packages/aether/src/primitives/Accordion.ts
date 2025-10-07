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
import { computed } from '../core/reactivity/computed.js';
import { createContext, useContext } from '../core/component/context.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

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

// Create context with default implementation
const noop = () => {};
const noopGetter = () => undefined as string | string[] | undefined;
const typeGetter = () => 'single' as const;
const booleanGetter = () => false;
const orientationGetter = () => 'vertical' as const;

export const AccordionContext = createContext<AccordionContextValue>({
  type: typeGetter,
  value: noopGetter,
  setValue: noop,
  collapsible: booleanGetter,
  disabled: booleanGetter,
  orientation: orientationGetter,
  accordionId: '',
}, 'Accordion');

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

export const AccordionItemContext = createContext<AccordionItemContextValue>({
  value: '',
  isOpen: () => false,
  toggle: noop,
  disabled: booleanGetter,
  triggerId: '',
  contentId: '',
}, 'AccordionItem');

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
   */
  value?: WritableSignal<string | undefined>;

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
  children: any;

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
   */
  value?: WritableSignal<string[]>;

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
  children: any;

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
  const type = signal(props.type);

  // Handle both single and multiple type values
  const internalValue = signal<string | string[] | undefined>(
    props.type === 'single' ? (props as AccordionSingleProps).defaultValue : (props as AccordionMultipleProps).defaultValue
  );
  const valueSignal = props.value || internalValue;

  const collapsible = signal((props as AccordionSingleProps).collapsible ?? false);
  const disabled = signal(props.disabled ?? false);
  const orientation = signal(props.orientation || 'vertical');

  // Generate stable ID
  const accordionId = generateId('accordion');

  // Context value
  const contextValue: AccordionContextValue = {
    type: () => type(),
    value: () => valueSignal(),
    setValue: (value: string | string[]) => {
      valueSignal.set(value as any);
      if (props.type === 'single') {
        (props as AccordionSingleProps).onValueChange?.(value as string | undefined);
      } else {
        (props as AccordionMultipleProps).onValueChange?.(value as string[]);
      }
    },
    collapsible: () => collapsible(),
    disabled: () => disabled(),
    orientation: () => orientation(),
    accordionId,
  };

  return () => {
    const { children, type: _, value: __, defaultValue: ___, onValueChange: ____, collapsible: _____, disabled: ______, orientation: _______, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      id: accordionId,
      'data-orientation': orientation(),
      children: jsx(AccordionContext.Provider, {
        value: contextValue,
        children,
      }),
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
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion item component
 */
export const AccordionItem = defineComponent<AccordionItemProps>((props) => {
  const ctx = useContext(AccordionContext);

  const itemDisabled = computed(() => ctx.disabled() || props.disabled === true);

  const isOpen = computed(() => {
    const value = ctx.value();
    const type = ctx.type();

    if (type === 'single') {
      return value === props.value;
    } else {
      return Array.isArray(value) && value.includes(props.value);
    }
  });

  const toggle = () => {
    if (itemDisabled()) return;

    const currentValue = ctx.value();
    const type = ctx.type();

    if (type === 'single') {
      // For single type
      if (currentValue === props.value) {
        // Trying to close the open item
        if (ctx.collapsible()) {
          ctx.setValue(undefined as any);
        }
      } else {
        ctx.setValue(props.value);
      }
    } else {
      // For multiple type
      const currentArray = Array.isArray(currentValue) ? currentValue : [];
      if (currentArray.includes(props.value)) {
        // Remove from array
        ctx.setValue(currentArray.filter(v => v !== props.value));
      } else {
        // Add to array
        ctx.setValue([...currentArray, props.value]);
      }
    }
  };

  // Generate stable IDs
  const baseId = `${ctx.accordionId}-item-${props.value}`;
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  const itemContextValue: AccordionItemContextValue = {
    value: props.value,
    isOpen,
    toggle,
    disabled: itemDisabled,
    triggerId,
    contentId,
  };

  return () => {
    const { value, disabled, children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-state': isOpen() ? 'open' : 'closed',
      'data-disabled': itemDisabled() ? '' : undefined,
      children: jsx(AccordionItemContext.Provider, {
        value: itemContextValue,
        children,
      }),
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
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion trigger component - expand/collapse button
 */
export const AccordionTrigger = defineComponent<AccordionTriggerProps>((props) => {
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
      const currentIndex = triggerArray.findIndex(el => el === event.target);
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

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      id: itemCtx.triggerId,
      type: 'button',
      role: 'button',
      'aria-expanded': itemCtx.isOpen(),
      'aria-controls': itemCtx.contentId,
      'data-state': itemCtx.isOpen() ? 'open' : 'closed',
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
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Accordion content component - expandable content
 */
export const AccordionContent = defineComponent<AccordionContentProps>((props) => {
  const itemCtx = useContext(AccordionItemContext);

  return () => {
    const { forceMount, children, ...restProps } = props;

    // Don't render unless open or force mounted
    if (!itemCtx.isOpen() && !forceMount) {
      return null;
    }

    return jsx('div', {
      ...restProps,
      id: itemCtx.contentId,
      role: 'region',
      'aria-labelledby': itemCtx.triggerId,
      'data-state': itemCtx.isOpen() ? 'open' : 'closed',
      hidden: !itemCtx.isOpen() ? true : undefined,
      children,
    });
  };
});

// Attach sub-components to Accordion
(Accordion as any).Item = AccordionItem;
(Accordion as any).Trigger = AccordionTrigger;
(Accordion as any).Content = AccordionContent;
