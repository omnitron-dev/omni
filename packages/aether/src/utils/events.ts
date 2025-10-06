/**
 * Event Handler Utilities
 *
 * Lightweight helpers for common event handling patterns,
 * providing directive-like convenience without a custom compiler
 */

/**
 * Wrap event handler to call preventDefault()
 *
 * @param handler - Event handler function
 * @returns Wrapped handler that prevents default behavior
 *
 * @example
 * ```typescript
 * <button onClick={prevent(handleSubmit)}>Submit</button>
 * <a href="/link" onClick={prevent(handleClick)}>Click</a>
 * ```
 */
export function prevent<T extends Event>(handler: (e: T) => void): (e: T) => void {
  return (e: T) => {
    e.preventDefault();
    handler(e);
  };
}

/**
 * Wrap event handler to call stopPropagation()
 *
 * @param handler - Event handler function
 * @returns Wrapped handler that stops event propagation
 *
 * @example
 * ```typescript
 * <div onClick={stop(handleClick)}>
 *   <button>Click won't bubble</button>
 * </div>
 * ```
 */
export function stop<T extends Event>(handler: (e: T) => void): (e: T) => void {
  return (e: T) => {
    e.stopPropagation();
    handler(e);
  };
}

/**
 * Wrap event handler to call stopImmediatePropagation()
 *
 * @param handler - Event handler function
 * @returns Wrapped handler that stops immediate propagation
 *
 * @example
 * ```typescript
 * <button onClick={stopImmediate(handleClick)}>
 *   No other handlers will run
 * </button>
 * ```
 */
export function stopImmediate<T extends Event>(
  handler: (e: T) => void
): (e: T) => void {
  return (e: T) => {
    e.stopImmediatePropagation();
    handler(e);
  };
}

/**
 * Wrap event handler to call both preventDefault() and stopPropagation()
 *
 * @param handler - Event handler function
 * @returns Wrapped handler that prevents default and stops propagation
 *
 * @example
 * ```typescript
 * <button onClick={preventStop(handleClick)}>
 *   Prevent default and stop bubbling
 * </button>
 * ```
 */
export function preventStop<T extends Event>(
  handler: (e: T) => void
): (e: T) => void {
  return (e: T) => {
    e.preventDefault();
    e.stopPropagation();
    handler(e);
  };
}

/**
 * Create event handler that only runs if event target matches selector
 *
 * @param selector - CSS selector to match
 * @param handler - Event handler function
 * @returns Wrapped handler that runs only if target matches
 *
 * @example
 * ```typescript
 * <div onClick={self('.delete-btn', handleDelete)}>
 *   <button className="delete-btn">Delete</button>
 *   <button className="edit-btn">Edit</button>
 * </div>
 * ```
 */
export function self<T extends Event>(
  selector: string,
  handler: (e: T) => void
): (e: T) => void {
  return (e: T) => {
    const target = e.target as Element;
    if (target && target.matches(selector)) {
      handler(e);
    }
  };
}

/**
 * Create event handler that only runs on trusted events
 *
 * @param handler - Event handler function
 * @returns Wrapped handler that runs only on trusted events
 *
 * @example
 * ```typescript
 * <button onClick={trusted(handleClick)}>
 *   Only handles real user clicks, not programmatic
 * </button>
 * ```
 */
export function trusted<T extends Event>(
  handler: (e: T) => void
): (e: T) => void {
  return (e: T) => {
    if (e.isTrusted) {
      handler(e);
    }
  };
}

/**
 * Create debounced event handler
 *
 * @param handler - Event handler function
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced handler
 *
 * @example
 * ```typescript
 * <input onInput={debounce(handleSearch, 500)} />
 * ```
 */
export function debounce<T extends Event>(
  handler: (e: T) => void,
  delay: number
): (e: T) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (e: T) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      handler(e);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Create throttled event handler
 *
 * @param handler - Event handler function
 * @param limit - Throttle limit in milliseconds
 * @returns Throttled handler
 *
 * @example
 * ```typescript
 * <div onScroll={throttle(handleScroll, 100)}>
 *   Content
 * </div>
 * ```
 */
export function throttle<T extends Event>(
  handler: (e: T) => void,
  limit: number
): (e: T) => void {
  let inThrottle = false;

  return (e: T) => {
    if (!inThrottle) {
      handler(e);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Create event handler with passive option for better scroll performance
 *
 * Note: This returns event listener options, use with addEventListener
 *
 * @param handler - Event handler function
 * @returns Event listener options with passive: true
 *
 * @example
 * ```typescript
 * onMount(() => {
 *   const cleanup = passive((e: WheelEvent) => handleWheel(e));
 *   element.addEventListener('wheel', cleanup.handler, cleanup.options);
 *   onCleanup(() => element.removeEventListener('wheel', cleanup.handler));
 * });
 * ```
 */
export function passive<T extends Event>(
  handler: (e: T) => void
): { handler: (e: T) => void; options: AddEventListenerOptions } {
  return {
    handler,
    options: { passive: true },
  };
}

/**
 * Create event handler with capture option
 *
 * Note: This returns event listener options, use with addEventListener
 *
 * @param handler - Event handler function
 * @returns Event listener options with capture: true
 *
 * @example
 * ```typescript
 * onMount(() => {
 *   const cleanup = capture((e: MouseEvent) => handleClick(e));
 *   element.addEventListener('click', cleanup.handler, cleanup.options);
 *   onCleanup(() => element.removeEventListener('click', cleanup.handler));
 * });
 * ```
 */
export function capture<T extends Event>(
  handler: (e: T) => void
): { handler: (e: T) => void; options: AddEventListenerOptions } {
  return {
    handler,
    options: { capture: true },
  };
}

/**
 * Create event handler that runs once then removes itself
 *
 * Note: This returns event listener options, use with addEventListener
 *
 * @param handler - Event handler function
 * @returns Event listener options with once: true
 *
 * @example
 * ```typescript
 * onMount(() => {
 *   const cleanup = once((e: MouseEvent) => handleFirstClick(e));
 *   element.addEventListener('click', cleanup.handler, cleanup.options);
 *   // No need for cleanup - listener removes itself
 * });
 * ```
 */
export function once<T extends Event>(
  handler: (e: T) => void
): { handler: (e: T) => void; options: AddEventListenerOptions } {
  return {
    handler,
    options: { once: true },
  };
}

/**
 * Compose multiple event handler modifiers
 *
 * @param modifiers - Array of modifier functions
 * @returns Composed modifier function
 *
 * @example
 * ```typescript
 * const preventAndStop = compose([prevent, stop]);
 * <button onClick={preventAndStop(handleClick)}>Click</button>
 * ```
 */
export function compose<T extends Event>(
  modifiers: Array<(handler: (e: T) => void) => (e: T) => void>
): (handler: (e: T) => void) => (e: T) => void {
  return (handler: (e: T) => void) => {
    return modifiers.reduceRight(
      (acc, modifier) => modifier(acc),
      handler
    );
  };
}
