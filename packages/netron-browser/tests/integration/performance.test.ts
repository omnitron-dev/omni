/**
 * Performance Benchmarks and Load Testing
 * Tests performance characteristics of the netron-browser client with Titan server
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import { HttpClient } from '../../src/client/http-client.js';

interface BenchmarkResult {
  operation: string;
  count: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
}

function benchmark(operation: string, times: number[]): BenchmarkResult {
  const totalTime = times.reduce((a, b) => a + b, 0);
  const avgTime = totalTime / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const throughput = (times.length / totalTime) * 1000; // ops per second

  return {
    operation,
    count: times.length,
    totalTime,
    avgTime,
    minTime,
    maxTime,
    throughput,
  };
}

describe('Performance Benchmarks - WebSocket', () => {
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
      timeout: 30000,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Latency Benchmarks', () => {
    it('should measure simple RPC call latency', async () => {
      const iterations = 100;
      const latencies: number[] = [];

      // Warmup
      for (let i = 0; i < 10; i++) {
        await client.invoke('calculator@1.0.0', 'add', [1, 1]);
      }

      // Measure
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.invoke('calculator@1.0.0', 'add', [i, i + 1]);
        const latency = performance.now() - start;
        latencies.push(latency);
      }

      const result = benchmark('Simple RPC (add)', latencies);

      console.log('\n=== Simple RPC Latency ===');
      console.log(`Operations: ${result.count}`);
      console.log(`Total Time: ${result.totalTime.toFixed(2)}ms`);
      console.log(`Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`Min: ${result.minTime.toFixed(2)}ms`);
      console.log(`Max: ${result.maxTime.toFixed(2)}ms`);
      console.log(`Throughput: ${result.throughput.toFixed(2)} ops/sec`);

      expect(result.avgTime).toBeLessThan(50); // Average under 50ms
      expect(result.maxTime).toBeLessThan(200); // Max under 200ms
    });

    it('should measure complex object echo latency', async () => {
      const iterations = 50;
      const latencies: number[] = [];

      const complexObj = {
        id: 1,
        name: 'Test Object',
        tags: ['tag1', 'tag2', 'tag3'],
        metadata: {
          created: Date.now(),
          modified: Date.now(),
          nested: {
            deep: {
              value: 'test',
            },
          },
        },
        items: Array.from({ length: 10 }, (_, i) => ({
          id: i,
          value: `item-${i}`,
        })),
      };

      // Warmup
      for (let i = 0; i < 5; i++) {
        await client.invoke('echo@1.0.0', 'echoObject', [complexObj]);
      }

      // Measure
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.invoke('echo@1.0.0', 'echoObject', [complexObj]);
        const latency = performance.now() - start;
        latencies.push(latency);
      }

      const result = benchmark('Complex Object Echo', latencies);

      console.log('\n=== Complex Object Echo Latency ===');
      console.log(`Operations: ${result.count}`);
      console.log(`Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`Min: ${result.minTime.toFixed(2)}ms`);
      console.log(`Max: ${result.maxTime.toFixed(2)}ms`);

      expect(result.avgTime).toBeLessThan(100); // Complex objects should still be fast
    });

    it('should measure array streaming latency', async () => {
      const iterations = 20;
      const latencies: number[] = [];

      // Measure
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.invoke('stream@1.0.0', 'generateNumbers', [100]);
        const latency = performance.now() - start;
        latencies.push(latency);
      }

      const result = benchmark('Array Stream (100 items)', latencies);

      console.log('\n=== Array Stream Latency ===');
      console.log(`Operations: ${result.count}`);
      console.log(`Average: ${result.avgTime.toFixed(2)}ms`);
      console.log(`Throughput: ${result.throughput.toFixed(2)} ops/sec`);

      expect(result.avgTime).toBeLessThan(150);
    });
  });

  describe('Throughput Benchmarks', () => {
    it('should measure sequential throughput', async () => {
      const count = 500;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        await client.invoke('calculator@1.0.0', 'add', [i, 1]);
      }

      const duration = performance.now() - start;
      const throughput = (count / duration) * 1000;

      console.log('\n=== Sequential Throughput ===');
      console.log(`Operations: ${count}`);
      console.log(`Duration: ${duration.toFixed(2)}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} ops/sec`);

      expect(throughput).toBeGreaterThan(10); // At least 10 ops/sec sequentially
    });

    it('should measure concurrent throughput', async () => {
      const count = 500;
      const start = performance.now();

      const promises = Array.from({ length: count }, (_, i) =>
        client.invoke('calculator@1.0.0', 'add', [i, 1])
      );

      await Promise.all(promises);

      const duration = performance.now() - start;
      const throughput = (count / duration) * 1000;

      console.log('\n=== Concurrent Throughput ===');
      console.log(`Operations: ${count}`);
      console.log(`Duration: ${duration.toFixed(2)}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} ops/sec`);

      expect(throughput).toBeGreaterThan(50); // Much higher with concurrency
      expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
    });

    it('should measure mixed operation throughput', async () => {
      const operationsPerType = 100;
      const start = performance.now();

      const operations = [
        ...Array.from({ length: operationsPerType }, (_, i) =>
          client.invoke('calculator@1.0.0', 'add', [i, 1])
        ),
        ...Array.from({ length: operationsPerType }, (_, i) =>
          client.invoke('calculator@1.0.0', 'multiply', [i, 2])
        ),
        ...Array.from({ length: operationsPerType }, (_, i) =>
          client.invoke('echo@1.0.0', 'echoNumber', [i])
        ),
      ];

      await Promise.all(operations);

      const duration = performance.now() - start;
      const totalOps = operationsPerType * 3;
      const throughput = (totalOps / duration) * 1000;

      console.log('\n=== Mixed Operation Throughput ===');
      console.log(`Operations: ${totalOps}`);
      console.log(`Duration: ${duration.toFixed(2)}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} ops/sec`);

      expect(duration).toBeLessThan(15000);
    });
  });

  describe('Payload Size Impact', () => {
    it('should measure impact of payload size on latency', async () => {
      const sizes = [10, 100, 1000, 10000];
      const results: { size: number; avgLatency: number }[] = [];

      for (const size of sizes) {
        const latencies: number[] = [];

        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          await client.invoke('stream@1.0.0', 'generateNumbers', [size]);
          latencies.push(performance.now() - start);
        }

        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        results.push({ size, avgLatency });
      }

      console.log('\n=== Payload Size Impact ===');
      results.forEach(({ size, avgLatency }) => {
        console.log(`Size ${size}: ${avgLatency.toFixed(2)}ms`);
      });

      // Verify latency increases with size but not drastically
      results.forEach(({ avgLatency }) => {
        expect(avgLatency).toBeLessThan(500);
      });
    });

    it('should handle large payloads efficiently', async () => {
      const size = 50000;
      const iterations = 5;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const result = await client.invoke('stream@1.0.0', 'generateNumbers', [size]);
        const latency = performance.now() - start;
        latencies.push(latency);
        expect(result.length).toBe(size);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log('\n=== Large Payload Performance ===');
      console.log(`Payload size: ${size} items`);
      console.log(`Average latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`Throughput: ${((size / avgLatency) * 1000).toFixed(2)} items/sec`);

      expect(avgLatency).toBeLessThan(2000); // Should handle 50k items in under 2 seconds
    });
  });

  describe('Sustained Load Testing', () => {
    it('should maintain performance under sustained load', async () => {
      const duration = 5000; // 5 seconds
      const batchSize = 20;
      let completedOps = 0;
      const startTime = Date.now();
      const latencies: number[] = [];

      while (Date.now() - startTime < duration) {
        const batchStart = performance.now();

        const batch = Array.from({ length: batchSize }, (_, i) =>
          client.invoke('calculator@1.0.0', 'add', [i, 1])
        );

        await Promise.all(batch);

        const batchLatency = performance.now() - batchStart;
        latencies.push(batchLatency);
        completedOps += batchSize;
      }

      const totalDuration = Date.now() - startTime;
      const throughput = (completedOps / totalDuration) * 1000;
      const avgBatchLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log('\n=== Sustained Load Test ===');
      console.log(`Duration: ${totalDuration}ms`);
      console.log(`Completed Operations: ${completedOps}`);
      console.log(`Throughput: ${throughput.toFixed(2)} ops/sec`);
      console.log(`Avg Batch Latency: ${avgBatchLatency.toFixed(2)}ms`);

      expect(completedOps).toBeGreaterThan(100); // Should complete significant ops
      expect(throughput).toBeGreaterThan(20); // Maintain reasonable throughput
    });
  });

  describe('Error Handling Performance', () => {
    it('should measure error handling overhead', async () => {
      const iterations = 50;
      const successLatencies: number[] = [];
      const errorLatencies: number[] = [];

      // Measure successful calls
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.invoke('calculator@1.0.0', 'divide', [10, 2]);
        successLatencies.push(performance.now() - start);
      }

      // Measure error calls
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        try {
          await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
        } catch (e) {
          // Expected
        }
        errorLatencies.push(performance.now() - start);
      }

      const successResult = benchmark('Successful calls', successLatencies);
      const errorResult = benchmark('Error calls', errorLatencies);

      console.log('\n=== Error Handling Performance ===');
      console.log(`Success avg: ${successResult.avgTime.toFixed(2)}ms`);
      console.log(`Error avg: ${errorResult.avgTime.toFixed(2)}ms`);
      console.log(`Overhead: ${(errorResult.avgTime - successResult.avgTime).toFixed(2)}ms`);

      // Error handling should not add significant overhead
      expect(errorResult.avgTime).toBeLessThan(successResult.avgTime * 2);
    });
  });
});

describe('Performance Benchmarks - HTTP vs WebSocket', () => {
  let server: TitanServerFixture;
  let httpClient: HttpClient;
  let wsClient: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    httpClient = new HttpClient({ url: server.httpUrl });
    wsClient = new WebSocketClient({ url: server.wsUrl, reconnect: false });

    await httpClient.connect();
    await wsClient.connect();
  });

  afterAll(async () => {
    await httpClient.disconnect();
    await wsClient.disconnect();
    await server.cleanup();
  });

  describe('Transport Comparison', () => {
    it('should compare simple RPC latency across transports', async () => {
      const iterations = 50;

      // HTTP latencies
      const httpLatencies: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await httpClient.invoke('calculator@1.0.0', 'add', [i, 1]);
        httpLatencies.push(performance.now() - start);
      }

      // WebSocket latencies
      const wsLatencies: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await wsClient.invoke('calculator@1.0.0', 'add', [i, 1]);
        wsLatencies.push(performance.now() - start);
      }

      const httpResult = benchmark('HTTP Simple RPC', httpLatencies);
      const wsResult = benchmark('WebSocket Simple RPC', wsLatencies);

      console.log('\n=== Transport Comparison: Simple RPC ===');
      console.log(`HTTP avg: ${httpResult.avgTime.toFixed(2)}ms`);
      console.log(`WebSocket avg: ${wsResult.avgTime.toFixed(2)}ms`);
      console.log(`Difference: ${(httpResult.avgTime - wsResult.avgTime).toFixed(2)}ms`);

      // Both should be reasonably fast
      expect(httpResult.avgTime).toBeLessThan(100);
      expect(wsResult.avgTime).toBeLessThan(100);
    });

    it('should compare throughput across transports', async () => {
      const count = 100;

      // HTTP throughput
      const httpStart = performance.now();
      const httpOps = Array.from({ length: count }, (_, i) =>
        httpClient.invoke('calculator@1.0.0', 'add', [i, 1])
      );
      await Promise.all(httpOps);
      const httpDuration = performance.now() - httpStart;
      const httpThroughput = (count / httpDuration) * 1000;

      // WebSocket throughput
      const wsStart = performance.now();
      const wsOps = Array.from({ length: count }, (_, i) =>
        wsClient.invoke('calculator@1.0.0', 'add', [i, 1])
      );
      await Promise.all(wsOps);
      const wsDuration = performance.now() - wsStart;
      const wsThroughput = (count / wsDuration) * 1000;

      console.log('\n=== Transport Comparison: Throughput ===');
      console.log(`HTTP: ${httpThroughput.toFixed(2)} ops/sec`);
      console.log(`WebSocket: ${wsThroughput.toFixed(2)} ops/sec`);

      expect(httpThroughput).toBeGreaterThan(10);
      expect(wsThroughput).toBeGreaterThan(10);
    });

    it('should compare large payload handling', async () => {
      const size = 1000;
      const iterations = 10;

      // HTTP
      const httpLatencies: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await httpClient.invoke('stream@1.0.0', 'generateNumbers', [size]);
        httpLatencies.push(performance.now() - start);
      }

      // WebSocket
      const wsLatencies: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await wsClient.invoke('stream@1.0.0', 'generateNumbers', [size]);
        wsLatencies.push(performance.now() - start);
      }

      const httpAvg = httpLatencies.reduce((a, b) => a + b, 0) / httpLatencies.length;
      const wsAvg = wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length;

      console.log('\n=== Transport Comparison: Large Payload ===');
      console.log(`Payload size: ${size} items`);
      console.log(`HTTP avg: ${httpAvg.toFixed(2)}ms`);
      console.log(`WebSocket avg: ${wsAvg.toFixed(2)}ms`);

      expect(httpAvg).toBeLessThan(500);
      expect(wsAvg).toBeLessThan(500);
    });
  });
});

describe('Performance Regression Detection', () => {
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

  it('should detect performance regressions in simple operations', async () => {
    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await client.invoke('calculator@1.0.0', 'add', [1, 1]);
      latencies.push(performance.now() - start);
    }

    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const max = Math.max(...latencies);
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];
    const p99 = latencies[Math.floor(iterations * 0.99)];

    console.log('\n=== Performance Regression Check ===');
    console.log(`Average: ${avg.toFixed(2)}ms`);
    console.log(`P95: ${p95.toFixed(2)}ms`);
    console.log(`P99: ${p99.toFixed(2)}ms`);
    console.log(`Max: ${max.toFixed(2)}ms`);

    // Set baseline thresholds
    expect(avg).toBeLessThan(50); // Average should be under 50ms
    expect(p95).toBeLessThan(100); // 95th percentile under 100ms
    expect(p99).toBeLessThan(150); // 99th percentile under 150ms
    expect(max).toBeLessThan(300); // Max under 300ms
  });
});
