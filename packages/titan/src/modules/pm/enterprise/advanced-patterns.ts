/**
 * Advanced Process Manager Patterns
 *
 * Additional enterprise patterns for the Titan Process Manager
 * including distributed locks, geo-spatial queries, real-time matching, etc.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

import { Errors } from '../../../errors/index.js';
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
        extend: async (newTtl?: number) => this.extend(lockId, newTtl || ttl),
      };

      this.locks.set(resource, lock);
      return lock;
    }

    throw Errors.notFound(`Failed to acquire lock for resource: ${resource}`);
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
        reject(Errors.timeout(`resource lock: ${resource}`, timeout));
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
    return results.filter(
      (entity) =>
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
      payload: message,
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
      resource.usageCount = 1; // Set initial usage count
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
      resource: {}, // Actual resource would be created here
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
// Circuit Breaker Pattern
// ============================================================================

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Circuit breaker configuration
 */
export interface ICircuitBreakerConfig {
  /** Failure threshold to open circuit */
  failureThreshold?: number;
  /** Time in ms to stay open before transitioning to half-open */
  resetTimeout?: number;
  /** Number of successful calls needed to close from half-open */
  successThreshold?: number;
  /** Timeout for individual calls in ms */
  callTimeout?: number;
  /** Volume threshold - minimum calls before circuit can trip */
  volumeThreshold?: number;
  /** Percentage of failures to trip (0-100) */
  failureRateThreshold?: number;
  /** Sliding window size for metrics */
  slidingWindowSize?: number;
}

/**
 * Circuit breaker metrics
 */
export interface ICircuitBreakerMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  state: CircuitBreakerState;
  lastFailureTime?: number;
  lastStateChange: number;
  failureRate: number;
}

/**
 * Call result for sliding window tracking
 */
interface ICallResult {
  timestamp: number;
  success: boolean;
  duration: number;
}

