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
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { effect } from '../core/reactivity/effect.js';
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

export const DialogContext = createContext<DialogContextValue>(
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
  'Dialog'
);

/**
 * Dialog props
 */
export interface DialogProps {
  /**
   * Controlled open state
   */
  open?: boolean;

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
  const internalOpen = signal(props.defaultOpen || false);
  const effectiveOpen = signal(props.open ?? props.defaultOpen ?? false);

  // Check if controlled
  const isControlled = () => props.open !== undefined;

  // Generate stable IDs for accessibility
  const baseId = generateId('dialog');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // Context value
  const contextValue: DialogContextValue = {
    isOpen: () => effectiveOpen(),
    open: () => {
      if (!isControlled()) {
        internalOpen.set(true);
        effectiveOpen.set(true);
      }
      props.onOpenChange?.(true);
    },
    close: () => {
      if (!isControlled()) {
        internalOpen.set(false);
        effectiveOpen.set(false);
      }
      props.onOpenChange?.(false);
    },
    toggle: () => {
      const newState = !effectiveOpen();
      if (!isControlled()) {
        internalOpen.set(newState);
        effectiveOpen.set(newState);
      }
      props.onOpenChange?.(newState);
    },
    triggerId,
    contentId,
    titleId,
    descriptionId,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(DialogContext, contextValue);

  return () => {
    // Sync controlled prop to internal signal BEFORE rendering children
    // This ensures child effects see the correct value
    if (isControlled()) {
      const newOpen = props.open ?? false;
      if (effectiveOpen() !== newOpen) {
        effectiveOpen.set(newOpen);
      }
    }

    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    return jsx('div', {
      'data-dialog-root': '',
      children,
    });
  };
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

    const trigger = jsx('button', {
      ...restProps,
      id: ctx.triggerId,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-controls': ctx.contentId,
      onClick: ctx.toggle,
      children,
    }) as HTMLButtonElement;

    // Reactively update aria-expanded (Pattern 18)
    effect(() => {
      trigger.setAttribute('aria-expanded', String(ctx.isOpen()));
    });

    return trigger;
  };
});

/**
 * Dialog portal props
 */
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

/**
 * Dialog portal component
 * Renders children into a different part of the DOM
 */
export const DialogPortal = defineComponent<DialogPortalProps>(
  (props) => () =>
    jsx(Portal, {
      target: props.container,
      children: props.children,
    })
);

/**
 * Dialog overlay props
 */
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

/**
 * Dialog overlay component
 * Renders a backdrop/overlay behind the dialog
 */
export const DialogOverlay = defineComponent<DialogOverlayProps>((props) => {
  const ctx = useContext(DialogContext);

  // Handle click on overlay to close dialog
  const handleClick = (event: MouseEvent) => {
    // Only close if clicking directly on overlay (not on content inside)
    if (event.target === event.currentTarget) {
      ctx.close();
    }
  };

  return () => {
    const { children, ...restProps } = props;

    const overlay = jsx('div', {
      ...restProps,
      'data-dialog-overlay': '',
      onClick: handleClick,
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: 50,
        display: ctx.isOpen() ? 'block' : 'none',
        ...restProps.style,
      },
      children,
    }) as HTMLElement;

    // Reactively toggle visibility and state (Pattern 18)
    effect(() => {
      const open = ctx.isOpen();
      overlay.style.display = open ? 'block' : 'none';
      overlay.setAttribute('data-state', open ? 'open' : 'closed');
      overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    return overlay;
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
    const { children, ...restProps } = props;

    const content = jsx('div', {
      ...restProps,
      id: ctx.contentId,
      'data-dialog-content': '',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': ctx.titleId,
      'aria-describedby': ctx.descriptionId,
      tabIndex: -1,
      onKeyDown: handleKeyDown,
      style: {
        display: ctx.isOpen() ? 'block' : 'none',
        ...restProps.style,
      },
      children,
    }) as HTMLElement;

    // Reactively toggle visibility and state (Pattern 18)
    effect(() => {
      const open = ctx.isOpen();
      content.style.display = open ? 'block' : 'none';
      content.setAttribute('data-state', open ? 'open' : 'closed');
      content.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    return content;
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
(Dialog as any).Portal = DialogPortal;
(Dialog as any).Overlay = DialogOverlay;
(Dialog as any).Content = DialogContent;
(Dialog as any).Title = DialogTitle;
(Dialog as any).Description = DialogDescription;
(Dialog as any).Close = DialogClose;
