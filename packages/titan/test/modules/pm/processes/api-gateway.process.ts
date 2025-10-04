/**
 * API Gateway Service Process
 * Used in resilience pattern tests for rate limiting
 */

import { Process, Public, RateLimit } from '../../../../src/modules/pm/decorators.js';

@Process({ name: 'api-gateway', version: '1.0.0' })
export default class ApiGatewayService {
  private requestCounts = new Map<string, number>();
  private lastReset = Date.now();

  @Public()
  @RateLimit({
    rps: 10, // 10 requests per second
    burst: 15 // Allow burst up to 15 requests
  })
  async handleRequest(userId: string, request: any): Promise<{ success: boolean; data?: any; rateLimited?: boolean }> {
    // Track requests per user
    const count = this.requestCounts.get(userId) || 0;
    this.requestCounts.set(userId, count + 1);

    // Process request
    await new Promise(resolve => setTimeout(resolve, 10));

    return {
      success: true,
      data: { userId, processed: true, timestamp: Date.now() }
    };
  }

  @Public()
  async getUserRequestCount(userId: string): Promise<number> {
    return this.requestCounts.get(userId) || 0;
  }

  @Public()
  async resetCounts(): Promise<void> {
    this.requestCounts.clear();
    this.lastReset = Date.now();
  }
}