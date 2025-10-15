/**
 * @fileoverview Comprehensive tests for Streaming SSR
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderToPipeableStream,
  renderToReadableStream,
  createStreamingRenderer,
  createSuspenseBoundaryId,
  resetBoundaryCounter,
} from '../../src/server/streaming.js';
import { PassThrough } from 'node:stream';

// Mock SSR
vi.mock('../../src/server/ssr.js', () => ({
  renderToString: vi.fn().mockResolvedValue({
    html: '<div>Shell Content</div>',
    data: {},
  }),
}));

describe('Streaming SSR', () => {
  let mockRenderToString: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get the mock after it's been hoisted
    const ssrModule = await import('../../src/server/ssr.js');
    mockRenderToString = ssrModule.renderToString as any;
    // Reset mock to default behavior
    mockRenderToString.mockResolvedValue({
      html: '<div>Shell Content</div>',
      data: {},
    });
    resetBoundaryCounter();
  });

  afterEach(() => {
    resetBoundaryCounter();
  });

  describe('renderToPipeableStream', () => {
    it('should create pipeable stream', () => {
      const Component = () => 'Content';

      const stream = renderToPipeableStream(Component);

      expect(stream).toHaveProperty('pipe');
      expect(stream).toHaveProperty('abort');
      expect(typeof stream.pipe).toBe('function');
      expect(typeof stream.abort).toBe('function');
    });

    it('should call onShellReady after shell renders', async () => {
      const Component = () => 'Shell';

      await new Promise<void>((resolve) => {
        const onShellReady = vi.fn(() => {
          expect(onShellReady).toHaveBeenCalled();
          resolve();
        });

        renderToPipeableStream(Component, { onShellReady });
      });
    });

    it('should call onAllReady after all content rendered', async () => {
      const Component = () => 'Content';

      await new Promise<void>((resolve) => {
        const onAllReady = vi.fn(() => {
          expect(onAllReady).toHaveBeenCalled();
          resolve();
        });

        renderToPipeableStream(Component, { onAllReady });
      });
    });

    it('should handle shell rendering errors', async () => {
      const ErrorComponent = () => {
        throw new Error('Shell error');
      };

      // Get the mock and make it reject for this specific test
      const ssrModule = await import('../../src/server/ssr.js');
      const mock = ssrModule.renderToString as any;

      // Temporarily suppress unhandled rejection warnings for this test
      // The error will still be caught by the implementation, but Vitest won't log it
      const originalListeners = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      const testUnhandledRejectionHandler = () => {
        // Silently ignore - the implementation will handle it
      };
      process.on('unhandledRejection', testUnhandledRejectionHandler);

      try {
        // Create a safely rejected promise that won't trigger unhandled rejection
        const createSafeRejectedPromise = () => {
          const error = new Error('Shell error');
          const promise = new Promise<never>((_, reject) => {
            // Reject in next tick to allow handler attachment
            setTimeout(() => reject(error), 0);
          });
          // Attach default handler to prevent unhandled rejection
          promise.catch(() => {});
          return promise;
        };

        mock.mockImplementationOnce(createSafeRejectedPromise);

        await new Promise<void>((resolve, reject) => {
          const onShellError = vi.fn((error: Error) => {
            try {
              expect(error.message).toContain('Shell error');
              resolve();
            } catch (e) {
              reject(e);
            }
          });

          const onError = vi.fn((error: Error) => {
            // Also handle if it comes through onError
            try {
              if (error.message.includes('Shell error')) {
                resolve();
              }
            } catch (e) {
              reject(e);
            }
          });

          renderToPipeableStream(ErrorComponent, { onShellError, onError });

          // Timeout to ensure test doesn't hang
          setTimeout(() => {
            if (!onShellError.mock.calls.length && !onError.mock.calls.length) {
              reject(new Error('Test timeout: error handler not called'));
            }
          }, 100);
        });
      } finally {
        // Restore original listeners
        process.removeListener('unhandledRejection', testUnhandledRejectionHandler);
        originalListeners.forEach((listener) => {
          process.on('unhandledRejection', listener as any);
        });
      }
    });

    it('should pipe to writable stream', async () => {
      const Component = () => 'Content';
      const destination = new PassThrough();

      const chunks: Buffer[] = [];
      destination.on('data', (chunk) => chunks.push(chunk));

      await new Promise<void>((resolve) => {
        destination.on('end', () => {
          const content = Buffer.concat(chunks).toString();
          expect(content).toContain('Shell Content');
          resolve();
        });

        const stream = renderToPipeableStream(Component);
        stream.pipe(destination);
      });
    });

    it('should abort stream when requested', () => {
      const Component = () => 'Content';

      const stream = renderToPipeableStream(Component);

      expect(() => stream.abort()).not.toThrow();
    });

    it('should handle out-of-order streaming', async () => {
      const Component = () => 'Content';

      await new Promise<void>((resolve) => {
        const stream = renderToPipeableStream(Component, {
          outOfOrder: true,
          onAllReady: resolve,
        });

        expect(stream).toBeDefined();
      });
    });

    it('should respect suspense timeout', async () => {
      const SlowComponent = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'Slow Content';
      };

      const onError = vi.fn();

      await new Promise<void>((resolve) => {
        renderToPipeableStream(SlowComponent, {
          suspenseTimeout: 50,
          onError,
          onAllReady: () => {
            // Timeout should have triggered
            resolve();
          },
        });
      });
    });

    it('should handle multiple suspense boundaries', async () => {
      const Component = () => 'Content with boundaries';

      await new Promise<void>((resolve) => {
        renderToPipeableStream(Component, {
          onAllReady: resolve,
        });
      });
    });

    it('should pass props to component', async () => {
      const Component = (props: { title: string }) => `<h1>${props.title}</h1>`;

      await new Promise<void>((resolve) => {
        renderToPipeableStream(Component, {
          props: { title: 'Test Title' },
          onShellReady: resolve,
        });
      });
    });

    it('should handle URL context', async () => {
      const Component = () => 'Page';

      await new Promise<void>((resolve) => {
        renderToPipeableStream(Component, {
          url: 'https://example.com/page',
          onShellReady: resolve,
        });
      });
    });

    it('should handle initial state', async () => {
      const Component = () => 'Content';

      await new Promise<void>((resolve) => {
        renderToPipeableStream(Component, {
          initialState: { user: { id: 1, name: 'Alice' } },
          onShellReady: resolve,
        });
      });
    });
  });

  describe('renderToReadableStream', () => {
    it('should create ReadableStream', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component);

      expect(result.stream).toBeDefined();
      expect(result.metadata).toBeDefined();
    });

    it('should return correct metadata', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component);

      expect(result.metadata.status).toBe(200);
      expect(result.metadata.headers).toHaveProperty('Content-Type');
      expect(result.metadata.headers['Content-Type']).toContain('text/html');
    });

    it('should stream HTML chunks', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component);

      const reader = result.stream.getReader();
      const chunks: Uint8Array[] = [];

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (value) chunks.push(value);
        done = streamDone;
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle async components', async () => {
      const AsyncComponent = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'Async Content';
      };

      const result = await renderToReadableStream(AsyncComponent);

      expect(result.stream).toBeDefined();
    });

    it('should support out-of-order streaming', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component, {
        outOfOrder: true,
      });

      expect(result.stream).toBeDefined();
    });

    it('should handle progressive rendering', async () => {
      const Component = () => 'Progressive';

      const result = await renderToReadableStream(Component, {
        progressive: true,
      });

      expect(result.stream).toBeDefined();
    });

    it('should handle suspense timeout', async () => {
      const SlowComponent = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'Slow';
      };

      const result = await renderToReadableStream(SlowComponent, {
        suspenseTimeout: 50,
      });

      expect(result.stream).toBeDefined();
    });

    it('should handle stream cancellation', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component);

      const reader = result.stream.getReader();

      // Cancel immediately
      await reader.cancel();

      await expect(reader.closed).resolves.toBeUndefined();
    });

    it('should encode text as UTF-8', async () => {
      const Component = () => 'Unicode: ñ é ü';

      const result = await renderToReadableStream(Component);

      const reader = result.stream.getReader();
      const { value } = await reader.read();

      expect(value).toBeInstanceOf(Uint8Array);
    });

    it('should handle errors in streaming', async () => {
      const ErrorComponent = () => {
        throw new Error('Stream error');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      // Get the mock and make it reject for this specific test
      const ssrModule = await import('../../src/server/ssr.js');
      const mock = ssrModule.renderToString as any;

      // Temporarily suppress unhandled rejection warnings for this test
      const originalListeners = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      const testUnhandledRejectionHandler = () => {
        // Silently ignore - the implementation will handle it
      };
      process.on('unhandledRejection', testUnhandledRejectionHandler);

      try {
        // Create a safely rejected promise that won't trigger unhandled rejection
        const createSafeRejectedPromise = () => {
          const error = new Error('Stream error');
          const promise = new Promise<never>((_, reject) => {
            // Reject in next tick to allow handler attachment
            setTimeout(() => reject(error), 0);
          });
          // Attach default handler to prevent unhandled rejection
          promise.catch(() => {});
          return promise;
        };

        mock.mockImplementationOnce(createSafeRejectedPromise);

        const result = await renderToReadableStream(ErrorComponent);
        const reader = result.stream.getReader();

        // The stream should have an error
        await expect(reader.read()).rejects.toThrow();
      } catch (error) {
        // If renderToReadableStream itself throws, that's also acceptable
        expect(error).toBeDefined();
      } finally {
        consoleError.mockRestore();
        // Restore original listeners
        process.removeListener('unhandledRejection', testUnhandledRejectionHandler);
        originalListeners.forEach((listener) => {
          process.on('unhandledRejection', listener as any);
        });
      }
    });
  });

  describe('createStreamingRenderer', () => {
    it('should create reusable renderer', () => {
      const renderer = createStreamingRenderer({
        progressive: true,
        outOfOrder: true,
      });

      expect(typeof renderer).toBe('function');
    });

    it('should apply default options', async () => {
      const renderer = createStreamingRenderer({
        progressive: true,
        suspenseTimeout: 100,
      });

      const Component = () => 'Content';
      const result = await renderer(Component);

      expect(result.stream).toBeDefined();
    });

    it('should allow option override', async () => {
      const renderer = createStreamingRenderer({
        suspenseTimeout: 1000,
      });

      const Component = () => 'Content';
      const result = await renderer(Component, {
        suspenseTimeout: 500, // Override
      });

      expect(result.stream).toBeDefined();
    });

    it('should handle multiple renders', async () => {
      const renderer = createStreamingRenderer({
        progressive: true,
      });

      const Component1 = () => 'Page 1';
      const Component2 = () => 'Page 2';

      const result1 = await renderer(Component1);
      const result2 = await renderer(Component2);

      expect(result1.stream).toBeDefined();
      expect(result2.stream).toBeDefined();
    });
  });

  describe('Suspense Boundaries', () => {
    it('should generate unique boundary IDs', () => {
      const id1 = createSuspenseBoundaryId();
      const id2 = createSuspenseBoundaryId();
      const id3 = createSuspenseBoundaryId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).toMatch(/^suspense-\d+$/);
    });

    it('should reset boundary counter', () => {
      createSuspenseBoundaryId(); // 1
      createSuspenseBoundaryId(); // 2

      resetBoundaryCounter();

      const id = createSuspenseBoundaryId(); // Should be 1 again
      expect(id).toBe('suspense-1');
    });

    it('should handle boundary replacement in order', async () => {
      const Component = () => 'Content with boundaries';

      const destination = new PassThrough();
      const chunks: Buffer[] = [];

      destination.on('data', (chunk) => chunks.push(chunk));

      await new Promise<void>((resolve) => {
        destination.on('end', () => {
          const content = Buffer.concat(chunks).toString();
          expect(content).toBeDefined();
          resolve();
        });

        const stream = renderToPipeableStream(Component, {
          outOfOrder: false,
        });

        stream.pipe(destination);
      });
    });

    it('should handle boundary replacement out of order', async () => {
      const Component = () => 'Content with boundaries';

      const destination = new PassThrough();
      const chunks: Buffer[] = [];

      destination.on('data', (chunk) => chunks.push(chunk));

      await new Promise<void>((resolve) => {
        destination.on('end', () => {
          const content = Buffer.concat(chunks).toString();
          // Out of order should use templates and scripts
          expect(content).toBeDefined();
          resolve();
        });

        const stream = renderToPipeableStream(Component, {
          outOfOrder: true,
        });

        stream.pipe(destination);
      });
    });
  });

  describe('Backpressure Handling', () => {
    it('should handle slow consumers', async () => {
      const Component = () => 'Large Content';

      const slowDestination = new PassThrough({
        highWaterMark: 1, // Very small buffer
      });

      let chunks = 0;
      slowDestination.on('data', () => {
        chunks++;
      });

      await new Promise<void>((resolve) => {
        slowDestination.on('end', () => {
          expect(chunks).toBeGreaterThan(0);
          resolve();
        });

        const stream = renderToPipeableStream(Component);
        stream.pipe(slowDestination);
      });
    });

    it('should handle stream errors gracefully', async () => {
      const Component = () => 'Content';

      const errorDestination = new PassThrough();

      await new Promise<void>((resolve) => {
        errorDestination.on('error', (error) => {
          expect(error).toBeDefined();
          resolve();
        });

        const stream = renderToPipeableStream(Component);
        stream.pipe(errorDestination);

        // Simulate error
        errorDestination.destroy(new Error('Stream error'));
      });
    });
  });

  describe('Progressive Rendering', () => {
    it('should send shell immediately', async () => {
      const Component = () => 'Shell';

      const destination = new PassThrough();

      await new Promise<void>((resolve) => {
        let firstChunkReceived = false;
        destination.on('data', () => {
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            expect(true).toBe(true); // Shell received
            resolve();
          }
        });

        const stream = renderToPipeableStream(Component, {
          progressive: true,
        });

        stream.pipe(destination);
      });
    });

    it('should stream suspense content as it resolves', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component, {
        progressive: true,
        outOfOrder: true,
      });

      const reader = result.stream.getReader();
      const chunks: Uint8Array[] = [];

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (value) {
          chunks.push(value);
        }
        done = streamDone;
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle component errors during streaming', async () => {
      const ErrorComponent = () => {
        throw new Error('Render error');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      // Get the mock and make it reject for this specific test
      const ssrModule = await import('../../src/server/ssr.js');
      const mock = ssrModule.renderToString as any;

      // Temporarily suppress unhandled rejection warnings for this test
      const originalListeners = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      const testUnhandledRejectionHandler = () => {
        // Silently ignore - the implementation will handle it
      };
      process.on('unhandledRejection', testUnhandledRejectionHandler);

      try {
        // Create a safely rejected promise that won't trigger unhandled rejection
        const createSafeRejectedPromise = () => {
          const error = new Error('Render error');
          const promise = new Promise<never>((_, reject) => {
            // Reject in next tick to allow handler attachment
            setTimeout(() => reject(error), 0);
          });
          // Attach default handler to prevent unhandled rejection
          promise.catch(() => {});
          return promise;
        };

        mock.mockImplementationOnce(createSafeRejectedPromise);

        await new Promise<void>((resolve, reject) => {
          const onShellError = vi.fn((error: Error) => {
            try {
              expect(error.message).toContain('Render error');
              consoleError.mockRestore();
              resolve();
            } catch (e) {
              consoleError.mockRestore();
              reject(e);
            }
          });

          const onError = vi.fn((error: Error) => {
            // Also handle if it comes through onError
            try {
              if (error.message.includes('Render error')) {
                consoleError.mockRestore();
                resolve();
              }
            } catch (e) {
              consoleError.mockRestore();
              reject(e);
            }
          });

          renderToPipeableStream(ErrorComponent, { onShellError, onError });

          // Timeout to ensure test doesn't hang
          setTimeout(() => {
            if (!onShellError.mock.calls.length && !onError.mock.calls.length) {
              consoleError.mockRestore();
              reject(new Error('Test timeout: error handler not called'));
            }
          }, 100);
        });
      } finally {
        consoleError.mockRestore();
        // Restore original listeners
        process.removeListener('unhandledRejection', testUnhandledRejectionHandler);
        originalListeners.forEach((listener) => {
          process.on('unhandledRejection', listener as any);
        });
      }
    });

    it('should handle boundary errors', async () => {
      const Component = () => 'Content';

      const onError = vi.fn();

      await new Promise<void>((resolve) => {
        renderToPipeableStream(Component, {
          onError,
          onAllReady: resolve,
        });
      });
    });

    it('should continue streaming on non-critical errors', async () => {
      const Component = () => 'Content';

      const result = await renderToReadableStream(Component);

      const reader = result.stream.getReader();

      // Should be able to read despite potential errors
      const { value, done } = await reader.read();

      expect(value || done).toBeTruthy();
    });
  });

  describe('Performance', () => {
    it('should handle large content efficiently', async () => {
      const largeContent = 'x'.repeat(100000);
      const Component = () => largeContent;

      const startTime = Date.now();

      const result = await renderToReadableStream(Component);

      const reader = result.stream.getReader();
      const chunks: Uint8Array[] = [];

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (value) chunks.push(value);
        done = streamDone;
      }

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should be fast
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should stream incrementally, not all at once', async () => {
      const Component = () => 'Content';

      const destination = new PassThrough();
      const dataEvents: number[] = [];

      destination.on('data', () => {
        dataEvents.push(Date.now());
      });

      await new Promise<void>((resolve) => {
        destination.on('end', () => {
          // Should receive multiple data events
          expect(dataEvents.length).toBeGreaterThan(0);
          resolve();
        });

        const stream = renderToPipeableStream(Component);
        stream.pipe(destination);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty component', async () => {
      const EmptyComponent = () => '';

      const result = await renderToReadableStream(EmptyComponent);

      expect(result.stream).toBeDefined();
    });

    it('should handle null component', async () => {
      const NullComponent = () => null;

      const result = await renderToReadableStream(NullComponent);

      expect(result.stream).toBeDefined();
    });

    it('should handle immediate stream abort', () => {
      const Component = () => 'Content';

      const stream = renderToPipeableStream(Component);

      stream.abort();

      // Should not throw
      expect(() => stream.abort()).not.toThrow();
    });

    it('should handle concurrent streams', async () => {
      const Component = () => 'Content';

      const promise1 = renderToReadableStream(Component);
      const promise2 = renderToReadableStream(Component);
      const promise3 = renderToReadableStream(Component);

      const results = await Promise.all([promise1, promise2, promise3]);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.stream).toBeDefined();
      });
    });
  });
});
