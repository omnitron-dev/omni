/**
 * createOverlayPrimitive Factory
 *
 * Factory function to eliminate ~2,000 lines of duplicated code across overlay components.
 * Provides a unified way to create Dialog, Popover, HoverCard, ContextMenu, etc.
 *
 * PATTERNS IDENTIFIED:
 * 1. Context creation with isOpen/open/close/toggle + IDs
 * 2. Root component with signal & ID generation
 * 3. Trigger component with aria attributes
 * 4. Content component with Portal & positioning
 * 5. Close component
 * 6. Optional Title/Description components
 * 7. Optional Arrow component (for positioned overlays)
 *
 * VARIATIONS HANDLED:
 * - Modal vs non-modal behavior
 * - Focus trap & scroll lock
 * - Positioning (floating vs fixed)
 * - Close behaviors (ESC, outside click)
 * - Controlled vs uncontrolled state
 * - Signal vs boolean control
 */

import { defineComponent } from '../../core/component/define.js';
import { signal, type WritableSignal } from '../../core/reactivity/index.js';
import { createContext, useContext, provideContext } from '../../core/component/context.js';
import { onMount } from '../../core/component/lifecycle.js';
import { effect } from '../../core/reactivity/effect.js';
import { Portal } from '../../control-flow/Portal.js';
import { jsx } from '../../jsx-runtime.js';
import {
  generateId,
  trapFocus,
  saveFocus,
  restoreFocus,
  disableBodyScroll,
  enableBodyScroll,
  calculatePosition,
  applyPosition,
  calculateArrowPosition,
  type Side,
  type Align,
} from '../utils/index.js';
import { useControlledBooleanState } from '../../utils/controlled-state.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for creating an overlay primitive
 */
export interface OverlayConfig {
  /**
   * Name of the overlay (e.g., 'dialog', 'popover')
   * Used for ID generation and data attributes
   */
  name: string;

  /**
   * Whether this overlay is modal (blocks interaction with page)
   * @default false
   */
  modal?: boolean;

  /**
   * ARIA role for the content element
   * @default 'dialog'
   */
  role?: string;

  /**
   * Whether this overlay uses positioning (floating UI)
   * If true, enables calculatePosition and related features
   * @default false
   */
  positioning?: boolean;

  /**
   * Whether to trap focus inside the overlay when open
   * @default true for modal, false for non-modal
   */
  focusTrap?: boolean;

  /**
   * Whether to lock body scroll when overlay is open
   * @default true for modal, false for non-modal
   */
  scrollLock?: boolean;

  /**
   * Whether to allow closing with Escape key
   * @default true
   */
  closeOnEscape?: boolean;

  /**
   * Whether to allow closing by clicking outside
   * @default false for modal, true for non-modal
   */
  closeOnClickOutside?: boolean;

  /**
   * Whether to generate and use a title ID
   * @default true
   */
  hasTitle?: boolean;

  /**
   * Whether to generate and use a description ID
   * @default true
   */
  hasDescription?: boolean;

  /**
   * Whether to support arrow component (for positioned overlays)
   * @default false
   */
  hasArrow?: boolean;

  /**
   * Whether to support controlled state via signal
   * If false, only supports boolean control
   * @default true
   */
  supportsSignalControl?: boolean;

  /**
   * Custom trigger behavior type
   * - 'click': Standard click to toggle (Dialog, Popover)
   * - 'hover': Hover with delays (HoverCard)
   * - 'contextmenu': Right-click to open (ContextMenu)
   * @default 'click'
   */
  triggerBehavior?: 'click' | 'hover' | 'contextmenu';

  /**
   * Hover delays (only used if triggerBehavior === 'hover')
   */
  hoverDelays?: {
    openDelay?: number;
    closeDelay?: number;
  };
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Base context value for all overlay primitives
 */
export interface BaseOverlayContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle?: () => void;
  triggerId: string;
  contentId: string;
  titleId?: string;
  descriptionId?: string;
}

/**
 * Extended context for positioned overlays
 */
export interface PositionedOverlayContextValue extends BaseOverlayContextValue {
  anchorElement: () => HTMLElement | null;
  setAnchorElement: (el: HTMLElement | null) => void;
}

/**
 * Extended context for context menu
 */
