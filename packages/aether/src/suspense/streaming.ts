/**
 * Streaming SSR Integration
 *
 * Integrates Suspense with SSR streaming for progressive rendering.
 * Supports out-of-order streaming and concurrent boundary resolution.
 */

import { PassThrough } from 'node:stream';
import type {
  SuspenseBoundaryMarker,
  SSRSuspenseContext,
  StreamingSuspenseOptions,
} from './types.js';

/**
 * Create SSR suspense context
 */
export function createSSRSuspenseContext(): SSRSuspenseContext {
  const boundaries = new Map<string, SuspenseBoundaryMarker>();
  const completed = new Set<string>();
  let pendingCount = 0;

  const context: SSRSuspenseContext = {
    boundaries,
    completed,
    get pending() {
      return pendingCount;
    },

    registerBoundary(id: string, promise: Promise<string>) {
      const marker: SuspenseBoundaryMarker = {
        id,
        promise,
        resolved: false,
      };

      boundaries.set(id, marker);
      pendingCount++;

      promise
        .then((html) => {
          marker.resolved = true;
          marker.html = html;
          completed.add(id);
          pendingCount--;
        })
        .catch((error) => {
          marker.resolved = true;
          marker.error = error;
          completed.add(id);
          pendingCount--;
        });
    },

    completeBoundary(id: string, html: string) {
      const marker = boundaries.get(id);
      if (marker) {
        marker.resolved = true;
        marker.html = html;
        completed.add(id);
        pendingCount--;
      }
    },

    failBoundary(id: string, error: Error) {
      const marker = boundaries.get(id);
      if (marker) {
        marker.resolved = true;
        marker.error = error;
        completed.add(id);
        pendingCount--;
      }
    },
  };

  return context;
}

/**
 * Stream suspense boundaries
 *
 * Streams HTML for suspense boundaries as they resolve.
 *
 * @param stream - Output stream
 * @param context - SSR suspense context
 * @param options - Streaming options
 */
export async function streamSuspenseBoundaries(
  stream: NodeJS.WritableStream,
  context: SSRSuspenseContext,
  options: StreamingSuspenseOptions = {}
): Promise<void> {
  const {
    outOfOrder = false,
    maxConcurrency = 10,
    timeout = 10000,
  } = options;

  const { boundaries } = context;

  if (boundaries.size === 0) {
    return;
  }

  if (outOfOrder) {
    // Out-of-order streaming: stream boundaries as they resolve
    await streamOutOfOrder(stream, boundaries, { timeout, maxConcurrency });
  } else {
    // In-order streaming: stream boundaries in registration order
    await streamInOrder(stream, boundaries, { timeout });
  }
}

/**
 * Stream boundaries in order
 */
async function streamInOrder(
  stream: NodeJS.WritableStream,
  boundaries: Map<string, SuspenseBoundaryMarker>,
  options: { timeout: number }
): Promise<void> {
  const { timeout } = options;

  for (const [id, marker] of boundaries) {
    try {
      // Wait for boundary to resolve with timeout
      const html = await Promise.race([
        marker.promise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Boundary timeout')), timeout)
        ),
      ]);

      // Write boundary chunk
      const chunk = createBoundaryChunk(id, html, false);
      stream.write(chunk);
    } catch (error) {
      // Write error fallback
      console.error(`Boundary ${id} failed:`, error);
      const errorChunk = createBoundaryChunk(
        id,
        '<div>Error loading content</div>',
        false
      );
      stream.write(errorChunk);
    }
  }
}

/**
 * Stream boundaries out of order
 */
async function streamOutOfOrder(
  stream: NodeJS.WritableStream,
  boundaries: Map<string, SuspenseBoundaryMarker>,
  options: { timeout: number; maxConcurrency: number }
): Promise<void> {
  const { timeout, maxConcurrency } = options;

  // Process boundaries with concurrency limit
  const chunks = Array.from(boundaries.entries());
  const results: Promise<void>[] = [];

  for (let i = 0; i < chunks.length; i += maxConcurrency) {
    const batch = chunks.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async ([id, marker]) => {
      try {
        // Wait for boundary to resolve with timeout
        const html = await Promise.race([
          marker.promise,
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Boundary timeout')), timeout)
          ),
        ]);

        // Write boundary chunk
        const chunk = createBoundaryChunk(id, html, true);
        stream.write(chunk);
      } catch (error) {
        // Write error fallback
        console.error(`Boundary ${id} failed:`, error);
        const errorChunk = createBoundaryChunk(
          id,
          '<div>Error loading content</div>',
          true
        );
        stream.write(errorChunk);
      }
    });

    results.push(...batchPromises);
    await Promise.all(batchPromises);
  }

  await Promise.all(results);
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
 * Create suspense boundary placeholder
 *
 * Generates HTML placeholder for a suspense boundary during SSR.
 *
 * @param id - Boundary ID
 * @param fallback - Fallback HTML
 * @returns Placeholder HTML
 */
