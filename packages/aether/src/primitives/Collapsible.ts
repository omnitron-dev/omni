/**
 * Collapsible Primitive
 *
 * Simple collapsible/expandable content region.
 * Similar to Accordion but for single items.
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal } from '../core/reactivity/signal.js';
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
  children: any;

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
const noopGetter = () => false;

export const CollapsibleContext = createContext<CollapsibleContextValue>(
  {
    isOpen: noopGetter,
    toggle: noop,
    disabled: noopGetter,
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
  const isOpen = props.open !== undefined ? () => props.open! : internalOpen;

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

  return () =>
    jsx(CollapsibleContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        ...props,
        'data-collapsible': '',
        'data-state': isOpen() ? 'open' : 'closed',
        'data-disabled': props.disabled ? '' : undefined,
      }),
    });
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

  return () =>
    jsx('button', {
      ...props,
      id: ctx.triggerId,
      type: 'button',
      'aria-expanded': ctx.isOpen(),
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

  return () => {
    const open = ctx.isOpen();

    if (!open && !props.forceMount) {
      return null;
    }

    return jsx('div', {
      ...props,
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
