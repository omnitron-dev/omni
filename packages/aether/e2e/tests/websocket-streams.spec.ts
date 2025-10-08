/**
 * WebSocket Stream E2E Tests
 * Tests browser stream implementation and compatibility with Node.js streams
 */

import { test, expect, Page } from '@playwright/test';

test.describe('WebSocket Streams - Basic Operations', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    // Connect WebSocket peer
    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should generate readable stream', async () => {
    const chunks = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');
      const stream = await streamService.generateStream(5, 100);

      const chunks: any[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return chunks;
    });

    expect(chunks).toHaveLength(5);
    chunks.forEach((chunk: any, index: number) => {
      expect(chunk).toHaveProperty('index', index);
      expect(chunk).toHaveProperty('data');
      expect(chunk).toHaveProperty('timestamp');
    });
  });

  test('should echo stream (duplex operation)', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Create input stream
      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ index: 0, data: 'hello' });
          controller.enqueue({ index: 1, data: 'world' });
          controller.close();
        }
      });

      // Get echo stream
      const outputStream = await streamService.echoStream(inputStream);

      // Read echoed chunks
      const chunks: any[] = [];
      const reader = outputStream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return chunks;
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('echoed', true);
    expect(result[0]).toHaveProperty('echoedAt');
    expect(result[0]).toHaveProperty('data', 'hello');
    expect(result[1]).toHaveProperty('data', 'world');
  });

  test('should transform stream', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Create input stream
      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ index: 0, data: 'hello' });
          controller.enqueue({ index: 1, data: 'world' });
          controller.close();
        }
      });

      // Transform to uppercase
      const outputStream = await streamService.transformStream(inputStream, 'uppercase');

      // Read transformed chunks
      const chunks: any[] = [];
      const reader = outputStream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return chunks;
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('data', 'HELLO');
    expect(result[1]).toHaveProperty('data', 'WORLD');
  });

  test('should consume writable stream', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const chunks: any[] = [];

      // Create writable stream
      const writableStream = new WritableStream({
        write(chunk) {
          chunks.push(chunk);
        }
      });

      // Write some data
      const writer = writableStream.getWriter();
      await writer.write({ data: 'chunk1' });
      await writer.write({ data: 'chunk2' });
      await writer.write({ data: 'chunk3' });
      await writer.close();

      // Consume the stream
      const summary = await streamService.consumeStream(writableStream);

      return { summary, chunks };
    });

    expect(result.chunks).toHaveLength(3);
    expect(result.summary).toHaveProperty('received', 3);
  });
});

test.describe('WebSocket Streams - Advanced Operations', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should merge multiple streams', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Create multiple input streams
      const stream1 = new ReadableStream({
        start(controller) {
          controller.enqueue('stream1-chunk1');
          controller.enqueue('stream1-chunk2');
          controller.close();
        }
      });

      const stream2 = new ReadableStream({
        start(controller) {
          controller.enqueue('stream2-chunk1');
          controller.enqueue('stream2-chunk2');
          controller.close();
        }
      });

      // Merge streams
      const merged = await streamService.mergeStreams([stream1, stream2]);

      // Read merged chunks
      const chunks: any[] = [];
      const reader = merged.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return chunks;
    });

    expect(result).toHaveLength(4);
    result.forEach((item: any) => {
      expect(item).toHaveProperty('streamIndex');
      expect(item).toHaveProperty('chunk');
    });
  });

  test('should stream large data', async () => {
    const { size, chunkCount, duration } = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const startTime = performance.now();

      // Stream 1MB with 64KB chunks
      const stream = await streamService.streamLargeData(1, 64);

      let totalBytes = 0;
      let chunkCount = 0;
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value instanceof ArrayBuffer) {
          totalBytes += value.byteLength;
        } else if (value instanceof Uint8Array) {
          totalBytes += value.length;
        }
        chunkCount++;
      }

      const duration = performance.now() - startTime;

      return { size: totalBytes, chunkCount, duration };
    });

    expect(size).toBe(1024 * 1024); // 1MB
    expect(chunkCount).toBeGreaterThan(0);
    expect(duration).toBeLessThan(5000); // Should complete in < 5s
  });

  test('should handle backpressure correctly', async () => {
    const { processed, timing } = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Get backpressure stream (100 items, fast mode)
      const stream = await streamService.backpressureStream(100, true);

      const processed: any[] = [];
      const timing: number[] = [];
      const reader = stream.getReader();

      while (true) {
        const start = performance.now();
        const { done, value } = await reader.read();
        const readTime = performance.now() - start;

        if (done) break;

        processed.push(value);
        timing.push(readTime);
      }

      return { processed, timing };
    });

    expect(processed).toHaveLength(100);

    // Verify items are in order
    processed.forEach((item: any, index: number) => {
      expect(item.index).toBe(index);
    });

    // Timing should show proper backpressure (not all at once)
    const avgReadTime = timing.reduce((sum, t) => sum + t, 0) / timing.length;
    expect(avgReadTime).toBeGreaterThan(0);
  });

  test('should handle stream errors', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Create stream that errors
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ data: 'chunk1' });
          controller.error(new Error('Stream error'));
        }
      });

      try {
        await streamService.transformStream(errorStream, 'uppercase');
        return { success: false };
      } catch (err) {
        return { success: true, error: err.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.error).toContain('Stream error');
  });

  test('should handle stream cancellation', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const stream = await streamService.generateStream(100, 50);
      const reader = stream.getReader();

      const chunks: any[] = [];

      // Read only first 10 chunks, then cancel
      for (let i = 0; i < 10; i++) {
        const { value } = await reader.read();
        chunks.push(value);
      }

      await reader.cancel();

      return { chunks: chunks.length };
    });

    expect(result.chunks).toBe(10);
  });
});

