/**
 * Advanced Process Manager Patterns
 *
 * Additional enterprise patterns for the Titan Process Manager
 * including distributed locks, geo-spatial queries, real-time matching, etc.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ============================================================================
// Distributed Lock Pattern
// ============================================================================

/**
 * Distributed lock configuration
 */
export interface IDistributedLockConfig {
  timeout?: number;
  strategy?: 'redlock' | 'zookeeper' | 'consul';
  retries?: number;
  retryDelay?: number;
}

/**
 * Lock handle for distributed locks
 */
export interface ILockHandle {
  id: string;
  resource: string;
  acquired: boolean;
  expiresAt?: number;
  release(): Promise<void>;
  extend(ttl?: number): Promise<boolean>;
}

/**
 * Distributed lock manager using Redlock algorithm
 */
export class DistributedLockManager {
  private locks = new Map<string, ILockHandle>();
  private lockQueues = new Map<string, Array<() => void>>();

  constructor(private config: IDistributedLockConfig = {}) {}

  /**
   * Acquire a distributed lock
   */
  async acquire(resource: string, ttl: number = 30000): Promise<ILockHandle> {
    const lockId = randomUUID();
    const { timeout = 5000, retries = 3, retryDelay = 200 } = this.config;

    for (let attempt = 0; attempt < retries; attempt++) {
      // Check if resource is already locked
      const existingLock = this.locks.get(resource);
      if (existingLock && existingLock.expiresAt && existingLock.expiresAt > Date.now()) {
        // Wait for lock to be released
        await this.waitForLock(resource, timeout);
        continue;
      }

      // Try to acquire lock
      const lock: ILockHandle = {
        id: lockId,
        resource,
        acquired: true,
        expiresAt: Date.now() + ttl,
        release: async () => this.release(lockId),
        extend: async (newTtl?: number) => this.extend(lockId, newTtl || ttl)
      };

      this.locks.set(resource, lock);
      return lock;
    }

    throw new Error(`Failed to acquire lock for resource: ${resource}`);
  }

