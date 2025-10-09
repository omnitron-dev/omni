/**
 * Policy Engine Performance Benchmark
 * Measures throughput, latency, and cache effectiveness
 */

import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import type { ExecutionContext, PolicyDefinition } from '../../../src/netron/auth/types.js';

// Mock logger
const mockLogger: any = {
  child: () => mockLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  opsPerSecond: number;
  avgLatency: number;
  p95Latency?: number;
  cacheHitRate?: number;
}

async function benchmark(
  name: string,
  iterations: number,
  fn: () => Promise<void>,
): Promise<BenchmarkResult> {
  const latencies: number[] = [];

  // Warm-up
  for (let i = 0; i < 100; i++) {
    await fn();
  }

  // Actual benchmark
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const iterStart = performance.now();
    await fn();
    latencies.push(performance.now() - iterStart);
  }
  const totalTime = performance.now() - start;

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);

  return {
    operation: name,
    iterations,
    totalTime,
    opsPerSecond: (iterations / totalTime) * 1000,
    avgLatency: totalTime / iterations,
    p95Latency: latencies[p95Index],
  };
}

async function runBenchmarks() {
  console.log('\n=== PolicyEngine Performance Benchmark ===\n');

  const engine = new PolicyEngine(mockLogger);
  const mockContext: ExecutionContext = {
    auth: { userId: 'user1', roles: ['user'], permissions: ['read'] },
    service: { name: 'testService', version: '1.0.0' },
    method: { name: 'testMethod', args: [] },
  };

  // Simple allow policy
  const simplePolicy: PolicyDefinition = {
    name: 'simple',
    evaluate: () => ({ allowed: true }),
  };

  // Complex policy with some logic
  const complexPolicy: PolicyDefinition = {
    name: 'complex',
    evaluate: (ctx: ExecutionContext) => {
      const hasRole = ctx.auth?.roles.includes('user');
      const hasPermission = ctx.auth?.permissions.includes('read');
      return {
        allowed: hasRole && hasPermission,
        reason: hasRole && hasPermission ? 'Access granted' : 'Access denied',
      };
    },
  };

  engine.registerPolicy(simplePolicy);
  engine.registerPolicy(complexPolicy);

  // Benchmark 1: Simple policy evaluation (cached)
  console.log('1. Simple policy evaluation (with cache)...');
  const result1 = await benchmark('Simple cached eval', 50000, async () => {
    await engine.evaluate('simple', mockContext);
  });
  const stats1 = engine.getCacheStats();
  console.log(`   Throughput: ${result1.opsPerSecond.toFixed(0)} ops/sec`);
  console.log(`   Avg latency: ${result1.avgLatency.toFixed(3)} ms`);
  console.log(`   P95 latency: ${result1.p95Latency!.toFixed(3)} ms`);
  console.log(`   Cache hit rate: ${(stats1.hitRate * 100).toFixed(2)}%`);

  // Clear cache for next test
  engine.clearCache();

  // Benchmark 2: Simple policy evaluation (no cache)
  console.log('\n2. Simple policy evaluation (no cache)...');
  const result2 = await benchmark('Simple no cache', 10000, async () => {
    await engine.evaluate('simple', mockContext, { skipCache: true });
  });
  console.log(`   Throughput: ${result2.opsPerSecond.toFixed(0)} ops/sec`);
  console.log(`   Avg latency: ${result2.avgLatency.toFixed(3)} ms`);
  console.log(`   P95 latency: ${result2.p95Latency!.toFixed(3)} ms`);

  // Benchmark 3: Complex policy evaluation
  console.log('\n3. Complex policy evaluation...');
  const result3 = await benchmark('Complex eval', 10000, async () => {
    await engine.evaluate('complex', mockContext, { skipCache: true });
  });
  console.log(`   Throughput: ${result3.opsPerSecond.toFixed(0)} ops/sec`);
  console.log(`   Avg latency: ${result3.avgLatency.toFixed(3)} ms`);
  console.log(`   P95 latency: ${result3.p95Latency!.toFixed(3)} ms`);

  // Benchmark 4: Multiple policies (evaluateAll)
  console.log('\n4. Multiple policies (evaluateAll)...');
  const result4 = await benchmark('EvaluateAll', 5000, async () => {
    await engine.evaluateAll(['simple', 'complex'], mockContext, { skipCache: true });
  });
  console.log(`   Throughput: ${result4.opsPerSecond.toFixed(0)} ops/sec`);
  console.log(`   Avg latency: ${result4.avgLatency.toFixed(3)} ms`);
  console.log(`   P95 latency: ${result4.p95Latency!.toFixed(3)} ms`);

  // Benchmark 5: Batch evaluation
  console.log('\n5. Batch evaluation (100 contexts)...');
  const contexts = Array.from({ length: 100 }, (_, i) => ({
    ...mockContext,
    auth: { ...mockContext.auth!, userId: `user${i}` },
  }));
  const result5 = await benchmark('Batch 100', 100, async () => {
    await engine.evaluateBatch(contexts, 'simple', { skipCache: true });
  });
  console.log(`   Throughput: ${result5.opsPerSecond.toFixed(0)} batches/sec`);
  console.log(`   Avg latency: ${result5.avgLatency.toFixed(3)} ms per batch`);
  console.log(`   P95 latency: ${result5.p95Latency!.toFixed(3)} ms`);
  console.log(`   Individual eval rate: ${(result5.opsPerSecond * 100).toFixed(0)} ops/sec`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`✓ Cached evaluation: ${result1.opsPerSecond.toFixed(0)} ops/sec`);
  console.log(`✓ Non-cached evaluation: ${result2.opsPerSecond.toFixed(0)} ops/sec`);
  console.log(`✓ P95 latency: ${result2.p95Latency!.toFixed(3)} ms`);
  console.log(`✓ Cache hit rate: ${(stats1.hitRate * 100).toFixed(2)}%`);
  console.log(`✓ Batch processing: ${(result5.opsPerSecond * 100).toFixed(0)} ops/sec`);

  // Check performance targets
  console.log('\n=== Performance Targets ===');
  console.log(`${result1.opsPerSecond > 10000 ? '✓' : '✗'} > 10K ops/sec with cache: ${result1.opsPerSecond.toFixed(0)}`);
  console.log(`${result2.p95Latency! < 5 ? '✓' : '✗'} < 5ms P95 latency: ${result2.p95Latency!.toFixed(3)}ms`);
  console.log(`${stats1.hitRate > 0.9 ? '✓' : '✗'} > 90% cache hit rate: ${(stats1.hitRate * 100).toFixed(2)}%`);

  console.log('\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarks().catch(console.error);
}

export { runBenchmarks };
