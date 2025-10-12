/**
 * Popover Primitive
 *
 * Non-modal floating element positioned relative to a trigger
 *
 * Based on WAI-ARIA practices:
 * https://www.w3.org/WAI/ARIA/apg/patterns/
 */

import { defineComponent } from '../core/component/define.js';
import { signal } from '../core/reactivity/signal.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { onMount } from '../core/component/lifecycle.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/id.js';
import { calculatePosition, applyPosition, calculateArrowPosition, type Side, type Align } from './utils/position.js';

/**
 * Popover context
 */
export interface PopoverContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  anchorElement: () => HTMLElement | null;
  setAnchorElement: (el: HTMLElement | null) => void;
}

const noop = () => {};
const noopGetter = () => false;
const noopElementGetter = () => null;

export const PopoverContext = createContext<PopoverContextValue>(
  {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    toggle: noop,
    triggerId: '',
    contentId: '',
    anchorElement: noopElementGetter,
    setAnchorElement: noop,
  },
  'Popover'
);

/**
 * Popover props
 */
export interface PopoverProps {
  /**
   * Controlled open state
   */
  open?: boolean;

  /**
   * Initial open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Whether the popover is modal (default: false)
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
 * Popover root component
 */
export const Popover = defineComponent<PopoverProps>((props) => {
  const internalOpen = signal(props.defaultOpen || false);
  const anchorElement = signal<HTMLElement | null>(null);

  const baseId = generateId('popover');
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  // Controlled/Uncontrolled pattern
  const isControlled = () => props.open !== undefined;
  const currentOpen = () => (isControlled() ? (props.open ?? false) : internalOpen());

  const contextValue: PopoverContextValue = {
    isOpen: currentOpen,
    open: () => {
      if (!isControlled()) {
        internalOpen.set(true);
      }
      props.onOpenChange?.(true);
    },
    close: () => {
      if (!isControlled()) {
        internalOpen.set(false);
      }
      props.onOpenChange?.(false);
    },
    toggle: () => {
      const newState = !currentOpen();
      if (!isControlled()) {
        internalOpen.set(newState);
      }
      props.onOpenChange?.(newState);
    },
    triggerId,
    contentId,
    anchorElement: () => anchorElement(),
    setAnchorElement: (el) => anchorElement.set(el),
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(PopoverContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      'data-popover-root': '',
      children,
    });
  };
});

/**
 * Popover trigger props
 */
export interface PopoverTriggerProps {
  children: any;
  [key: string]: any;
}

/**
 * Popover trigger button
 */
export const PopoverTrigger = defineComponent<PopoverTriggerProps>((props) => {
  const ctx = useContext(PopoverContext);

  onMount(() => {
    // Get element after mount
    const el = document.getElementById(ctx.triggerId);
    if (el instanceof HTMLElement) {
      ctx.setAnchorElement(el);
    }
  });

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      id: ctx.triggerId,
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': ctx.isOpen(),
      'aria-controls': ctx.contentId,
      onClick: (e: Event) => {
        ctx.toggle();
        if (restProps.onClick) {
          restProps.onClick(e);
        }
      },
      children,
    });
  };
});

/**
 * Popover content props
 */
export interface PopoverContentProps {
  /**
   * Preferred side
   */
  side?: Side;

  /**
   * Alignment
   */
  align?: Align;

  /**
   * Offset from anchor
   */
  sideOffset?: number;

  /**
   * Offset along alignment axis
   */
  alignOffset?: number;

  /**
   * Auto-flip/shift to avoid viewport edges
   */
  avoidCollisions?: boolean;

  /**
   * Padding from edges
   */
  collisionPadding?: number;

  /**
   * Callback on Escape key
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;

  /**
   * Callback on pointer down outside
   */
  onPointerDownOutside?: (event: PointerEvent) => void;

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
 * Popover content
 */
export const PopoverContent = defineComponent<PopoverContentProps>((props) => {
  const ctx = useContext(PopoverContext);
  let contentRef: HTMLElement | null = null;

  const {
    side = 'bottom',
    align = 'center',
    sideOffset = 8,
    alignOffset = 0,
    avoidCollisions = true,
    collisionPadding = 10,
    onEscapeKeyDown,
    onPointerDownOutside,
  } = props;

  // Handle Escape key
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (onEscapeKeyDown) {
        onEscapeKeyDown(event);
        if (event.defaultPrevented) return;
      }
      ctx.close();
    }
  };

