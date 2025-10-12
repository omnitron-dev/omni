/**
 * Caching Service Process
 * Used in resilience pattern tests for cache pattern with TTL
 */

import { Process, Public, Cache } from '../../../../src/modules/pm/decorators.js';

@Process({ name: 'caching-service', version: '1.0.0' })
export default class CachingService {
  private cacheMisses = 0;
  private cacheHits = 0;
  private computations = 0;

  @Public()
  @Cache({ ttl: 1000 }) // Cache for 1 second
  async expensiveComputation(input: number): Promise<{ result: number; cached: boolean; computationTime: number }> {
    this.computations++;
    const startTime = Date.now();

    // Simulate expensive computation
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = input * input + Math.floor(Math.random() * 100);

    return {
      result,
      cached: false,
      computationTime: Date.now() - startTime,
    };
  }

  @Public()
  async getCacheStats(): Promise<{ hits: number; misses: number; computations: number; hitRate: number }> {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      computations: this.computations,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }
}
