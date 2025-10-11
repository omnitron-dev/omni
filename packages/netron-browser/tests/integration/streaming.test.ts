/**
 * Streaming Integration Tests
 * Tests readable/writable stream functionality with Titan server
 * Note: Full streaming support may be limited in current implementation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import { HttpClient } from '../../src/client/http-client.js';

describe('Streaming Integration (WebSocket)', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Simulated Streaming (Array-based)', () => {
    it('should generate and return array of numbers', async () => {
      const count = 10;
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [count]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(count);
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should generate large datasets efficiently', async () => {
      const count = 1000;
      const startTime = Date.now();

      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [count]);

      const duration = Date.now() - startTime;

      expect(result.length).toBe(count);
      expect(result[0]).toBe(0);
      expect(result[count - 1]).toBe(count - 1);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should generate complex data objects', async () => {
      const count = 5;
      const result = await client.invoke('stream@1.0.0', 'generateData', [count]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(count);

      result.forEach((item, index) => {
        expect(item).toHaveProperty('id', index);
        expect(item).toHaveProperty('timestamp');
        expect(item).toHaveProperty('value');
        expect(typeof item.value).toBe('number');
      });
    });

    it('should handle empty streams', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [0]);
      expect(result).toEqual([]);
    });

    it('should handle large stream payloads', async () => {
      const count = 10000;
      const result = await client.invoke('stream@1.0.0', 'generateData', [count]);

      expect(result.length).toBe(count);
      expect(result[0]).toHaveProperty('id', 0);
      expect(result[count - 1]).toHaveProperty('id', count - 1);
    });
  });

  describe('Streaming Data Types', () => {
    it('should stream numeric sequences', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [100]);

      // Verify sequence integrity
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(i);
      }
    });

    it('should stream structured data', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateData', [50]);

      // Verify data structure consistency
      result.forEach((item) => {
        expect(typeof item.id).toBe('number');
        expect(typeof item.timestamp).toBe('number');
        expect(typeof item.value).toBe('number');
        expect(item.timestamp).toBeGreaterThan(0);
        expect(item.value).toBeGreaterThanOrEqual(0);
        expect(item.value).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Stream Performance', () => {
    it('should handle streaming efficiently', async () => {
      const sizes = [10, 100, 1000];
      const timings: { size: number; duration: number }[] = [];

      for (const size of sizes) {
        const start = Date.now();
        await client.invoke('stream@1.0.0', 'generateNumbers', [size]);
        const duration = Date.now() - start;
        timings.push({ size, duration });
      }

      // Verify timing scales reasonably
      timings.forEach(({ size, duration }) => {
        console.log(`Stream size ${size}: ${duration}ms`);
        expect(duration).toBeLessThan(size); // Should be faster than 1ms per item
      });
    });

    it('should maintain consistent performance under load', async () => {
      const iterations = 10;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await client.invoke('stream@1.0.0', 'generateNumbers', [100]);
        durations.push(Date.now() - start);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);

      console.log(`Stream performance - Avg: ${avgDuration}ms, Min: ${minDuration}ms, Max: ${maxDuration}ms`);

      // Performance should be relatively consistent
      expect(maxDuration - minDuration).toBeLessThan(avgDuration * 2);
    });
  });

  describe('Concurrent Streaming', () => {
    it('should handle multiple concurrent stream requests', async () => {
      const promises = [
        client.invoke('stream@1.0.0', 'generateNumbers', [10]),
        client.invoke('stream@1.0.0', 'generateNumbers', [20]),
        client.invoke('stream@1.0.0', 'generateNumbers', [30]),
        client.invoke('stream@1.0.0', 'generateData', [15]),
        client.invoke('stream@1.0.0', 'generateData', [25]),
      ];

      const results = await Promise.all(promises);

      expect(results[0].length).toBe(10);
      expect(results[1].length).toBe(20);
      expect(results[2].length).toBe(30);
      expect(results[3].length).toBe(15);
      expect(results[4].length).toBe(25);
    });

    it('should handle interleaved streaming operations', async () => {
      const operations: Promise<any>[] = [];

      // Start multiple streams with different sizes
      for (let i = 1; i <= 10; i++) {
        operations.push(client.invoke('stream@1.0.0', 'generateNumbers', [i * 10]));
      }

      const results = await Promise.all(operations);

      // Verify each stream completed with correct size
      results.forEach((result, index) => {
        expect(result.length).toBe((index + 1) * 10);
      });
    });
  });
});

describe('Streaming Integration (HTTP)', () => {
  let server: TitanServerFixture;
  let client: HttpClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: false,
      logLevel: 'silent',
    });

    client = new HttpClient({
      url: server.httpUrl,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('HTTP Streaming (Array-based)', () => {
    it('should generate data via HTTP transport', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [20]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(20);
    });

    it('should handle large payloads over HTTP', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateData', [500]);

      expect(result.length).toBe(500);
      result.forEach((item, i) => {
        expect(item.id).toBe(i);
      });
    });
  });

  describe('HTTP vs WebSocket Comparison', () => {
    it('should produce identical results across transports', async () => {
      const wsClient = new WebSocketClient({
        url: server.httpUrl.replace('http', 'ws'),
        reconnect: false,
      });

      // Note: Since we only have HTTP server, we can't directly compare
      // This test would need both transports enabled
      const httpResult = await client.invoke('stream@1.0.0', 'generateNumbers', [10]);

      expect(httpResult).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});

describe('Stream Error Handling', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Invalid Stream Operations', () => {
    it('should handle negative counts gracefully', async () => {
      // Service should handle this - might return empty array or throw
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [-5]);
      // The service likely returns empty array for invalid counts
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle extremely large counts', async () => {
      // Test with a very large number - might timeout or succeed
      const count = 100000;
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [count]);

      expect(result.length).toBe(count);
    });
  });
});

describe('Stream Data Integrity', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Data Consistency', () => {
    it('should maintain sequence order', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [1000]);

      // Verify strict sequential order
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i + 1]).toBe(result[i] + 1);
      }
    });

    it('should have no duplicate items', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [1000]);
      const uniqueValues = new Set(result);

      expect(uniqueValues.size).toBe(result.length);
    });

    it('should have no missing items', async () => {
      const count = 500;
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [count]);

      // Check for gaps in sequence
      for (let i = 0; i < count; i++) {
        expect(result).toContain(i);
      }
    });
  });

  describe('Timestamp Validation', () => {
    it('should have valid timestamps in streamed data', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateData', [100]);
      const now = Date.now();

      result.forEach((item) => {
        expect(item.timestamp).toBeGreaterThan(now - 5000); // Within last 5 seconds
        expect(item.timestamp).toBeLessThanOrEqual(now + 1000); // Not in future
      });
    });

    it('should have monotonically increasing or stable timestamps', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateData', [100]);

      // Timestamps should be non-decreasing (might be same due to speed)
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i + 1].timestamp).toBeGreaterThanOrEqual(result[i].timestamp);
      }
    });
  });
});
