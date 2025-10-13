/**
 * Special Files Handler
 *
 * Handles special route files like _error, _loading, _404, _middleware
 */

import type { RouteDefinition, RouteComponent } from '../types.js';

/**
 * Special file types
 */
export type SpecialFileType = 'error' | 'loading' | 'notFound' | 'middleware';

/**
 * Error boundary props
 */
export interface ErrorBoundaryProps {
  error: Error;
  reset: () => void;
  pathname: string;
}

/**
 * Loading component props
 */
export interface LoadingProps {
  pathname: string;
  progress?: number;
}

/**
 * 404 Not Found props
 */
export interface NotFoundProps {
  pathname: string;
  suggestion?: string;
}

/**
 * Middleware context
 */
export interface MiddlewareContext {
  request: Request;
  pathname: string;
  params: Record<string, string | string[]>;
  query: Record<string, string>;
}

/**
 * Middleware result
 */
export type MiddlewareResult =
  | { type: 'continue' }
  | { type: 'redirect'; location: string; status?: number }
  | { type: 'rewrite'; pathname: string }
  | { type: 'block'; status?: number; message?: string };

/**
 * Create error boundary component
 */
export function createErrorBoundary(
  component?: RouteComponent,
  options: {
    fallback?: (props: ErrorBoundaryProps) => any;
    onError?: (error: Error, pathname: string) => void;
  } = {}
): RouteComponent {
  return (props: any) => {
    const error = props.error as Error;
    const pathname = props.pathname as string;

    // Call error handler if provided
    if (options.onError) {
      options.onError(error, pathname);
    }

    // Use custom component if provided
    if (component) {
      return component({
        error,
        reset: () => {
          // Reset logic - reload route
          window.location.reload();
        },
        pathname,
        ...props,
      });
    }

    // Use fallback if provided
    if (options.fallback) {
      return options.fallback({
        error,
        reset: () => window.location.reload(),
        pathname,
      });
    }

    // Default error boundary
    return createDefaultErrorBoundary(error, pathname);
  };
}

/**
 * Default error boundary UI
 */
function createDefaultErrorBoundary(error: Error, pathname: string): any {
  return {
    type: 'div',
    props: {
      class: 'error-boundary',
      style: {
        padding: '2rem',
        maxWidth: '600px',
        margin: '2rem auto',
        border: '1px solid #f44336',
        borderRadius: '8px',
        backgroundColor: '#ffebee',
        color: '#c62828',
      },
      children: [
        {
          type: 'h1',
          props: {
            style: { fontSize: '1.5rem', marginBottom: '1rem' },
            children: '⚠️ Something went wrong',
          },
        },
        {
          type: 'p',
          props: {
            style: { marginBottom: '1rem' },
            children: error.message,
          },
        },
        {
          type: 'details',
          props: {
            style: {
              padding: '1rem',
              backgroundColor: '#fff',
              borderRadius: '4px',
              marginBottom: '1rem',
            },
            children: [
              {
                type: 'summary',
                props: {
                  style: { cursor: 'pointer', marginBottom: '0.5rem' },
                  children: 'Stack trace',
                },
              },
              {
                type: 'pre',
                props: {
                  style: {
                    fontSize: '0.75rem',
                    overflow: 'auto',
                    padding: '0.5rem',
                    backgroundColor: '#f5f5f5',
                  },
                  children: error.stack || 'No stack trace available',
                },
              },
            ],
          },
        },
        {
          type: 'button',
          props: {
            style: {
              padding: '0.5rem 1rem',
              backgroundColor: '#f44336',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            },
            onClick: () => window.location.reload(),
            children: 'Reload page',
          },
        },
      ],
    },
  };
}

/**
 * Create loading component
 */
export function createLoadingComponent(
  component?: RouteComponent,
  options: {
    fallback?: (props: LoadingProps) => any;
    timeout?: number;
  } = {}
): RouteComponent {
  return (props: any) => {
    const pathname = props.pathname as string;
    const progress = props.progress as number | undefined;

    // Use custom component if provided
    if (component) {
      return component({ pathname, progress, ...props });
    }

    // Use fallback if provided
    if (options.fallback) {
      return options.fallback({ pathname, progress });
    }

    // Default loading component
    return createDefaultLoading(pathname, progress);
  };
}

/**
 * Default loading UI
 */
function createDefaultLoading(pathname: string, progress?: number): any {
  return {
    type: 'div',
    props: {
      class: 'loading-boundary',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        minHeight: '200px',
      },
      children: [
        {
          type: 'div',
          props: {
            class: 'spinner',
            style: {
              width: '40px',
              height: '40px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #3498db',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            },
          },
        },
        {
          type: 'p',
          props: {
            style: {
              marginTop: '1rem',
              color: '#666',
            },
            children: `Loading ${pathname}...`,
          },
        },
        progress !== undefined && {
          type: 'div',
          props: {
            style: {
              width: '200px',
              height: '4px',
              backgroundColor: '#f3f3f3',
              borderRadius: '2px',
              marginTop: '1rem',
              overflow: 'hidden',
            },
            children: {
              type: 'div',
              props: {
                style: {
                  width: `${progress * 100}%`,
                  height: '100%',
                  backgroundColor: '#3498db',
                  transition: 'width 0.3s ease',
                },
              },
            },
          },
        },
      ].filter(Boolean),
    },
  };
}

/**
 * Create 404 not found component
 */
