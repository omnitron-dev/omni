/**
 * Dialog Primitive
 *
 * Modal dialog component with accessibility and focus management
 *
 * Based on WAI-ARIA Dialog (Modal) pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

import { defineComponent } from '../core/component/define.js';
import { signal } from '../core/reactivity/signal.js';
import { createContext, useContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import { generateId, trapFocus, saveFocus, restoreFocus, disableBodyScroll, enableBodyScroll } from './utils/index.js';

/**
 * Dialog context
 */
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

// Create context with default no-op implementation
const noop = () => {};
const noopGetter = () => false;

export const DialogContext = createContext<DialogContextValue>({
  isOpen: noopGetter,
  open: noop,
  close: noop,
  toggle: noop,
  triggerId: '',
  contentId: '',
  titleId: '',
  descriptionId: '',
}, 'Dialog');

/**
 * Dialog props
 */
export interface DialogProps {
  /**
   * Initial open state
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
export const Dialog = defineComponent<DialogProps>((props) => {
  const isOpen = signal(props.defaultOpen || false);

  // Generate stable IDs for accessibility
  const baseId = generateId('dialog');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // Context value
  const contextValue: DialogContextValue = {
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

  // Provide context to children using Provider
  return () => jsx(DialogContext.Provider, {
    value: contextValue,
    children: props.children,
  });
});

/**
 * Dialog trigger props
 */
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

/**
 * Dialog trigger button
 */
export const DialogTrigger = defineComponent<DialogTriggerProps>((props) => {
  const ctx = useContext(DialogContext);

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      id: ctx.triggerId,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.isOpen(),
      'aria-controls': ctx.contentId,
      onClick: ctx.toggle,
      children,
    });
  };
});

/**
 * Dialog content props
 */
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

/**
 * Dialog content
 */
export const DialogContent = defineComponent<DialogContentProps>((props) => {
  const ctx = useContext(DialogContext);
  let previousFocus: HTMLElement | null = null;
  let cleanupFocusTrap: (() => void) | null = null;

  onMount(() => {
    // Setup focus trap and scroll lock when dialog opens
    if (ctx.isOpen()) {
      previousFocus = saveFocus();
      disableBodyScroll();

      // Find the dialog element and setup focus trap
      const dialogElement = document.getElementById(ctx.contentId);
      if (dialogElement instanceof HTMLElement) {
        cleanupFocusTrap = trapFocus(dialogElement);
        dialogElement.focus();
      }
    }

    // Cleanup on unmount
    return () => {
      if (cleanupFocusTrap) {
        cleanupFocusTrap();
      }
      enableBodyScroll();
      if (previousFocus) {
        restoreFocus(previousFocus);
      }
    };
  });

  // Handle Escape key
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      ctx.close();
    }
  };

  return () => {
    if (!ctx.isOpen()) {
      return null;
    }

    const { children, ...restProps } = props;

    return jsx(Portal, {
      children: jsx('div', {
        ...restProps,
        id: ctx.contentId,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': ctx.titleId,
        'aria-describedby': ctx.descriptionId,
        tabIndex: -1,
        onKeyDown: handleKeyDown,
        children,
      }),
    });
  };
});

/**
 * Dialog title
 */
export const DialogTitle = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(DialogContext);

  return () => {
    const { children, ...restProps } = props;

    return jsx('h2', {
      ...restProps,
      id: ctx.titleId,
      children,
    });
  };
});

/**
 * Dialog description
 */
export const DialogDescription = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(DialogContext);

  return () => {
    const { children, ...restProps } = props;

    return jsx('p', {
      ...restProps,
      id: ctx.descriptionId,
      children,
    });
  };
});

/**
 * Dialog close button
 */
export const DialogClose = defineComponent<{ children: any; [key: string]: any }>((props) => {
  const ctx = useContext(DialogContext);

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      type: 'button',
      onClick: ctx.close,
      children,
    });
  };
});

// Attach sub-components to Dialog
(Dialog as any).Trigger = DialogTrigger;
(Dialog as any).Content = DialogContent;
(Dialog as any).Title = DialogTitle;
(Dialog as any).Description = DialogDescription;
(Dialog as any).Close = DialogClose;
