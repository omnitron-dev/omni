/**
 * Component Lifecycle Hooks
 *
 * Hooks for component mount, update, and cleanup
 */

import { getOwner } from '../reactivity/context.js';
import type { MountCallback, ErrorCallback, ComponentContext } from './types.js';

// Component context stored per owner
const componentContexts = new WeakMap<any, ComponentContext>();

/**
 * Get or create component context for current owner
 */
function getComponentContext(): ComponentContext {
  const owner = getOwner();
  if (!owner) {
    throw new Error('Lifecycle hooks can only be called inside component setup');
  }

  let ctx = componentContexts.get(owner);
  if (!ctx) {
    ctx = {
      mountCallbacks: [],
      errorCallbacks: [],
      isMounted: false,
    };
    componentContexts.set(owner, ctx);
  }

  return ctx;
}

/**
 * Register a callback to run after component mounts
 *
 * @param callback - Function to run on mount, can return cleanup function
 * @returns Cleanup function
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   onMount(() => {
 *     console.log('Mounted!');
 *
 *     return () => {
 *       console.log('Cleanup on unmount');
 *     };
 *   });
 *
 *   return () => <div>Hello</div>;
 * });
 * ```
 */
export function onMount(callback: MountCallback): void {
  const ctx = getComponentContext();
  ctx.mountCallbacks.push(callback);
}

/**
 * Register error handler for component tree
 *
 * @param callback - Error handler function
 *
 * @example
 * ```typescript
 * const ErrorBoundary = defineComponent(() => {
 *   const error = signal<Error | null>(null);
 *
 *   onError((err) => {
 *     error.set(err);
 *   });
 *
 *   return () => error() ? <ErrorUI error={error()!} /> : <slot />;
 * });
 * ```
 */
export function onError(callback: ErrorCallback): void {
  const ctx = getComponentContext();
  ctx.errorCallbacks.push(callback);
}

/**
 * Trigger mount lifecycle for component
 * Internal API - called by component runtime
 *
 * @internal
 */
export function triggerMount(owner: any): void {
  const ctx = componentContexts.get(owner);
  if (!ctx || ctx.isMounted) return;

  ctx.isMounted = true;

  // Run all mount callbacks
  for (const callback of ctx.mountCallbacks) {
    try {
      callback();
    } catch (error) {
      // Handle errors via error callbacks
      handleComponentError(owner, error as Error);
    }
  }
}

/**
 * Handle component error
 * Internal API
 *
 * Searches up the owner tree to find error handlers (error boundaries)
 *
 * @internal
 */
export function handleComponentError(owner: any, error: Error): void {
  console.log('[handleComponentError] Called with error:', error.message);
  console.log('[handleComponentError] Owner:', owner);

  // Search up the owner tree for error handlers
  let currentOwner = owner;
  const visitedOwners = new Set();
  let depth = 0;

  while (currentOwner) {
    console.log(`[handleComponentError] Checking owner at depth ${depth}:`, currentOwner);

    // Prevent infinite loops
    if (visitedOwners.has(currentOwner)) {
      console.log('[handleComponentError] Loop detected');
      break;
    }
    visitedOwners.add(currentOwner);

    const ctx = componentContexts.get(currentOwner);
    console.log(`[handleComponentError] Context for owner:`, ctx);
    console.log(`[handleComponentError] Error callbacks count:`, ctx?.errorCallbacks.length || 0);

    // If this owner has error handlers, call them
    if (ctx && ctx.errorCallbacks.length > 0) {
      console.log(`[handleComponentError] Calling error handlers`);

      // Call all error handlers at this level
      for (const callback of ctx.errorCallbacks) {
        try {
          callback(error);
          // Error was handled, stop propagation
          console.log('[handleComponentError] Error handled');
          return;
        } catch (handlerError) {
          console.error('Error in error handler:', handlerError);
          // Continue to next handler or bubble up
        }
      }
    }

    // Move up to parent owner
    currentOwner = currentOwner.parent;
    console.log(`[handleComponentError] Moving to parent:`, currentOwner);
    depth++;

    if (depth > 10) {
      console.error('[handleComponentError] Max depth exceeded');
      break;
    }
  }

  // No error handler found in the entire tree, re-throw
  console.log('[handleComponentError] No handler found, re-throwing');
  throw error;
}

/**
 * Clean up component context
 * Internal API
 *
 * @internal
 */
export function cleanupComponentContext(owner: any): void {
  componentContexts.delete(owner);
}
