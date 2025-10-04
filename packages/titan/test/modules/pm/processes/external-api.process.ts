/**
 * External API Service Process
 * Used in resilience pattern tests for circuit breaker
 */

import { Process, Public, CircuitBreaker } from '../../../../src/modules/pm/decorators.js';

@Process({ name: 'external-api-service', version: '1.0.0' })
export default class ExternalApiService {
  private callCount = 0;
  private failureRate = 0.5; // 50% failure rate initially
  private consecutiveFailures = 0;

  @Public()
  @CircuitBreaker({
    threshold: 5, // Open circuit after 5 failures
    timeout: 1000, // 1 second timeout per call
    fallback: 'getFallbackData'
  })
  async fetchData(endpoint: string): Promise<{ data: any; source: 'primary' | 'fallback' }> {
    this.callCount++;

    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 50));

    // Simulate failures based on failure rate
    if (Math.random() < this.failureRate) {
      this.consecutiveFailures++;
      throw new Error(`External API call failed for endpoint: ${endpoint}`);
    }

    this.consecutiveFailures = 0;
    return {
      data: { endpoint, timestamp: Date.now(), value: Math.random() },
      source: 'primary'
    };
  }

  @Public()
  async getFallbackData(endpoint: string): Promise<{ data: any; source: 'primary' | 'fallback' }> {
    // Return cached or default data
    return {
      data: { endpoint, cached: true, timestamp: Date.now() },
      source: 'fallback'
    };
  }

  @Public()
  async setFailureRate(rate: number): Promise<void> {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  @Public()
  async getStats(): Promise<{ callCount: number; consecutiveFailures: number; failureRate: number }> {
    return {
      callCount: this.callCount,
      consecutiveFailures: this.consecutiveFailures,
      failureRate: this.failureRate
    };
  }

  @Public()
  async reset(): Promise<void> {
    this.callCount = 0;
    this.consecutiveFailures = 0;
    this.failureRate = 0.5;
  }
}