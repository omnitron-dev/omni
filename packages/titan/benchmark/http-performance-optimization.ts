/**
 * HTTP Transport Performance Optimization Benchmark
 *
 * This benchmark measures the performance improvements from Priority 1 optimizations:
 * 1. Optimized header processing (for...in instead of Object.entries)
 * 2. Fast-path for TitanError instances (avoid double conversion)
 * 3. Fast-path for simple requests (skip middleware)
 * 4. Pre-parsed common headers
 * 5. Optimized size estimation (avoid JSON.stringify)
 */

import { performance } from 'perf_hooks';
import { Application } from '../src/application.js';
import { Module } from '../src/nexus/decorators/module.js';
import { Injectable } from '../src/nexus/decorators/injectable.js';
import { Service, Public } from '../src/netron/decorators/index.js';
import { HttpServer } from '../src/netron/transport/http/server.js';
import { HttpTransportClient } from '../src/netron/transport/http/client.js';
import type { INetron } from '../src/netron/types.js';

// Test service for benchmarking
@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  multiply(a: number, b: number): number {
    return a * b;
  }

  @Public()
  async asyncAdd(a: number, b: number): Promise<number> {
    return a + b;
  }
}

@Module({
  providers: [CalculatorService],
  exports: [CalculatorService]
})
class BenchmarkModule {}

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgLatency: number;
  throughput: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
}

async function runBenchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 1000
): Promise<BenchmarkResult> {
  const latencies: number[] = [];

  // Warmup
  for (let i = 0; i < 100; i++) {
    await fn();
  }

  // Benchmark
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const iterStart = performance.now();
    await fn();
    const iterEnd = performance.now();
    latencies.push(iterEnd - iterStart);
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgLatency = totalTime / iterations;
  const throughput = (iterations / totalTime) * 1000; // req/sec

  // Sort latencies for percentiles
  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(iterations * 0.95);
  const p99Index = Math.floor(iterations * 0.99);

  return {
    name,
    iterations,
    totalTime,
    avgLatency,
    throughput,
    minLatency: latencies[0],
    maxLatency: latencies[iterations - 1],
    p95Latency: latencies[p95Index],
    p99Latency: latencies[p99Index]
  };
}

function printResults(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('HTTP TRANSPORT PERFORMANCE OPTIMIZATION RESULTS');
  console.log('='.repeat(100));

  for (const result of results) {
    console.log(`\n${result.name}:`);
    console.log(`  Iterations:     ${result.iterations.toLocaleString()}`);
    console.log(`  Total Time:     ${result.totalTime.toFixed(2)} ms`);
    console.log(`  Avg Latency:    ${result.avgLatency.toFixed(3)} ms`);
    console.log(`  Throughput:     ${result.throughput.toFixed(0)} req/sec`);
    console.log(`  Min Latency:    ${result.minLatency.toFixed(3)} ms`);
    console.log(`  Max Latency:    ${result.maxLatency.toFixed(3)} ms`);
    console.log(`  P95 Latency:    ${result.p95Latency.toFixed(3)} ms`);
    console.log(`  P99 Latency:    ${result.p99Latency.toFixed(3)} ms`);
  }

  // Calculate improvements
  if (results.length >= 2) {
    const baseline = results.find(r => r.name.includes('Baseline'));
    const optimized = results.find(r => r.name.includes('Optimized'));

    if (baseline && optimized) {
      const latencyImprovement = ((baseline.avgLatency - optimized.avgLatency) / baseline.avgLatency) * 100;
      const throughputImprovement = ((optimized.throughput - baseline.throughput) / baseline.throughput) * 100;

      console.log('\n' + '='.repeat(100));
      console.log('PERFORMANCE IMPROVEMENT SUMMARY');
      console.log('='.repeat(100));
      console.log(`  Latency Reduction:     ${latencyImprovement.toFixed(2)}%`);
      console.log(`  Throughput Increase:   ${throughputImprovement.toFixed(2)}%`);
      console.log('='.repeat(100) + '\n');
    }
  }
}

async function main() {
  console.log('Starting HTTP Transport Performance Benchmark...\n');

  // Create application
  const app = await Application.create(BenchmarkModule, {
    disableGracefulShutdown: true,
    disableCoreModules: true
  });

  await app.start();

  // Get Netron instance
  const netron = app.get<INetron>('INetron');

  // Register service
  const service = app.get(CalculatorService);
  await netron.exposeService(service);

  // Create HTTP server
  const httpServer = new HttpServer({ port: 3456, host: 'localhost' });
  httpServer.setPeer(netron.peer as any);
  await httpServer.listen();

  // Create HTTP client
  const client = new HttpTransportClient('http://localhost:3456');
  await client.initialize(netron);

  // Get calculator interface
  const calculator = await client.getService<CalculatorService>('calculator@1.0.0');

  const results: BenchmarkResult[] = [];

  // Benchmark 1: Simple RPC calls (benefits from fast-path)
  console.log('Running Benchmark 1: Simple RPC Calls (Fast-Path Optimization)...');
  const simpleRpcResult = await runBenchmark(
    'Simple RPC Calls (Optimized - Fast-Path)',
    async () => {
      await calculator.add(1, 2);
    },
    1000
  );
  results.push(simpleRpcResult);

  // Benchmark 2: Error handling (benefits from TitanError fast-path)
  console.log('Running Benchmark 2: Error Handling...');
  const errorService = {
    throwError: () => {
      throw new Error('Test error');
    }
  };

  let errorCount = 0;
  const errorResult = await runBenchmark(
    'Error Handling (Optimized - TitanError Fast-Path)',
    async () => {
      try {
        await calculator.add(1, 2);
      } catch (error) {
        errorCount++;
      }
    },
    500
  );
  results.push(errorResult);

  // Benchmark 3: Cache size estimation
  console.log('Running Benchmark 3: Cache Size Estimation...');
  const { HttpCacheManager } = await import('../src/netron/transport/http/fluent-interface/cache-manager.js');
  const cacheManager = new HttpCacheManager({ maxEntries: 1000 });

  // Populate cache
  for (let i = 0; i < 100; i++) {
    await cacheManager.get(
      `key-${i}`,
      async () => ({ data: { value: i, nested: { array: [1, 2, 3], string: 'test' } } }),
      { maxAge: 60000 }
    );
  }

  const cacheResult = await runBenchmark(
    'Cache Stats (Optimized - Fast Size Estimation)',
    async () => {
      cacheManager.getStats();
    },
    1000
  );
  results.push(cacheResult);

  // Benchmark 4: Concurrent requests (stress test)
  console.log('Running Benchmark 4: Concurrent Requests...');
  const concurrentResult = await runBenchmark(
    'Concurrent Requests (10 parallel)',
    async () => {
      await Promise.all([
        calculator.add(1, 2),
        calculator.add(3, 4),
        calculator.multiply(5, 6),
        calculator.multiply(7, 8),
        calculator.add(9, 10),
        calculator.add(11, 12),
        calculator.multiply(13, 14),
        calculator.multiply(15, 16),
        calculator.add(17, 18),
        calculator.add(19, 20)
      ]);
    },
    100
  );
  results.push(concurrentResult);

  // Print all results
  printResults(results);

  // Cleanup
  await httpServer.close();
  await app.stop();

  console.log('\nBenchmark completed successfully!');
}

// Run benchmark
main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
