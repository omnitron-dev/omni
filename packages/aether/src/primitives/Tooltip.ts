/**
 * Tooltip Primitive
 *
 * A popup that displays information related to an element when hovered or focused.
 *
 * Based on WAI-ARIA Tooltip pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
 */

import { defineComponent } from '../core/component/define.js';
import { useContext, provideContext, createContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import { effect } from '../core/reactivity/effect.js';
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';
import { calculatePosition, applyPosition, type Side, type Align } from './utils/index.js';

// ============================================================================
// Create Base Tooltip using Factory
// ============================================================================

const TooltipBase = createOverlayPrimitive({
  name: 'tooltip',
  modal: false,
  role: 'tooltip',
  positioning: true,
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: false, // Tooltips typically don't close on Escape
  closeOnClickOutside: false, // Tooltips close on hover out, not click
  triggerBehavior: 'hover',
  hoverDelays: {
    openDelay: 700,
    closeDelay: 0,
  },
  hasArrow: true,
  hasTitle: false,
  hasDescription: false,
});

// ============================================================================
// Types
// ============================================================================

export interface TooltipProps {
  /**
   * Delay before showing tooltip (ms)
   * @default 700
   */
  delayDuration?: number;

  /**
   * Delay before hiding tooltip (ms)
   * @default 0
   */
  closeDelay?: number;

  /**
   * Disable the tooltip
   */
  disabled?: boolean;

  /**
   * Children
   */
  children: any | (() => any);
}

export interface TooltipContentProps {
  /**
   * Preferred side
   * @default 'top'
   */
  side?: Side;

  /**
   * Alignment
   * @default 'center'
   */
  align?: Align;

  /**
   * Offset from trigger (px)
   * @default 4
   */
  sideOffset?: number;

  /**
   * Alignment offset (px)
   * @default 0
   */
  alignOffset?: number;

  /**
   * Avoid collisions with viewport edges
   * @default true
   */
  avoidCollisions?: boolean;

  /**
   * Padding from viewport edges (px)
   * @default 8
   */
  collisionPadding?: number;

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

export interface TooltipArrowProps {
  /**
   * Arrow width (px)
   * @default 8
   */
  width?: number;

  /**
   * Arrow height (px)
   * @default 4
   */
  height?: number;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface TooltipContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  triggerId: string;
  contentId: string;
  disabled: boolean;
  openDelay: () => number;
  closeDelay: () => number;
}

export const TooltipContext = TooltipBase.Context;

// Extended context for disabled prop (component-specific, not in factory)
const TooltipExtendedContext = createContext<{ disabled: boolean }>({
  disabled: false,
});

// ============================================================================
// Components
// ============================================================================

/**
 * Tooltip root component with disabled support
 *
 * @example
 * ```tsx
 * <Tooltip disabled={false}>
 *   <Tooltip.Trigger>Hover me</Tooltip.Trigger>
 *   <Tooltip.Content>
 *     Helpful information
 *   </Tooltip.Content>
 * </Tooltip>
 * ```
 */
export const Tooltip = defineComponent<TooltipProps>((props) => {
  const disabled = props.disabled ?? false;

  provideContext(TooltipExtendedContext, { disabled });

  return () =>
    jsx(TooltipBase.Root, {
      delayDuration: props.delayDuration,
      closeDelay: props.closeDelay,
      children: props.children,
    });
});

/**
 * Tooltip Trigger component
 * Custom implementation that renders as button and handles hover delays
 */
export const TooltipTrigger = defineComponent<{ children: any; disabled?: boolean; [key: string]: any }>((props) => {
  const ctx = useContext(TooltipContext);
  const extCtx = useContext(TooltipExtendedContext);
  let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  onMount(() => () => {
    if (openTimeoutId) clearTimeout(openTimeoutId);
    if (closeTimeoutId) clearTimeout(closeTimeoutId);
  });

  return () => {
    const handlePointerEnter = () => {
      // Check both props.disabled and context disabled (from root component)
      if (props.disabled || extCtx.disabled) return;

      if (closeTimeoutId) {
        clearTimeout(closeTimeoutId);
        closeTimeoutId = null;
      }

      openTimeoutId = setTimeout(() => {
        ctx.open();
      }, ctx.openDelay());
    };

    const handlePointerLeave = () => {
      if (openTimeoutId) {
        clearTimeout(openTimeoutId);
        openTimeoutId = null;
      }

      closeTimeoutId = setTimeout(() => {
        ctx.close();
      }, ctx.closeDelay());
    };

    const handleFocus = () => {
      // Check both props.disabled and context disabled (from root component)
      if (props.disabled || extCtx.disabled) return;
      ctx.open();
    };

    const handleBlur = () => {
      ctx.close();
    };

    // Create refCallback to set up effect for reactive attributes
    const refCallback = (element: HTMLButtonElement | null) => {
      if (!element) return;

      // Set up effect to update attributes when isOpen changes
      effect(() => {
        const isOpen = ctx.isOpen();
        element.setAttribute('data-state', isOpen ? 'open' : 'closed');

        // Remove aria-describedby when closed, set it when open
        if (isOpen) {
          element.setAttribute('aria-describedby', ctx.contentId);
        } else {
          element.removeAttribute('aria-describedby');
        }
      });
    };

    return jsx('button', {
      ...props,
      ref: refCallback,
      id: ctx.triggerId,
      type: 'button',
      'aria-describedby': ctx.isOpen() ? ctx.contentId : undefined,
      'data-state': ctx.isOpen() ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onFocus: handleFocus,
      onBlur: handleBlur,
    });
  };
});

/**
 * Tooltip Content component
 * Custom implementation that always renders (with display:none when closed)
 * and handles positioning with collision detection
 */
export const TooltipContent = defineComponent<TooltipContentProps>((props) => {
  const ctx = useContext(TooltipContext);
  let contentRef: HTMLElement | null = null;
  let triggerElement: HTMLElement | null = null;

  onMount(() => {
    triggerElement = document.getElementById(ctx.triggerId);

    if (contentRef && triggerElement && ctx.isOpen()) {
      const side = props.side || 'top';
      const align = props.align || 'center';
      const sideOffset = props.sideOffset ?? 4;
      const alignOffset = props.alignOffset ?? 0;

      const position = calculatePosition(triggerElement, contentRef, {
        side,
        align,
        sideOffset,
        alignOffset,
        avoidCollisions: props.avoidCollisions !== false,
        collisionPadding: props.collisionPadding ?? 8,
      });

      applyPosition(contentRef, position);

      // Store position data for arrow
      contentRef.setAttribute('data-side', position.side);
      contentRef.setAttribute('data-align', position.align);
    }
  });

  return () => {
    const handlePointerEnter = () => {
      // Keep tooltip open when hovering over it
    };

    const handlePointerLeave = () => {
      ctx.close();
    };

    // Create refCallback to set up effect for visibility changes
    const refCallback = (el: HTMLElement | null) => {
      contentRef = el;
      if (!el) return;

      // Set up effect to update visibility when isOpen changes
      effect(() => {
        const isOpen = ctx.isOpen();
        el.setAttribute('data-state', isOpen ? 'open' : 'closed');
        // Control visibility via display style instead of conditional rendering
        el.style.display = isOpen || props.forceMount ? '' : 'none';
      });
    };

    // Evaluate function children if needed
    const resolvedChildren = typeof props.children === 'function' ? props.children() : props.children;

    // Create the content div
    const contentDiv = jsx('div', {
      ...props,
      ref: refCallback,
      id: ctx.contentId,
      role: 'tooltip',
      'data-state': ctx.isOpen() ? 'open' : 'closed',
      style: {
        position: 'absolute',
        zIndex: 9999,
        display: ctx.isOpen() || props.forceMount ? '' : 'none',
        ...((props.style as any) || {}),
      },
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      children: resolvedChildren,
    });

    // Always render portal, control visibility via display:none
    return jsx(Portal, {
      children: contentDiv,
    });
  };
});

/**
 * Tooltip Arrow component
 */
export const TooltipArrow = defineComponent<TooltipArrowProps>((props) => {
  const ctx = useContext(TooltipContext);
  let arrowRef: HTMLElement | null = null;

  onMount(() => {
    const contentElement = document.getElementById(ctx.contentId);
    const triggerElement = document.getElementById(ctx.triggerId);

    if (arrowRef && contentElement && triggerElement) {
      // Arrow positioning based on tooltip side/align
      // This is a simplified implementation - can be enhanced later
      arrowRef.style.position = 'absolute';
    }
  });

  return () =>
    jsx('div', {
      ...props,
      ref: ((el: HTMLElement) => (arrowRef = el)) as any,
      'data-tooltip-arrow': '',
    });
});

// ============================================================================
// Sub-component Attachment
// ============================================================================

(Tooltip as any).Trigger = TooltipTrigger;
(Tooltip as any).Content = TooltipContent;
(Tooltip as any).Arrow = TooltipArrow;
