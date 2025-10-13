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

import { defineComponent } from '../core/component/index.js';
import { type WritableSignal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';
import { effect } from '../core/reactivity/effect.js';

// ============================================================================
// Types
// ============================================================================

export type DrawerSide = 'top' | 'right' | 'bottom' | 'left';

export interface DrawerProps {
  /**
   * Controlled open state (supports WritableSignal for reactive updates - Pattern 19)
   */
  open?: WritableSignal<boolean> | boolean;

  /**
   * Open state change callback
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Default open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Side to slide from
   * @default 'right'
   */
  side?: DrawerSide;

  /**
   * Whether the drawer is modal (blocks interaction with content behind)
   * @default true
   */
  modal?: boolean;

  /**
   * Children
   */
  children?: any;
}

export interface DrawerTriggerProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface DrawerPortalProps {
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

export interface DrawerContentProps {
  /**
   * Side to slide from (can override root side prop)
   */
  side?: DrawerSide;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface DrawerOverlayProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface DrawerTitleProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface DrawerDescriptionProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface DrawerCloseProps {
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

export interface DrawerContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

// ============================================================================
// Create Base Drawer using Factory
// ============================================================================

const DrawerBase = createOverlayPrimitive({
  name: 'drawer',
  modal: true, // Default modal, but can be overridden
  role: 'dialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true,
  closeOnClickOutside: true, // Drawer allows clicking overlay to close by default
  hasTitle: true,
  hasDescription: true,
});

export const DrawerContext = DrawerBase.Context;

// ============================================================================
// Root Component with Side and Modal Support
// ============================================================================

/**
 * Drawer root component
 *
 * @example
 * ```tsx
 * <Drawer side="bottom" modal={true}>
 *   <Drawer.Trigger>Open Drawer</Drawer.Trigger>
 *   <Drawer.Content>
 *     <Drawer.Title>Title</Drawer.Title>
 *     <Drawer.Description>Description</Drawer.Description>
 *     <Drawer.Close>Close</Drawer.Close>
 *   </Drawer.Content>
 * </Drawer>
 * ```
 */
export const Drawer = defineComponent<DrawerProps>((props) => {
  // Store side in a way that child components can access it
  const side = props.side ?? 'right';
  const modal = props.modal ?? true;

  return () => {
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx(DrawerBase.Root, {
      open: props.open,
      defaultOpen: props.defaultOpen,
      modal,
      onOpenChange: props.onOpenChange,
      children: jsx('div', {
        'data-drawer-root': '',
        'data-side': side,
        'data-modal': modal,
        children,
      }),
    });
  };
});

// ============================================================================
// Content Component with Side Attribute
// ============================================================================

/**
 * Drawer Content component - wraps factory Content to add data-side attribute
 */
export const DrawerContent = defineComponent<DrawerContentProps>((props) => () => {
    const { side, children, ...restProps } = props;

    // Get side from props or default to 'right'
    const effectiveSide = side || 'right';

    const content = jsx(DrawerBase.Content, {
      ...restProps,
      children,
    }) as HTMLElement;

    // Add data-side attribute to content element
    if (content) {
      effect(() => {
        content.setAttribute('data-side', effectiveSide);
      });
    }

    return content;
  });

// ============================================================================
// Overlay Component
// ============================================================================

/**
 * Drawer Overlay component - wraps factory Overlay
 */
export const DrawerOverlay = defineComponent<DrawerOverlayProps>((props) => () => {
    const { children, ...restProps } = props;

    return jsx(DrawerBase.Overlay, {
      ...restProps,
      children,
    });
  });

// ============================================================================
// Re-export other components directly from factory
// ============================================================================

/**
 * Drawer Trigger component
 */
export const DrawerTrigger = DrawerBase.Trigger;

/**
 * Drawer Portal component
 * Renders children into a different part of the DOM
 */
export const DrawerPortal = DrawerBase.Portal;

/**
 * Drawer Title component
 */
export const DrawerTitle = DrawerBase.Title;

/**
 * Drawer Description component
 */
export const DrawerDescription = DrawerBase.Description;

/**
 * Drawer Close button component
 */
export const DrawerClose = DrawerBase.Close;

// ============================================================================
// Attach sub-components
// ============================================================================

(Drawer as any).Trigger = DrawerTrigger;
(Drawer as any).Portal = DrawerPortal;
(Drawer as any).Overlay = DrawerOverlay;
(Drawer as any).Content = DrawerContent;
(Drawer as any).Title = DrawerTitle;
(Drawer as any).Description = DrawerDescription;
(Drawer as any).Close = DrawerClose;
