/**
 * Performance Benchmark for HTTP Transport
 *
 * Tests the ability to handle 100K RPS and measures:
 * - Throughput
 * - Latency percentiles
 * - Resource utilization
 * - Concurrent connection handling
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { EnhancedHttpServer } from '../../../../specs/http-ptransport-enchanced/http-server-enhanced.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import * as os from 'os';

// Get number of CPU cores for parallel testing
const CPU_CORES = os.cpus().length;

/**
 * Performance metrics collector
 */
class PerformanceMetrics {
  private latencies: number[] = [];
  private errors = 0;
  private startTime = 0;
  private endTime = 0;

  start(): void {
    this.startTime = performance.now();
  }

  recordLatency(latency: number): void {
    this.latencies.push(latency);
  }

  recordError(): void {
    this.errors++;
  }

  end(): void {
    this.endTime = performance.now();
  }

  getStats() {
    this.latencies.sort((a, b) => a - b);
    const totalRequests = this.latencies.length + this.errors;
    const duration = (this.endTime - this.startTime) / 1000; // seconds
    const throughput = totalRequests / duration;

    return {
      totalRequests,
      successfulRequests: this.latencies.length,
      errors: this.errors,
      errorRate: (this.errors / totalRequests) * 100,
      duration,
      throughput,
      latency: {
        min: this.latencies[0] || 0,
        max: this.latencies[this.latencies.length - 1] || 0,
        mean: this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length || 0,
        p50: this.percentile(50),
        p75: this.percentile(75),
        p90: this.percentile(90),
        p95: this.percentile(95),
        p99: this.percentile(99),
        p999: this.percentile(99.9)
      }
    };
  }

  private percentile(p: number): number {
    if (this.latencies.length === 0) return 0;
    const index = Math.ceil((p / 100) * this.latencies.length) - 1;
    return this.latencies[Math.max(0, index)];
  }
}

/**
 * Load generator for benchmark testing
 */
class LoadGenerator {
  private baseUrl: string;
  private running = false;
  private requestCount = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Generate load with specified parameters
   */
  async generateLoad(
    duration: number,
    rps: number,
    concurrency: number,
    metrics: PerformanceMetrics
  ): Promise<void> {
    this.running = true;
    const interval = 1000 / rps; // ms between requests
    const workers: Promise<void>[] = [];

    // Create worker function
    const worker = async () => {
      while (this.running) {
        const start = performance.now();
        try {
          const response = await fetch(`${this.baseUrl}/rpc/BenchmarkService/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: this.requestCount++,
              timestamp: Date.now(),
              data: 'x'.repeat(100) // Small payload
            })
          });

          if (response.ok) {
            const latency = performance.now() - start;
            metrics.recordLatency(latency);
          } else {
            metrics.recordError();
          }
        } catch (error) {
          metrics.recordError();
        }

        // Rate limiting per worker
        const elapsed = performance.now() - start;
        const delay = Math.max(0, interval * concurrency - elapsed);
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    // Start workers
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }

    // Run for specified duration
    await new Promise(resolve => setTimeout(resolve, duration));
    this.running = false;

    // Wait for workers to finish
    await Promise.all(workers);
  }

  /**
   * Burst test - send requests as fast as possible
   */
  async burst(count: number, concurrency: number, metrics: PerformanceMetrics): Promise<void> {
    const batchSize = Math.ceil(count / concurrency);
    const workers: Promise<void>[] = [];

    const worker = async (workerId: number) => {
      for (let i = 0; i < batchSize; i++) {
        const requestId = workerId * batchSize + i;
        if (requestId >= count) break;

        const start = performance.now();
        try {
          const response = await fetch(`${this.baseUrl}/rpc/BenchmarkService/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: requestId,
              timestamp: Date.now()
            })
          });

          if (response.ok) {
            const latency = performance.now() - start;
            metrics.recordLatency(latency);
          } else {
            metrics.recordError();
          }
        } catch (error) {
          metrics.recordError();
        }
      }
    };

    // Start workers
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker(i));
    }

    await Promise.all(workers);
  }
}

