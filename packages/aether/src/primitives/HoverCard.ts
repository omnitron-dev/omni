/**
 * HoverCard Primitive
 *
 * A rich preview card that appears when hovering over an element.
 * Similar to Tooltip but with more complex content and interactions.
 *
 * Based on WAI-ARIA Dialog pattern (role="dialog" for rich content):
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal } from '../core/reactivity/signal.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import { effect } from '../core/reactivity/effect.js';
import { createRef } from '../core/component/refs.js';
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

export interface HoverCardProps {
  /**
   * Delay before showing card (ms)
   * @default 700
   */
  openDelay?: number;

  /**
   * Delay before hiding card (ms)
   * @default 300
   */
  closeDelay?: number;

  /**
   * Children
   */
  children: any;
}

export interface HoverCardContentProps {
  /**
   * Preferred side
   * @default 'bottom'
   */
  side?: Side;

  /**
   * Alignment
   * @default 'center'
   */
  align?: Align;

  /**
   * Offset from trigger (px)
   * @default 8
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
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface HoverCardArrowProps {
  /**
   * Arrow width (px)
   * @default 12
   */
  width?: number;

  /**
   * Arrow height (px)
   * @default 6
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

export interface HoverCardContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  triggerId: string;
  contentId: string;
}

const noop = () => {};
const noopGetter = () => false;

export const HoverCardContext = createContext<HoverCardContextValue>(
  {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    triggerId: '',
    contentId: '',
  },
  'HoverCard'
);

// ============================================================================
// Components
// ============================================================================

/**
 * HoverCard root component
 *
 * @example
 * ```tsx
 * <HoverCard>
 *   <HoverCard.Trigger>
 *     <a href="/user/john">@john</a>
 *   </HoverCard.Trigger>
 *   <HoverCard.Content>
 *     <img src="/avatar.jpg" alt="John's avatar" />
 *     <h4>John Doe</h4>
 *     <p>Software Engineer at Acme Corp</p>
 *     <button>Follow</button>
 *   </HoverCard.Content>
 * </HoverCard>
 * ```
 */
export const HoverCard = defineComponent<HoverCardProps>((props) => {
  const isOpen = signal(false);

  const baseId = generateId('hover-card');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  const contextValue: HoverCardContextValue = {
    isOpen: () => isOpen(),
    open: () => {
      isOpen.set(true);
    },
    close: () => {
      isOpen.set(false);
    },
    triggerId,
    contentId,
  };

  return () => {
    const resolvedChildren = typeof props.children === 'function' ? props.children() : props.children;

    return jsx(HoverCardContext.Provider, {
      value: contextValue,
      children: resolvedChildren,
    });
  };
});

/**
 * HoverCard Trigger component
 */
export const HoverCardTrigger = defineComponent<{ children: any; [key: string]: any }>(
  (props) => {
    // Defer context access to render time
    let ctx: HoverCardContextValue;

    let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const openDelay = 700; // default delay
    const closeDelay = 300;

    onMount(() => () => {
        if (openTimeoutId) clearTimeout(openTimeoutId);
        if (closeTimeoutId) clearTimeout(closeTimeoutId);
      });

    // Create ref for reactive updates
    const triggerRef = createRef<HTMLAnchorElement>();

    return () => {
      // Get context at render time
      ctx = useContext(HoverCardContext);

      const handlePointerEnter = () => {
        if (closeTimeoutId) {
          clearTimeout(closeTimeoutId);
          closeTimeoutId = null;
        }

        openTimeoutId = setTimeout(() => {
          ctx.open();
        }, openDelay);
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
        ctx.open();
      };

      const handleBlur = () => {
        ctx.close();
      };

      const refCallback = (element: HTMLAnchorElement | null) => {
        triggerRef.current = element || undefined;
        if (!element) return;

        // Set up effect to update attributes when isOpen changes
        effect(() => {
          const isOpen = ctx.isOpen();
          element.setAttribute('data-state', isOpen ? 'open' : 'closed');
          element.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
      };

      return jsx('a', {
        ...props,
        ref: refCallback,
        id: ctx.triggerId,
        'data-state': ctx.isOpen() ? 'open' : 'closed',
        'aria-expanded': ctx.isOpen() ? 'true' : 'false',
        'aria-haspopup': 'dialog',
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
      });
    };
  }
);

/**
 * HoverCard Content component
 */
export const HoverCardContent = defineComponent<HoverCardContentProps>((props) => {
  // Defer context access to render time
  let ctx: HoverCardContextValue;

  let contentRef: HTMLElement | null = null;
  let triggerElement: HTMLElement | null = null;

  onMount(() => {
    if (!ctx) return; // Context not available yet

    triggerElement = document.getElementById(ctx.triggerId);

    if (contentRef && triggerElement && ctx.isOpen()) {
      const side = props.side || 'bottom';
      const align = props.align || 'center';
      const sideOffset = props.sideOffset ?? 8;
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
    }
  });

  return () => {
    // Get context at render time
    ctx = useContext(HoverCardContext);

    const handlePointerEnter = () => {
      // Keep hover card open when hovering over it
    };

    const handlePointerLeave = () => {
      ctx.close();
    };

    const refCallback = (el: HTMLElement | null) => {
      contentRef = el;
      if (!el) return;

      // Set up effect to update visibility when isOpen changes
      effect(() => {
        const isOpen = ctx.isOpen();
        el.setAttribute('data-state', isOpen ? 'open' : 'closed');

        if (isOpen) {
          el.style.display = '';
          el.hidden = false;
        } else {
          el.style.display = 'none';
          el.hidden = true;
        }
      });
    };

    // Always render the content, control visibility via effects
    return jsx(Portal, {
      children: jsx('div', {
        ...props,
        ref: refCallback,
        id: ctx.contentId,
        role: 'dialog',
        'aria-labelledby': ctx.triggerId,
        'data-state': ctx.isOpen() ? 'open' : 'closed',
        hidden: !ctx.isOpen(),
        style: {
          ...props.style,
          display: !ctx.isOpen() ? 'none' : undefined,
        },
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
      }),
    });
  };
});

/**
 * HoverCard Arrow component
 */
export const HoverCardArrow = defineComponent<HoverCardArrowProps>((props) => {
  let arrowRef: HTMLElement | null = null;

  onMount(() => {
    if (arrowRef) {
      // Arrow positioning - simplified implementation
      arrowRef.style.position = 'absolute';
    }
  });

  return () =>
    jsx('div', {
      ...props,
      ref: ((el: HTMLElement) => (arrowRef = el)) as any,
      'data-hover-card-arrow': '',
    });
});
