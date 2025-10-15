/**
 * ErrorBoundary Component
 *
 * Catches and handles errors in the component tree, preventing the entire app from crashing.
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={<ErrorFallback />}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */

import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { jsx } from '@omnitron-dev/aether/jsx-runtime';

// ============================================================================
// Types
// ============================================================================

export interface ErrorInfo {
  error: Error;
  errorInfo?: any;
  timestamp: Date;
}

export interface ErrorBoundaryProps {
  /** Children to render */
  children?: any;

  /** Fallback UI when error occurs */
  fallback?: any;

  /** Custom fallback renderer */
  fallbackRender?: (error: ErrorInfo) => any;

  /** Callback when error is caught */
  onError?: (error: ErrorInfo) => void;

  /** Whether to log errors to console */
  logErrors?: boolean;

  /** Whether to allow reset */
  resetable?: boolean;

  /** Custom reset button text */
  resetText?: string;

  /** Additional CSS class */
  class?: string;

  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Default Error Fallback
// ============================================================================

const DefaultErrorFallback = defineComponent<{
  error: ErrorInfo;
  reset?: () => void;
  resetText?: string;
}>((props) => () => {
  const { error, reset, resetText = 'Try Again' } = props;

  return jsx('div', {
    'data-error-boundary-fallback': '',
    class: 'error-boundary-fallback',
    role: 'alert',
    children: [
      jsx('div', {
        'data-error-icon': '',
        children: jsx('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          width: '48',
          height: '48',
          children: [
            jsx('circle', { cx: '12', cy: '12', r: '10' }),
            jsx('line', { x1: '12', y1: '8', x2: '12', y2: '12' }),
            jsx('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' }),
          ],
        }),
      }),

      jsx('h2', {
        'data-error-title': '',
        children: 'Something went wrong',
      }),

      jsx('p', {
        'data-error-message': '',
        children: error.error.message || 'An unexpected error occurred',
      }),

      import.meta.env.DEV &&
        jsx('details', {
          'data-error-details': '',
          children: [
            jsx('summary', { children: 'Error Details' }),
            jsx('pre', {
              'data-error-stack': '',
              children: error.error.stack || 'No stack trace available',
            }),
          ],
        }),

      reset &&
        jsx('button', {
          'data-error-reset': '',
          onClick: reset,
          children: resetText,
        }),
    ],
  });
});

// ============================================================================
// ErrorBoundary Component
// ============================================================================

export const ErrorBoundary = defineComponent<ErrorBoundaryProps>((props) => {
  const error = signal<ErrorInfo | null>(null);
  const hasError = signal(false);

  const handleError = (err: Error, errorInfo?: any) => {
    const errorData: ErrorInfo = {
      error: err,
      errorInfo,
      timestamp: new Date(),
    };

    error.set(errorData);
    hasError.set(true);

    // Log to console if enabled
    if (props.logErrors !== false) {
      console.error('ErrorBoundary caught error:', err);
      if (errorInfo) {
        console.error('Error info:', errorInfo);
      }
    }

    // Call error callback
    props.onError?.(errorData);
  };

  const reset = () => {
    error.set(null);
    hasError.set(false);
  };

  // Set up global error handler
  onMount(() => {
    const errorHandler = (event: ErrorEvent) => {
      handleError(event.error);
      event.preventDefault();
    };

    const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      handleError(new Error(event.reason));
      event.preventDefault();
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
    };
  });

  return () => {
    const {
      children,
      fallback,
      fallbackRender,
      resetable = true,
      resetText,
      class: className = '',
      ...rest
    } = props;

    // If there's an error, render fallback
    if (hasError()) {
      const errorData = error()!;

      // Custom fallback renderer
      if (fallbackRender) {
        return jsx('div', {
          ...rest,
          'data-error-boundary': '',
          class: `error-boundary ${className}`,
          children: fallbackRender(errorData),
        });
      }

      // Custom fallback component
      if (fallback) {
        return jsx('div', {
          ...rest,
          'data-error-boundary': '',
          class: `error-boundary ${className}`,
          children: fallback,
        });
      }

      // Default fallback
      return jsx('div', {
        ...rest,
        'data-error-boundary': '',
        class: `error-boundary ${className}`,
        children: jsx(DefaultErrorFallback, {
          error: errorData,
          reset: resetable ? reset : undefined,
          resetText,
        }),
      });
    }

    // Normal render
    return jsx('div', {
      ...rest,
      'data-error-boundary': '',
      class: `error-boundary ${className}`,
      children,
    });
  };
});

// Display name
ErrorBoundary.displayName = 'ErrorBoundary';
