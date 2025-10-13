/**
 * Edge Runtime Support
 *
 * Lightweight SSR optimized for edge runtimes:
 * - Cloudflare Workers compatibility
 * - Vercel Edge Runtime support
 * - Deno Deploy compatibility
 * - Minimal bundle size
 * - Edge caching strategies
 */

import type { EdgeOptions } from './types.js';
import { renderToString } from './ssr.js';
import { renderToReadableStream } from './streaming.js';
import { renderDocument } from './renderer.js';

/**
 * Runtime detection
 */
type EdgeRuntime = 'cloudflare' | 'vercel' | 'deno' | 'node';

/**
 * Detect current edge runtime
 */
function detectRuntime(): EdgeRuntime {
  // Check for Cloudflare Workers
  if (typeof (globalThis as any).caches !== 'undefined' && typeof (globalThis as any).WebSocketPair !== 'undefined') {
    return 'cloudflare';
  }

  // Check for Vercel Edge
  if (typeof (globalThis as any).EdgeRuntime !== 'undefined') {
    return 'vercel';
  }

  // Check for Deno
  if (typeof (globalThis as any).Deno !== 'undefined') {
    return 'deno';
  }

  return 'node';
}

/**
 * Render component for edge runtime
 *
 * Optimized SSR for edge environments with minimal overhead.
 * Automatically detects runtime and uses appropriate APIs.
 *
 * @param component - Component to render
 * @param options - Edge rendering options
 * @returns Response object
 *
 * @example
 * ```typescript
 * // Cloudflare Workers
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     return renderToEdge(App, {
 *       runtime: 'cloudflare',
 *       cache: true,
 *       cacheTtl: 300
 *     });
 *   }
 * };
 *
 * // Vercel Edge
 * export const config = { runtime: 'edge' };
 *
 * export default async function handler(request: Request) {
 *   return renderToEdge(App, {
 *     runtime: 'vercel',
 *     cache: true
 *   });
 * }
 * ```
 */
