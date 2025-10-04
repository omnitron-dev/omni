/**
 * Resource Manager Service Process
 * Used in resilience pattern tests for bulkhead pattern
 */

import { Process, Public } from '../../../../src/modules/pm/decorators.js';

interface ResourcePool {
  name: string;
  maxConcurrent: number;
  currentActive: number;
  queue: Array<{ id: string; priority: number }>;
}

@Process({ name: 'resource-manager', version: '1.0.0' })
export default class ResourceManagerService {
  private pools = new Map<string, ResourcePool>();
  private activeRequests = new Map<string, Set<string>>();

  @Public()
  async createPool(name: string, maxConcurrent: number): Promise<void> {
    this.pools.set(name, {
      name,
      maxConcurrent,
      currentActive: 0,
      queue: []
    });
    this.activeRequests.set(name, new Set());
  }

  @Public()
  async acquireResource(poolName: string, requestId: string, priority: number = 0): Promise<{ acquired: boolean; waitTime?: number }> {
    const pool = this.pools.get(poolName);
    if (!pool) {
      throw new Error(`Pool ${poolName} not found`);
    }

    const activeSet = this.activeRequests.get(poolName)!;
    const startTime = Date.now();

    // Check if we can acquire immediately
    if (activeSet.size < pool.maxConcurrent) {
      activeSet.add(requestId);
      pool.currentActive = activeSet.size;
      return { acquired: true, waitTime: 0 };
    }

    // Add to queue
    pool.queue.push({ id: requestId, priority });
    pool.queue.sort((a, b) => b.priority - a.priority); // Higher priority first

    // Wait for resource to become available
    await new Promise(resolve => setTimeout(resolve, 50));

    // Try to acquire again (simplified for test)
    if (activeSet.size < pool.maxConcurrent) {
      activeSet.add(requestId);
      pool.currentActive = activeSet.size;
      pool.queue = pool.queue.filter(item => item.id !== requestId);
      return { acquired: true, waitTime: Date.now() - startTime };
    }

    return { acquired: false };
  }

  @Public()
  async releaseResource(poolName: string, requestId: string): Promise<void> {
    const pool = this.pools.get(poolName);
    if (!pool) return;

    const activeSet = this.activeRequests.get(poolName)!;
    activeSet.delete(requestId);
    pool.currentActive = activeSet.size;

    // Process queue if there are waiting requests
    if (pool.queue.length > 0 && activeSet.size < pool.maxConcurrent) {
      const nextRequest = pool.queue.shift();
      if (nextRequest) {
        activeSet.add(nextRequest.id);
        pool.currentActive = activeSet.size;
      }
    }
  }

  @Public()
  async getPoolStats(poolName: string): Promise<ResourcePool | null> {
    return this.pools.get(poolName) || null;
  }
}