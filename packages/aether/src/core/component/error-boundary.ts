/**
 * Error Boundary Component
 *
 * Enhanced error boundary with retry, reset, and component stack tracking
 */

import { signal } from '../reactivity/signal.js';
import { defineComponent } from './define.js';
import { createContext, useContext } from './context.js';
import { onMount, onError } from './lifecycle.js';
import { jsx } from '../../jsx-runtime.js';

/**
 * Error information with component stack
 */
export interface ErrorInfo {
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Original error object */
  error: Error;
  /** Component stack trace (which component threw the error) */
  componentStack?: string;
  /** Number of times error has occurred */
  errorCount: number;
}

/**
 * Error boundary context
 */
export interface ErrorBoundaryContext {
  /** Current error info */
  error: ErrorInfo | null;
  /** Reset the error boundary */
  reset: () => void;
  /** Retry the failed operation */
  retry: () => void;
}

/**
 * Error context - provides error information and reset functionality
 */
export const ErrorBoundaryContext = createContext<ErrorBoundaryContext | null>(null, 'error-boundary');

/**
 * Get current error boundary context
 *
 * Must be called inside an error boundary
 *
 * @example
 * ```tsx
 * const ErrorFallback = defineComponent(() => {
 *   const ctx = useErrorBoundary();
 *
 *   return () => (
 *     <div class="error-page">
 *       <h1>Error</h1>
 *       <p>{ctx()?.error?.message}</p>
 *       <button onClick={() => ctx()?.reset()}>Try Again</button>
 *       {ctx()?.error?.componentStack && (
 *         <pre>{ctx().error.componentStack}</pre>
 *       )}
 *     </div>
 *   );
 * });
 * ```
 */
export function useErrorBoundary() {
  return useContext(ErrorBoundaryContext);
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
  onError?: (error: Error, errorInfo: ErrorInfo) => void;

  /**
   * Callback when error boundary is reset
   */
  onReset?: () => void;

  /**
   * Maximum number of retry attempts before giving up
   * @default Infinity
   */
  maxRetries?: number;

  /**
   * Reset error boundary when children change
   * @default true
   */
  resetOnPropsChange?: boolean;

  /**
   * Children to wrap with error boundary
   */
  children?: any;
}

/**
 * Error Boundary Component
 *
 * Catches errors in child components and renders a fallback UI with retry/reset functionality
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   fallback={ErrorFallback}
 *   onError={(error, info) => logError(error, info)}
 *   maxRetries={3}
 * >
 *   <App />
 * </ErrorBoundary>
 * ```
 */
