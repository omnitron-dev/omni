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
import { useContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { jsx } from '../jsx-runtime.js';
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';

// ============================================================================
// Create Base AlertDialog using Factory
// ============================================================================

const AlertDialogBase = createOverlayPrimitive({
  name: 'alert-dialog',
  modal: true,
  role: 'alertdialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: false, // Stricter than Dialog - won't close by default
  closeOnClickOutside: false, // Stricter than Dialog - won't close by default
  hasTitle: true,
  hasDescription: true,
});

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

export const AlertDialogContext = AlertDialogBase.Context;

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
export const AlertDialog = AlertDialogBase.Root;

/**
 * AlertDialog Trigger component
 */
export const AlertDialogTrigger = AlertDialogBase.Trigger;

/**
 * AlertDialog Content component
 * Wraps factory Content to handle AlertDialog-specific props and behavior
 */
export const AlertDialogContent = defineComponent<AlertDialogContentProps>((props) => {
  const ctx = useContext(AlertDialogContext);

  // Setup event handlers for AlertDialog-specific behavior
  onMount(() => {
    if (!ctx.isOpen()) return;

    const contentElement = document.getElementById(ctx.contentId);
    if (!contentElement) return;

    // Handle Escape key - only close if explicitly enabled
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (props.closeOnEscape) {
          ctx.close();
        }
        // Always prevent default to stop event propagation
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Handle outside click - only close if explicitly enabled
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (contentElement && !contentElement.contains(target)) {
        if (props.closeOnOutsideClick) {
          ctx.close();
        }
        // Always prevent default to stop event propagation
        e.preventDefault();
        e.stopPropagation();
      }
    };

    contentElement.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      contentElement.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  });

  return () => {
    // Handle forceMount - render even when closed for animations
    if (!ctx.isOpen() && !props.forceMount) {
      return null;
    }

    // Remove AlertDialog-specific props before passing to factory
    const { closeOnOutsideClick, forceMount, closeOnEscape, ...restProps } = props;

    return AlertDialogBase.Content(restProps);
  };
});

/**
 * AlertDialog Title component
 */
export const AlertDialogTitle = AlertDialogBase.Title;

/**
 * AlertDialog Description component
 */
export const AlertDialogDescription = AlertDialogBase.Description;

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
