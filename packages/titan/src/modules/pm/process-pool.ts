/**
 * Process Pool Implementation
 *
 * Comprehensive process pool with advanced load balancing, auto-scaling,
 * monitoring, and all features specified in the PM specification.
 */

import { cpus } from 'os';
import { EventEmitter } from 'events';
import type { ILogger } from '../logger/logger.types.js';
import type {
  IProcessPool,
  IProcessPoolOptions,
  ServiceProxy,
  IPoolMetrics,
  IProcessManager,
  IProcessMetrics,
  IHealthStatus
} from './types.js';
import { PoolStrategy, ProcessStatus } from './types.js';

/**
 * Worker information tracking
 */
interface WorkerInfo<T> {
  id: string;
  proxy: ServiceProxy<T>;
  requests: number;
  totalRequestTime: number;
  lastUsed: number;
  created: number;
  health: 'healthy' | 'unhealthy' | 'degraded';
  currentLoad: number;
  processing: Set<string>;
  errors: number;
  restarts: number;
  metrics?: IProcessMetrics;
}

/**
 * Queued request tracking
 */
interface QueuedRequest {
  id: string;
  method: string;
  args: any[];
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
  retries: number;
  timeout?: NodeJS.Timeout;
}

/**
 * Comprehensive Process Pool Implementation
 *
 * Features:
 * - Multiple load balancing strategies
 * - Auto-scaling based on metrics
 * - Health monitoring and self-healing
 * - Request queuing with timeout
 * - Worker recycling and lifecycle management
 * - Detailed metrics and observability
 * - Circuit breaker pattern
 * - Graceful shutdown
 */
export class ProcessPool<T> implements IProcessPool<T> {
  private workers = new Map<string, WorkerInfo<T>>();
  private queue: QueuedRequest[] = [];
  private isInitialized = false;
  private isShuttingDown = false;
  private isDraining = false;
  private currentRoundRobinIndex = 0;
  private requestIdCounter = 0;

  // Metrics tracking
  private totalRequests = 0;
  private totalErrors = 0;
  private totalResponseTime = 0;
  private successfulRequests = 0;

  // Auto-scaling state
  private autoScaleTimer?: NodeJS.Timeout;
  private lastScaleCheck = Date.now();
  private scaleHistory: Array<{ timestamp: number; action: 'up' | 'down'; from: number; to: number }> = [];

  // Health monitoring
  private healthCheckTimer?: NodeJS.Timeout;
  private unhealthyWorkers = new Set<string>();

  // Circuit breaker state
  private circuitBreaker = {
    isOpen: false,
    failures: 0,
    lastFailTime: 0,
    successAfterOpen: 0
  };

  // Event emitter for monitoring
  private emitter = new EventEmitter();

  // Pool options
  private poolOptions: IProcessPoolOptions;

  constructor(
    private readonly manager: IProcessManager,
    private readonly ProcessClass: new (...args: any[]) => T,
    options: IProcessPoolOptions,
    private readonly logger: ILogger
  ) {
    this.poolOptions = this.normalizeOptions(options);
  }

  /**
   * Normalize and validate pool options
   */
  private normalizeOptions(options: IProcessPoolOptions): IProcessPoolOptions {
    const defaults: IProcessPoolOptions = {
      size: options.size || 'auto',
      strategy: options.strategy || PoolStrategy.ROUND_ROBIN,
      maxQueueSize: options.maxQueueSize ?? 100,
      requestTimeout: options.requestTimeout ?? 30000,
      recycleAfter: options.recycleAfter ?? 10000,
      maxLifetime: options.maxLifetime ?? 3600000,
      warmup: options.warmup ?? false,
      metrics: options.metrics ?? true,
      healthCheck: options.healthCheck ?? {
        enabled: true,
        interval: 30000,
        unhealthyThreshold: 3
      },
      autoScale: options.autoScale ?? {
        enabled: false,
        min: 1,
        max: 10,
        targetCPU: 70,
        targetMemory: 80,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3,
        cooldownPeriod: 60000
      },
      circuitBreaker: options.circuitBreaker ?? {
        enabled: false,
        threshold: 5,
        timeout: 60000,
        halfOpenRequests: 3
      }
    };

    return { ...defaults, ...options };
  }

