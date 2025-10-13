/**
 * Streaming SSR Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createSSRSuspenseContext,
  streamSuspenseBoundaries,
  createSuspensePlaceholder,
  extractSuspenseBoundaries,
  renderWithSuspenseStreaming,
} from '../../src/suspense/streaming.js';
import { PassThrough } from 'node:stream';

describe('Streaming SSR', () => {
  describe('createSSRSuspenseContext', () => {
    it('should create SSR suspense context', () => {
      const context = createSSRSuspenseContext();

      expect(context).toBeDefined();
      expect(context.boundaries).toBeInstanceOf(Map);
      expect(context.completed).toBeInstanceOf(Set);
      expect(context.pending).toBe(0);
    });

    it('should register boundaries', async () => {
      const context = createSSRSuspenseContext();

      const promise = Promise.resolve('<div>Content</div>');
      context.registerBoundary('test-1', promise);

      expect(context.boundaries.size).toBe(1);
      expect(context.pending).toBe(1);

      await promise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(context.completed.has('test-1')).toBe(true);
      expect(context.pending).toBe(0);
    });

    it('should handle boundary errors', async () => {
      const context = createSSRSuspenseContext();

      const error = new Error('Render failed');
      const promise = Promise.reject(error);
      context.registerBoundary('test-1', promise);

      await promise.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      const marker = context.boundaries.get('test-1');
      expect(marker?.error).toBe(error);
      expect(context.completed.has('test-1')).toBe(true);
    });
  });

  describe('streamSuspenseBoundaries', () => {
    it('should stream boundaries in order', async () => {
      const stream = new PassThrough();
      const context = createSSRSuspenseContext();

      const chunks: string[] = [];
      stream.on('data', (chunk) => {
        chunks.push(chunk.toString());
      });

      // Register boundaries
      context.registerBoundary('test-1', Promise.resolve('<div>Content 1</div>'));
      context.registerBoundary('test-2', Promise.resolve('<div>Content 2</div>'));

      await streamSuspenseBoundaries(stream, context, {
        outOfOrder: false,
        timeout: 1000,
      });

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toContain('Content 1');
      expect(chunks[1]).toContain('Content 2');
    });

    it('should stream boundaries out of order', async () => {
      const stream = new PassThrough();
      const context = createSSRSuspenseContext();

      const chunks: string[] = [];
      stream.on('data', (chunk) => {
        chunks.push(chunk.toString());
      });

      // Register boundaries with different delays
      context.registerBoundary(
        'test-1',
        new Promise((resolve) => setTimeout(() => resolve('<div>Content 1</div>'), 50))
      );
      context.registerBoundary(
        'test-2',
        new Promise((resolve) => setTimeout(() => resolve('<div>Content 2</div>'), 10))
      );

      await streamSuspenseBoundaries(stream, context, {
        outOfOrder: true,
        timeout: 1000,
        maxConcurrency: 10,
      });

      expect(chunks.length).toBe(2);
      // In out-of-order mode, chunks should contain template and script tags
      expect(chunks.some((c) => c.includes('template'))).toBe(true);
    });

    it('should handle timeout', async () => {
      const stream = new PassThrough();
      const context = createSSRSuspenseContext();

      const chunks: string[] = [];
      stream.on('data', (chunk) => {
        chunks.push(chunk.toString());
      });

      // Register boundary that never resolves
      context.registerBoundary(
        'test-1',
        new Promise(() => {
          // Never resolves
        })
      );

      await streamSuspenseBoundaries(stream, context, {
        timeout: 100,
      });

      // Should write error fallback
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain('Error loading content');
    });
  });

  describe('createSuspensePlaceholder', () => {
    it('should create placeholder HTML', () => {
      const html = createSuspensePlaceholder('test-1', 'Loading...');

      expect(html).toContain('id="test-1"');
      expect(html).toContain('data-suspense-boundary');
      expect(html).toContain('Loading...');
    });

    it('should create placeholder without fallback', () => {
      const html = createSuspensePlaceholder('test-1');

      expect(html).toContain('id="test-1"');
      expect(html).toContain('data-suspense-boundary');
    });
  });

  describe('extractSuspenseBoundaries', () => {
    it('should extract boundary IDs from HTML', () => {
      const html = `
        <div id="test-1" data-suspense-boundary>Loading 1...</div>
        <div>Some content</div>
        <div id="test-2" data-suspense-boundary>Loading 2...</div>
      `;

      const boundaries = extractSuspenseBoundaries(html);

      expect(boundaries).toEqual(['test-1', 'test-2']);
    });

    it('should return empty array for no boundaries', () => {
      const html = '<div>No boundaries here</div>';

      const boundaries = extractSuspenseBoundaries(html);

      expect(boundaries).toEqual([]);
    });
  });

  describe('renderWithSuspenseStreaming', () => {
    it('should render with suspense streaming', async () => {
      const renderFn = async (context: any) => {
        context.registerBoundary('test-1', Promise.resolve('<div>Content</div>'));
        return '<html><body><div id="test-1" data-suspense-boundary>Loading...</div></body></html>';
      };

      const { stream, abort } = await renderWithSuspenseStreaming(renderFn, {
        shellTimeout: 1000,
      });

      const chunks: string[] = [];
      stream.on('data', (chunk) => {
        chunks.push(chunk.toString());
      });

      await new Promise((resolve) => {
        stream.on('end', resolve);
      });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toContain('<html>');

      // Cleanup
      abort();
    });

    it('should call lifecycle callbacks', async () => {
      const onShellReady = vi.fn();
      const onAllReady = vi.fn();

      const renderFn = async () => '<html><body>Content</body></html>';

      const { stream } = await renderWithSuspenseStreaming(renderFn, {
        onShellReady,
        onAllReady,
      });

      await new Promise((resolve) => {
        stream.on('end', resolve);
      });

      expect(onShellReady).toHaveBeenCalled();
      expect(onAllReady).toHaveBeenCalled();
    });

    it('should handle shell errors', async () => {
      const onShellError = vi.fn();
      const error = new Error('Shell render failed');

      const renderFn = async () => {
        throw error;
      };

      const { stream } = await renderWithSuspenseStreaming(renderFn, {
        onShellError,
      });

      await new Promise((resolve) => {
        stream.on('error', () => resolve(null));
        stream.on('end', () => resolve(null));
      });

      expect(onShellError).toHaveBeenCalledWith(error);
    });

    it('should handle abort', async () => {
      const renderFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return '<html><body>Content</body></html>';
      };

      const { stream, abort } = await renderWithSuspenseStreaming(renderFn);

      // Abort immediately
      abort();

      const destroyed = await new Promise((resolve) => {
        stream.on('error', () => resolve(true));
        stream.on('end', () => resolve(false));
        setTimeout(() => resolve(false), 100);
      });

      expect(destroyed).toBe(true);
    });
  });

  describe('integration', () => {
    it('should stream multiple boundaries concurrently', async () => {
      const stream = new PassThrough();
      const context = createSSRSuspenseContext();

      const chunks: string[] = [];
      stream.on('data', (chunk) => {
        chunks.push(chunk.toString());
      });

      // Register multiple boundaries with different delays
      for (let i = 1; i <= 5; i++) {
        context.registerBoundary(
          `test-${i}`,
          new Promise((resolve) =>
            setTimeout(() => resolve(`<div>Content ${i}</div>`), Math.random() * 100)
          )
        );
      }

      await streamSuspenseBoundaries(stream, context, {
        outOfOrder: true,
        maxConcurrency: 3,
        timeout: 1000,
      });

      expect(chunks.length).toBe(5);
    });

    it('should handle mix of success and failure', async () => {
      const stream = new PassThrough();
      const context = createSSRSuspenseContext();

      const chunks: string[] = [];
      stream.on('data', (chunk) => {
        chunks.push(chunk.toString());
      });

      // Register boundaries with mixed outcomes
      context.registerBoundary('success-1', Promise.resolve('<div>Success 1</div>'));
      context.registerBoundary('error-1', Promise.reject(new Error('Failed')));
      context.registerBoundary('success-2', Promise.resolve('<div>Success 2</div>'));

      await streamSuspenseBoundaries(stream, context, {
        timeout: 1000,
      });

      expect(chunks.length).toBe(3);
      expect(chunks.some((c) => c.includes('Success 1'))).toBe(true);
      expect(chunks.some((c) => c.includes('Success 2'))).toBe(true);
      expect(chunks.some((c) => c.includes('Error loading content'))).toBe(true);
    });
  });
});
