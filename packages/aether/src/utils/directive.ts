/**
 * Custom Directive Pattern
 *
 * Type-safe pattern for creating reusable element behaviors without a compiler,
 * using refs and cleanup functions
 */

import { onCleanup } from '../core/reactivity/context.js';

/**
 * Directive function type
 *
 * Takes an element and optional parameters, returns cleanup function
 */
export type DirectiveFunction<T = void> = (
  element: HTMLElement,
  params: T
) => void | (() => void);

/**
 * Directive with update support
 */
export interface DirectiveWithUpdate<T = void> {
  (element: HTMLElement, params: T): DirectiveResult;
}

/**
 * Directive result with optional update and destroy hooks
 */
export interface DirectiveResult {
  update?: (params: unknown) => void;
  destroy?: () => void;
}

/**
 * Create a custom directive
 *
 * Directives are functions that add behavior to DOM elements,
 * similar to Vue/Svelte directives but without compiler magic.
 *
 * @param setup - Function that receives element and params, returns cleanup
 * @returns Directive function usable with ref prop
 *
 * @example
 * ```typescript
 * // Define directive
 * const tooltip = createDirective<string>((element, text) => {
 *   const tooltipEl = document.createElement('div');
 *   tooltipEl.className = 'tooltip';
 *   tooltipEl.textContent = text;
 *
 *   const show = () => {
 *     document.body.appendChild(tooltipEl);
 *     positionTooltip(tooltipEl, element);
 *   };
 *
 *   const hide = () => {
 *     tooltipEl.remove();
 *   };
 *
 *   element.addEventListener('mouseenter', show);
 *   element.addEventListener('mouseleave', hide);
 *
 *   // Return cleanup function
 *   return () => {
 *     hide();
 *     element.removeEventListener('mouseenter', show);
 *     element.removeEventListener('mouseleave', hide);
 *   };
 * });
 *
 * // Use directive
 * <button ref={tooltip('Click to submit')}>Submit</button>
 * ```
 */
export function createDirective<T = void>(
  setup: DirectiveFunction<T>
): (params: T) => (element: HTMLElement) => void {
  return (params: T) => (element: HTMLElement) => {
    const cleanup = setup(element, params);
    if (cleanup) {
      onCleanup(cleanup);
    }
  };
}

/**
 * Create a directive with update support
 *
 * Allows directive to react to parameter changes
 *
 * @param setup - Function that receives element and params, returns result with update/destroy
 * @returns Directive function with update support
 *
 * @example
 * ```typescript
 * const coloredBorder = createUpdatableDirective<{ color: string; width: number }>(
 *   (element, params) => {
 *     const applyStyles = () => {
 *       element.style.border = `${params.width}px solid ${params.color}`;
 *     };
 *
 *     applyStyles();
 *
 *     return {
 *       update(newParams: { color: string; width: number }) {
 *         params = newParams;
 *         applyStyles();
 *       },
 *       destroy() {
 *         element.style.border = '';
 *       }
 *     };
 *   }
 * );
 * ```
 */
export function createUpdatableDirective<T = void>(
  setup: DirectiveWithUpdate<T>
): (params: T) => (element: HTMLElement) => void {
  return (params: T) => (element: HTMLElement) => {
    const result = setup(element, params);

    if (result.destroy) {
      onCleanup(result.destroy);
    }

    // Note: update() would need to be called manually in current implementation
    // In a full directive system, this would be called automatically when params change
  };
}

/**
 * Combine multiple directives
 *
 * @param directives - Array of directive functions
 * @returns Combined directive function
 *
 * @example
 * ```typescript
 * const multiDirective = combineDirectives([
 *   tooltip('Hover me'),
 *   clickOutside(handleClose),
 *   autoFocus()
 * ]);
 *
 * <div ref={multiDirective}>Content</div>
 * ```
 */
export function combineDirectives(
  directives: Array<(element: HTMLElement) => void>
): (element: HTMLElement) => void {
  return (element: HTMLElement) => {
    for (const directive of directives) {
      directive(element);
    }
  };
}

// ============================================================================
// Built-in Directives
// ============================================================================

/**
 * Auto-focus directive
 *
 * Automatically focuses element when mounted
 *
 * @example
 * ```typescript
 * <input ref={autoFocus()} />
 * ```
 */
export const autoFocus = createDirective<void>((element) => {
  // Focus after a microtask to ensure element is in DOM
  queueMicrotask(() => {
    if (element instanceof HTMLElement && 'focus' in element) {
      (element as HTMLInputElement).focus();
    }
  });
});

/**
 * Click outside directive
 *
 * Calls handler when user clicks outside the element
 *
 * @param handler - Function to call on outside click
 *
 * @example
 * ```typescript
 * const handleClose = () => setIsOpen(false);
 * <div ref={clickOutside(handleClose)}>Modal</div>
 * ```
 */
export const clickOutside = createDirective<(event: MouseEvent) => void>(
  (element, handler) => {
    const handleClick = (event: MouseEvent) => {
      if (!element.contains(event.target as Node)) {
        handler(event);
      }
    };

    // Use capture phase to handle clicks before they bubble
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }
);