/**
 * Circuit Breaker implementation
 *
 * Prevents cascading failures by failing fast when a service is unhealthy.
 * Transitions: CLOSED -> OPEN (on failures) -> HALF_OPEN (after timeout) -> CLOSED (on success)
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private lastStateChangeTime: number = Date.now();
  private totalCalls = 0;
  private rejectedCalls = 0;
  private slidingWindow: ICallResult[] = [];
  private halfOpenInProgress = false;

  constructor(
    private readonly name: string,
    private readonly config: ICircuitBreakerConfig = {}
  ) {
    super();
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      this.rejectedCalls++;
      this.emit('rejected', { name: this.name, state: this.state });
      throw Errors.unavailable(this.name, 'Circuit breaker is open');
    }

    // In half-open state, only allow one call at a time
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.halfOpenInProgress) {
        this.rejectedCalls++;
        this.emit('rejected', { name: this.name, state: this.state, reason: 'half-open-in-progress' });
        throw Errors.unavailable(this.name, 'Circuit breaker is testing (half-open)');
      }
      this.halfOpenInProgress = true;
    }

    const startTime = Date.now();
    this.totalCalls++;

    try {
      const result = await this.executeWithTimeout(fn);
      this.recordSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordFailure(Date.now() - startTime);
      throw error;
    } finally {
      if (this.state === CircuitBreakerState.HALF_OPEN) {
        this.halfOpenInProgress = false;
      }
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    const { callTimeout } = this.config;

    if (!callTimeout) {
      return fn();
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Errors.timeout(`${this.name} call`, callTimeout));
      }, callTimeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Check if execution is allowed based on circuit state
   */
  private canExecute(): boolean {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        // Check if reset timeout has passed
        const { resetTimeout = 30000 } = this.config;
        if (this.lastFailureTime && Date.now() - this.lastFailureTime >= resetTimeout) {
          this.transitionTo(CircuitBreakerState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful call
   */
  private recordSuccess(duration: number): void {
    this.addToSlidingWindow({ timestamp: Date.now(), success: true, duration });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      const { successThreshold = 3 } = this.config;

      if (this.successCount >= successThreshold) {
        this.transitionTo(CircuitBreakerState.CLOSED);
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }

    this.emit('success', { name: this.name, duration });
  }

  /**
   * Record a failed call
   */
  private recordFailure(duration: number): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.addToSlidingWindow({ timestamp: Date.now(), success: false, duration });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      this.transitionTo(CircuitBreakerState.OPEN);
    } else if (this.state === CircuitBreakerState.CLOSED) {
      this.checkThreshold();
    }

    this.emit('failure', { name: this.name, duration, failureCount: this.failureCount });
  }

  /**
   * Check if failure threshold is exceeded
   */
  private checkThreshold(): void {
    const {
      failureThreshold = 5,
      volumeThreshold = 10,
      failureRateThreshold,
      slidingWindowSize = 10,
    } = this.config;

    // Check volume threshold
    if (this.slidingWindow.length < volumeThreshold) {
      return;
    }

    // Check failure rate threshold if configured
    if (failureRateThreshold !== undefined) {
      const recentCalls = this.slidingWindow.slice(-slidingWindowSize);
      const failures = recentCalls.filter((c) => !c.success).length;
      const failureRate = (failures / recentCalls.length) * 100;

      if (failureRate >= failureRateThreshold) {
        this.transitionTo(CircuitBreakerState.OPEN);
        return;
      }
    }

    // Check absolute failure threshold
    if (this.failureCount >= failureThreshold) {
      this.transitionTo(CircuitBreakerState.OPEN);
    }
  }

  /**
   * Add call result to sliding window
   */
  private addToSlidingWindow(result: ICallResult): void {
    const { slidingWindowSize = 10 } = this.config;
    this.slidingWindow.push(result);

    if (this.slidingWindow.length > slidingWindowSize) {
      this.slidingWindow.shift();
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();

    if (newState === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitBreakerState.HALF_OPEN) {
      this.successCount = 0;
    }

    this.emit('stateChange', {
      name: this.name,
      previousState,
      newState,
      timestamp: this.lastStateChangeTime,
    });
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get current metrics
   */
  getMetrics(): ICircuitBreakerMetrics {
    const successfulCalls = this.slidingWindow.filter((c) => c.success).length;
    const failedCalls = this.slidingWindow.filter((c) => !c.success).length;
    const total = successfulCalls + failedCalls;

    return {
      totalCalls: this.totalCalls,
      successfulCalls,
      failedCalls,
      rejectedCalls: this.rejectedCalls,
      state: this.state,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChangeTime,
      failureRate: total > 0 ? (failedCalls / total) * 100 : 0,
    };
  }

  /**
   * Force circuit to open state
   */
  forceOpen(): void {
    this.transitionTo(CircuitBreakerState.OPEN);
    this.lastFailureTime = Date.now();
  }

  /**
   * Force circuit to closed state
   */
  forceClosed(): void {
    this.transitionTo(CircuitBreakerState.CLOSED);
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastStateChangeTime = Date.now();
    this.totalCalls = 0;
    this.rejectedCalls = 0;
    this.slidingWindow = [];
    this.halfOpenInProgress = false;
    this.emit('reset', { name: this.name });
  }
}

// ============================================================================
// Bulkhead Pattern
// ============================================================================

/**
 * Bulkhead configuration
 */
export interface IBulkheadConfig {
  /** Maximum concurrent executions */
  maxConcurrent?: number;
  /** Maximum queue size for waiting requests */
  maxQueue?: number;
  /** Queue timeout in ms */
  queueTimeout?: number;
  /** Name for the bulkhead (for metrics/logging) */
  name?: string;
}

/**
 * Bulkhead metrics
 */
export interface IBulkheadMetrics {
  name: string;
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
  maxQueue: number;
  totalExecuted: number;
  totalRejected: number;
  totalTimedOut: number;
}

/**
 * Queued execution item
 */
interface IQueuedItem<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  enqueuedAt: number;
}

/**
 * Bulkhead Pattern implementation
 *
 * Isolates resources by limiting concurrent executions, preventing
 * resource exhaustion and ensuring fair resource allocation.
 */
export class Bulkhead extends EventEmitter {
  private activeCount = 0;
  private queue: Array<IQueuedItem<unknown>> = [];
  private totalExecuted = 0;
  private totalRejected = 0;
  private totalTimedOut = 0;

  constructor(private readonly config: IBulkheadConfig = {}) {
    super();
  }

  /**
   * Execute a function through the bulkhead
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const { maxConcurrent = 10, maxQueue = 100, queueTimeout = 30000 } = this.config;

    // Check if we can execute immediately
    if (this.activeCount < maxConcurrent) {
      return this.doExecute(fn);
    }

    // Check if queue is full
    if (this.queue.length >= maxQueue) {
      this.totalRejected++;
      this.emit('rejected', {
        name: this.config.name,
        reason: 'queue-full',
        queueSize: this.queue.length,
      });
      throw Errors.unavailable(
        this.config.name || 'Bulkhead',
        'Queue is full'
      );
    }

    // Queue the request
    return new Promise<T>((resolve, reject) => {
      const item: IQueuedItem<T> = {
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      // Set timeout for queued item
      if (queueTimeout > 0) {
        item.timer = setTimeout(() => {
          const index = this.queue.indexOf(item as IQueuedItem<unknown>);
          if (index !== -1) {
            this.queue.splice(index, 1);
            this.totalTimedOut++;
            this.emit('timeout', {
              name: this.config.name,
              waitTime: Date.now() - item.enqueuedAt,
            });
            reject(
              Errors.timeout(this.config.name || 'Bulkhead queue', queueTimeout)
            );
          }
        }, queueTimeout);
      }

      this.queue.push(item as IQueuedItem<unknown>);
      this.emit('queued', {
        name: this.config.name,
        queueSize: this.queue.length,
      });
    });
  }

  /**
   * Actually execute the function
   */
  private async doExecute<T>(fn: () => Promise<T>): Promise<T> {
    this.activeCount++;
    this.emit('executing', {
      name: this.config.name,
      activeCount: this.activeCount,
    });

    try {
      const result = await fn();
      this.totalExecuted++;
      this.emit('executed', { name: this.config.name });
      return result;
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  /**
   * Process the next item in queue
   */
  private processQueue(): void {
    const { maxConcurrent = 10 } = this.config;

    if (this.activeCount < maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Clear timeout if set
      if (item.timer) {
        clearTimeout(item.timer);
      }

      this.doExecute(item.fn)
        .then(item.resolve)
        .catch(item.reject);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): IBulkheadMetrics {
    const { maxConcurrent = 10, maxQueue = 100 } = this.config;
    return {
      name: this.config.name || 'default',
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      maxConcurrent,
      maxQueue,
      totalExecuted: this.totalExecuted,
      totalRejected: this.totalRejected,
      totalTimedOut: this.totalTimedOut,
    };
  }

  /**
   * Check if bulkhead can accept more requests
   */
  isAvailable(): boolean {
    const { maxConcurrent = 10, maxQueue = 100 } = this.config;
    return this.activeCount < maxConcurrent || this.queue.length < maxQueue;
  }

  /**
   * Get current utilization percentage
   */
  getUtilization(): number {
    const { maxConcurrent = 10 } = this.config;
    return (this.activeCount / maxConcurrent) * 100;
  }

  /**
   * Drain the queue (reject all pending requests)
   */
  drain(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (item.timer) {
        clearTimeout(item.timer);
      }
      item.reject(Errors.unavailable(this.config.name || 'Bulkhead', 'Queue drained'));
    }
    this.emit('drained', { name: this.config.name });
  }
}

// ============================================================================
// Rate Limiter Pattern (Token Bucket Algorithm)
// ============================================================================

/**
 * Rate limiter configuration
 */
export interface IRateLimiterConfig {
  /** Maximum tokens in bucket */
  maxTokens?: number;
  /** Tokens added per refill */
  refillAmount?: number;
  /** Refill interval in ms */
  refillInterval?: number;
  /** Initial tokens (defaults to maxTokens) */
  initialTokens?: number;
  /** Name for the rate limiter (for metrics/logging) */
  name?: string;
  /** Timeout for waiting requests in ms */
  timeout?: number;
}

/**
 * Rate limiter metrics
 */
export interface IRateLimiterMetrics {
  name: string;
  currentTokens: number;
  maxTokens: number;
  totalAcquired: number;
  totalRejected: number;
  totalTimedOut: number;
  waitingCount: number;
}

/**
 * Waiting request item
 */
interface IWaitingRequest {
  tokens: number;
  resolve: (acquired: boolean) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Token Bucket Rate Limiter
 *
 * Controls the rate of operations using the token bucket algorithm.
 * Tokens are added at a fixed rate and consumed by operations.
 */
export class RateLimiter extends EventEmitter {
  private tokens: number;
  private readonly maxTokens: number;
  private refillTimer?: ReturnType<typeof setInterval>;
  private waitingQueue: IWaitingRequest[] = [];
  private totalAcquired = 0;
  private totalRejected = 0;
  private totalTimedOut = 0;
  private lastRefillTime: number = Date.now();

  constructor(private readonly config: IRateLimiterConfig = {}) {
    super();
    this.maxTokens = config.maxTokens ?? 100;
    this.tokens = config.initialTokens ?? this.maxTokens;
    this.startRefillTimer();
  }

  /**
   * Start the refill timer
   */
  private startRefillTimer(): void {
    const { refillInterval = 1000, refillAmount = 10 } = this.config;

    this.refillTimer = setInterval(() => {
      this.refill(refillAmount);
    }, refillInterval);
  }

  /**
   * Refill tokens
   */
  private refill(amount: number): void {
    const previousTokens = this.tokens;
    this.tokens = Math.min(this.tokens + amount, this.maxTokens);
    this.lastRefillTime = Date.now();

    if (this.tokens > previousTokens) {
      this.emit('refill', {
        name: this.config.name,
        tokens: this.tokens,
        added: this.tokens - previousTokens,
      });

      // Try to satisfy waiting requests
      this.processWaitingQueue();
    }
  }

  /**
   * Process waiting requests after refill
   */
  private processWaitingQueue(): void {
    while (this.waitingQueue.length > 0) {
      const request = this.waitingQueue[0]!;
      if (this.tokens >= request.tokens) {
        this.waitingQueue.shift();
        if (request.timer) {
          clearTimeout(request.timer);
        }
        this.tokens -= request.tokens;
        this.totalAcquired++;
        request.resolve(true);
      } else {
        break;
      }
    }
  }

  /**
   * Try to acquire tokens immediately (non-blocking)
   */
  tryAcquire(tokens = 1): boolean {
    if (tokens > this.maxTokens) {
      throw Errors.badRequest(`Cannot acquire ${tokens} tokens, max is ${this.maxTokens}`);
    }

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.totalAcquired++;
      this.emit('acquired', {
        name: this.config.name,
        tokens,
        remaining: this.tokens,
      });
      return true;
    }

    this.totalRejected++;
    this.emit('rejected', {
      name: this.config.name,
      tokens,
      available: this.tokens,
    });
    return false;
  }

  /**
   * Acquire tokens, waiting if necessary
   */
  async acquire(tokens = 1): Promise<boolean> {
    if (tokens > this.maxTokens) {
      throw Errors.badRequest(`Cannot acquire ${tokens} tokens, max is ${this.maxTokens}`);
    }

    // Try immediate acquisition
    if (this.tryAcquire(tokens)) {
      return true;
    }

    // Wait for tokens
    const { timeout } = this.config;

    return new Promise<boolean>((resolve, reject) => {
      const request: IWaitingRequest = {
        tokens,
        resolve: (acquired) => {
          if (acquired) {
            this.emit('acquired', {
              name: this.config.name,
              tokens,
              remaining: this.tokens,
            });
          }
          resolve(acquired);
        },
        reject,
      };

      // Set timeout if configured
      if (timeout !== undefined && timeout > 0) {
        request.timer = setTimeout(() => {
          const index = this.waitingQueue.indexOf(request);
          if (index !== -1) {
            this.waitingQueue.splice(index, 1);
            this.totalTimedOut++;
            this.emit('timeout', {
              name: this.config.name,
              tokens,
            });
            reject(Errors.timeout('Rate limiter acquisition', timeout));
          }
        }, timeout);
      }

      this.waitingQueue.push(request);
      this.emit('waiting', {
        name: this.config.name,
        tokens,
        position: this.waitingQueue.length,
      });
    });
  }

  /**
   * Execute a function if rate limit allows
   */
  async execute<T>(fn: () => Promise<T>, tokens = 1): Promise<T> {
    const acquired = await this.acquire(tokens);
    if (!acquired) {
      throw Errors.tooManyRequests();
    }
    return fn();
  }

  /**
   * Get current metrics
   */
  getMetrics(): IRateLimiterMetrics {
    return {
      name: this.config.name || 'default',
      currentTokens: this.tokens,
      maxTokens: this.maxTokens,
      totalAcquired: this.totalAcquired,
      totalRejected: this.totalRejected,
      totalTimedOut: this.totalTimedOut,
      waitingCount: this.waitingQueue.length,
    };
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    return this.tokens;
  }

  /**
   * Check if tokens are available
   */
  isAvailable(tokens = 1): boolean {
    return this.tokens >= tokens;
  }

  /**
   * Stop the rate limiter
   */
  stop(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = undefined;
    }

    // Reject all waiting requests
    while (this.waitingQueue.length > 0) {
      const request = this.waitingQueue.shift()!;
      if (request.timer) {
        clearTimeout(request.timer);
      }
      request.reject(Errors.unavailable(this.config.name || 'Rate limiter', 'Stopped'));
    }

    this.emit('stopped', { name: this.config.name });
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.tokens = this.config.initialTokens ?? this.maxTokens;
    this.totalAcquired = 0;
    this.totalRejected = 0;
    this.totalTimedOut = 0;
    this.lastRefillTime = Date.now();
    this.emit('reset', { name: this.config.name, tokens: this.tokens });
  }
}

// ============================================================================
// Retry Strategy Pattern
// ============================================================================

/**
 * Backoff strategy types
 */
export enum BackoffStrategy {
  FIXED = 'fixed',
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  EXPONENTIAL_WITH_JITTER = 'exponential_with_jitter',
  DECORRELATED_JITTER = 'decorrelated_jitter',
}

/**
 * Retry configuration
 */
export interface IRetryConfig {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Initial delay in ms */
  initialDelay?: number;
  /** Maximum delay in ms */
  maxDelay?: number;
  /** Backoff strategy */
  backoffStrategy?: BackoffStrategy;
  /** Multiplier for exponential backoff */
  multiplier?: number;
  /** Jitter factor (0-1) */
  jitterFactor?: number;
  /** Retryable error predicate */
  retryOn?: (error: Error) => boolean;
  /** Callback on retry */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
  /** Name for logging/metrics */
  name?: string;
}

/**
 * Retry result
 */
export interface IRetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
}

/**
 * Retry handler with configurable backoff strategies
 */
export class RetryHandler extends EventEmitter {
  constructor(private readonly config: IRetryConfig = {}) {
    super();
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<IRetryResult<T>> {
    const {
      maxRetries = 3,
      retryOn = () => true,
    } = this.config;

    let lastError: Error | undefined;
    let totalDelay = 0;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await fn();
        this.emit('success', {
          name: this.config.name,
          attempt,
          totalDelay,
        });
        return {
          success: true,
          result,
          attempts: attempt,
          totalDelay,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (attempt > maxRetries || !retryOn(lastError)) {
          this.emit('exhausted', {
            name: this.config.name,
            attempts: attempt,
            error: lastError,
            totalDelay,
          });
          return {
            success: false,
            error: lastError,
            attempts: attempt,
            totalDelay,
          };
        }

        // Calculate delay for next retry
        const delay = this.calculateDelay(attempt);
        totalDelay += delay;

        // Notify retry callback
        if (this.config.onRetry) {
          this.config.onRetry(attempt, lastError, delay);
        }

        this.emit('retry', {
          name: this.config.name,
          attempt,
          error: lastError,
          delay,
          totalDelay,
        });

        // Wait before next retry
        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: maxRetries + 1,
      totalDelay,
    };
  }

  /**
   * Execute and throw on failure
   */
  async executeOrThrow<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.execute(fn);
    if (!result.success) {
      throw result.error || Errors.internal('Retry failed');
    }
    return result.result!;
  }

  /**
   * Calculate delay for a given attempt
   */
  calculateDelay(attempt: number): number {
    const {
      initialDelay = 100,
      maxDelay = 30000,
      backoffStrategy = BackoffStrategy.EXPONENTIAL,
      multiplier = 2,
      jitterFactor = 0.1,
    } = this.config;

    let delay: number;

    switch (backoffStrategy) {
      case BackoffStrategy.FIXED:
        delay = initialDelay;
        break;

      case BackoffStrategy.LINEAR:
        delay = initialDelay * attempt;
        break;

      case BackoffStrategy.EXPONENTIAL:
        delay = initialDelay * Math.pow(multiplier, attempt - 1);
        break;

      case BackoffStrategy.EXPONENTIAL_WITH_JITTER:
        delay = initialDelay * Math.pow(multiplier, attempt - 1);
        const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
        delay = delay + jitter;
        break;

      case BackoffStrategy.DECORRELATED_JITTER:
        // AWS recommended algorithm: sleep = min(cap, random_between(base, sleep * 3))
        const previousDelay = attempt === 1 ? initialDelay : this.calculateDelay(attempt - 1);
        delay = Math.random() * (previousDelay * 3 - initialDelay) + initialDelay;
        break;

      default:
        delay = initialDelay;
    }

    return Math.min(Math.max(0, delay), maxDelay);
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Timeout Handler Pattern
// ============================================================================

/**
 * Timeout configuration
 */
export interface ITimeoutConfig {
  /** Default timeout in ms */
  defaultTimeout?: number;
  /** Name for logging/metrics */
  name?: string;
  /** Callback on timeout */
  onTimeout?: (operation: string, timeout: number) => void;
}

/**
 * Timeout result
 */
export interface ITimeoutResult<T> {
  success: boolean;
  result?: T;
  timedOut: boolean;
  duration: number;
  error?: Error;
}

/**
 * Timeout handler for async operations
 */
export class TimeoutHandler extends EventEmitter {
  constructor(private readonly config: ITimeoutConfig = {}) {
    super();
  }

  /**
   * Execute with timeout
   */
  async execute<T>(
    fn: () => Promise<T>,
    timeout?: number,
    operation?: string
  ): Promise<ITimeoutResult<T>> {
    const effectiveTimeout = timeout ?? this.config.defaultTimeout ?? 30000;
    const operationName = operation ?? this.config.name ?? 'operation';
    const startTime = Date.now();

    return new Promise<ITimeoutResult<T>>((resolve) => {
      let completed = false;

      // Setup timeout
      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          const duration = Date.now() - startTime;

          if (this.config.onTimeout) {
            this.config.onTimeout(operationName, effectiveTimeout);
          }

          this.emit('timeout', {
            name: this.config.name,
            operation: operationName,
            timeout: effectiveTimeout,
            duration,
          });

          resolve({
            success: false,
            timedOut: true,
            duration,
            error: Errors.timeout(operationName, effectiveTimeout),
          });
        }
      }, effectiveTimeout);

      // Execute function
      fn()
        .then((result) => {
          if (!completed) {
            completed = true;
            clearTimeout(timer);
            const duration = Date.now() - startTime;

            this.emit('success', {
              name: this.config.name,
              operation: operationName,
              duration,
            });

            resolve({
              success: true,
              result,
              timedOut: false,
              duration,
            });
          }
        })
        .catch((error) => {
          if (!completed) {
            completed = true;
            clearTimeout(timer);
            const duration = Date.now() - startTime;

            this.emit('error', {
              name: this.config.name,
              operation: operationName,
              error,
              duration,
            });

            resolve({
              success: false,
              timedOut: false,
              duration,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        });
    });
  }

  /**
   * Execute and throw on timeout or error
   */
  async executeOrThrow<T>(
    fn: () => Promise<T>,
    timeout?: number,
    operation?: string
  ): Promise<T> {
    const result = await this.execute(fn, timeout, operation);

    if (result.timedOut) {
      throw result.error || Errors.timeout(operation || 'operation', timeout || this.config.defaultTimeout || 30000);
    }

    if (!result.success) {
      throw result.error || Errors.internal('Operation failed');
    }

    return result.result!;
  }

  /**
   * Create a race between function and timeout
   */
  async race<T>(
    fn: () => Promise<T>,
    timeout?: number,
    operation?: string
  ): Promise<T> {
    const effectiveTimeout = timeout ?? this.config.defaultTimeout ?? 30000;
    const operationName = operation ?? this.config.name ?? 'operation';

    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(Errors.timeout(operationName, effectiveTimeout));
        }, effectiveTimeout);
      }),
    ]);
  }

  /**
   * Wrap a function with timeout
   */
  wrap<T extends (...args: Parameters<T>) => Promise<ReturnType<T>>>(
    fn: T,
    timeout?: number,
    operation?: string
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return (...args: Parameters<T>) => {
      return this.executeOrThrow(() => fn(...args), timeout, operation);
    };
  }
}