  /**
   * Initialize the pool
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const size = this.getPoolSize();
    this.logger.info({
      size,
      class: this.ProcessClass.name,
      strategy: this.poolOptions.strategy
    }, 'Initializing process pool');

    // Spawn initial workers
    const spawnPromises = [];
    for (let i = 0; i < size; i++) {
      spawnPromises.push(this.spawnWorker());
    }

    await Promise.all(spawnPromises);
    this.isInitialized = true;

    // Setup monitoring and features
    if (this.poolOptions.healthCheck?.enabled) {
      this.setupHealthMonitoring();
    }

    if (this.poolOptions.autoScale?.enabled) {
      this.setupAutoScaling();
    }

    if (this.poolOptions.warmup) {
      await this.warmupPool();
    }

    if (this.poolOptions.recycleAfter || this.poolOptions.maxLifetime) {
      this.setupRecycling();
    }

    this.emit('pool:initialized', { size, class: this.ProcessClass.name });
  }

  /**
   * Get pool size
   */
  get size(): number {
    return this.workers.size;
  }

  /**
   * Get active worker count
   */
  get active(): number {
    let activeCount = 0;
    this.workers.forEach(worker => {
      if (worker.processing.size > 0) activeCount++;
    });
    return activeCount;
  }

  /**
   * Get pending request count
   */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Get pool metrics
   */
  get metrics(): IPoolMetrics {
    const avgResponseTime = this.totalRequests > 0
      ? this.totalResponseTime / this.totalRequests
      : 0;

    const errorRate = this.totalRequests > 0
      ? this.totalErrors / this.totalRequests
      : 0;

    // Aggregate worker metrics
    let totalCpu = 0;
    let totalMemory = 0;
    let healthyWorkers = 0;

    this.workers.forEach(worker => {
      if (worker.metrics) {
        totalCpu += worker.metrics.cpu;
        totalMemory += worker.metrics.memory;
      }
      if (worker.health === 'healthy') healthyWorkers++;
    });

    const avgCpu = this.workers.size > 0 ? totalCpu / this.workers.size : 0;
    const avgMemory = this.workers.size > 0 ? totalMemory / this.workers.size : 0;

    return {
      cpu: avgCpu,
      memory: avgMemory,
      queueSize: this.queue.length,
      activeWorkers: this.active,
      totalWorkers: this.workers.size,
      idleWorkers: this.workers.size - this.active,
      healthyWorkers,
      unhealthyWorkers: this.unhealthyWorkers.size,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.totalErrors,
      avgResponseTime,
      errorRate,
      throughput: this.calculateThroughput(),
      saturation: this.calculateSaturation()
    };
  }