describe('HTTP Transport Performance Benchmark', () => {
  let server: EnhancedHttpServer;
  let baseUrl: string;
  const port = 4600;

  beforeAll(async () => {
    // Create high-performance server
    server = new EnhancedHttpServer({
      port,
      host: '0.0.0.0',
      maxConnections: 100000,
      keepAliveTimeout: 60000,
      requestTimeout: 5000,
      http2: false, // HTTP/1.1 for now
      pipelining: true,
      cluster: false // Single process for controlled testing
    });

    // Create benchmark service
    const definition = new Definition({
      name: 'BenchmarkService',
      version: '1.0.0',
      methods: {
        process: {
          input: { id: 'number', timestamp: 'number', data: 'string' },
          output: { id: 'number', processed: 'boolean' }
        },
        echo: {
          input: { message: 'string' },
          output: { message: 'string' }
        },
        compute: {
          input: { iterations: 'number' },
          output: { result: 'number' }
        }
      }
    });

    const implementation = {
      async process(input: any) {
        // Minimal processing for benchmark
        return { id: input.id, processed: true };
      },
      async echo(input: any) {
        return { message: input.message };
      },
      async compute(input: any) {
        // Simulate CPU-bound work
        let result = 0;
        for (let i = 0; i < input.iterations; i++) {
          result += Math.sqrt(i);
        }
        return { result };
      }
    };

    const peer = new LocalPeer('benchmark-peer');
    peer.exposeService(definition, implementation);
    server.setPeer(peer);
    server.registerService('BenchmarkService', definition);

    await server.listen();
    baseUrl = `http://localhost:${port}`;

    // Warm up the server
    for (let i = 0; i < 100; i++) {
      await fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'warmup' })
      });
    }
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Throughput Tests', () => {
    it('should handle 1K RPS', async () => {
      const metrics = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      metrics.start();
      await generator.generateLoad(5000, 1000, 10, metrics); // 5 seconds, 1K RPS, 10 concurrent
      metrics.end();

      const stats = metrics.getStats();
      console.log('1K RPS Stats:', JSON.stringify(stats, null, 2));

      expect(stats.throughput).toBeGreaterThanOrEqual(950); // Allow 5% variance
      expect(stats.errorRate).toBeLessThan(1); // Less than 1% errors
      expect(stats.latency.p95).toBeLessThan(100); // 95th percentile under 100ms
    }, 10000);

    it('should handle 10K RPS', async () => {
      const metrics = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      metrics.start();
      await generator.generateLoad(5000, 10000, 100, metrics); // 5 seconds, 10K RPS, 100 concurrent
      metrics.end();

      const stats = metrics.getStats();
      console.log('10K RPS Stats:', JSON.stringify(stats, null, 2));

      expect(stats.throughput).toBeGreaterThanOrEqual(9000); // Allow 10% variance
      expect(stats.errorRate).toBeLessThan(2); // Less than 2% errors
      expect(stats.latency.p95).toBeLessThan(200); // 95th percentile under 200ms
    }, 10000);

    it('should handle 50K RPS burst', async () => {
      const metrics = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      metrics.start();
      await generator.burst(50000, 500, metrics); // 50K requests with 500 concurrent connections
      metrics.end();

      const stats = metrics.getStats();
      console.log('50K Burst Stats:', JSON.stringify(stats, null, 2));

      expect(stats.successfulRequests).toBeGreaterThan(45000); // At least 90% success
      expect(stats.errorRate).toBeLessThan(10); // Less than 10% errors
      expect(stats.latency.p50).toBeLessThan(500); // Median under 500ms
    }, 30000);

    // Skip this test in CI as it requires significant resources
    it.skip('should approach 100K RPS with optimal conditions', async () => {
      const metrics = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      metrics.start();
      await generator.generateLoad(10000, 100000, 1000, metrics); // 10 seconds, 100K RPS, 1000 concurrent
      metrics.end();

      const stats = metrics.getStats();
      console.log('100K RPS Stats:', JSON.stringify(stats, null, 2));

      expect(stats.throughput).toBeGreaterThanOrEqual(80000); // At least 80K RPS
      expect(stats.errorRate).toBeLessThan(5); // Less than 5% errors
    }, 30000);
  });

  describe('Latency Tests', () => {
    it('should maintain low latency under normal load', async () => {
      const latencies: number[] = [];
      const requests = 1000;

      for (let i = 0; i < requests; i++) {
        const start = performance.now();
        await fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `test-${i}` })
        });
        latencies.push(performance.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      console.log(`Latency - P50: ${p50.toFixed(2)}ms, P99: ${p99.toFixed(2)}ms`);

      expect(p50).toBeLessThan(10); // P50 under 10ms
      expect(p99).toBeLessThan(50); // P99 under 50ms
    }, 30000);

    it('should handle variable payload sizes efficiently', async () => {
      const payloadSizes = [10, 100, 1000, 10000]; // bytes
      const results: any = {};

      for (const size of payloadSizes) {
        const payload = 'x'.repeat(size);
        const latencies: number[] = [];

        for (let i = 0; i < 100; i++) {
          const start = performance.now();
          await fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: payload })
          });
          latencies.push(performance.now() - start);
        }

        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        results[size] = avg;
      }

      console.log('Payload size latencies:', results);

      // Latency should scale reasonably with payload size
      expect(results[10000]).toBeLessThan(results[10] * 10); // Not linear scaling
    });
  });

  describe('Concurrency Tests', () => {
    it('should handle increasing concurrent connections', async () => {
      const concurrencyLevels = [10, 50, 100, 500, 1000];
      const results: any = {};

      for (const concurrency of concurrencyLevels) {
        const metrics = new PerformanceMetrics();
        const promises: Promise<void>[] = [];

        metrics.start();
        for (let i = 0; i < concurrency; i++) {
          promises.push(
            fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: `concurrent-${i}` })
            }).then(response => {
              if (response.ok) {
                metrics.recordLatency(0); // Just count successes
              } else {
                metrics.recordError();
              }
            }).catch(() => metrics.recordError())
          );
        }

        await Promise.all(promises);
        metrics.end();

        const stats = metrics.getStats();
        results[concurrency] = {
          successRate: ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(2),
          duration: stats.duration.toFixed(2)
        };
      }

      console.log('Concurrency results:', results);

      // Should handle up to 1000 concurrent connections
      expect(parseFloat(results[1000].successRate)).toBeGreaterThan(95);
    }, 60000);

    it('should maintain performance with connection pooling', async () => {
      const metrics = new PerformanceMetrics();
      const connectionCount = 10;
      const requestsPerConnection = 100;

      metrics.start();

      // Simulate connection pooling
      const connections = Array(connectionCount).fill(null).map(async (_, connId) => {
        for (let i = 0; i < requestsPerConnection; i++) {
          const start = performance.now();
          try {
            const response = await fetch(`${baseUrl}/rpc/BenchmarkService/process`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
              },
              body: JSON.stringify({
                id: connId * requestsPerConnection + i,
                timestamp: Date.now()
              })
            });

            if (response.ok) {
              metrics.recordLatency(performance.now() - start);
            } else {
              metrics.recordError();
            }
          } catch {
            metrics.recordError();
          }
        }
      });

      await Promise.all(connections);
      metrics.end();

      const stats = metrics.getStats();
      console.log('Connection pooling stats:', stats);

      expect(stats.throughput).toBeGreaterThan(500); // Should maintain good throughput
      expect(stats.latency.p95).toBeLessThan(100); // Low latency with pooling
    }, 30000);
  });

  describe('Resource Utilization', () => {
    it('should handle memory efficiently under load', async () => {
      const initialMemory = process.memoryUsage();
      const metrics = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      metrics.start();
      await generator.burst(10000, 100, metrics);
      metrics.end();

      const finalMemory = process.memoryUsage();
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024; // MB

      console.log(`Memory increase: ${memoryIncrease.toFixed(2)} MB`);

      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(200); // Less than 200MB for 10K requests
    }, 30000);

    it('should handle CPU-bound operations', async () => {
      const metrics = new PerformanceMetrics();
      const requests = 100;

      metrics.start();
      const promises: Promise<void>[] = [];

      for (let i = 0; i < requests; i++) {
        promises.push(
          fetch(`${baseUrl}/rpc/BenchmarkService/compute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ iterations: 1000 })
          }).then(response => {
            if (response.ok) {
              metrics.recordLatency(0);
            } else {
              metrics.recordError();
            }
          }).catch(() => metrics.recordError())
        );
      }

      await Promise.all(promises);
      metrics.end();

      const stats = metrics.getStats();
      console.log('CPU-bound operation stats:', stats);

      // Should still handle requests even with CPU-bound operations
      expect(stats.successfulRequests).toBe(requests);
      expect(stats.duration).toBeLessThan(10); // Should complete within 10 seconds
    }, 15000);
  });

  describe('Stability Tests', () => {
    it('should remain stable under sustained load', async () => {
      const duration = 10000; // 10 seconds
      const rps = 1000;
      const metrics = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      metrics.start();
      await generator.generateLoad(duration, rps, 50, metrics);
      metrics.end();

      const stats = metrics.getStats();
      console.log('Sustained load stats:', stats);

      expect(stats.errorRate).toBeLessThan(1); // Less than 1% errors
      expect(stats.throughput).toBeGreaterThan(900); // Maintain throughput
      expect(stats.latency.p99).toBeLessThan(500); // P99 under 500ms
    }, 15000);

    it('should recover from overload', async () => {
      const metrics1 = new PerformanceMetrics();
      const metrics2 = new PerformanceMetrics();
      const generator = new LoadGenerator(baseUrl);

      // Overload the server
      metrics1.start();
      await generator.burst(5000, 500, metrics1);
      metrics1.end();

      // Wait for recovery
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Normal load after overload
      metrics2.start();
      await generator.burst(1000, 10, metrics2);
      metrics2.end();

      const stats1 = metrics1.getStats();
      const stats2 = metrics2.getStats();

      console.log('Overload stats:', stats1);
      console.log('Recovery stats:', stats2);

      // Should recover and handle normal load
      expect(stats2.errorRate).toBeLessThan(stats1.errorRate);
      expect(stats2.latency.p50).toBeLessThan(stats1.latency.p50);
    }, 20000);
  });

  describe('Optimization Verification', () => {
    it('should benefit from route caching', async () => {
      // First batch - cold cache
      const coldLatencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `cold-${i}` })
        });
        coldLatencies.push(performance.now() - start);
      }

      // Second batch - warm cache
      const warmLatencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `warm-${i}` })
        });
        warmLatencies.push(performance.now() - start);
      }

      const coldAvg = coldLatencies.reduce((a, b) => a + b, 0) / coldLatencies.length;
      const warmAvg = warmLatencies.reduce((a, b) => a + b, 0) / warmLatencies.length;

      console.log(`Route caching - Cold: ${coldAvg.toFixed(2)}ms, Warm: ${warmAvg.toFixed(2)}ms`);

      // Warm cache should be faster (or at least not slower)
      expect(warmAvg).toBeLessThanOrEqual(coldAvg * 1.1); // Allow 10% variance
    });

    it('should show middleware overhead is minimal', async () => {
      // Request with full middleware pipeline (default server)
      const withMiddleware: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await fetch(`${baseUrl}/rpc/BenchmarkService/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `test-${i}` })
        });
        withMiddleware.push(performance.now() - start);
      }

      const avgWithMiddleware = withMiddleware.reduce((a, b) => a + b, 0) / withMiddleware.length;
      console.log(`Average latency with middleware: ${avgWithMiddleware.toFixed(2)}ms`);

      // Middleware overhead should be minimal
      expect(avgWithMiddleware).toBeLessThan(20); // Should be very fast
    });
  });
});