export const ErrorBoundary = defineComponent<ErrorBoundaryProps>((rawProps) => {
  const error = signal<ErrorInfo | null>(null);
  const hasError = signal(false);
  const errorCount = signal(0);
  const retryKey = signal(0);

  // Track props for reset on change
  const previousChildren = signal(rawProps.children);

  /**
   * Reset the error boundary
   */
  const reset = () => {
    error.set(null);
    hasError.set(false);
    errorCount.set(0);

    // Call user reset handler
    if (rawProps.onReset) {
      rawProps.onReset();
    }

    // Log in development
    if (process.env.NODE_ENV !== 'production') {
      console.log('ErrorBoundary reset');
    }
  };

  /**
   * Retry the failed operation
   */
  const retry = () => {
    const currentCount = errorCount();
    const maxRetries = rawProps.maxRetries ?? Infinity;

    if (currentCount >= maxRetries) {
      console.warn(`ErrorBoundary: Maximum retries (${maxRetries}) exceeded. Use reset() instead.`);
      return;
    }

    // Increment retry key to force re-render
    retryKey.set(retryKey() + 1);

    // Clear error state
    error.set(null);
    hasError.set(false);

    // Log in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`ErrorBoundary retry (attempt ${currentCount + 1})`);
    }
  };

  // Register error handler
  onError((err) => {
    const componentStack = captureComponentStack(err);

    const errorInfo: ErrorInfo = {
      message: err.message || 'An error occurred',
      stack: err.stack,
      error: err,
      componentStack,
      errorCount: errorCount() + 1,
    };

    error.set(errorInfo);
    hasError.set(true);
    errorCount.set(errorCount() + 1);

    // Call user error handler
    if (rawProps.onError) {
      rawProps.onError(err, errorInfo);
    }

    // Log error in development
    if (process.env.NODE_ENV !== 'production') {
      console.group('ErrorBoundary caught error');
      console.error('Error:', err);
      console.log('Error count:', errorInfo.errorCount);
      if (componentStack) {
        console.log('Component stack:', componentStack);
      }
      console.groupEnd();
    }
  });

  // Reset error on cleanup
  onMount(() => () => {
    error.set(null);
    hasError.set(false);
    errorCount.set(0);
  });

  // Create error boundary context
  const errorBoundaryContext: ErrorBoundaryContext = {
    get error() {
      return error();
    },
    reset,
    retry,
  };

  return () => {
    // Reset on props change if enabled
    if (rawProps.resetOnPropsChange !== false) {
      const currentChildren = rawProps.children;
      if (currentChildren !== previousChildren()) {
        previousChildren.set(currentChildren);
        if (hasError()) {
          reset();
        }
      }
    }

    if (hasError()) {
      const FallbackComponent = rawProps.fallback;

      if (!FallbackComponent) {
        // Default error UI with retry button
        const errorData = error();
        const children = [
          jsx('h1', { children: 'Something went wrong' }),
          jsx('p', { children: errorData?.message || 'An error occurred' }),
          jsx('button', {
            onClick: reset,
            children: 'Try Again',
            style: { marginRight: '8px' },
          }),
        ];

        // Show error details in development
        if (process.env.NODE_ENV !== 'production' && errorData) {
          if (errorData.stack) {
            children.push(
              jsx('h3', { children: 'Error Stack:' }),
              jsx('pre', {
                style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
                children: errorData.stack,
              })
            );
          }

          if (errorData.componentStack) {
            children.push(
              jsx('h3', { children: 'Component Stack:' }),
              jsx('pre', {
                style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
                children: errorData.componentStack,
              })
            );
          }

          children.push(
            jsx('p', {
              children: `Error count: ${errorData.errorCount}`,
              style: { fontSize: '12px', color: '#666' },
            })
          );
        }

        return jsx('div', {
          class: 'error-boundary-fallback',
          style: { padding: '20px', border: '1px solid #f00' },
          children,
        });
      }

      // Render user-provided fallback with error context
      return ErrorBoundaryContext.Provider({
        value: errorBoundaryContext,
        children: FallbackComponent(),
      });
    }

    // Render children normally with retry key for re-mounting
    // Errors from children will be caught by defineComponent and passed to onError
    const children = typeof rawProps.children === 'function' ? rawProps.children() : rawProps.children;

    return jsx('div', {
      key: `error-boundary-${retryKey()}`,
      children,
    });
  };
});

/**
 * Capture component stack from error
 * @internal
 */
function captureComponentStack(error: Error): string | undefined {
  // Try to extract component information from error stack
  if (!error.stack) return undefined;

  const lines = error.stack.split('\n');
  const componentLines: string[] = [];

  // Look for component-related stack frames
  for (const line of lines) {
    // Skip the error message line
    if (line.includes('Error:')) continue;

    // Look for defineComponent, component names, or JSX
    if (
      line.includes('defineComponent') ||
      line.includes('Component') ||
      line.includes('.tsx') ||
      line.includes('.jsx')
    ) {
      componentLines.push(line.trim());
    }

    // Limit to 10 lines for readability
    if (componentLines.length >= 10) break;
  }

  return componentLines.length > 0 ? componentLines.join('\n') : undefined;
}

/**
 * Create an error boundary wrapper
 *
 * Higher-order component that wraps a component with an error boundary
 *
 * @example
 * ```tsx
 * const SafeComponent = withErrorBoundary(MyComponent, {
 *   fallback: ErrorFallback,
 *   onError: (error) => console.error(error),
 * });
 * ```
 */
export function withErrorBoundary<P = {}>(
  Component: (props: P) => any,
  errorBoundaryProps: Omit<ErrorBoundaryProps, 'children'>
) {
  return defineComponent<P>(
    (props) => () =>
      ErrorBoundary({
        ...errorBoundaryProps,
        children: () => Component(props),
      })
  );
}