  /**
   * Scale the pool to a new size
   */
  async scale(newSize: number): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Cannot scale during shutdown');
    }

    const currentSize = this.workers.size;
    if (newSize === currentSize) return;

    this.logger.info({
      currentSize,
      newSize,
      class: this.ProcessClass.name
    }, 'Scaling process pool');

    // Record scale action
    this.scaleHistory.push({
      timestamp: Date.now(),
      action: newSize > currentSize ? 'up' : 'down',
      from: currentSize,
      to: newSize
    });

    if (newSize > currentSize) {
      // Scale up
      await this.scaleUp(newSize - currentSize);
    } else {
      // Scale down
      await this.scaleDown(currentSize - newSize);
    }

    this.emit('pool:scaled', {
      from: currentSize,
      to: newSize,
      class: this.ProcessClass.name
    });
  }

  /**
   * Drain the pool (stop accepting new requests)
   */
  async drain(): Promise<void> {
    this.logger.info({ class: this.ProcessClass.name }, 'Draining process pool');
    this.isDraining = true;

    // Clear the queue
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      if (request) {
        request.reject(new Error('Pool is draining'));
      }
    }

    // Wait for active requests to complete
    await this.waitForActiveRequests();

    this.emit('pool:drained', { class: this.ProcessClass.name });
  }

  /**
   * Destroy the pool
   */
  async destroy(): Promise<void> {
    this.logger.info({ class: this.ProcessClass.name }, 'Destroying process pool');
    this.isShuttingDown = true;

    // Clear timers
    if (this.autoScaleTimer) {
      clearInterval(this.autoScaleTimer);
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Drain first
    await this.drain();

    // Shutdown all workers
    const shutdownPromises = Array.from(this.workers.values()).map(worker =>
      this.shutdownWorker(worker.id)
    );

    await Promise.all(shutdownPromises);

    this.workers.clear();
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.isDraining = false;

    this.emit('pool:destroyed', { class: this.ProcessClass.name });
  }

  /**
   * Execute a method on a worker from the pool
   */
  async execute(method: string, ...args: any[]): Promise<any> {
    // Check circuit breaker
    if (this.poolOptions.circuitBreaker?.enabled && this.circuitBreaker.isOpen) {
      if (!this.shouldTryHalfOpen()) {
        throw new Error('Circuit breaker is open');
      }
    }

    // Check if draining
    if (this.isDraining) {
      throw new Error('Pool is draining, not accepting new requests');
    }

    // Queue if no workers available
    if (this.workers.size === 0 ||
        (this.active >= this.workers.size && this.queue.length < (this.poolOptions.maxQueueSize || 100))) {
      return this.queueRequest(method, args);
    }

    const worker = await this.selectWorker();
    return this.executeOnWorker(worker, method, args);
  }

  // Dynamic method proxying - allows calling pool methods directly
  [key: string]: any;

  /**
   * Private: Get the pool size based on options
   */
  private getPoolSize(): number {
    if (this.poolOptions.size === 'auto') {
      return cpus().length;
    }
    return typeof this.poolOptions.size === 'number' ? this.poolOptions.size : 2;
  }

  /**
   * Private: Spawn a new worker
   */
  private async spawnWorker(): Promise<void> {
    try {
      const proxy = await this.manager.spawn(this.ProcessClass, {
        name: `${this.ProcessClass.name}-pool-${Date.now()}-${Math.random().toString(36).slice(2)}`
      });

      const workerId = (proxy as any).__processId;

      const worker: WorkerInfo<T> = {
        id: workerId,
        proxy,
        requests: 0,
        totalRequestTime: 0,
        lastUsed: Date.now(),
        created: Date.now(),
        health: 'healthy',
        currentLoad: 0,
        processing: new Set(),
        errors: 0,
        restarts: 0
      };

      this.workers.set(workerId, worker);

      this.logger.debug({
        workerId,
        totalWorkers: this.workers.size
      }, 'Spawned pool worker');

      this.emit('worker:spawned', { workerId, class: this.ProcessClass.name });
    } catch (error) {
      this.logger.error({ error }, 'Failed to spawn worker');
      throw error;
    }
  }

  /**
   * Private: Shutdown a worker
   */
  private async shutdownWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    try {
      // Wait for active requests
      if (worker.processing.size > 0) {
        this.logger.debug({
          workerId,
          activeRequests: worker.processing.size
        }, 'Waiting for worker to finish active requests');

        // Give it some time to finish
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Destroy the worker proxy
      if ('__destroy' in worker.proxy) {
        await (worker.proxy as any).__destroy();
      }

      this.workers.delete(workerId);
      this.unhealthyWorkers.delete(workerId);

      this.logger.debug({ workerId }, 'Shutdown pool worker');
      this.emit('worker:shutdown', { workerId, class: this.ProcessClass.name });
    } catch (error) {
      this.logger.error({ error, workerId }, 'Error shutting down worker');
    }
  }

  /**
   * Private: Select a worker based on the strategy
   */
  private async selectWorker(): Promise<WorkerInfo<T>> {
    const healthyWorkers = Array.from(this.workers.values()).filter(
      w => w.health === 'healthy'
    );

    if (healthyWorkers.length === 0) {
      // Fallback to any worker if no healthy ones
      if (this.workers.size === 0) {
        throw new Error('No workers available in pool');
      }
      const firstWorker = this.workers.values().next().value;
      if (!firstWorker) {
        throw new Error('No workers available in pool');
      }
      return firstWorker;
    }

    const strategy = this.poolOptions.strategy || PoolStrategy.ROUND_ROBIN;

    switch (strategy) {
      case PoolStrategy.ROUND_ROBIN:
        return this.selectRoundRobin(healthyWorkers);

      case PoolStrategy.LEAST_LOADED:
        return this.selectLeastLoaded(healthyWorkers);

      case PoolStrategy.RANDOM:
        return this.selectRandom(healthyWorkers);

      case PoolStrategy.WEIGHTED:
        return this.selectWeighted(healthyWorkers);

      case PoolStrategy.ADAPTIVE:
        return this.selectAdaptive(healthyWorkers);

      case PoolStrategy.CONSISTENT_HASH:
        return this.selectConsistentHash(healthyWorkers);

      case PoolStrategy.LATENCY:
        return this.selectByLatency(healthyWorkers);

      default:
        return this.selectRoundRobin(healthyWorkers);
    }
  }

  /**
   * Private: Round-robin selection
   */
  private selectRoundRobin(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    if (workers.length === 0) {
      throw new Error('No workers available');
    }
    const worker = workers[this.currentRoundRobinIndex % workers.length];
    this.currentRoundRobinIndex++;
    return worker!;
  }

  /**
   * Private: Select least loaded worker
   */
  private selectLeastLoaded(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    return workers.reduce((min, worker) =>
      worker.currentLoad < min.currentLoad ? worker : min
    );
  }

  /**
   * Private: Random selection
   */
  private selectRandom(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    if (workers.length === 0) {
      throw new Error('No workers available');
    }
    const index = Math.floor(Math.random() * workers.length);
    return workers[index]!;
  }

  /**
   * Private: Weighted selection based on capacity
   */
  private selectWeighted(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    if (workers.length === 0) {
      throw new Error('No workers available');
    }

    const weights = workers.map(w => 1 / (w.currentLoad + 1));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let random = Math.random() * totalWeight;
    for (let i = 0; i < workers.length; i++) {
      random -= weights[i]!;
      if (random <= 0) {
        return workers[i]!;
      }
    }

    return workers[workers.length - 1]!;
  }

  /**
   * Private: Adaptive selection based on performance metrics
   */
  private selectAdaptive(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    // Score each worker based on multiple factors
    const scored = workers.map(w => {
      const avgResponseTime = w.requests > 0 ? w.totalRequestTime / w.requests : 0;
      const errorRate = w.requests > 0 ? w.errors / w.requests : 0;

      // Lower score is better
      const score =
        w.currentLoad * 0.3 +
        avgResponseTime * 0.3 +
        errorRate * 0.2 +
        w.processing.size * 0.2;

      return { worker: w, score };
    });

    scored.sort((a, b) => a.score - b.score);
    return scored[0]!.worker;
  }

  /**
   * Private: Consistent hash selection
   */
  private selectConsistentHash(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    if (workers.length === 0) {
      throw new Error('No workers available');
    }
    // Simple hash based on request counter for now
    const hash = this.requestIdCounter % workers.length;
    return workers[hash]!;
  }

  /**
   * Private: Select by latency
   */
  private selectByLatency(workers: WorkerInfo<T>[]): WorkerInfo<T> {
    // Select worker with lowest average response time
    return workers.reduce((best, worker) => {
      const workerAvg = worker.requests > 0 ? worker.totalRequestTime / worker.requests : 0;
      const bestAvg = best.requests > 0 ? best.totalRequestTime / best.requests : 0;
      return workerAvg < bestAvg ? worker : best;
    });
  }

  /**
   * Private: Execute method on specific worker
   */
  private async executeOnWorker(
    worker: WorkerInfo<T>,
    method: string,
    args: any[]
  ): Promise<any> {
    const requestId = `req-${++this.requestIdCounter}`;
    const startTime = Date.now();

    worker.processing.add(requestId);
    worker.currentLoad++;
    this.totalRequests++;

    try {
      // Add timeout if configured
      const timeout = this.poolOptions.requestTimeout;
      let result: any;

      if (timeout) {
        result = await Promise.race([
          (worker.proxy as any)[method](...args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          )
        ]);
      } else {
        result = await (worker.proxy as any)[method](...args);
      }

      // Update metrics
      const responseTime = Date.now() - startTime;
      worker.totalRequestTime += responseTime;
      worker.requests++;
      this.totalResponseTime += responseTime;
      this.successfulRequests++;

      // Circuit breaker success
      if (this.poolOptions.circuitBreaker?.enabled && this.circuitBreaker.isOpen) {
        this.circuitBreaker.successAfterOpen++;
        if (this.circuitBreaker.successAfterOpen >= (this.poolOptions.circuitBreaker.halfOpenRequests || 3)) {
          this.closeCircuitBreaker();
        }
      }

      return result;
    } catch (error) {
      worker.errors++;
      this.totalErrors++;

      // Circuit breaker failure
      if (this.poolOptions.circuitBreaker?.enabled) {
        this.handleCircuitBreakerFailure();
      }

      // Check if worker is unhealthy
      if (worker.errors > (this.poolOptions.healthCheck?.unhealthyThreshold || 3)) {
        worker.health = 'unhealthy';
        this.unhealthyWorkers.add(worker.id);
        this.emit('worker:unhealthy', { workerId: worker.id });
      }

      throw error;
    } finally {
      worker.processing.delete(requestId);
      worker.currentLoad--;
      worker.lastUsed = Date.now();
    }
  }

  /**
   * Private: Queue a request
   */
  private async queueRequest(method: string, args: any[]): Promise<any> {
    if (this.queue.length >= (this.poolOptions.maxQueueSize || 100)) {
      throw new Error('Pool queue is full');
    }

    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        id: `req-${++this.requestIdCounter}`,
        method,
        args,
        resolve,
        reject,
        timestamp: Date.now(),
        retries: 0
      };

      // Add timeout if configured
      if (this.poolOptions.requestTimeout) {
        request.timeout = setTimeout(() => {
          const index = this.queue.indexOf(request);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(new Error('Request timeout in queue'));
          }
        }, this.poolOptions.requestTimeout);
      }

      this.queue.push(request);
      this.emit('request:queued', {
        queueSize: this.queue.length,
        method
      });

      // Try to process queue
      this.processQueue();
    });
  }

  /**
   * Private: Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.isDraining) return;

    // Find available workers
    const availableWorkers = Array.from(this.workers.values()).filter(
      w => w.health === 'healthy' && w.currentLoad < 2
    );

    while (this.queue.length > 0 && availableWorkers.length > 0) {
      const request = this.queue.shift();
      if (!request) break;

      // Clear timeout
      if (request.timeout) {
        clearTimeout(request.timeout);
      }

      const worker = availableWorkers.shift();
      if (!worker) {
        // Put request back
        this.queue.unshift(request);
        break;
      }

      // Execute request
      this.executeOnWorker(worker, request.method, request.args)
        .then(request.resolve)
        .catch(request.reject);
    }
  }

  /**
   * Private: Setup health monitoring
   */
  private setupHealthMonitoring(): void {
    const interval = this.poolOptions.healthCheck?.interval || 30000;

    this.healthCheckTimer = setInterval(async () => {
      for (const worker of this.workers.values()) {
        try {
          // Try to get health status
          if ('__getHealth' in worker.proxy) {
            const health = await (worker.proxy as any).__getHealth();
            worker.health = health.status === 'healthy' ? 'healthy' :
                          health.status === 'degraded' ? 'degraded' : 'unhealthy';
          }

          // Also get metrics
          if ('__getMetrics' in worker.proxy) {
            worker.metrics = await (worker.proxy as any).__getMetrics();
          }
        } catch (error) {
          this.logger.warn({ error, workerId: worker.id }, 'Health check failed');
          worker.health = 'unhealthy';
        }
      }

      // Replace unhealthy workers
      for (const worker of this.workers.values()) {
        if (worker.health === 'unhealthy' && !this.isShuttingDown) {
          await this.replaceWorker(worker.id);
        }
      }
    }, interval);
  }

  /**
   * Private: Setup auto-scaling
   */
  private setupAutoScaling(): void {
    if (!this.poolOptions.autoScale?.enabled) return;

    const checkInterval = 10000; // Check every 10 seconds

    this.autoScaleTimer = setInterval(async () => {
      if (this.isShuttingDown || this.isDraining) return;

      const now = Date.now();
      const cooldownPeriod = this.poolOptions.autoScale?.cooldownPeriod || 60000;

      if (now - this.lastScaleCheck < cooldownPeriod) return;

      const metrics = this.metrics;
      const config = this.poolOptions.autoScale!;

      // Check if we need to scale up
      const shouldScaleUp =
        metrics.cpu > (config.targetCPU || 70) ||
        metrics.memory > (config.targetMemory || 80) ||
        (metrics.saturation || 0) > (config.scaleUpThreshold || 0.8);

      // Check if we need to scale down
      const shouldScaleDown =
        metrics.cpu < 30 &&
        metrics.memory < 40 &&
        (metrics.saturation || 0) < (config.scaleDownThreshold || 0.3);

      if (shouldScaleUp && this.workers.size < (config.max || 10)) {
        const newSize = Math.min(this.workers.size + 1, config.max || 10);
        await this.scale(newSize);
        this.lastScaleCheck = now;
      } else if (shouldScaleDown && this.workers.size > (config.min || 1)) {
        const newSize = Math.max(this.workers.size - 1, config.min || 1);
        await this.scale(newSize);
        this.lastScaleCheck = now;
      }
    }, checkInterval);
  }

  /**
   * Private: Setup worker recycling
   */
  private setupRecycling(): void {
    setInterval(async () => {
      if (this.isShuttingDown) return;

      const now = Date.now();
      const maxLifetime = this.poolOptions.maxLifetime || 3600000;
      const recycleAfter = this.poolOptions.recycleAfter || 10000;

      for (const worker of this.workers.values()) {
        const shouldRecycle =
          (now - worker.created > maxLifetime) ||
          (worker.requests > recycleAfter);

        if (shouldRecycle) {
          await this.replaceWorker(worker.id);
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Private: Replace a worker
   */
  private async replaceWorker(workerId: string): Promise<void> {
    this.logger.info({ workerId }, 'Replacing pool worker');

    // Spawn replacement first
    await this.spawnWorker();

    // Then shutdown old worker
    await this.shutdownWorker(workerId);

    this.emit('worker:replaced', { workerId });
  }

  /**
   * Private: Warmup the pool
   */
  private async warmupPool(): Promise<void> {
    this.logger.info('Warming up process pool');

    // Execute a simple method on each worker
    const warmupPromises = Array.from(this.workers.values()).map(async worker => {
      try {
        if ('__getHealth' in worker.proxy) {
          await (worker.proxy as any).__getHealth();
        }
      } catch (error) {
        this.logger.debug({ error, workerId: worker.id }, 'Warmup failed');
      }
    });

    await Promise.all(warmupPromises);
  }

  /**
   * Private: Scale up
   */
  private async scaleUp(count: number): Promise<void> {
    const spawnPromises = [];
    for (let i = 0; i < count; i++) {
      spawnPromises.push(this.spawnWorker());
    }
    await Promise.all(spawnPromises);
  }

  /**
   * Private: Scale down
   */
  private async scaleDown(count: number): Promise<void> {
    // Select workers to remove (prefer idle ones)
    const sortedWorkers = Array.from(this.workers.values())
      .sort((a, b) => a.currentLoad - b.currentLoad);

    const toRemove = sortedWorkers.slice(0, count);

    for (const worker of toRemove) {
      await this.shutdownWorker(worker.id);
    }
  }

  /**
   * Private: Wait for active requests
   */
  private async waitForActiveRequests(): Promise<void> {
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.active > 0 && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.active > 0) {
      this.logger.warn({ active: this.active }, 'Timed out waiting for active requests');
    }
  }

  /**
   * Private: Calculate throughput
   */
  private calculateThroughput(): number {
    // Requests per second over last minute
    const recentHistory = this.scaleHistory.filter(
      h => Date.now() - h.timestamp < 60000
    );

    if (recentHistory.length === 0) return 0;

    const firstEntry = recentHistory[0];
    if (!firstEntry) return 0;

    const duration = (Date.now() - firstEntry.timestamp) / 1000;
    return duration > 0 ? this.successfulRequests / duration : 0;
  }

  /**
   * Private: Calculate saturation
   */
  private calculateSaturation(): number {
    const totalCapacity = this.workers.size * 2; // Assume each worker can handle 2 concurrent
    const currentLoad = this.active + this.queue.length;
    return totalCapacity > 0 ? currentLoad / totalCapacity : 0;
  }

  /**
   * Private: Handle circuit breaker failure
   */
  private handleCircuitBreakerFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailTime = Date.now();

    const threshold = this.poolOptions.circuitBreaker?.threshold || 5;

    if (this.circuitBreaker.failures >= threshold && !this.circuitBreaker.isOpen) {
      this.openCircuitBreaker();
    }
  }

  /**
   * Private: Open circuit breaker
   */
  private openCircuitBreaker(): void {
    this.circuitBreaker.isOpen = true;
    this.circuitBreaker.successAfterOpen = 0;

    this.logger.warn('Circuit breaker opened');
    this.emit('circuitbreaker:open');

    // Schedule half-open attempt
    const timeout = this.poolOptions.circuitBreaker?.timeout || 60000;
    setTimeout(() => {
      if (this.circuitBreaker.isOpen) {
        this.logger.info('Circuit breaker entering half-open state');
        this.emit('circuitbreaker:halfopen');
      }
    }, timeout);
  }

  /**
   * Private: Close circuit breaker
   */
  private closeCircuitBreaker(): void {
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.successAfterOpen = 0;

    this.logger.info('Circuit breaker closed');
    this.emit('circuitbreaker:close');
  }

  /**
   * Private: Check if should try half-open
   */
  private shouldTryHalfOpen(): boolean {
    const timeout = this.poolOptions.circuitBreaker?.timeout || 60000;
    return Date.now() - this.circuitBreaker.lastFailTime > timeout;
  }

  /**
   * Private: Emit event
   */
  private emit(event: string, data?: any): void {
    this.emitter.emit(event, data);
  }

  /**
   * Public: Subscribe to pool events
   */
  on(event: string, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);
  }

  /**
   * Public: Unsubscribe from pool events
   */
  off(event: string, listener: (...args: any[]) => void): void {
    this.emitter.off(event, listener);
  }
}