test.describe('WebSocket Streams - Transformation Patterns', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should transform stream to uppercase', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ index: 0, data: 'hello world' });
          controller.enqueue({ index: 1, data: 'foo bar' });
          controller.close();
        }
      });

      const transformed = await streamService.transformStream(inputStream, 'uppercase');
      const chunks: any[] = [];
      const reader = transformed.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.data);
      }

      return chunks;
    });

    expect(result).toEqual(['HELLO WORLD', 'FOO BAR']);
  });

  test('should transform stream to lowercase', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ index: 0, data: 'HELLO WORLD' });
          controller.enqueue({ index: 1, data: 'FOO BAR' });
          controller.close();
        }
      });

      const transformed = await streamService.transformStream(inputStream, 'lowercase');
      const chunks: any[] = [];
      const reader = transformed.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.data);
      }

      return chunks;
    });

    expect(result).toEqual(['hello world', 'foo bar']);
  });

  test('should transform stream by reversing', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ index: 0, data: 'hello' });
          controller.enqueue({ index: 1, data: 'world' });
          controller.close();
        }
      });

      const transformed = await streamService.transformStream(inputStream, 'reverse');
      const chunks: any[] = [];
      const reader = transformed.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.data);
      }

      return chunks;
    });

    expect(result).toEqual(['olleh', 'dlrow']);
  });

  test('should chain stream transformations', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ index: 0, data: 'hello' });
          controller.close();
        }
      });

      // First transform to uppercase
      const uppercase = await streamService.transformStream(inputStream, 'uppercase');

      // Then reverse
      const reversed = await streamService.transformStream(uppercase, 'reverse');

      const chunks: any[] = [];
      const reader = reversed.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.data);
      }

      return chunks;
    });

    expect(result).toEqual(['OLLEH']);
  });

  test('should handle empty streams', async () => {
    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const emptyStream = new ReadableStream({
        start(controller) {
          controller.close();
        }
      });

      const transformed = await streamService.transformStream(emptyStream, 'uppercase');
      const chunks: any[] = [];
      const reader = transformed.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return chunks;
    });

    expect(result).toHaveLength(0);
  });
});

test.describe('WebSocket Streams - Performance', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should handle high-frequency stream chunks', async () => {
    const { chunkCount, duration, throughput } = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const startTime = performance.now();

      // Generate 1000 chunks with minimal delay
      const stream = await streamService.backpressureStream(1000, true);

      let count = 0;
      const reader = stream.getReader();

      while (true) {
        const { done } = await reader.read();
        if (done) break;
        count++;
      }

      const duration = performance.now() - startTime;
      const throughput = (count / duration) * 1000; // chunks per second

      return { chunkCount: count, duration, throughput };
    });

    expect(chunkCount).toBe(1000);
    expect(throughput).toBeGreaterThan(100); // At least 100 chunks/sec
  });

  test('should stream 10MB efficiently', async () => {
    const { size, duration, mbps } = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      const startTime = performance.now();

      // Stream 10MB with 128KB chunks
      const stream = await streamService.streamLargeData(10, 128);

      let totalBytes = 0;
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value instanceof ArrayBuffer) {
          totalBytes += value.byteLength;
        } else if (value instanceof Uint8Array) {
          totalBytes += value.length;
        }
      }

      const duration = performance.now() - startTime;
      const mbps = (totalBytes / (1024 * 1024)) / (duration / 1000);

      return { size: totalBytes, duration, mbps };
    });

    expect(size).toBe(10 * 1024 * 1024); // 10MB
    expect(duration).toBeLessThan(10000); // Less than 10 seconds
    expect(mbps).toBeGreaterThan(1); // At least 1 MB/s
  });
});
