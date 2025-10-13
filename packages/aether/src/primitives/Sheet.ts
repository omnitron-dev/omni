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
import { useContext } from '../core/component/context.js';
import { type WritableSignal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';
import { effect } from '../core/reactivity/effect.js';

// ============================================================================
// Types
// ============================================================================

export type SheetSide = 'top' | 'right' | 'bottom' | 'left';

export interface SheetProps {
  /**
   * Controlled open state (supports WritableSignal for reactive updates - Pattern 19)
   */
  open?: WritableSignal<boolean> | boolean;

  /**
   * Default open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Whether the sheet is modal (blocks interaction with rest of page)
   * @default true
   */
  modal?: boolean;

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

export interface SheetTriggerProps {
  /**
   * Children
   */
  children: any;

  /**
   * Additional props to spread on button
   */
  [key: string]: any;
}

export interface SheetPortalProps {
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

export interface SheetOverlayProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface SheetContentProps {
  /**
   * Side from which sheet slides in (can override root side prop)
   */
  side?: SheetSide;

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

export interface SheetContextValue {
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
// Create Base Sheet using Factory
// ============================================================================

const SheetBase = createOverlayPrimitive({
  name: 'sheet',
  modal: true,
  role: 'dialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true,
  closeOnClickOutside: false, // Sheet uses overlay click handling instead
  hasTitle: true,
  hasDescription: true,
});

export const SheetContext = SheetBase.Context;

// ============================================================================
// Root Component with Side Support
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
  // Store side in a way that child components can access it
  const side = props.side || 'right';

  return () => {
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx(SheetBase.Root, {
      open: props.open,
      defaultOpen: props.defaultOpen,
      modal: props.modal,
      onOpenChange: props.onOpenChange,
      children: jsx('div', {
        'data-sheet-root': '',
        'data-side': side,
        children,
      }),
    });
  };
});

// ============================================================================
// Content Component with Side Attribute
// ============================================================================

/**
 * Sheet Content component - wraps factory Content to add data-side attribute
 */
export const SheetContent = defineComponent<SheetContentProps>((props) => () => {
    const { side, children, ...restProps } = props;

    // Get side from props or from parent element
    const effectiveSide = side || 'right';

    const content = jsx(SheetBase.Content, {
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
// Overlay Component with Click-to-Close Support
// ============================================================================

/**
 * Sheet Overlay component - wraps factory Overlay with click-to-close behavior
 */
export const SheetOverlay = defineComponent<SheetOverlayProps>((props) => {
  const ctx = useContext(SheetContext);

  const handleClick = (event: MouseEvent) => {
    if (event.target === event.currentTarget) {
      ctx.close();
    }
  };

  return () => {
    const { children, onClick, ...restProps } = props;

    return jsx(SheetBase.Overlay, {
      ...restProps,
      onClick: (e: MouseEvent) => {
        handleClick(e);
        if (onClick) {
          onClick(e);
        }
      },
      children,
    });
  };
});

// ============================================================================
// Re-export other components directly from factory
// ============================================================================

/**
 * Sheet Trigger component
 */
export const SheetTrigger = SheetBase.Trigger;

/**
 * Sheet Portal component
 * Renders children into a different part of the DOM
 */
export const SheetPortal = SheetBase.Portal;

/**
 * Sheet Title component
 */
export const SheetTitle = SheetBase.Title;

/**
 * Sheet Description component
 */
export const SheetDescription = SheetBase.Description;

/**
 * Sheet Close button component
 */
export const SheetClose = SheetBase.Close;

// ============================================================================
// Sub-component Attachment
// ============================================================================

(Sheet as any).Trigger = SheetTrigger;
(Sheet as any).Portal = SheetPortal;
(Sheet as any).Overlay = SheetOverlay;
(Sheet as any).Content = SheetContent;
(Sheet as any).Title = SheetTitle;
(Sheet as any).Description = SheetDescription;
(Sheet as any).Close = SheetClose;