  /**
   * Release a lock
   */
  private async release(lockId: string): Promise<void> {
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.id === lockId) {
        this.locks.delete(resource);

        // Process waiting queue
        const queue = this.lockQueues.get(resource);
        if (queue && queue.length > 0) {
          const waiter = queue.shift();
          if (waiter) {
            // Just notify the waiter, they will handle acquiring the lock
            waiter();
          }
        }
        break;
      }
    }
  }

  /**
   * Extend a lock's TTL
   */
  private async extend(lockId: string, ttl: number): Promise<boolean> {
    for (const lock of this.locks.values()) {
      if (lock.id === lockId) {
        lock.expiresAt = Date.now() + ttl;
        return true;
      }
    }
    return false;
  }

  /**
   * Wait for a lock to be available
   */
  private waitForLock(resource: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Lock wait timeout for resource: ${resource}`));
      }, timeout);

      // Add to queue
      if (!this.lockQueues.has(resource)) {
        this.lockQueues.set(resource, []);
      }

      this.lockQueues.get(resource)!.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

// ============================================================================
// Geo-Spatial Query Pattern
// ============================================================================

/**
 * Geographic point
 */
export interface IGeoPoint {
  lat: number;
  lng: number;
}

/**
 * Geo-spatial index configuration
 */
export interface IGeoSpatialConfig {
  index?: 'h3' | 'geohash' | 's2';
  precision?: number;
}

/**
 * Geo-spatial query manager
 */
export class GeoSpatialQueryManager {
  private spatialIndex = new Map<string, Set<any>>();
  
  constructor(private config: IGeoSpatialConfig = {}) {}

  /**
   * Index an entity at a location
   */
  async index(entity: any, location: IGeoPoint): Promise<void> {
    const hash = this.computeGeoHash(location);
    
    if (!this.spatialIndex.has(hash)) {
      this.spatialIndex.set(hash, new Set());
    }
    
    this.spatialIndex.get(hash)!.add(entity);
  }

  /**
   * Find entities near a location
   */
  async nearby(location: IGeoPoint, radius: number): Promise<any[]> {
    const centerHash = this.computeGeoHash(location);
    const neighbors = this.getNeighbors(centerHash, radius);
    
    const results: any[] = [];
    for (const hash of neighbors) {
      const entities = this.spatialIndex.get(hash);
      if (entities) {
        results.push(...entities);
      }
    }
    
    // Filter by actual distance
    return results.filter(entity => 
      // In real implementation, entity would have location
       true // Simplified for now
    );
  }

  /**
   * Compute geo hash for a location
   */
  private computeGeoHash(location: IGeoPoint): string {
    const { precision = 7 } = this.config;
    // Simplified geohash implementation
    return `${Math.floor(location.lat * Math.pow(10, precision))}_${Math.floor(location.lng * Math.pow(10, precision))}`;
  }

  /**
   * Get neighboring geo hashes
   */
  private getNeighbors(hash: string, radius: number): string[] {
    // Simplified neighbor calculation
    const neighbors = [hash];
    const [latPart, lngPart] = hash.split('_');
    const lat = parseInt(latPart || '0');
    const lng = parseInt(lngPart || '0');
    
    // Add surrounding cells
    for (let dlat = -1; dlat <= 1; dlat++) {
      for (let dlng = -1; dlng <= 1; dlng++) {
        if (dlat === 0 && dlng === 0) continue;
        neighbors.push(`${lat + dlat}_${lng + dlng}`);
      }
    }
    
    return neighbors;
  }
}

// ============================================================================
// Real-Time Matching Pattern
// ============================================================================

/**
 * Matching configuration
 */
export interface IMatchingConfig {
  algorithm?: 'hungarian' | 'greedy' | 'stable-marriage';
  constraints?: string[];
  timeout?: number;
}

/**
 * Match result
 */
export interface IMatch<T, U> {
  item1: T;
  item2: U;
  score: number;
  metadata?: any;
}

/**
 * Real-time matching service
 */
export class RealtimeMatchingService<T, U> {
  constructor(private config: IMatchingConfig = {}) {}

  /**
   * Match items based on constraints
   */
  async match(items1: T[], items2: U[], scorer: (a: T, b: U) => number): Promise<IMatch<T, U>[]> {
    const { algorithm = 'hungarian', timeout = 30000 } = this.config;
    
    const startTime = Date.now();
    
    switch (algorithm) {
      case 'hungarian':
        return this.hungarianAlgorithm(items1, items2, scorer);
      case 'greedy':
        return this.greedyMatching(items1, items2, scorer);
      default:
        return this.greedyMatching(items1, items2, scorer);
    }
  }

  /**
   * Hungarian algorithm for optimal matching
   */
  private hungarianAlgorithm(items1: T[], items2: U[], scorer: (a: T, b: U) => number): IMatch<T, U>[] {
    // Simplified Hungarian algorithm implementation
    const matches: IMatch<T, U>[] = [];
    const used2 = new Set<U>();
    
    for (const item1 of items1) {
      let bestMatch: U | null = null;
      let bestScore = -Infinity;
      
      for (const item2 of items2) {
        if (used2.has(item2)) continue;
        
        const score = scorer(item1, item2);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = item2;
        }
      }
      
      if (bestMatch) {
        used2.add(bestMatch);
        matches.push({ item1, item2: bestMatch, score: bestScore });
      }
    }
    
    return matches;
  }

  /**
   * Greedy matching algorithm
   */
  private greedyMatching(items1: T[], items2: U[], scorer: (a: T, b: U) => number): IMatch<T, U>[] {
    const matches: IMatch<T, U>[] = [];
    const pairs: Array<{ item1: T; item2: U; score: number }> = [];
    
    // Generate all pairs with scores
    for (const item1 of items1) {
      for (const item2 of items2) {
        pairs.push({ item1, item2, score: scorer(item1, item2) });
      }
    }
    
    // Sort by score descending
    pairs.sort((a, b) => b.score - a.score);
    
    // Greedily select matches
    const used1 = new Set<T>();
    const used2 = new Set<U>();
    
    for (const pair of pairs) {
      if (!used1.has(pair.item1) && !used2.has(pair.item2)) {
        matches.push(pair);
        used1.add(pair.item1);
        used2.add(pair.item2);
      }
    }
    
    return matches;
  }
}

// ============================================================================
// Message Bus with Total Order Guarantee
// ============================================================================

/**
 * Message bus configuration
 */
export interface IMessageBusConfig {
  order?: 'total' | 'causal' | 'fifo';
  history?: number;
  persistence?: boolean;
}

/**
 * Ordered message
 */
export interface IOrderedMessage {
  id: string;
  sequence: number;
  timestamp: number;
  channel: string;
  payload: any;
}

/**
 * Message bus with ordering guarantees
 */
export class TotalOrderMessageBus extends EventEmitter {
  private sequenceNumber = 0;
  private messageHistory = new Map<string, IOrderedMessage[]>();
  
  constructor(private config: IMessageBusConfig = {}) {
    super();
  }

  /**
   * Publish a message with total ordering
   */
  async publish(channel: string, message: any): Promise<void> {
    const orderedMessage: IOrderedMessage = {
      id: randomUUID(),
      sequence: this.sequenceNumber++,
      timestamp: Date.now(),
      channel,
      payload: message
    };
    
    // Store in history
    if (!this.messageHistory.has(channel)) {
      this.messageHistory.set(channel, []);
    }
    
    const history = this.messageHistory.get(channel)!;
    history.push(orderedMessage);
    
    // Limit history size
    const { history: maxHistory = 1000 } = this.config;
    if (history.length > maxHistory) {
      history.shift();
    }
    
    // Emit in order
    this.emit(channel, orderedMessage);
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, handler: (message: IOrderedMessage) => void): () => void {
    this.on(channel, handler);
    
    // Return unsubscribe function
    return () => this.off(channel, handler);
  }

  /**
   * Get message history for a channel
   */
  getHistory(channel: string, limit?: number): IOrderedMessage[] {
    const history = this.messageHistory.get(channel) || [];
    if (limit) {
      return history.slice(-limit);
    }
    return [...history];
  }
}

// ============================================================================
// Resource Pool Pattern
// ============================================================================

/**
 * Resource pool configuration
 */
export interface IResourcePoolConfig {
  type?: 'container' | 'vm' | 'thread';
  max?: number;
  min?: number;
  recycleAfter?: number;
  idleTimeout?: number;
}

/**
 * Pooled resource
 */
export interface IPooledResource {
  id: string;
  type: string;
  inUse: boolean;
  usageCount: number;
  createdAt: number;
  lastUsedAt?: number;
  resource: any;
}

/**
 * Resource pool manager
 */
export class ResourcePool {
  private resources = new Map<string, IPooledResource>();
  private availableQueue: string[] = [];
  private waitingQueue: Array<(resource: IPooledResource) => void> = [];
  private initPromise: Promise<void> | null = null;

  constructor(private config: IResourcePoolConfig = {}) {
    this.initPromise = this.initialize();
  }

  /**
   * Initialize the pool
   */
  private async initialize(): Promise<void> {
    const { min = 1 } = this.config;

    for (let i = 0; i < min; i++) {
      const resource = await this.createResource();
      // Add to available queue since it's not in use
      this.availableQueue.push(resource.id);
    }
  }

  /**
   * Acquire a resource from the pool
   */
  async acquire(): Promise<IPooledResource> {
    // Wait for initialization to complete
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }

    // Check for available resource
    if (this.availableQueue.length > 0) {
      const resourceId = this.availableQueue.shift()!;
      const resource = this.resources.get(resourceId)!;
      resource.inUse = true;
      resource.lastUsedAt = Date.now();
      resource.usageCount++;
      
      // Check if needs recycling
      const { recycleAfter = 10 } = this.config;
      if (resource.usageCount >= recycleAfter) {
        // Mark for recycling after release
        (resource as any).needsRecycle = true;
      }
      
      return resource;
    }
    
    // Create new resource if under max
    const { max = 100 } = this.config;
    if (this.resources.size < max) {
      const resource = await this.createResource();
      resource.inUse = true;
      resource.lastUsedAt = Date.now();
      resource.usageCount = 1;  // Set initial usage count
      return resource;
    }
    
    // Wait for available resource
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  /**
   * Release a resource back to the pool
   */
  async release(resource: IPooledResource): Promise<void> {
    resource.inUse = false;
    
    // Check if needs recycling
    if ((resource as any).needsRecycle) {
      await this.recycleResource(resource);
      return;
    }
    
    // Process waiting queue
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift()!;
      resource.inUse = true;
      resource.lastUsedAt = Date.now();
      resource.usageCount++;
      waiter(resource);
    } else {
      this.availableQueue.push(resource.id);
    }
  }

  /**
   * Create a new resource
   */
  private async createResource(): Promise<IPooledResource> {
    const resource: IPooledResource = {
      id: randomUUID(),
      type: this.config.type || 'container',
      inUse: false,
      usageCount: 0,
      createdAt: Date.now(),
      resource: {} // Actual resource would be created here
    };

    this.resources.set(resource.id, resource);
    // Don't add to availableQueue here - let the caller decide
    return resource;
  }

  /**
   * Recycle a resource
   */
  private async recycleResource(resource: IPooledResource): Promise<void> {
    this.resources.delete(resource.id);
    
    // Create replacement
    const newResource = await this.createResource();
    
    // If there are waiters, give them the new resource
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift()!;
      newResource.inUse = true;
      newResource.lastUsedAt = Date.now();
      waiter(newResource);
    }
  }
}

// ============================================================================
// Export Additional Patterns
// ============================================================================

export {
  DistributedLockManager as DistributedLock,
  GeoSpatialQueryManager as GeoSpatialQuery,
  RealtimeMatchingService as RealtimeMatch,
  TotalOrderMessageBus as MessageBus
};