export interface ContextMenuContextValue extends BaseOverlayContextValue {
  position: () => { x: number; y: number } | null;
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface BaseRootProps {
  /**
   * Controlled open state (supports WritableSignal for reactive updates - Pattern 19)
   */
  open?: WritableSignal<boolean> | boolean;

  /**
   * Initial open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Whether the overlay is modal (blocks interaction with rest of page)
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

export interface HoverCardRootProps extends BaseRootProps {
  /**
   * Delay before showing (ms)
   */
  openDelay?: number;

  /**
   * Delay before hiding (ms)
   */
  closeDelay?: number;
}

export interface BaseTriggerProps {
  children: any;
  [key: string]: any;
}

export interface BaseContentProps {
  children: any;
  [key: string]: any;
}

export interface PositionedContentProps extends BaseContentProps {
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
}

export interface BaseArrowProps {
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

export interface BaseCloseProps {
  children: any;
  [key: string]: any;
}

export interface BaseTitleProps {
  children: any;
  [key: string]: any;
}

export interface BaseDescriptionProps {
  children: any;
  [key: string]: any;
}

export interface BasePortalProps {
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

export interface BaseOverlayProps {
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
// Factory Function
// ============================================================================

/**
 * Creates a complete overlay primitive component set
 *
 * @param config - Configuration for the overlay behavior
 * @returns Object containing all overlay components (Root, Trigger, Content, etc.)
 *
 * @example
 * ```typescript
 * const Dialog = createOverlayPrimitive({
 *   name: 'dialog',
 *   modal: true,
 *   role: 'dialog',
 *   focusTrap: true,
 *   scrollLock: true,
 *   closeOnEscape: true,
 *   closeOnClickOutside: false,
 *   hasTitle: true,
 *   hasDescription: true,
 * });
 *
 * const Popover = createOverlayPrimitive({
 *   name: 'popover',
 *   modal: false,
 *   role: 'dialog',
 *   positioning: true,
 *   closeOnEscape: true,
 *   closeOnClickOutside: true,
 *   hasArrow: true,
 * });
 * ```
 */
export function createOverlayPrimitive(config: OverlayConfig) {
  // Apply defaults
  const {
    name,
    modal = false,
    role = 'dialog',
    positioning = false,
    focusTrap = modal,
    scrollLock = modal,
    closeOnEscape = true,
    closeOnClickOutside = !modal,
    hasTitle = true,
    hasDescription = true,
    hasArrow = false,
    supportsSignalControl: _supportsSignalControl = true, // Reserved for future use
    triggerBehavior = 'click',
    hoverDelays = { openDelay: 700, closeDelay: 300 },
  } = config;

  // Create context
  const noop = () => {};
  const noopGetter = () => false;
  const noopElementGetter = () => null;
  const noopPositionGetter = () => null;

  const defaultContextValue: any = {
    isOpen: noopGetter,
    open: noop,
    close: noop,
    toggle: noop,
    triggerId: '',
    contentId: '',
    ...(hasTitle && { titleId: '' }),
    ...(hasDescription && { descriptionId: '' }),
    ...(positioning && {
      anchorElement: noopElementGetter,
      setAnchorElement: noop,
    }),
    ...(triggerBehavior === 'contextmenu' && {
      position: noopPositionGetter,
    }),
    ...(triggerBehavior === 'hover' && {
      openDelay: () => hoverDelays.openDelay,
      closeDelay: () => hoverDelays.closeDelay,
    }),
  };

  const Context = createContext<any>(defaultContextValue, name);

  // ============================================================================
  // Root Component
  // ============================================================================

  const Root = defineComponent<BaseRootProps | HoverCardRootProps>((props: any) => {
    // Pattern 19: Use unified controlled state helper
    const [isOpen, setIsOpen] = useControlledBooleanState(
      props.open,
      props.defaultOpen ?? false,
      props.onOpenChange
    );

    // Additional signals for specific behaviors
    const anchorElement = positioning ? signal<HTMLElement | null>(null) : null;
    const contextMenuPosition =
      triggerBehavior === 'contextmenu' ? signal<{ x: number; y: number } | null>(null) : null;

    // Generate stable IDs for accessibility
    const baseId = generateId(name);
    const triggerId = `${baseId}-trigger`;
    const contentId = `${baseId}-content`;
    const titleId = hasTitle ? `${baseId}-title` : undefined;
    const descriptionId = hasDescription ? `${baseId}-description` : undefined;

    // Context value
    const contextValue: any = {
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen(!isOpen()),
      triggerId,
      contentId,
      ...(hasTitle && { titleId }),
      ...(hasDescription && { descriptionId }),
      ...(positioning &&
        anchorElement && {
          anchorElement: () => anchorElement(),
          setAnchorElement: (el: HTMLElement | null) => anchorElement.set(el),
        }),
      ...(triggerBehavior === 'contextmenu' &&
        contextMenuPosition && {
          open: (x: number, y: number) => {
            contextMenuPosition.set({ x, y });
            setIsOpen(true);
          },
          position: () => contextMenuPosition(),
        }),
      ...(triggerBehavior === 'hover' && {
        openDelay: () => props.openDelay ?? hoverDelays.openDelay,
        closeDelay: () => props.closeDelay ?? hoverDelays.closeDelay,
      }),
    };

    // Provide context during setup phase
    provideContext(Context, contextValue);

    return () => {
      // Evaluate function children during render
      const children = typeof props.children === 'function' ? props.children() : props.children;
      return jsx('div', {
        [`data-${name}-root`]: '',
        children,
      });
    };
  });

  // ============================================================================
  // Trigger Component
  // ============================================================================

  const Trigger = defineComponent<BaseTriggerProps>((props) => {
    const ctx = useContext(Context);

    // Hover-specific state
    let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    if (triggerBehavior === 'hover') {
      onMount(() => () => {
        if (openTimeoutId) clearTimeout(openTimeoutId);
        if (closeTimeoutId) clearTimeout(closeTimeoutId);
      });
    }

    // Setup anchor element for positioning
    if (positioning && triggerBehavior !== 'contextmenu') {
      onMount(() => {
        const el = document.getElementById(ctx.triggerId);
        if (el instanceof HTMLElement) {
          ctx.setAnchorElement(el);
        }
      });
    }

    return () => {
      const { children, ...restProps } = props;

      // Build event handlers based on trigger behavior
      const handlers: any = {};

      if (triggerBehavior === 'click') {
        handlers.onClick = (e: Event) => {
          ctx.toggle();
          if (restProps.onClick) {
            restProps.onClick(e);
          }
        };
      } else if (triggerBehavior === 'hover') {
        handlers.onPointerEnter = () => {
          if (closeTimeoutId) {
            clearTimeout(closeTimeoutId);
            closeTimeoutId = null;
          }
          openTimeoutId = setTimeout(() => {
            ctx.open();
          }, ctx.openDelay());
        };

        handlers.onPointerLeave = () => {
          if (openTimeoutId) {
            clearTimeout(openTimeoutId);
            openTimeoutId = null;
          }
          closeTimeoutId = setTimeout(() => {
            ctx.close();
          }, ctx.closeDelay());
        };

        handlers.onFocus = () => {
          ctx.open();
        };

        handlers.onBlur = () => {
          ctx.close();
        };
      } else if (triggerBehavior === 'contextmenu') {
        handlers.onContextMenu = (e: MouseEvent) => {
          if (props.disabled) return;
          e.preventDefault();
          e.stopPropagation();
          ctx.open(e.clientX, e.clientY);
        };
      }

      const elementType = triggerBehavior === 'contextmenu' ? 'div' : 'button';
      const extraProps =
        elementType === 'button'
          ? {
              type: 'button',
              'aria-haspopup': role === 'menu' ? 'menu' : 'dialog',
              'aria-controls': ctx.contentId,
            }
          : {};

      const trigger = jsx(elementType, {
        ...restProps,
        ...handlers,
        ...extraProps,
        id: ctx.triggerId,
        children,
      }) as HTMLElement;

      // Reactively update aria-expanded for button triggers
      if (elementType === 'button') {
        effect(() => {
          trigger.setAttribute('aria-expanded', String(ctx.isOpen()));
          trigger.setAttribute('data-state', ctx.isOpen() ? 'open' : 'closed');
        });
      }

      return trigger;
    };
  });

  // ============================================================================
  // Content Component
  // ============================================================================

  const Content = defineComponent<BaseContentProps | PositionedContentProps>((props: any) => {
    const ctx = useContext(Context);
    let contentRef: HTMLElement | null = null;
    let previousFocus: HTMLElement | null = null;
    let cleanupFocusTrap: (() => void) | null = null;

    // Setup focus management and scroll lock
    onMount(() => {
      if (!ctx.isOpen()) return undefined;

      // Save focus and setup focus trap
      if (focusTrap) {
        previousFocus = saveFocus();
        const dialogElement = document.getElementById(ctx.contentId);
        if (dialogElement instanceof HTMLElement) {
          cleanupFocusTrap = trapFocus(dialogElement);
          dialogElement.focus();
        }
      }

      // Lock scroll
      if (scrollLock) {
        disableBodyScroll();
      }

      // Cleanup on unmount
      return () => {
        if (cleanupFocusTrap) {
          cleanupFocusTrap();
        }
        if (scrollLock) {
          enableBodyScroll();
        }
        if (previousFocus && focusTrap) {
          restoreFocus(previousFocus);
        }
      };
    });

    // Positioning logic
    if (positioning) {
      const updatePosition = () => {
        if (!contentRef) {
          contentRef = document.getElementById(ctx.contentId) as HTMLElement;
        }
        if (!contentRef) return;

        const anchor = ctx.anchorElement?.();
        if (!anchor) return;

        const position = calculatePosition(anchor, contentRef, {
          side: props.side || 'bottom',
          align: props.align || 'center',
          sideOffset: props.sideOffset ?? 8,
          alignOffset: props.alignOffset ?? 0,
          avoidCollisions: props.avoidCollisions !== false,
          collisionPadding: props.collisionPadding ?? 10,
        });

        applyPosition(contentRef, position);

        // Store position data for arrow
        if (hasArrow) {
          contentRef.setAttribute('data-side', position.side);
          contentRef.setAttribute('data-align', position.align);
        }
      };

      onMount(() => {
        if (!ctx.isOpen()) return undefined;

        contentRef = document.getElementById(ctx.contentId) as HTMLElement;
        updatePosition();

        // Update position on scroll/resize
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);

        return () => {
          window.removeEventListener('scroll', updatePosition, true);
          window.removeEventListener('resize', updatePosition);
        };
      });
    }

    // Context menu positioning
    if (triggerBehavior === 'contextmenu') {
      onMount(() => {
        if (!ctx.isOpen() || !contentRef) return;

        const pos = ctx.position();
        if (!pos) return;

        // Position at click location
        contentRef.style.position = 'fixed';
        contentRef.style.left = `${pos.x}px`;
        contentRef.style.top = `${pos.y}px`;

        // Adjust if off-screen
        const rect = contentRef.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          contentRef.style.left = `${pos.x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
          contentRef.style.top = `${pos.y - rect.height}px`;
        }

        // Focus first item for menus
        if (role === 'menu') {
          const firstItem = contentRef.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
          firstItem?.focus();
        }
      });
    }

    // Handle Escape key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        if (props.onEscapeKeyDown) {
          props.onEscapeKeyDown(event);
          if (event.defaultPrevented) return;
        }
        ctx.close();
      }
    };

    // Handle click outside
    const handlePointerDown = closeOnClickOutside
      ? (event: PointerEvent) => {
          const target = event.target as Node;
          if (contentRef && !contentRef.contains(target)) {
            const anchor = positioning ? ctx.anchorElement?.() : null;
            if (!anchor || !anchor.contains(target)) {
              if (props.onPointerDownOutside) {
                props.onPointerDownOutside(event);
                if (event.defaultPrevented) return;
              }
              ctx.close();
            }
          }
        }
      : null;

    if (handlePointerDown) {
      onMount(() => {
        if (ctx.isOpen()) {
          document.addEventListener('pointerdown', handlePointerDown as EventListener);
          return () => {
            document.removeEventListener('pointerdown', handlePointerDown as EventListener);
          };
        }
        return undefined;
      });
    }

    return () => {
      if (!ctx.isOpen()) {
        return null;
      }

      const { children, side, align, sideOffset, alignOffset, avoidCollisions, collisionPadding, ...restProps } =
        props;

      // Evaluate function children during render
      const evaluatedChildren = typeof children === 'function' ? children() : children;

      const ariaProps: any = {
        role,
        ...(modal && { 'aria-modal': 'true' }),
        ...(hasTitle && ctx.titleId && { 'aria-labelledby': ctx.titleId }),
        ...(hasDescription && ctx.descriptionId && { 'aria-describedby': ctx.descriptionId }),
      };

      const content = jsx('div', {
        ...restProps,
        ...ariaProps,
        id: ctx.contentId,
        [`data-${name}-content`]: '',
        tabIndex: -1,
        onKeyDown: handleKeyDown,
        children: evaluatedChildren,
      }) as HTMLElement;

      effect(() => {
        const open = ctx.isOpen();
        content.setAttribute('data-state', open ? 'open' : 'closed');
      });

      return jsx(Portal, {
        children: content,
      });
    };
  });

  // ============================================================================
  // Portal Component
  // ============================================================================

  const PortalComponent = defineComponent<BasePortalProps>(
    (props) => () =>
      jsx(Portal, {
        target: props.container,
        children: props.children,
      })
  );

  // ============================================================================
  // Overlay Component (backdrop)
  // ============================================================================

  const Overlay = defineComponent<BaseOverlayProps>((props) => {
    const ctx = useContext(Context);

    // Handle click on overlay to close
    const handleClick = (event: MouseEvent) => {
      if (closeOnClickOutside && event.target === event.currentTarget) {
        ctx.close();
      }
    };

    return () => {
      const { children, ...restProps } = props;

      const overlay = jsx('div', {
        ...restProps,
        [`data-${name}-overlay`]: '',
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

      // Reactively toggle visibility and state
      effect(() => {
        const open = ctx.isOpen();
        overlay.style.display = open ? 'block' : 'none';
        overlay.setAttribute('data-state', open ? 'open' : 'closed');
        overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
      });

      return overlay;
    };
  });

  // ============================================================================
  // Close Component
  // ============================================================================

  const Close = defineComponent<BaseCloseProps>((props) => {
    const ctx = useContext(Context);

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

  // ============================================================================
  // Title Component
  // ============================================================================

  const Title = hasTitle
    ? defineComponent<BaseTitleProps>((props) => {
        const ctx = useContext(Context);

        return () => {
          const { children, ...restProps } = props;

          return jsx('h2', {
            ...restProps,
            id: ctx.titleId,
            children,
          });
        };
      })
    : undefined;

  // ============================================================================
  // Description Component
  // ============================================================================

  const Description = hasDescription
    ? defineComponent<BaseDescriptionProps>((props) => {
        const ctx = useContext(Context);

        return () => {
          const { children, ...restProps } = props;

          return jsx('p', {
            ...restProps,
            id: ctx.descriptionId,
            children,
          });
        };
      })
    : undefined;

  // ============================================================================
  // Arrow Component
  // ============================================================================

  const Arrow = hasArrow
    ? defineComponent<BaseArrowProps>((props) => {
        const ctx = useContext(Context);
        let arrowRef: HTMLElement | null = null;

        const { width = 10, height = 5, ...restProps } = props;

        const arrowId = `${ctx.contentId}-arrow`;

        // Update arrow position
        const updateArrowPosition = () => {
          if (!arrowRef) {
            arrowRef = document.getElementById(arrowId) as HTMLElement;
          }
          if (!arrowRef) return;

          const anchor = ctx.anchorElement?.();
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
            arrowRef = document.getElementById(arrowId) as HTMLElement;
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
            [`data-${name}-arrow`]: '',
            style: {
              ...restProps.style,
              position: 'absolute',
              width: `${width}px`,
              height: `${height}px`,
              pointerEvents: 'none',
            },
          });
        };
      })
    : undefined;

  // ============================================================================
  // Anchor Component (for positioned overlays)
  // ============================================================================

  const Anchor = positioning
    ? defineComponent<BaseTriggerProps>((props) => {
        const ctx = useContext(Context);

        return () => {
          const { children, ...restProps } = props;

          return jsx('div', {
            ...restProps,
            [`data-${name}-anchor`]: '',
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
      })
    : undefined;

  // ============================================================================
  // Return Component Set
  // ============================================================================

  return {
    Root,
    Trigger,
    Content,
    Portal: PortalComponent,
    Overlay,
    Close,
    ...(Title && { Title }),
    ...(Description && { Description }),
    ...(Arrow && { Arrow }),
    ...(Anchor && { Anchor }),
    Context,
  };
}
