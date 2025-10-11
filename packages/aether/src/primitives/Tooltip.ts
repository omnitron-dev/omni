/**
 * Tooltip Primitive
 *
 * A popup that displays information related to an element when hovered or focused.
 *
 * Based on WAI-ARIA Tooltip pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal } from '../core/reactivity/signal.js';
import { effect } from '../core/reactivity/effect.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import {
  generateId,
  calculatePosition,
  applyPosition,
  type Side,
  type Align,
} from './utils/index.js';

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
}

const noop = () => { };
const noopGetter = () => false;

export const TooltipContext = createContext<TooltipContextValue>(
  {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    triggerId: '',
    contentId: '',
    disabled: false,
  },
  'Tooltip'
);

// ============================================================================
// Components
// ============================================================================

/**
 * Tooltip root component
 *
 * @example
 * ```tsx
 * <Tooltip>
 *   <Tooltip.Trigger>Hover me</Tooltip.Trigger>
 *   <Tooltip.Content>
 *     Helpful information
 *   </Tooltip.Content>
 * </Tooltip>
 * ```
 */
export const Tooltip = defineComponent<TooltipProps>((props) => {
  const isOpen = signal(false);
  const disabled = () => !!props.disabled;

  const baseId = generateId('tooltip');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  const contextValue: TooltipContextValue = {
    isOpen: () => isOpen(),
    open: () => {
      if (!disabled()) {
        isOpen.set(true);
      }
    },
    close: () => {
      isOpen.set(false);
    },
    triggerId,
    contentId,
    disabled: disabled(),
  };

  return () => {
    const children = typeof props.children === 'function' ? props.children() : props.children;
    return jsx(TooltipContext.Provider, {
      value: contextValue,
      children,
    });
  };
});

/**
 * Tooltip Trigger component
 */
export const TooltipTrigger = defineComponent<{ children: any;[key: string]: any }>(
  (props) => {
    const ctx = useContext(TooltipContext);
    let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const delayDuration = 700; // default delay
    const closeDelay = 0;

    const handlePointerEnter = () => {
      if (ctx.disabled) return;

      if (closeTimeoutId) {
        clearTimeout(closeTimeoutId);
        closeTimeoutId = null;
      }

      openTimeoutId = setTimeout(() => {
        ctx.open();
      }, delayDuration);
    };

    const handlePointerLeave = () => {
      if (openTimeoutId) {
        clearTimeout(openTimeoutId);
        openTimeoutId = null;
      }

      closeTimeoutId = setTimeout(() => {
        ctx.close();
      }, closeDelay);
    };

    const handleFocus = () => {
      if (ctx.disabled) return;
      ctx.open();
    };

    const handleBlur = () => {
      ctx.close();
    };

    onMount(() => () => {
      if (openTimeoutId) clearTimeout(openTimeoutId);
      if (closeTimeoutId) clearTimeout(closeTimeoutId);
    });

    return () =>
      jsx('button', {
        ...props,
        id: ctx.triggerId,
        type: 'button',
        'aria-describedby': ctx.isOpen() ? ctx.contentId : undefined,
        'data-state': ctx.isOpen() ? 'open' : 'closed',
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
      });
  }
);

/**
 * Tooltip Content component
 */
export const TooltipContent = defineComponent<TooltipContentProps>((props) => {
  const ctx = useContext(TooltipContext);
  let contentRef: HTMLElement | null = null;
  let triggerElement: HTMLElement | null = null;

  const updatePosition = () => {
    if (!contentRef || !triggerElement) return;

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
  };

  onMount(() => {
    triggerElement = document.getElementById(ctx.triggerId);
    if (ctx.isOpen()) {
      updatePosition();
    }
  });

  const handlePointerEnter = () => {
    // Keep tooltip open when hovering over it
  };

  const handlePointerLeave = () => {
    ctx.close();
  };

  const refCallback = (el: HTMLElement | null) => {
    contentRef = el;
    if (!el) return;

    // Set up effect to update visibility and position when isOpen changes
    effect(() => {
      const isOpen = ctx.isOpen();
      el.style.display = isOpen || props.forceMount ? '' : 'none';
      el.setAttribute('data-state', isOpen ? 'open' : 'closed');
      if (isOpen) {
        // Update position when opening
        triggerElement = document.getElementById(ctx.triggerId);
        updatePosition();
      }
    });
  };

  return () => {
    const { children, side, align, sideOffset, alignOffset, avoidCollisions, collisionPadding, forceMount, ...restProps } = props;

    return jsx(Portal, {
      children: jsx('div', {
        ...restProps,
        ref: refCallback as any,
        id: ctx.contentId,
        role: 'tooltip',
        'data-state': ctx.isOpen() ? 'open' : 'closed',
        style: {
          display: ctx.isOpen() || props.forceMount ? '' : 'none',
          ...restProps.style,
        },
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
        children,
      }),
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