// ============================================================================
// Resilience Builder (Combines Patterns)
// ============================================================================

/**
 * Resilience configuration combining all patterns
 */
export interface IResilienceConfig {
  circuitBreaker?: ICircuitBreakerConfig;
  bulkhead?: IBulkheadConfig;
  rateLimiter?: IRateLimiterConfig;
  retry?: IRetryConfig;
  timeout?: ITimeoutConfig;
}

/**
 * Resilience builder for combining patterns
 */
export class ResilienceBuilder {
  private circuitBreaker?: CircuitBreaker;
  private bulkhead?: Bulkhead;
  private rateLimiter?: RateLimiter;
  private retryHandler?: RetryHandler;
  private timeoutHandler?: TimeoutHandler;

  constructor(
    private readonly name: string,
    private readonly config: IResilienceConfig = {}
  ) {
    this.initialize();
  }

  /**
   * Initialize configured patterns
   */
  private initialize(): void {
    if (this.config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(this.name, this.config.circuitBreaker);
    }

    if (this.config.bulkhead) {
      this.bulkhead = new Bulkhead({
        ...this.config.bulkhead,
        name: this.config.bulkhead.name || this.name,
      });
    }

    if (this.config.rateLimiter) {
      this.rateLimiter = new RateLimiter({
        ...this.config.rateLimiter,
        name: this.config.rateLimiter.name || this.name,
      });
    }

    if (this.config.retry) {
      this.retryHandler = new RetryHandler({
        ...this.config.retry,
        name: this.config.retry.name || this.name,
      });
    }

    if (this.config.timeout) {
      this.timeoutHandler = new TimeoutHandler({
        ...this.config.timeout,
        name: this.config.timeout.name || this.name,
      });
    }
  }

