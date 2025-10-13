/**
 * Streaming SSR
 *
 * React 18-style streaming server-side rendering:
 * - Stream HTML as it's generated
 * - Support Suspense boundaries
 * - Out-of-order streaming for async components
 * - Progressive rendering for faster TTFB
 * - Compatible with Node.js streams and Web Streams API
 */

import { PassThrough } from 'node:stream';
import type { StreamingOptions, StreamingResult, RenderToStreamOptions } from './types.js';
import { renderToString } from './ssr.js';

/**
 * Suspense boundary state
 */
interface SuspenseBoundary {
  id: string;
  promise: Promise<string>;
  resolved: boolean;
  html?: string;
}

/**
 * Streaming context
 */
interface StreamingContext {
  boundaries: Map<string, SuspenseBoundary>;
  completed: Set<string>;
  pending: number;
}

/**
 * Render component to Node.js stream
 *
 * Creates a Node.js Readable stream that outputs HTML as it's generated.
 * Supports Suspense boundaries and out-of-order streaming.
 *
 * @param component - Component to render
 * @param options - Rendering and streaming options
 * @returns Pipeable stream with HTML chunks
 *
 * @example
 * ```typescript
 * const stream = renderToPipeableStream(App, {
 *   url: '/users',
 *   progressive: true,
 *   outOfOrder: true,
 *   onShellReady: () => {
 *     res.statusCode = 200;
 *     res.setHeader('Content-Type', 'text/html');
 *     stream.pipe(res);
 *   },
 *   onError: (error) => {
 *     console.error('Streaming error:', error);
 *   }
 * });
 * ```
 */
export function renderToPipeableStream(
  component: any,
  options: Partial<RenderToStreamOptions> & {
    onShellReady?: () => void;
    onShellError?: (error: Error) => void;
    onError?: (error: Error) => void;
    onAllReady?: () => void;
  } = {}
): {
  pipe: (destination: NodeJS.WritableStream) => void;
  abort: () => void;
} {
  const {
    props = {},
    url,
    initialState = {},
    netron,
    outOfOrder = false,
    // progressive = true,
    suspenseTimeout = 10000,
    // placeholder,
    onShellReady,
    onShellError,
    onError,
    onAllReady,
  } = options;

  const context: StreamingContext = {
    boundaries: new Map(),
    completed: new Set(),
    pending: 0,
  };

  const stream = new PassThrough();
  let aborted = false;

  // Start rendering
  (async () => {
    try {
      // Render shell
      const shell = await renderShell(component, props, context, {
        url,
        initialState,
        netron,
      });

      if (aborted) return;

      // Write shell
      stream.write(shell);

      if (onShellReady) {
        onShellReady();
      }

      // Stream suspense boundaries
      if (context.boundaries.size > 0) {
        await streamSuspenseBoundaries(stream, context, {
          outOfOrder,
          suspenseTimeout,
          onError,
        });
      }

      // End stream
      stream.end();

      if (onAllReady) {
        onAllReady();
      }
    } catch (error) {
      console.error('Shell rendering error:', error);

      if (onShellError) {
        onShellError(error as Error);
      }

      if (!stream.destroyed) {
        stream.destroy(error as Error);
      }
    }
  })().catch((error) => {
    // Handle any unhandled promise rejections from the async IIFE
    console.error('Unhandled streaming error:', error);
    if (onError) {
      onError(error as Error);
    }
  });

  return {
    pipe: (destination) => {
      stream.pipe(destination);
    },
    abort: () => {
      aborted = true;
      if (!stream.destroyed) {
        stream.destroy();
      }
    },
  };
}

/**
 * Render component to Web Streams API
 *
 * Creates a ReadableStream compatible with Web Streams API.
 * Works in edge runtimes like Cloudflare Workers and Vercel Edge.
 *
 * @param component - Component to render
 * @param options - Rendering and streaming options
 * @returns Streaming result with ReadableStream
 *
 * @example
 * ```typescript
 * const { stream, metadata } = await renderToReadableStream(App, {
 *   url: '/dashboard',
 *   progressive: true,
 *   suspenseTimeout: 5000
 * });
 *
 * return new Response(stream, {
 *   status: metadata.status,
 *   headers: metadata.headers
 * });
 * ```
 */
