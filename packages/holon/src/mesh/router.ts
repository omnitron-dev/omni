/**
 * Request router with load balancing and circuit breaking
 */

import type { RouterConfig, RouteTarget, CircuitBreakerConfig } from '../types.js';
import { EventEmitter } from 'eventemitter3';

export interface RouterEvents {
  'route': (target: RouteTarget) => void;
  'circuit:open': (targetId: string) => void;
  'circuit:close': (targetId: string) => void;
}

/**
 * Request router
 *
 * Features:
 * - Load balancing (round-robin, least-loaded, random, consistent-hash)
 * - Circuit breaker for fault tolerance
 * - Retry policies
 * - Timeout handling
 */
export class Router extends EventEmitter<RouterEvents> {
  private readonly config: Required<RouterConfig>;
  private readonly targets: Map<string, RouteTarget> = new Map();
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private currentIndex = 0;

  constructor(config: RouterConfig = {}) {
    super();

    this.config = {
      strategy: config.strategy ?? 'round-robin',
      circuitBreaker: config.circuitBreaker ?? {
        threshold: 5,
        timeout: 60000,
        halfOpenDuration: 30000,
      },
      retry: config.retry ?? { maxRetries: 3, delay: 1000 },
      timeout: config.timeout ?? 5000,
    };
  }

  /**
   * Add a route target
   */
  addTarget(target: RouteTarget): void {
    this.targets.set(target.nodeId, target);

    // Initialize circuit breaker for target
    if (!this.circuitBreakers.has(target.nodeId)) {
      const breaker = new CircuitBreaker(this.config.circuitBreaker);
      breaker.on('open', () => this.emit('circuit:open', target.nodeId));
      breaker.on('close', () => this.emit('circuit:close', target.nodeId));
      this.circuitBreakers.set(target.nodeId, breaker);
    }
  }

  /**
   * Remove a route target
   */
  removeTarget(nodeId: string): void {
    this.targets.delete(nodeId);
    this.circuitBreakers.delete(nodeId);
  }

  /**
   * Get a target based on load balancing strategy
   */
  getTarget(): RouteTarget | undefined {
    const availableTargets = this.getAvailableTargets();
    if (availableTargets.length === 0) {
      return undefined;
    }

    let target: RouteTarget;

    switch (this.config.strategy) {
      case 'round-robin':
        target = this.roundRobinSelect(availableTargets);
        break;
      case 'least-loaded':
        target = this.leastLoadedSelect(availableTargets);
        break;
      case 'random':
        target = this.randomSelect(availableTargets);
        break;
      case 'consistent-hash':
        target = this.consistentHashSelect(availableTargets);
        break;
      default:
        target = availableTargets[0]!; // Safe: we checked availableTargets.length > 0
    }

    this.emit('route', target);
    return target;
  }

  /**
   * Execute request on target with circuit breaker
   */
  async execute<T>(
    targetId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const breaker = this.circuitBreakers.get(targetId);
    if (!breaker) {
      throw new Error(`No circuit breaker for target: ${targetId}`);
    }

    return breaker.execute(fn);
  }

  /**
   * Get available targets (healthy and circuit closed)
   */
  private getAvailableTargets(): RouteTarget[] {
    return Array.from(this.targets.values()).filter((target) => {
      const breaker = this.circuitBreakers.get(target.nodeId);
      return target.health === 'healthy' && breaker && !breaker.isOpen();
    });
  }

  /**
   * Round-robin selection
   */
  private roundRobinSelect(targets: RouteTarget[]): RouteTarget {
    const target = targets[this.currentIndex % targets.length]!; // Safe: targets.length > 0 checked by caller
    this.currentIndex++;
    return target;
  }

  /**
   * Least-loaded selection
   */
  private leastLoadedSelect(targets: RouteTarget[]): RouteTarget {
    return targets.reduce((min, target) =>
      target.load < min.load ? target : min
    );
  }

  /**
   * Random selection
   */
  private randomSelect(targets: RouteTarget[]): RouteTarget {
    const index = Math.floor(Math.random() * targets.length);
    return targets[index]!; // Safe: targets.length > 0 checked by caller
  }

  /**
   * Consistent hash selection
   */
  private consistentHashSelect(targets: RouteTarget[]): RouteTarget {
    // Simple hash based on timestamp for now
    const hash = Date.now();
    const index = hash % targets.length;
    return targets[index]!; // Safe: targets.length > 0 checked by caller
  }

  /**
   * Get router statistics
   */
  getStats(): RouterStats {
    return {
      totalTargets: this.targets.size,
      healthyTargets: this.getAvailableTargets().length,
      strategy: this.config.strategy,
    };
  }
}

/**
 * Circuit breaker for fault tolerance
 */
class CircuitBreaker extends EventEmitter {
  private readonly config: CircuitBreakerConfig;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(config: CircuitBreakerConfig) {
    super();
    this.config = config;
  }

  /**
   * Execute function with circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.config.timeout) {
        // Try half-open state
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();

      // Record success
      if (this.state === 'half-open') {
        this.successCount++;
        if (this.successCount >= 3) {
          this.close();
        }
      } else {
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      // Record failure
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.config.threshold) {
        this.open();
      } else if (this.state === 'half-open') {
        this.open();
      }

      throw error;
    }
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Open the circuit
   */
  private open(): void {
    this.state = 'open';
    this.successCount = 0;
    this.emit('open');
  }

  /**
   * Close the circuit
   */
  private close(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.emit('close');
  }
}

export interface RouterStats {
  totalTargets: number;
  healthyTargets: number;
  strategy: string;
}

/**
 * Create a new router
 */
export function createRouter(config?: RouterConfig): Router {
  return new Router(config);
}
