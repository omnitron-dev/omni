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
 * @internal
 */
export function handleComponentError(owner: any, error: Error): void {
  const ctx = componentContexts.get(owner);
  if (!ctx) {
    throw error; // Re-throw if no context
  }

  // If there are error handlers, consider error handled even if they fail
  // This prevents cascading errors
  if (ctx.errorCallbacks.length === 0) {
    throw error; // No handlers, re-throw
  }

  // Call error handlers
  for (const callback of ctx.errorCallbacks) {
    try {
      callback(error);
    } catch (handlerError) {
      console.error('Error in error handler:', handlerError);
    }
  }

  // Error was handled (or attempted to be handled), don't re-throw
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
