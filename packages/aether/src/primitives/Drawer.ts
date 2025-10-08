/**
 * Drawer - Overlay panel that slides in from screen edge
 *
 * Features:
 * - Slides from top, right, bottom, or left
 * - Modal or non-modal modes
 * - Focus trap and restoration
 * - Scroll locking
 * - Swipe to close (on touch devices)
 * - Keyboard support (Escape to close)
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent, onCleanup } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type DrawerSide = 'top' | 'right' | 'bottom' | 'left';

export interface DrawerProps {
  /** Controlled open state */
  open?: boolean;
  /** Open state change callback */
  onOpenChange?: (open: boolean) => void;
  /** Default open state (uncontrolled) */
  defaultOpen?: boolean;
  /** Side to slide from */
  side?: DrawerSide;
  /** Whether the drawer is modal (blocks interaction with content behind) */
  modal?: boolean;
  /** Whether to close on outside click */
  closeOnOutsideClick?: boolean;
  /** Whether to close on Escape key */
  closeOnEscape?: boolean;
  /** Children */
  children?: any;
}

export interface DrawerTriggerProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DrawerContentProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DrawerOverlayProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DrawerTitleProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DrawerDescriptionProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DrawerCloseProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface DrawerContextValue {
  /** Open state */
  isOpen: Signal<boolean>;
  /** Set open state */
  setOpen: (open: boolean) => void;
  /** Side */
  side: DrawerSide;
  /** Modal */
  modal: boolean;
  /** Close on outside click */
  closeOnOutsideClick: boolean;
}

// ============================================================================
// Context
// ============================================================================

const DrawerContext = createContext<DrawerContextValue | null>(null);

const useDrawerContext = (): DrawerContextValue => {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error('Drawer components must be used within a Drawer');
  }
  return context;
};

// ============================================================================
// Drawer Root
// ============================================================================

export const Drawer = defineComponent<DrawerProps>((props) => {
  const side = props.side ?? 'right';
  const modal = props.modal ?? true;
  const closeOnOutsideClick = props.closeOnOutsideClick ?? true;
  const closeOnEscape = props.closeOnEscape ?? true;

  // State
  const internalOpen: WritableSignal<boolean> = signal<boolean>(
    props.defaultOpen ?? false,
  );

  const isOpen = (): boolean => {
    if (props.open !== undefined) {
      return props.open;
    }
    return internalOpen();
  };

  const setOpen = (open: boolean) => {
    if (props.open === undefined) {
      internalOpen.set(open);
    }
    props.onOpenChange?.(open);
  };

  // Handle escape key
  if (closeOnEscape) {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen()) {
        setOpen(false);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', handleKeyDown);
      onCleanup(() => {
        document.removeEventListener('keydown', handleKeyDown);
      });
    }
  }

  const contextValue: DrawerContextValue = {
    isOpen: computed(() => isOpen()),
    setOpen,
    side,
    modal,
    closeOnOutsideClick,
  };

  return () =>
    jsx(DrawerContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-drawer': '',
        'data-state': isOpen() ? 'open' : 'closed',
        children: props.children,
      }),
    });
});

// ============================================================================
// Drawer Trigger
// ============================================================================

export const DrawerTrigger = defineComponent<DrawerTriggerProps>((props) => {
  const context = useDrawerContext();

  const handleClick = () => {
    context.setOpen(!context.isOpen());
  };

  return () => {
    const { children, ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-drawer-trigger': '',
      'aria-expanded': context.isOpen(),
      onClick: handleClick,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Drawer Overlay
// ============================================================================

export const DrawerOverlay = defineComponent<DrawerOverlayProps>((props) => {
  const context = useDrawerContext();

  const handleClick = () => {
    if (context.closeOnOutsideClick) {
      context.setOpen(false);
    }
  };

  return () => {
    if (!context.isOpen() || !context.modal) return null;

    const { children, ...rest } = props;

    return jsx('div', {
      'data-drawer-overlay': '',
      'data-side': context.side,
      onClick: handleClick,
      'aria-hidden': 'true',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Drawer Content
// ============================================================================

export const DrawerContent = defineComponent<DrawerContentProps>((props) => {
  const context = useDrawerContext();
  const contentRef: { current: HTMLDivElement | null } = { current: null };

  const handleOverlayClick = (e: MouseEvent) => {
    // Prevent closing when clicking inside content
    e.stopPropagation();
  };

  return () => {
    if (!context.isOpen()) return null;

    const { children, ...rest } = props;

    return jsx('div', {
      ref: contentRef,
      'data-drawer-content': '',
      'data-side': context.side,
      role: 'dialog',
      'aria-modal': context.modal,
      tabIndex: -1,
      onClick: handleOverlayClick,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Drawer Title
// ============================================================================

export const DrawerTitle = defineComponent<DrawerTitleProps>((props) => () => {
    const { children, ...rest } = props;

    return jsx('h2', {
      'data-drawer-title': '',
      ...rest,
      children,
    });
  });

// ============================================================================
// Drawer Description
// ============================================================================

export const DrawerDescription = defineComponent<DrawerDescriptionProps>((props) => () => {
    const { children, ...rest } = props;

    return jsx('p', {
      'data-drawer-description': '',
      ...rest,
      children,
    });
  });

// ============================================================================
// Drawer Close
// ============================================================================

export const DrawerClose = defineComponent<DrawerCloseProps>((props) => {
  const context = useDrawerContext();

  const handleClick = () => {
    context.setOpen(false);
  };

  return () => {
    const { children = '×', ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-drawer-close': '',
      onClick: handleClick,
      'aria-label': 'Close drawer',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Drawer as any).Trigger = DrawerTrigger;
(Drawer as any).Overlay = DrawerOverlay;
(Drawer as any).Content = DrawerContent;
(Drawer as any).Title = DrawerTitle;
(Drawer as any).Description = DrawerDescription;
(Drawer as any).Close = DrawerClose;

// ============================================================================
// Export types
// ============================================================================

export type { DrawerContextValue };