export function createNotFoundComponent(
  component?: RouteComponent,
  options: {
    fallback?: (props: NotFoundProps) => any;
    suggestions?: (pathname: string) => string[];
  } = {}
): RouteComponent {
  return (props: any) => {
    const pathname = props.pathname as string;

    // Find suggestions if available
    const suggestions = options.suggestions ? options.suggestions(pathname) : [];
    const suggestion = suggestions[0];

    // Use custom component if provided
    if (component) {
      return component({ pathname, suggestion, ...props });
    }

    // Use fallback if provided
    if (options.fallback) {
      return options.fallback({ pathname, suggestion });
    }

    // Default 404 component
    return createDefault404(pathname, suggestion);
  };
}

/**
 * Default 404 UI
 */
function createDefault404(pathname: string, suggestion?: string): any {
  return {
    type: 'div',
    props: {
      class: 'not-found',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        minHeight: '400px',
        textAlign: 'center',
      },
      children: [
        {
          type: 'h1',
          props: {
            style: {
              fontSize: '6rem',
              margin: '0',
              color: '#e0e0e0',
            },
            children: '404',
          },
        },
        {
          type: 'h2',
          props: {
            style: {
              fontSize: '1.5rem',
              marginTop: '1rem',
              marginBottom: '0.5rem',
              color: '#666',
            },
            children: 'Page Not Found',
          },
        },
        {
          type: 'p',
          props: {
            style: {
              color: '#999',
              marginBottom: '2rem',
            },
            children: `The page "${pathname}" does not exist.`,
          },
        },
        suggestion && {
          type: 'p',
          props: {
            style: { marginBottom: '1rem' },
            children: [
              {
                type: 'span',
                props: { children: 'Did you mean ' },
              },
              {
                type: 'a',
                props: {
                  href: suggestion,
                  style: { color: '#3498db', textDecoration: 'underline' },
                  children: suggestion,
                },
              },
              {
                type: 'span',
                props: { children: '?' },
              },
            ],
          },
        },
        {
          type: 'a',
          props: {
            href: '/',
            style: {
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              backgroundColor: '#3498db',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: '4px',
              marginTop: '1rem',
            },
            children: 'Go Home',
          },
        },
      ].filter(Boolean),
    },
  };
}

/**
 * Execute middleware
 */
export async function executeMiddleware(
  middleware: RouteComponent,
  context: MiddlewareContext
): Promise<MiddlewareResult> {
  try {
    const result = await middleware(context);

    // Handle different result types
    if (!result || result === true) {
      return { type: 'continue' };
    }

    if (typeof result === 'object' && 'type' in result) {
      return result as MiddlewareResult;
    }

    // String result = redirect
    if (typeof result === 'string') {
      return { type: 'redirect', location: result };
    }

    // False = block
    if (result === false) {
      return { type: 'block', status: 403, message: 'Access denied' };
    }

    return { type: 'continue' };
  } catch (error) {
    console.error('Middleware execution error:', error);
    return {
      type: 'block',
      status: 500,
      message: error instanceof Error ? error.message : 'Middleware error',
    };
  }
}

/**
 * Find nearest special file in route tree
 */
export function findNearestSpecialFile(
  routes: RouteDefinition[],
  pathname: string,
  type: SpecialFileType
): RouteComponent | undefined {
  // Split pathname into segments
  const segments = pathname.split('/').filter(Boolean);

  // Check from most specific to least specific
  for (let i = segments.length; i >= 0; i--) {
    const checkPath = i === 0 ? '/' : '/' + segments.slice(0, i).join('/');

    // Find route for this path
    const route = findRouteByPath(routes, checkPath);
    if (route) {
      // Check for special file
      switch (type) {
        case 'error':
          if (route.errorBoundary) return route.errorBoundary;
          break;
        case 'loading':
          if (route.loading) return route.loading;
          break;
        case 'notFound':
          // Check meta for 404 handler
          if (route.meta?.notFound) return route.meta.notFound as RouteComponent;
          break;
        case 'middleware':
          // Check meta for middleware
          if (route.meta?.middleware) return route.meta.middleware as RouteComponent;
          break;
        default:
          // Handle unknown special file types
          break;
      }
    }
  }

  return undefined;
}

/**
 * Find route by exact path
 */
function findRouteByPath(routes: RouteDefinition[], path: string): RouteDefinition | undefined {
  for (const route of routes) {
    if (route.path === path) {
      return route;
    }
    if (route.children) {
      const found = findRouteByPath(route.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Calculate route similarity for suggestions
 */
export function calculateRouteSimilarity(path1: string, path2: string): number {
  const segments1 = path1.split('/').filter(Boolean);
  const segments2 = path2.split('/').filter(Boolean);

  let matches = 0;
  const maxLength = Math.max(segments1.length, segments2.length);

  for (let i = 0; i < Math.min(segments1.length, segments2.length); i++) {
    if (segments1[i] === segments2[i]) {
      matches++;
    }
  }

  return maxLength === 0 ? 0 : matches / maxLength;
}

/**
 * Find similar routes for 404 suggestions
 */
export function findSimilarRoutes(
  routes: RouteDefinition[],
  pathname: string,
  threshold = 0.5,
  limit = 3
): string[] {
  const allPaths: string[] = [];

  function collectPaths(routeList: RouteDefinition[]) {
    for (const route of routeList) {
      if (route.path && !route.path.includes(':') && !route.path.includes('*')) {
        allPaths.push(route.path);
      }
      if (route.children) {
        collectPaths(route.children);
      }
    }
  }

  collectPaths(routes);

  // Calculate similarities
  const similarities = allPaths.map(path => ({
    path,
    score: calculateRouteSimilarity(pathname, path),
  }));

  // Filter and sort by similarity
  return similarities
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.path);
}
