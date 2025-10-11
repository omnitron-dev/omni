/**
 * Collapsible Primitive
 *
 * Simple collapsible/expandable content region.
 * Similar to Accordion but for single items.
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal } from '../core/reactivity/signal.js';
import { effect } from '../core/reactivity/effect.js';
import { createRef } from '../core/component/refs.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface CollapsibleProps {
  /**
   * Controlled open state
   */
  open?: boolean;

  /**
   * Default open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Callback when open state changes
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Disabled state
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

export interface CollapsibleTriggerProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface CollapsibleContentProps {
  /**
   * Force mount (for animations)
   */
  forceMount?: boolean;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface CollapsibleContextValue {
  isOpen: () => boolean;
  toggle: () => void;
  disabled: () => boolean;
  triggerId: string;
  contentId: string;
}

const noop = () => {};
const noopBool = () => false;

export const CollapsibleContext = createContext<CollapsibleContextValue>(
  {
    isOpen: noopBool,
    toggle: noop,
    disabled: noopBool,
    triggerId: '',
    contentId: '',
  },
  'Collapsible'
);

// ============================================================================
// Components
// ============================================================================

/**
 * Collapsible root component
 *
 * @example
 * ```tsx
 * <Collapsible>
 *   <Collapsible.Trigger>Toggle</Collapsible.Trigger>
 *   <Collapsible.Content>
 *     Hidden content here
 *   </Collapsible.Content>
 * </Collapsible>
 * ```
 */
export const Collapsible = defineComponent<CollapsibleProps>((props) => {
  const internalOpen = signal(props.defaultOpen || false);
  const isOpen =
    props.open !== undefined
      ? () => (typeof props.open === 'function' ? props.open() : props.open!)
      : internalOpen;

  const baseId = generateId('collapsible');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  const toggle = () => {
    const newValue = !isOpen();
    if (props.open === undefined) {
      internalOpen.set(newValue);
    }
    props.onOpenChange?.(newValue);
  };

  const contextValue: CollapsibleContextValue = {
    isOpen: () => isOpen(),
    toggle,
    disabled: () => props.disabled || false,
    triggerId,
    contentId,
  };

  // Provide context for children
  provideContext(CollapsibleContext, contextValue);

  // Create ref to root element and set up reactive updates
  const rootRef = createRef<HTMLDivElement>();

  const refCallback = (element: HTMLDivElement | null) => {
    rootRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      element.setAttribute('data-state', isOpen() ? 'open' : 'closed');

      if (props.disabled) {
        element.setAttribute('data-disabled', '');
      } else {
        element.removeAttribute('data-disabled');
      }
    });
  };

  return () => {
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      ...props,
      ref: refCallback,
      'data-collapsible': '',
      'data-state': isOpen() ? 'open' : 'closed',
      'data-disabled': props.disabled ? '' : undefined,
      children,
    });
  };
});

/**
 * Collapsible Trigger component
 */
export const CollapsibleTrigger = defineComponent<CollapsibleTriggerProps>((props) => {
  const ctx = useContext(CollapsibleContext);

  const handleClick = () => {
    if (!ctx.disabled()) {
      ctx.toggle();
    }
  };

  // Create ref to button element and set up reactive updates
  const buttonRef = createRef<HTMLButtonElement>();

  const refCallback = (element: HTMLButtonElement | null) => {
    buttonRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      element.setAttribute('aria-expanded', ctx.isOpen() ? 'true' : 'false');
      element.setAttribute('data-state', ctx.isOpen() ? 'open' : 'closed');

      if (ctx.disabled()) {
        element.setAttribute('disabled', '');
        element.disabled = true;
      } else {
        element.removeAttribute('disabled');
        element.disabled = false;
      }
    });
  };

  return () =>
    jsx('button', {
      ...props,
      ref: refCallback,
      id: ctx.triggerId,
      type: 'button',
      'aria-expanded': ctx.isOpen() ? 'true' : 'false',
      'aria-controls': ctx.contentId,
      'data-state': ctx.isOpen() ? 'open' : 'closed',
      disabled: ctx.disabled(),
      onClick: handleClick,
    });
});

/**
 * Collapsible Content component
 */
export const CollapsibleContent = defineComponent<CollapsibleContentProps>((props) => {
  const ctx = useContext(CollapsibleContext);

  // Create ref to content element and set up reactive updates
  const contentRef = createRef<HTMLDivElement>();

  const refCallback = (element: HTMLDivElement | null) => {
    contentRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      const open = ctx.isOpen();
      element.setAttribute('data-state', open ? 'open' : 'closed');

      // Update visibility based on open state and forceMount
      if (!props.forceMount && !open) {
        element.style.display = 'none';
        element.hidden = true;
      } else if (props.forceMount && !open) {
        // ForceMount keeps element in DOM but hidden
        element.hidden = true;
      } else {
        element.style.display = '';
        element.hidden = false;
      }
    });
  };

  return () => {
    const open = ctx.isOpen();

    // Always render the element - visibility is controlled via effects
    // This ensures the element exists for effects to update
    return jsx('div', {
      ...props,
      ref: refCallback,
      id: ctx.contentId,
      'data-collapsible-content': '',
      'data-state': open ? 'open' : 'closed',
      hidden: !open,
      style: {
        ...props.style,
        display: !open && !props.forceMount ? 'none' : undefined,
      },
    });
  };
});