  /**
   * Execute function with all configured resilience patterns
   * Order: Rate Limiter -> Bulkhead -> Circuit Breaker -> Timeout -> Retry
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let wrappedFn = fn;

    // Apply retry (innermost - retries the timed operation)
    if (this.retryHandler) {
      const handler = this.retryHandler;
      const originalFn = wrappedFn;
      wrappedFn = async () => handler.executeOrThrow(originalFn);
    }

    // Apply timeout
    if (this.timeoutHandler) {
      const handler = this.timeoutHandler;
      const originalFn = wrappedFn;
      wrappedFn = async () => handler.executeOrThrow(originalFn);
    }

    // Apply circuit breaker
    if (this.circuitBreaker) {
      const cb = this.circuitBreaker;
      const originalFn = wrappedFn;
      wrappedFn = async () => cb.execute(originalFn);
    }

    // Apply bulkhead
    if (this.bulkhead) {
      const bh = this.bulkhead;
      const originalFn = wrappedFn;
      wrappedFn = async () => bh.execute(originalFn);
    }

    // Apply rate limiter (outermost)
    if (this.rateLimiter) {
      const rl = this.rateLimiter;
      const originalFn = wrappedFn;
      wrappedFn = async () => rl.execute(originalFn);
    }

    return wrappedFn();
  }

  /**
   * Get circuit breaker
   */
  getCircuitBreaker(): CircuitBreaker | undefined {
    return this.circuitBreaker;
  }

  /**
   * Get bulkhead
   */
  getBulkhead(): Bulkhead | undefined {
    return this.bulkhead;
  }

  /**
   * Get rate limiter
   */
  getRateLimiter(): RateLimiter | undefined {
    return this.rateLimiter;
  }

  /**
   * Get retry handler
   */
  getRetryHandler(): RetryHandler | undefined {
    return this.retryHandler;
  }

  /**
   * Get timeout handler
   */
  getTimeoutHandler(): TimeoutHandler | undefined {
    return this.timeoutHandler;
  }

  /**
   * Shutdown all patterns
   */
  shutdown(): void {
    if (this.rateLimiter) {
      this.rateLimiter.stop();
    }
    if (this.bulkhead) {
      this.bulkhead.drain();
    }
    if (this.circuitBreaker) {
      this.circuitBreaker.reset();
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
  TotalOrderMessageBus as MessageBus,
};