export async function renderToReadableStream(
  component: any,
  options: Partial<RenderToStreamOptions> = {}
): Promise<StreamingResult> {
  const {
    props = {},
    url,
    initialState = {},
    netron,
    outOfOrder = false,
    // progressive = true,
    suspenseTimeout = 10000,
    // placeholder,
  } = options;

  const context: StreamingContext = {
    boundaries: new Map(),
    completed: new Set(),
    pending: 0,
  };

  let aborted = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Render shell
        const shell = await renderShell(component, props, context, {
          url,
          initialState,
          netron,
        });

        if (aborted) {
          controller.close();
          return;
        }

        // Enqueue shell
        controller.enqueue(new TextEncoder().encode(shell));

        // Stream suspense boundaries
        if (context.boundaries.size > 0) {
          for (const [id, boundary] of context.boundaries) {
            try {
              const html = await Promise.race([
                boundary.promise,
                new Promise<string>((_, reject) =>
                  setTimeout(() => reject(new Error('Suspense timeout')), suspenseTimeout)
                ),
              ]);

              if (aborted) break;

              boundary.resolved = true;
              boundary.html = html;
              context.completed.add(id);

              // Stream boundary content
              const chunk = createBoundaryChunk(id, html, outOfOrder);
              controller.enqueue(new TextEncoder().encode(chunk));
            } catch (error) {
              console.error(`Boundary ${id} failed:`, error);
              // Enqueue error placeholder
              const errorChunk = createBoundaryChunk(id, '<div>Error loading content</div>', outOfOrder);
              controller.enqueue(new TextEncoder().encode(errorChunk));
            }
          }
        }

        controller.close();
      } catch (error) {
        console.error('Streaming error:', error);
        controller.error(error);
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return {
    stream,
    metadata: {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    },
  };
}

/**
 * Create streaming renderer factory
 *
 * Creates a reusable streaming renderer with default options.
 *
 * @param defaultOptions - Default streaming options
 * @returns Renderer function
 *
 * @example
 * ```typescript
 * const renderer = createStreamingRenderer({
 *   progressive: true,
 *   outOfOrder: true,
 *   suspenseTimeout: 5000
 * });
 *
 * const stream = renderer(App, { url: '/page' });
 * ```
 */
export function createStreamingRenderer(
  defaultOptions: Partial<StreamingOptions> = {}
): (component: any, options?: Partial<RenderToStreamOptions>) => Promise<StreamingResult> {
  return async (comp: any, options: Partial<RenderToStreamOptions> = {}) =>
    renderToReadableStream(comp, {
      ...defaultOptions,
      ...options,
    });
}

/**
 * Render shell (initial HTML)
 */
async function renderShell(
  component: any,
  props: any,
  _context: StreamingContext,
  options: {
    url?: string | URL;
    initialState?: Record<string, any>;
    netron?: any;
  }
): Promise<string> {
  const { url, initialState, netron } = options;

  // Render with suspense detection
  const result = await renderToString(component, {
    props,
    url,
    initialState,
    netron,
    collectStyles: true,
  });

  // For now, return the full HTML
  // In a real implementation, this would detect Suspense boundaries
  // and replace them with placeholders + tracking

  return result.html;
}

/**
 * Stream suspense boundaries as they resolve
 */
async function streamSuspenseBoundaries(
  stream: PassThrough,
  context: StreamingContext,
  options: {
    outOfOrder?: boolean;
    suspenseTimeout?: number;
    onError?: (error: Error) => void;
  }
): Promise<void> {
  const { outOfOrder = false, suspenseTimeout = 10000, onError } = options;

  if (outOfOrder) {
    // Stream boundaries as they complete (out of order)
    await Promise.all(
      Array.from(context.boundaries.entries()).map(async ([id, boundary]) => {
        try {
          const html = await Promise.race([
            boundary.promise,
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('Suspense timeout')), suspenseTimeout)
            ),
          ]);

          boundary.resolved = true;
          boundary.html = html;
          context.completed.add(id);

          // Write boundary chunk
          const chunk = createBoundaryChunk(id, html, true);
          stream.write(chunk);
        } catch (error) {
          if (onError) {
            onError(error as Error);
          }
          // Write error placeholder
          const errorChunk = createBoundaryChunk(id, '<div>Error loading content</div>', true);
          stream.write(errorChunk);
        }
      })
    );
  } else {
    // Stream boundaries in order
    for (const [id, boundary] of context.boundaries) {
      try {
        const html = await Promise.race([
          boundary.promise,
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Suspense timeout')), suspenseTimeout)),
        ]);

        boundary.resolved = true;
        boundary.html = html;
        context.completed.add(id);

        // Write boundary chunk
        const chunk = createBoundaryChunk(id, html, false);
        stream.write(chunk);
      } catch (error) {
        if (onError) {
          onError(error as Error);
        }
        // Write error placeholder
        const errorChunk = createBoundaryChunk(id, '<div>Error loading content</div>', false);
        stream.write(errorChunk);
      }
    }
  }
}

/**
 * Create boundary replacement chunk
 */
function createBoundaryChunk(id: string, html: string, outOfOrder: boolean): string {
  if (outOfOrder) {
    // Out-of-order streaming uses script to replace placeholder
    return `
<template id="${id}-content">${html}</template>
<script>
  (function() {
    const template = document.getElementById('${id}-content');
    const placeholder = document.getElementById('${id}');
    if (template && placeholder) {
      placeholder.replaceWith(template.content.cloneNode(true));
      template.remove();
    }
  })();
</script>`;
  } else {
    // In-order streaming can directly append
    return html;
  }
}

/**
 * Create suspense boundary ID
 */
let boundaryCounter = 0;
export function createSuspenseBoundaryId(): string {
  return `suspense-${++boundaryCounter}`;
}

/**
 * Reset boundary counter (for testing)
 */
export function resetBoundaryCounter(): void {
  boundaryCounter = 0;
}