  // Handle click outside
  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (contentRef && !contentRef.contains(target)) {
      const anchor = ctx.anchorElement();
      if (anchor && !anchor.contains(target)) {
        if (onPointerDownOutside) {
          onPointerDownOutside(event);
          if (event.defaultPrevented) return;
        }
        ctx.close();
      }
    }
  };

  // Position popover
  const updatePosition = () => {
    if (!contentRef) {
      contentRef = document.getElementById(ctx.contentId) as HTMLElement;
    }
    if (!contentRef) return;

    const anchor = ctx.anchorElement();
    if (!anchor) return;

    const position = calculatePosition(anchor, contentRef, {
      side,
      align,
      sideOffset,
      alignOffset,
      avoidCollisions,
      collisionPadding,
    });

    applyPosition(contentRef, position);

    // Store position data for arrow
    contentRef.setAttribute('data-side', position.side);
    contentRef.setAttribute('data-align', position.align);
  };

  onMount(() => {
    if (!ctx.isOpen()) return;

    // Get content element
    contentRef = document.getElementById(ctx.contentId) as HTMLElement;

    // Initial position
    updatePosition();

    // Listen for outside clicks
    document.addEventListener('pointerdown', handlePointerDown as EventListener);

    // Update position on scroll/resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown as EventListener);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  });

  return () => {
    if (!ctx.isOpen()) {
      return null;
    }

    const { children, side: _side, align: _align, ...restProps } = props;

    // Remove positioning props from restProps
    const {
      sideOffset: _1,
      alignOffset: _2,
      avoidCollisions: _3,
      collisionPadding: _4,
      onEscapeKeyDown: _5,
      onPointerDownOutside: _6,
      ...cleanProps
    } = restProps;

    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    return jsx(Portal, {
      children: jsx('div', {
        ...cleanProps,
        id: ctx.contentId,
        role: 'dialog',
        'aria-modal': 'false',
        tabIndex: -1,
        onKeyDown: handleKeyDown,
        children: evaluatedChildren,
      }),
    });
  };
});

/**
 * Popover arrow props
 */
export interface PopoverArrowProps {
  /**
   * Arrow width
   */
  width?: number;

  /**
   * Arrow height
   */
  height?: number;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Popover arrow
 */
export const PopoverArrow = defineComponent<PopoverArrowProps>((props) => {
  const ctx = useContext(PopoverContext);
  let arrowRef: HTMLElement | null = null;

  const { width = 10, height = 5, ...restProps } = props;

  const arrowId = `${ctx.contentId}-arrow`;

  // Update arrow position
  const updateArrowPosition = () => {
    if (!arrowRef) {
      arrowRef = document.getElementById(arrowId) as HTMLElement;
    }
    if (!arrowRef) return;

    const anchor = ctx.anchorElement();
    const content = document.getElementById(ctx.contentId);
    if (!anchor || !content) return;

    const side = (content.getAttribute('data-side') as Side) || 'bottom';
    const align = (content.getAttribute('data-align') as Align) || 'center';

    const position = calculateArrowPosition(anchor, content, side, align);

    Object.entries(position).forEach(([key, value]) => {
      if (arrowRef) {
        arrowRef.style[key as any] = value;
      }
    });
  };

  onMount(() => {
    if (ctx.isOpen()) {
      // Get arrow element
      arrowRef = document.getElementById(arrowId) as HTMLElement;
      // Small delay to ensure content is positioned
      setTimeout(updateArrowPosition, 0);
    }
  });

  return () => {
    if (!ctx.isOpen()) {
      return null;
    }

    return jsx('span', {
      ...restProps,
      id: arrowId,
      style: {
        ...restProps.style,
        position: 'absolute',
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
      },
    });
  };
});

/**
 * Popover anchor props
 */
export interface PopoverAnchorProps {
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
 * Popover anchor - provides a reference element for positioning
 */
export const PopoverAnchor = defineComponent<PopoverAnchorProps>((props) => {
  const ctx = useContext(PopoverContext);

  return () => {
    const { children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-popover-anchor': '',
      ref: (el: HTMLElement | null) => {
        if (el) {
          ctx.setAnchorElement(el);
        }
        // Handle user-provided ref
        if (restProps.ref) {
          if (typeof restProps.ref === 'function') {
            restProps.ref(el);
          } else {
            restProps.ref.current = el;
          }
        }
      },
      children,
    });
  };
});

/**
 * Popover close button
 */
export interface PopoverCloseProps {
  children: any;
  [key: string]: any;
}

export const PopoverClose = defineComponent<PopoverCloseProps>((props) => {
  const ctx = useContext(PopoverContext);

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      type: 'button',
      onClick: (e: Event) => {
        ctx.close();
        if (restProps.onClick) {
          restProps.onClick(e);
        }
      },
      children,
    });
  };
});

// Attach sub-components
(Popover as any).Trigger = PopoverTrigger;
(Popover as any).Content = PopoverContent;
(Popover as any).Arrow = PopoverArrow;
(Popover as any).Anchor = PopoverAnchor;
(Popover as any).Close = PopoverClose;