/**
 * Intersection observer directive
 *
 * Calls handler when element enters viewport
 *
 * @param handler - Function to call with intersection entry
 * @param options - IntersectionObserver options
 *
 * @example
 * ```typescript
 * const handleIntersect = (entry: IntersectionObserverEntry) => {
 *   if (entry.isIntersecting) {
 *     console.log('Element is visible!');
 *   }
 * };
 *
 * <div ref={intersectionObserver(handleIntersect, { threshold: 0.5 })}>
 *   Content
 * </div>
 * ```
 */
export const intersectionObserver = createDirective<{
  handler: (entry: IntersectionObserverEntry) => void;
  options?: IntersectionObserverInit;
}>((element, { handler, options }) => {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        handler(entry);
      }
    },
    options
  );

  observer.observe(element);

  return () => {
    observer.disconnect();
  };
});

/**
 * Resize observer directive
 *
 * Calls handler when element size changes
 *
 * @param handler - Function to call with resize entry
 *
 * @example
 * ```typescript
 * const handleResize = (entry: ResizeObserverEntry) => {
 *   console.log('New size:', entry.contentRect.width, entry.contentRect.height);
 * };
 *
 * <div ref={resizeObserver(handleResize)}>
 *   Resizable content
 * </div>
 * ```
 */
export const resizeObserver = createDirective<
  (entry: ResizeObserverEntry) => void
>((element, handler) => {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      handler(entry);
    }
  });

  observer.observe(element);

  return () => {
    observer.disconnect();
  };
});

/**
 * Long press directive
 *
 * Calls handler when element is pressed for specified duration
 *
 * @param handler - Function to call on long press
 * @param duration - Press duration in milliseconds (default: 500)
 *
 * @example
 * ```typescript
 * const handleLongPress = () => {
 *   console.log('Long pressed!');
 * };
 *
 * <button ref={longPress({ handler: handleLongPress, duration: 1000 })}>
 *   Press and hold
 * </button>
 * ```
 */
export const longPress = createDirective<{
  handler: () => void;
  duration?: number;
}>((element, { handler, duration = 500 }) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const handleStart = () => {
    cancelled = false;
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        handler();
      }
    }, duration);
  };

  const handleEnd = () => {
    cancelled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  element.addEventListener('mousedown', handleStart);
  element.addEventListener('mouseup', handleEnd);
  element.addEventListener('mouseleave', handleEnd);
  element.addEventListener('touchstart', handleStart);
  element.addEventListener('touchend', handleEnd);
  element.addEventListener('touchcancel', handleEnd);

  return () => {
    handleEnd();
    element.removeEventListener('mousedown', handleStart);
    element.removeEventListener('mouseup', handleEnd);
    element.removeEventListener('mouseleave', handleEnd);
    element.removeEventListener('touchstart', handleStart);
    element.removeEventListener('touchend', handleEnd);
    element.removeEventListener('touchcancel', handleEnd);
  };
});

/**
 * Portal directive
 *
 * Moves element to a different location in the DOM
 *
 * @param target - Target element or selector
 *
 * @example
 * ```typescript
 * <div ref={portal({ target: document.body })}>
 *   This will be rendered in document.body
 * </div>
 * ```
 */
export const portal = createDirective<{
  target: HTMLElement | string;
}>((element, { target }) => {
  const targetElement =
    typeof target === 'string'
      ? document.querySelector(target)
      : target;

  if (!targetElement) {
    console.warn(`Portal target not found: ${target}`);
    return;
  }

  const parent = element.parentElement;
  const nextSibling = element.nextSibling;

  targetElement.appendChild(element);

  return () => {
    if (parent) {
      if (nextSibling) {
        parent.insertBefore(element, nextSibling);
      } else {
        parent.appendChild(element);
      }
    }
  };
});

/**
 * Draggable directive
 *
 * Makes element draggable
 *
 * @param options - Draggable options
 *
 * @example
 * ```typescript
 * const handleDrag = (position: { x: number; y: number }) => {
 *   console.log('New position:', position);
 * };
 *
 * <div ref={draggable({ onDrag: handleDrag })}>
 *   Drag me
 * </div>
 * ```
 */
export const draggable = createDirective<{
  onDrag?: (position: { x: number; y: number }) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}>((element, { onDrag, onDragStart, onDragEnd }) => {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;

  const handleMouseDown = (e: MouseEvent) => {
    isDragging = true;
    startX = e.clientX - currentX;
    startY = e.clientY - currentY;

    if (onDragStart) {
      onDragStart();
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    currentX = e.clientX - startX;
    currentY = e.clientY - startY;

    element.style.transform = `translate(${currentX}px, ${currentY}px)`;

    if (onDrag) {
      onDrag({ x: currentX, y: currentY });
    }
  };

  const handleMouseUp = () => {
    if (isDragging && onDragEnd) {
      onDragEnd();
    }
    isDragging = false;
  };

  element.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  return () => {
    element.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
});
