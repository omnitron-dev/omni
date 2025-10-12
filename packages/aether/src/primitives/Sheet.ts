/**
 * Sheet Primitive
 *
 * A panel that slides in from the edge of the screen (also called Drawer).
 * Commonly used for mobile navigation, filters, or side panels.
 *
 * Based on WAI-ARIA Dialog pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal } from '../core/reactivity/signal.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import { generateId, saveFocus, restoreFocus, trapFocus, disableBodyScroll, enableBodyScroll } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export type SheetSide = 'top' | 'right' | 'bottom' | 'left';

export interface SheetProps {
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
   * Side from which sheet slides in
   * @default 'right'
   */
  side?: SheetSide;

  /**
   * Children
   */
  children: any;
}

export interface SheetContentProps {
  /**
   * Close on escape key
   * @default true
   */
  closeOnEscape?: boolean;

  /**
   * Close on overlay click
   * @default true
   */
  closeOnOverlayClick?: boolean;

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

export interface SheetContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  side: SheetSide;
  triggerId: string;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

const noop = () => {};
const noopGetter = () => false;

export const SheetContext = createContext<SheetContextValue>(
  {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    side: 'right',
    triggerId: '',
    contentId: '',
    titleId: '',
    descriptionId: '',
  },
  'Sheet'
);

// ============================================================================
// Components
// ============================================================================

/**
 * Sheet root component
 *
 * @example
 * ```tsx
 * <Sheet side="left">
 *   <Sheet.Trigger>Open Menu</Sheet.Trigger>
 *   <Sheet.Content>
 *     <Sheet.Title>Navigation</Sheet.Title>
 *     <Sheet.Description>Main menu</Sheet.Description>
 *     <nav>
 *       <a href="/">Home</a>
 *       <a href="/about">About</a>
 *     </nav>
 *     <Sheet.Close>Close</Sheet.Close>
 *   </Sheet.Content>
 * </Sheet>
 * ```
 */
export const Sheet = defineComponent<SheetProps>((props) => {
  const internalOpen = signal(props.defaultOpen || false);
  const isOpen = props.open !== undefined ? () => props.open! : internalOpen;

  const baseId = generateId('sheet');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const contextValue: SheetContextValue = {
    isOpen: () => isOpen(),
    open: () => {
      if (props.open === undefined) {
        internalOpen.set(true);
      }
      props.onOpenChange?.(true);
    },
    close: () => {
      if (props.open === undefined) {
        internalOpen.set(false);
      }
      props.onOpenChange?.(false);
    },
    side: props.side || 'right',
    triggerId,
    contentId,
    titleId,
    descriptionId,
  };

  return () =>
    jsx(SheetContext.Provider, {
      value: contextValue,
      children: props.children,
    });
});

/**
 * Sheet Trigger component
 */
export const SheetTrigger = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(SheetContext);

  const handleClick = () => {
    ctx.open();
  };

  return () =>
    jsx('button', {
      ...props,
      id: ctx.triggerId,
      type: 'button',
      'data-state': ctx.isOpen() ? 'open' : 'closed',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.isOpen(),
      onClick: handleClick,
    });
});

/**
 * Sheet Content component
 */
export const SheetContent = defineComponent<SheetContentProps>((props) => {
  const ctx = useContext(SheetContext);
  let contentRef: HTMLElement | null = null;
  let savedFocusElement: HTMLElement | null = null;

  onMount(() => {
    if (!ctx.isOpen()) return;

    // Save current focus and trap focus within sheet
    if (contentRef) {
      savedFocusElement = saveFocus();
      trapFocus(contentRef);
    }

    // Disable body scroll
    disableBodyScroll();

    return () => {
      restoreFocus(savedFocusElement);
      enableBodyScroll();
    };
  });

  const handleEscapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.closeOnEscape !== false) {
      e.preventDefault();
      ctx.close();
    }
  };

  const handleOverlayClick = () => {
    if (props.closeOnOverlayClick !== false) {
      ctx.close();
    }
  };

  return () => {
    if (!ctx.isOpen()) return null;

    return jsx(Portal, {
      children: jsx('div', {
        'data-sheet-overlay': '',
        'data-state': ctx.isOpen() ? 'open' : 'closed',
        onClick: handleOverlayClick,
        children: jsx('div', {
          ...props,
          ref: ((el: HTMLElement) => (contentRef = el)) as any,
          id: ctx.contentId,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': ctx.titleId,
          'aria-describedby': ctx.descriptionId,
          'data-state': ctx.isOpen() ? 'open' : 'closed',
          'data-side': ctx.side,
          tabIndex: -1,
          onKeyDown: handleEscapeKey,
          onClick: (e: Event) => e.stopPropagation(),
        }),
      }),
    });
  };
});

/**
 * Sheet Title component
 */
export const SheetTitle = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(SheetContext);

  return () =>
    jsx('h2', {
      ...props,
      id: ctx.titleId,
    });
});

/**
 * Sheet Description component
 */
export const SheetDescription = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(SheetContext);

  return () =>
    jsx('p', {
      ...props,
      id: ctx.descriptionId,
    });
});

/**
 * Sheet Close component
 */
export const SheetClose = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(SheetContext);

  const handleClick = (e: Event) => {
    props.onClick?.(e);
    ctx.close();
  };

  return () =>
    jsx('button', {
      ...props,
      type: 'button',
      onClick: handleClick,
    });
});
