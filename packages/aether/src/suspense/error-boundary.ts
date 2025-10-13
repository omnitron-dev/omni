/**
 * Error Boundary Component
 *
 * Catches errors in child components and displays fallback UI.
 * Integrates with Suspense for async error handling.
 */

import { signal } from '../core/reactivity/signal.js';
import { onCleanup } from '../core/reactivity/context.js';
import { createContext, useContext } from '../core/component/context.js';
import type { ErrorBoundaryProps, ErrorInfo } from './types.js';
import { Suspense } from './suspense.js';

/**
 * Error boundary context
 */
interface ErrorBoundaryContext {
  /**
   * Reset the error boundary
   */
  reset(): void;

  /**
   * Current error
   */
  error: () => Error | null;

  /**
   * Manually report an error
   */
  reportError(error: Error, info?: ErrorInfo): void;
}

/**
 * Context for error boundary
 */
const ErrorBoundaryContextAPI = createContext<ErrorBoundaryContext | null>(null);

/**
 * Error boundary ID counter
 */
let errorBoundaryIdCounter = 0;

/**
 * ErrorBoundary component
 *
 * Catches errors thrown by child components and displays fallback UI.
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={(error, retry) => (
 *   <div>
 *     <h1>Error: {error.message}</h1>
 *     <button onClick={retry}>Retry</button>
 *   </div>
 * )}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export function ErrorBoundary(props: ErrorBoundaryProps): any {
  const {
    fallback,
    children,
    onError,
    resetKeys = [],
  } = props;

  // Track error state
  const errorSignal = signal<Error | null>(null);
  const errorInfoSignal = signal<ErrorInfo | null>(null);

  // Track reset keys
  const prevResetKeysSignal = signal<any[]>(resetKeys);

  // Check if reset keys changed
  const resetKeysChanged = () => {
    const prev = prevResetKeysSignal.peek();
    const current = resetKeys;

    if (prev.length !== current.length) return true;

    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== current[i]) return true;
    }

    return false;
  };

  // Reset on keys change
  if (resetKeysChanged()) {
    errorSignal.set(null);
    errorInfoSignal.set(null);
    prevResetKeysSignal.set([...resetKeys]);
  }

  // Create context
  const context: ErrorBoundaryContext = {
    reset() {
      errorSignal.set(null);
      errorInfoSignal.set(null);
    },

    error() {
      return errorSignal();
    },

    reportError(error: Error, info?: ErrorInfo) {
      errorSignal.set(error);
      errorInfoSignal.set(info || {});

      if (onError) {
        onError(error, info || {});
      }
    },
  };

  // Cleanup
  onCleanup(() => {
    errorSignal.set(null);
    errorInfoSignal.set(null);
  });

  // Return setup function that returns render function
  return () => 
    // This is the setup/component function
     () => {
      // This is the render function
      const error = errorSignal();

      if (error) {
        // Render fallback
        if (typeof fallback === 'function') {
          return fallback(error, () => context.reset());
        } else {
          return fallback;
        }
      }

      // Wrap children in error boundary context
      try {
        return typeof children === 'function' ? children() : children;
      } catch (err) {
        // Catch synchronous errors
        const errorObj = err as Error;
        context.reportError(errorObj, {
          componentStack: new Error().stack,
        });

        // Render fallback
        if (typeof fallback === 'function') {
          return fallback(errorObj, () => context.reset());
        } else {
          return fallback;
        }
      }
    }
  ;
}

/**
 * Hook to access error boundary context
 *
 * @returns Error boundary context or null
 *
 * @example
 * ```typescript
 * const errorBoundary = useErrorBoundary();
 * if (errorBoundary) {
 *   errorBoundary.reportError(new Error('Something went wrong'));
 * }
 * ```
 */
export function useErrorBoundary(): ErrorBoundaryContext | null {
  return useContext(ErrorBoundaryContextAPI);
}

/**
 * HOC to wrap component with error boundary
 *
 * @param Component - Component to wrap
 * @param fallback - Fallback UI or function
 * @returns Wrapped component
 *
 * @example
 * ```typescript
 * const SafeComponent = withErrorBoundary(MyComponent, (error, retry) => (
 *   <div>Error: {error.message}</div>
 * ));
 * ```
 */
export function withErrorBoundary<T>(
  Component: (props: T) => any,
  fallback: ((error: Error, retry: () => void) => any) | any,
  options?: { onError?: (error: Error, info: ErrorInfo) => void }
): (props: T) => any {
  return (props: T) => ErrorBoundary({
      fallback,
      onError: options?.onError,
      children: () => Component(props),
    });
}

/**
 * Combined Suspense + ErrorBoundary wrapper
 *
 * Convenience component that wraps children with both Suspense and ErrorBoundary.
 *
 * @example
 * ```tsx
 * <Boundary
 *   fallback={<LoadingSpinner />}
 *   errorFallback={(error, retry) => (
 *     <ErrorDisplay error={error} onRetry={retry} />
 *   )}
 * >
 *   <AsyncComponent />
 * </Boundary>
 * ```
 */
export function Boundary(props: {
  children?: any;
  fallback?: any;
  errorFallback?: ((error: Error, retry: () => void) => any) | any;
  onError?: (error: Error, info: ErrorInfo) => void;
  onSuspend?: () => void;
  onResolve?: () => void;
  suspenseTimeout?: number;
}): any {
  const {
    children,
    fallback,
    errorFallback,
    onError,
    onSuspend,
    onResolve,
    suspenseTimeout,
  } = props;

  // Create components outside to avoid re-instantiation
  const suspense = Suspense({
    fallback,
    onSuspend,
    onResolve,
    timeout: suspenseTimeout,
    children,
  });

  const errorBoundary = ErrorBoundary({
    fallback: errorFallback,
    onError,
    children: () => {
      // Suspense returns setup function, call it to get render function
      const suspenseRenderFn = suspense();
      // Call the suspense render function to execute and catch any errors
      return suspenseRenderFn();
    },
  });

  // Return setup function that returns wrapper that returns render function
  return () => {
    // ErrorBoundary returns setup function, call it to get render function
    const errorBoundaryRenderFn = errorBoundary();

    // Return wrapper function that returns the error boundary render function
    // This adds the extra layer needed for Boundary
    return () => errorBoundaryRenderFn;
  };
}

/**
 * Error recovery helper
 *
 * Creates a retry mechanism with exponential backoff.
 *
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Function that retries on error
 *
 * @example
 * ```typescript
 * const fetchWithRetry = withRetry(
 *   () => fetch('/api/data'),
 *   { maxRetries: 3, backoff: 'exponential' }
 * );
 * ```
 */
export function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    backoff?: 'linear' | 'exponential';
    initialDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): () => Promise<T> {
  const {
    maxRetries = 3,
    backoff = 'exponential',
    initialDelay = 1000,
    onRetry,
  } = options;

  return async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          const delay =
            backoff === 'exponential'
              ? initialDelay * Math.pow(2, attempt)
              : initialDelay * (attempt + 1);

          if (onRetry) {
            onRetry(attempt + 1, lastError);
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  };
}

/**
 * Reset error boundary ID counter (for testing)
 */
export function resetErrorBoundaryIdCounter(): void {
  errorBoundaryIdCounter = 0;
}

/**
 * Get current error boundary ID counter (for testing)
 */
export function getErrorBoundaryIdCounter(): number {
  return errorBoundaryIdCounter;
}
