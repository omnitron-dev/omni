/**
 * Dialog Primitive
 *
 * Modal dialog component with accessibility and focus management
 *
 * Based on WAI-ARIA Dialog (Modal) pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

import { type WritableSignal } from '../core/reactivity/index.js';
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';

// ============================================================================
// Create Base Dialog using Factory
// ============================================================================

const DialogBase = createOverlayPrimitive({
  name: 'dialog',
  modal: true,
  role: 'dialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true, // Less strict than AlertDialog
  closeOnClickOutside: false,
  hasTitle: true,
  hasDescription: true,
});

// ============================================================================
// Types
// ============================================================================

export interface DialogProps {
  /**
   * Controlled open state (supports WritableSignal for reactive updates - Pattern 19)
   */
  open?: WritableSignal<boolean> | boolean;

  /**
   * Initial open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Whether the dialog is modal (blocks interaction with rest of page)
   * @default true
   */
  modal?: boolean;

  /**
   * Callback when open state changes
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Children
   */
  children: any;
}

export interface DialogTriggerProps {
  /**
   * Children
   */
  children: any;

  /**
   * Additional props to spread on button
   */
  [key: string]: any;
}

export interface DialogPortalProps {
  /**
   * Target container to render into
   * @default document.body
   */
  container?: HTMLElement;

  /**
   * Children
   */
  children: any;
}

export interface DialogOverlayProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface DialogContentProps {
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

export interface DialogContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

export const DialogContext = DialogBase.Context;

// ============================================================================
// Components
// ============================================================================

/**
 * Dialog root component
 *
 * @example
 * ```tsx
 * <Dialog>
 *   <Dialog.Trigger>Open Dialog</Dialog.Trigger>
 *   <Dialog.Content>
 *     <Dialog.Title>Dialog Title</Dialog.Title>
 *     <Dialog.Description>Dialog description</Dialog.Description>
 *     <Dialog.Close>Close</Dialog.Close>
 *   </Dialog.Content>
 * </Dialog>
 * ```
 */
export const Dialog = DialogBase.Root;

/**
 * Dialog Trigger component
 */
export const DialogTrigger = DialogBase.Trigger;

/**
 * Dialog Portal component
 * Renders children into a different part of the DOM
 */
export const DialogPortal = DialogBase.Portal;

/**
 * Dialog Overlay component
 * Renders a backdrop/overlay behind the dialog
 */
export const DialogOverlay = DialogBase.Overlay;

/**
 * Dialog Content component
 */
export const DialogContent = DialogBase.Content;

/**
 * Dialog Title component
 */
export const DialogTitle = DialogBase.Title;

/**
 * Dialog Description component
 */
export const DialogDescription = DialogBase.Description;

/**
 * Dialog Close button component
 */
export const DialogClose = DialogBase.Close;

// ============================================================================
// Sub-component Attachment
// ============================================================================

(Dialog as any).Trigger = DialogTrigger;
(Dialog as any).Portal = DialogPortal;
(Dialog as any).Overlay = DialogOverlay;
(Dialog as any).Content = DialogContent;
(Dialog as any).Title = DialogTitle;
(Dialog as any).Description = DialogDescription;
(Dialog as any).Close = DialogClose;
