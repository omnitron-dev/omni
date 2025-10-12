/**
 * AlertDialog Primitive
 *
 * Modal dialog for important confirmations that require user action.
 * Unlike Dialog, AlertDialog blocks dismissal via ESC or outside click by default.
 *
 * Based on WAI-ARIA AlertDialog pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/
 */

import { defineComponent } from '../core/component/define.js';
import { signal } from '../core/reactivity/signal.js';
import { createContext, useContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import { generateId, trapFocus, saveFocus, restoreFocus, disableBodyScroll, enableBodyScroll } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface AlertDialogProps {
  /**
   * Initial open state
   */
  defaultOpen?: boolean;

  /**
   * Callback when open state changes
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Children
   */
  children: any;
}

export interface AlertDialogContentProps {
  /**
   * Allow closing with Escape key
   * @default false (stricter than Dialog)
   */
  closeOnEscape?: boolean;

  /**
   * Allow closing by clicking outside
   * @default false (stricter than Dialog)
   */
  closeOnOutsideClick?: boolean;

  /**
   * Force mount even when closed (for animations)
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

// ============================================================================
// Context
// ============================================================================

export interface AlertDialogContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

const noop = () => {};
const noopGetter = () => false;

export const AlertDialogContext = createContext<AlertDialogContextValue>(
  {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    toggle: noop,
    triggerId: '',
    contentId: '',
    titleId: '',
    descriptionId: '',
  },
  'AlertDialog'
);

// ============================================================================
// Components
// ============================================================================

/**
 * AlertDialog root component
 *
 * @example
 * ```tsx
 * <AlertDialog>
 *   <AlertDialog.Trigger>Delete</AlertDialog.Trigger>
 *   <AlertDialog.Content>
 *     <AlertDialog.Title>Are you sure?</AlertDialog.Title>
 *     <AlertDialog.Description>
 *       This action cannot be undone.
 *     </AlertDialog.Description>
 *     <AlertDialog.Action>Delete</AlertDialog.Action>
 *     <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
 *   </AlertDialog.Content>
 * </AlertDialog>
 * ```
 */
export const AlertDialog = defineComponent<AlertDialogProps>((props) => {
  const isOpen = signal(props.defaultOpen || false);

  const baseId = generateId('alert-dialog');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const contextValue: AlertDialogContextValue = {
    isOpen: () => isOpen(),
    open: () => {
      isOpen.set(true);
      props.onOpenChange?.(true);
    },
    close: () => {
      isOpen.set(false);
      props.onOpenChange?.(false);
    },
    toggle: () => {
      const newState = !isOpen();
      isOpen.set(newState);
      props.onOpenChange?.(newState);
    },
    triggerId,
    contentId,
    titleId,
    descriptionId,
  };

  return () =>
    jsx(AlertDialogContext.Provider, {
      value: contextValue,
      children: props.children,
    });
});

/**
 * AlertDialog Trigger component
 */
export const AlertDialogTrigger = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(AlertDialogContext);

  return () =>
    jsx('button', {
      ...props,
      id: ctx.triggerId,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.isOpen() ? 'true' : 'false',
      'data-state': ctx.isOpen() ? 'open' : 'closed',
      onClick: (e: Event) => {
        props.onClick?.(e);
        ctx.open();
      },
    });
});

/**
 * AlertDialog Content component
 */
export const AlertDialogContent = defineComponent<AlertDialogContentProps>((props) => {
  const ctx = useContext(AlertDialogContext);
  let contentRef: HTMLElement | null = null;
  let savedFocusElement: HTMLElement | null = null;

  onMount(() => {
    if (!ctx.isOpen()) return;

    // Save current focus and trap focus within dialog
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
    if (e.key === 'Escape' && props.closeOnEscape) {
      e.preventDefault();
      ctx.close();
    }
  };

  const handleOutsideClick = (e: MouseEvent) => {
    if (props.closeOnOutsideClick && contentRef && e.target instanceof Node && !contentRef.contains(e.target)) {
      ctx.close();
    }
  };

  return () => {
    if (!ctx.isOpen() && !props.forceMount) {
      return null;
    }

    return jsx(Portal, {
      children: jsx('div', {
        'data-alert-dialog-overlay': '',
        'data-state': ctx.isOpen() ? 'open' : 'closed',
        onClick: handleOutsideClick,
        children: jsx('div', {
          ...props,
          ref: ((el: HTMLElement) => (contentRef = el)) as any,
          id: ctx.contentId,
          role: 'alertdialog',
          'aria-modal': 'true',
          'aria-labelledby': ctx.titleId,
          'aria-describedby': ctx.descriptionId,
          'data-state': ctx.isOpen() ? 'open' : 'closed',
          tabIndex: -1,
          onKeyDown: handleEscapeKey,
          onClick: (e: Event) => e.stopPropagation(),
        }),
      }),
    });
  };
});

/**
 * AlertDialog Title component
 */
export const AlertDialogTitle = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(AlertDialogContext);

  return () =>
    jsx('h2', {
      ...props,
      id: ctx.titleId,
    });
});

/**
 * AlertDialog Description component
 */
export const AlertDialogDescription = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(AlertDialogContext);

  return () =>
    jsx('p', {
      ...props,
      id: ctx.descriptionId,
    });
});

/**
 * AlertDialog Action component (confirm/primary action)
 */
export const AlertDialogAction = defineComponent<{ children: any; [key: string]: any }>(
  (props) => () =>
    jsx('button', {
      ...props,
      type: 'button',
      onClick: (e: Event) => {
        props.onClick?.(e);
        // Don't auto-close, let user handle it via onClick
      },
    })
);

/**
 * AlertDialog Cancel component (cancel/secondary action)
 */
export const AlertDialogCancel = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(AlertDialogContext);

  return () =>
    jsx('button', {
      ...props,
      type: 'button',
      onClick: (e: Event) => {
        props.onClick?.(e);
        ctx.close();
      },
    });
});

// ============================================================================
// Sub-component Attachment
// ============================================================================

(AlertDialog as any).Trigger = AlertDialogTrigger;
(AlertDialog as any).Content = AlertDialogContent;
(AlertDialog as any).Title = AlertDialogTitle;
(AlertDialog as any).Description = AlertDialogDescription;
(AlertDialog as any).Action = AlertDialogAction;
(AlertDialog as any).Cancel = AlertDialogCancel;