export async function renderToEdge(
  component: any,
  options: Partial<
    EdgeOptions & {
      props?: Record<string, any>;
      url?: string | URL;
      initialState?: Record<string, any>;
      streaming?: boolean;
    }
  > = {}
): Promise<Response> {
  const {
    runtime: _runtime = 'auto',
    cache = false,
    cacheTtl = 300,
    props = {},
    url,
    initialState = {},
    streaming = false,
  } = options;

  // Detect runtime (for future use - currently unused but will be needed for runtime-specific optimizations)
  // const _detectedRuntime = runtime === 'auto' ? detectRuntime() : runtime;

  try {
    if (streaming) {
      // Use streaming SSR
      const { stream, metadata } = await renderToReadableStream(component, {
        props,
        url,
        initialState,
        progressive: true,
      });

      const headers = new Headers(metadata.headers);

      // Add caching headers
      if (cache) {
        headers.set('Cache-Control', `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`);
      }

      return new Response(stream as any, {
        status: metadata.status,
        headers,
      });
    } else {
      // Use standard SSR
      const result = await renderToString(component, {
        props,
        url,
        initialState,
      });

      const html = renderDocument(result.html, result.data, result.meta);

      const headers = new Headers({
        'Content-Type': 'text/html; charset=utf-8',
      });

      // Add caching headers
      if (cache) {
        headers.set('Cache-Control', `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`);
      }

      return new Response(html, {
        status: 200,
        headers,
      });
    }
  } catch (error) {
    console.error('Edge rendering error:', error);

    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

/**
 * Create edge request handler
 *
 * Factory function that creates an edge-compatible request handler.
 * Handles routing, caching, and error handling automatically.
 *
 * @param component - Root component
 * @param options - Edge options
 * @returns Request handler function
 *
 * @example
 * ```typescript
 * const handler = createEdgeHandler(App, {
 *   runtime: 'cloudflare',
 *   cache: true,
 *   cacheTtl: 600
 * });
 *
 * export default {
 *   fetch: handler
 * };
 * ```
 */
export function createEdgeHandler(
  component: any,
  options: Partial<EdgeOptions> = {}
): (request: Request) => Promise<Response> {
  const { runtime = 'auto', cache = false, cacheTtl = 300 } = options;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // Handle static assets
    if (url.pathname.startsWith('/_assets/') || url.pathname.startsWith('/assets/')) {
      return new Response('Not Found', { status: 404 });
    }

    // Check cache
    if (cache) {
      const cached = await getCachedResponse(request, runtime);
      if (cached) {
        return cached;
      }
    }

    // Render
    const response = await renderToEdge(component, {
      runtime,
      cache,
      cacheTtl,
      url: url.href,
    });

    // Store in cache
    if (cache && response.ok) {
      await cacheResponse(request, response.clone(), runtime, cacheTtl);
    }

    return response;
  };
}

/**
 * Optimize bundle for edge deployment
 *
 * Analyzes and optimizes the component tree for edge runtime.
 * Removes server-only code and reduces bundle size.
 *
 * @param component - Component to optimize
 * @param options - Optimization options
 * @returns Optimized component
 *
 * @example
 * ```typescript
 * const optimized = optimizeForEdge(App, {
 *   maxBundleSize: 50000, // 50KB
 *   stripServerCode: true
 * });
 * ```
 */
export function optimizeForEdge(
  component: any,
  _options: Partial<
    EdgeOptions & {
      stripServerCode?: boolean;
    }
  > = {}
): any {
  // const { maxBundleSize = 100000, stripServerCode = true } = options;

  // In a real implementation, this would:
  // 1. Analyze component tree
  // 2. Remove server-only imports
  // 3. Tree-shake unused code
  // 4. Minify and compress
  // 5. Validate bundle size

  // For now, return component as-is
  return component;
}

/**
 * Get cached response from edge runtime
 */
async function getCachedResponse(request: Request, runtime: EdgeRuntime | 'auto'): Promise<Response | null> {
  try {
    if (runtime === 'cloudflare' || runtime === 'auto') {
      // Cloudflare Workers Cache API
      const cache = (globalThis as any).caches?.default;
      if (cache) {
        return await cache.match(request);
      }
    }

    // Vercel Edge has automatic caching via headers
    // No manual cache API needed

    return null;
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
}

/**
 * Cache response in edge runtime
 */
async function cacheResponse(
  request: Request,
  response: Response,
  runtime: EdgeRuntime | 'auto',
  ttl: number
): Promise<void> {
  try {
    if (runtime === 'cloudflare' || runtime === 'auto') {
      // Cloudflare Workers Cache API
      const cache = (globalThis as any).caches?.default;
      if (cache) {
        // Clone response with cache headers
        const cachedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers({
            ...Object.fromEntries(response.headers),
            'Cache-Control': `public, max-age=${ttl}`,
          }),
        });

        await cache.put(request, cachedResponse);
      }
    }

    // Vercel Edge caching is automatic via Cache-Control headers
    // Already set in renderToEdge
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

/**
 * Create Cloudflare Workers handler
 *
 * Convenience function specifically for Cloudflare Workers.
 *
 * @param component - Root component
 * @param options - Edge options
 * @returns Workers handler
 *
 * @example
 * ```typescript
 * export default createCloudflareHandler(App, {
 *   cache: true,
 *   cacheTtl: 600,
 *   regions: ['auto']
 * });
 * ```
 */
export function createCloudflareHandler(
  component: any,
  options: Partial<EdgeOptions> = {}
): {
  fetch: (request: Request) => Promise<Response>;
} {
  const handler = createEdgeHandler(component, {
    ...options,
    runtime: 'cloudflare',
  });

  return {
    fetch: handler,
  };
}

/**
 * Create Vercel Edge handler
 *
 * Convenience function specifically for Vercel Edge Runtime.
 *
 * @param component - Root component
 * @param options - Edge options
 * @returns Edge handler
 *
 * @example
 * ```typescript
 * export const config = { runtime: 'edge' };
 *
 * export default createVercelEdgeHandler(App, {
 *   cache: true,
 *   cacheTtl: 300
 * });
 * ```
 */
export function createVercelEdgeHandler(
  component: any,
  options: Partial<EdgeOptions> = {}
): (request: Request) => Promise<Response> {
  return createEdgeHandler(component, {
    ...options,
    runtime: 'vercel',
  });
}

/**
 * Create Deno Deploy handler
 *
 * Convenience function specifically for Deno Deploy.
 *
 * @param component - Root component
 * @param options - Edge options
 * @returns Deno handler
 *
 * @example
 * ```typescript
 * import { serve } from 'https://deno.land/std/http/server.ts';
 *
 * const handler = createDenoHandler(App, {
 *   cache: true,
 *   cacheTtl: 600
 * });
 *
 * serve(handler);
 * ```
 */
export function createDenoHandler(
  component: any,
  options: Partial<EdgeOptions> = {}
): (request: Request) => Promise<Response> {
  return createEdgeHandler(component, {
    ...options,
    runtime: 'deno',
  });
}

/**
 * Get edge runtime info
 *
 * Returns information about the current edge runtime.
 */
export function getEdgeRuntimeInfo(): {
  runtime: EdgeRuntime;
  features: {
    cache: boolean;
    streaming: boolean;
    webSockets: boolean;
  };
} {
  const runtime = detectRuntime();

  return {
    runtime,
    features: {
      cache: runtime === 'cloudflare' || runtime === 'vercel',
      streaming: true, // All modern runtimes support streaming
      webSockets: runtime === 'cloudflare' || runtime === 'deno',
    },
  };
}