export function createSuspensePlaceholder(id: string, fallback?: string): string {
  return `<div id="${id}" data-suspense-boundary>${fallback || ''}</div>`;
}

/**
 * Extract suspense boundaries from HTML
 *
 * Parses rendered HTML to find suspense boundary markers.
 *
 * @param html - Rendered HTML
 * @returns Array of boundary IDs
 */
export function extractSuspenseBoundaries(html: string): string[] {
  const regex = /<div id="([^"]+)" data-suspense-boundary>/g;
  const boundaries: string[] = [];
  let match;

  while ((match = regex.exec(html)) !== null) {
    if (match[1]) {
      boundaries.push(match[1]);
    }
  }

  return boundaries;
}

/**
 * Render with suspense streaming
 *
 * High-level API for rendering with suspense and streaming.
 *
 * @param renderFn - Function that renders the component
 * @param options - Streaming options
 * @returns Readable stream
 */
export async function renderWithSuspenseStreaming(
  renderFn: (context: SSRSuspenseContext) => Promise<string>,
  options: StreamingSuspenseOptions & {
    onShellReady?: () => void;
    onShellError?: (error: Error) => void;
    onAllReady?: () => void;
    onError?: (error: Error) => void;
  } = {}
): Promise<{
  stream: NodeJS.ReadableStream;
  abort: () => void;
}> {
  const {
    shellTimeout = 5000,
    onShellReady,
    onShellError,
    onAllReady,
    onError,
    ...streamingOptions
  } = options;

  const stream = new PassThrough();
  const context = createSSRSuspenseContext();
  let aborted = false;

  // Start rendering
  (async () => {
    try {
      // Render shell with timeout
      const shell = await Promise.race([
        renderFn(context),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Shell timeout')), shellTimeout)
        ),
      ]);

      if (aborted) return;

      // Write shell
      stream.write(shell);

      if (onShellReady) {
        onShellReady();
      }

      // Stream suspense boundaries
      if (context.boundaries.size > 0) {
        await streamSuspenseBoundaries(stream, context, {
          ...streamingOptions,
          onError,
        } as any);
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
    console.error('Unhandled streaming error:', error);
    if (onError) {
      onError(error as Error);
    }
  });

  return {
    stream,
    abort: () => {
      aborted = true;
      if (!stream.destroyed) {
        stream.destroy();
      }
    },
  };
}

/**
 * Web Streams API version
 */
export async function renderToReadableStreamWithSuspense(
  renderFn: (context: SSRSuspenseContext) => Promise<string>,
  options: StreamingSuspenseOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const {
    shellTimeout = 5000,
    ...streamingOptions
  } = options;

  const context = createSSRSuspenseContext();
  let aborted = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Render shell with timeout
        const shell = await Promise.race([
          renderFn(context),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Shell timeout')), shellTimeout)
          ),
        ]);

        if (aborted) {
          controller.close();
          return;
        }

        // Enqueue shell
        controller.enqueue(new TextEncoder().encode(shell));

        // Stream suspense boundaries
        if (context.boundaries.size > 0) {
          const tempStream = new PassThrough();

          await streamSuspenseBoundaries(tempStream, context, streamingOptions);

          // Read from temp stream and enqueue
          tempStream.on('data', (chunk) => {
            if (!aborted) {
              const text = chunk.toString();
              controller.enqueue(new TextEncoder().encode(text));
            }
          });

          await new Promise<void>((resolve, reject) => {
            tempStream.on('end', resolve);
            tempStream.on('error', reject);
          });
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
}

/**
 * Hydrate suspense boundaries on client
 *
 * Client-side code to hydrate streamed suspense boundaries.
 */
export const hydrateSuspenseBoundaries = `
(function() {
  // Track pending boundaries
  const pendingBoundaries = new Set();

  // Observer for new boundaries
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && node.hasAttribute('data-suspense-boundary')) {
          pendingBoundaries.add(node.id);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Hydration complete
  window.__SUSPENSE_HYDRATED__ = true;
})();
`;
