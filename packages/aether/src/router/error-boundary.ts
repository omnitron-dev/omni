/**
 * Error Boundary Support
 *
 * Provides error handling for route components
 */

import { signal } from '../core/reactivity/signal.js';
import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { onMount, onError } from '../core/component/lifecycle.js';
import { jsx } from '../jsx-runtime.js';
import type { RouteError } from './types.js';

/**
 * Error context - provides error information to error boundary components
 */
export const RouteErrorContext = createContext<RouteError | null>(null, 'route-error');

/**
 * Get current route error
 *
 * Must be called inside an error boundary component
 *
 * @example
 * ```tsx
 * const ErrorPage = defineComponent(() => {
 *   const error = useRouteError();
 *
 *   return () => (
 *     <div class="error-page">
 *       <h1>Error {error()?.statusCode || 500}</h1>
 *       <p>{error()?.message}</p>
 *       {error()?.stack && <pre>{error().stack}</pre>}
 *     </div>
 *   );
 * });
 * ```
 */
export function useRouteError() {
  return useContext(RouteErrorContext);
}

/**
 * Error Boundary Props
 */
export interface ErrorBoundaryProps {
  /**
   * Fallback component to render on error
   */
  fallback?: any;
  /**
   * Callback when error is caught
   */
  onError?: (error: Error) => void;
  /**
   * Children to wrap with error boundary
   */
  children?: any;
}

/**
 * Error Boundary Component
 *
 * Catches errors in child components and renders a fallback UI
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={ErrorPage}>
 *   <RouteComponent />
 * </ErrorBoundary>
 * ```
 */
export const ErrorBoundary = defineComponent<ErrorBoundaryProps>((props) => {
  const error = signal<RouteError | null>(null);
  const hasError = signal(false);

  // Register error handler
  onError((err) => {
    const routeError: RouteError = {
      message: err.message || 'An error occurred',
      stack: err.stack,
      statusCode: 500,
      error: err,
    };

    error.set(routeError);
    hasError.set(true);

    // Call user error handler
    if (props.onError) {
      props.onError(err);
    }

    // Log error in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('ErrorBoundary caught error:', err);
    }
  });

  // Reset error on cleanup
  onMount(() => {
    return () => {
      error.set(null);
      hasError.set(false);
    };
  });

  return () => {
    if (hasError()) {
      const FallbackComponent = props.fallback;

      if (!FallbackComponent) {
        // Default error UI
        const errorData = error();
        const children = [
          jsx('h1', { children: 'Something went wrong' }),
          jsx('p', { children: errorData?.message || 'An error occurred' }),
        ];

        if (process.env.NODE_ENV !== 'production' && errorData?.stack) {
          children.push(
            jsx('pre', {
              style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
              children: errorData.stack,
            })
          );
        }

        return jsx('div', {
          class: 'error-boundary-fallback',
          children,
        });
      }

      // Render user-provided fallback with error context
      return RouteErrorContext.Provider({
        value: error(),
        children: FallbackComponent(),
      });
    }

    // Render children normally
    return props.children;
  };
});

/**
 * Create a route error
 *
 * Useful for throwing custom errors in loaders
 *
 * @example
 * ```tsx
 * export const loader = async ({ params }) => {
 *   const user = await fetchUser(params.id);
 *   if (!user) {
 *     throw createRouteError('User not found', 404);
 *   }
 *   return user;
 * };
 * ```
 */
export function createRouteError(message: string, statusCode?: number): RouteError {
  const error = new Error(message) as Error & { statusCode?: number };
  if (statusCode) {
    error.statusCode = statusCode;
  }
  return {
    message,
    statusCode,
    error,
    stack: error.stack,
  };
}

/**
 * Check if value is a route error
 */
export function isRouteError(value: any): value is RouteError {
  return (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
