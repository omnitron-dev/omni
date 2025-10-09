/**
 * Policy Engine for universal authorization
 * Supports RBAC, ABAC, PBAC, ReBAC with high-performance caching
 * @module @omnitron-dev/titan/netron/auth
 */

import { TimedMap } from '@omnitron-dev/common';
import { Injectable, Optional } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type {
  EnhancedPolicyDecision,
  ExecutionContext,
  PolicyDefinition,
  PolicyEngineConfig,
  PolicyEvaluationOptions,
  PolicyExpression,
} from './types.js';
import { Errors } from '../../errors/index.js';

/**
 * Circuit breaker for policy evaluation
 * Prevents cascading failures by opening after threshold failures
 */
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private config: {
      threshold: number;
      timeout: number;
      resetTimeout: number;
    },
  ) { }

  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.threshold) {
      this.state = 'open';
    }
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Policy cache with statistics tracking
 */
class PolicyCache {
  private cache: TimedMap<string, EnhancedPolicyDecision>;
  private hits = 0;
  private misses = 0;

  constructor(defaultTTL = 60000) {
    this.cache = new TimedMap<string, EnhancedPolicyDecision>(defaultTTL);
  }

  get(key: string): EnhancedPolicyDecision | undefined {
    const value = this.cache.get(key);
    if (value) {
      this.hits++;
      return value;
    }
    this.misses++;
    return undefined;
  }

  set(key: string, value: EnhancedPolicyDecision, ttl?: number): void {
    this.cache.set(key, value, undefined, ttl);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  keys(): string[] {
    const keys: string[] = [];
    for (const entry of this.cache.entries()) {
      keys.push(entry[0] as string);
    }
    return keys;
  }

  getStats(): { size: number; hitRate: number; hits: number; misses: number } {
    const total = this.hits + this.misses;
    return {
      size: this.keys().length,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/**
 * Universal policy engine with performance optimizations
 *
 * Performance features:
 * - Policy result caching with TTL (60s default)
 * - Parallel policy evaluation
 * - Timeout protection (5s default)
 * - Circuit breaker for failing policies
 * - Short-circuit optimization for OR policies
 *
 * Supports:
 * - RBAC (Role-Based Access Control)
 * - ABAC (Attribute-Based Access Control)
 * - PBAC (Policy-Based Access Control)
 * - ReBAC (Relationship-Based Access Control)
 */
@Injectable()
export class PolicyEngine {
  private policies = new Map<string, PolicyDefinition>();
  private policyCache: PolicyCache;
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private logger: ILogger;
  private debugMode = false;

  constructor(
    logger: ILogger,
    @Optional() private config?: PolicyEngineConfig,
  ) {
    this.logger = logger.child({ component: 'PolicyEngine' });
    this.debugMode = config?.debug ?? false;
    this.policyCache = new PolicyCache(config?.defaultCacheTTL ?? 60000);
  }

  /**
   * Register a policy with optional circuit breaker
   */
  registerPolicy(
    policy: PolicyDefinition,
    options?: {
      circuitBreaker?: {
        threshold: number;
        timeout: number;
        resetTimeout: number;
      };
    },
  ): void {
    if (this.policies.has(policy.name)) {
      throw Errors.conflict('Policy already registered: ' + policy.name, { policyName: policy.name });
    }

    this.policies.set(policy.name, policy);

    // Setup circuit breaker if configured
    if (options?.circuitBreaker) {
      this.circuitBreakers.set(
        policy.name,
        new CircuitBreaker(options.circuitBreaker),
      );
    }

    this.logger.debug({ policyName: policy.name }, 'Policy registered');
  }

  /**
   * Register multiple policies at once
   */
  registerPolicies(policies: PolicyDefinition[]): void {
    for (const policy of policies) {
      this.registerPolicy(policy);
    }
  }

  /**
   * Evaluate a single policy with caching and timeout
   */
  async evaluate(
    policyName: string,
    context: ExecutionContext,
    options?: PolicyEvaluationOptions,
  ): Promise<EnhancedPolicyDecision> {
    const startTime = performance.now();

    // Check cache
    if (!options?.skipCache) {
      const cacheKey = this.getCacheKey(policyName, context);
      const cached = this.policyCache.get(cacheKey);
      if (cached) {
        this.logger.debug({ policyName, cached: true }, 'Policy cache hit');
        return cached;
      }
    }

    const policy = this.policies.get(policyName);
    if (!policy) {
      throw Errors.notFound('Policy', policyName);
    }

    // Check circuit breaker
    const circuitBreaker = this.circuitBreakers.get(policyName);
    if (circuitBreaker?.isOpen()) {
      return {
        allowed: false,
        reason: `Policy '${policyName}' circuit breaker open`,
        policyName,
        evaluationTime: performance.now() - startTime,
      };
    }

    try {
      // Evaluate with timeout
      const timeout = options?.timeout ?? this.config?.defaultTimeout ?? 5000;
      const decision = await this.evaluateWithTimeout(
        Promise.resolve(policy.evaluate(context)),
        timeout,
        options?.signal,
      );

      const evaluationTime = performance.now() - startTime;

      const enhancedDecision: EnhancedPolicyDecision = {
        ...decision,
        policyName,
        evaluationTime,
      };

      // Cache successful evaluations
      if (decision.allowed && !options?.skipCache) {
        const cacheTTL =
          options?.cacheTTL ?? this.config?.defaultCacheTTL ?? 60000;
        const cacheKey = this.getCacheKey(policyName, context);
        this.policyCache.set(cacheKey, enhancedDecision, cacheTTL);
      }

      // Record success in circuit breaker
      circuitBreaker?.recordSuccess();

      this.logger.debug(
        {
          policy: policyName,
          decision: decision.allowed,
          reason: decision.reason,
          evaluationTime,
          userId: context.auth?.userId,
          service: context.service.name,
          method: context.method?.name,
        },
        'Policy evaluated',
      );

      return enhancedDecision;
    } catch (error: any) {
      const evaluationTime = performance.now() - startTime;

      // Record failure in circuit breaker
      circuitBreaker?.recordFailure();

      this.logger.error(
        {
          error,
          policyName,
          evaluationTime,
          circuitBreakerState: circuitBreaker?.getState(),
        },
        'Policy evaluation error',
      );

      return {
        allowed: false,
        reason: `Policy evaluation failed: ${error.message}`,
        policyName,
        evaluationTime,
      };
    }
  }

  /**
   * Evaluate multiple policies with AND logic (all must pass)
   * Executes in parallel for performance
   */
  async evaluateAll(
    policyNames: string[],
    context: ExecutionContext,
    options?: PolicyEvaluationOptions,
  ): Promise<EnhancedPolicyDecision> {
    const startTime = performance.now();

    // Parallel evaluation
    const decisions = await Promise.all(
      policyNames.map((name) => this.evaluate(name, context, options)),
    );

    const failed = decisions.find((d) => !d.allowed);
    if (failed) {
      return {
        ...failed,
        evaluationTime: performance.now() - startTime,
        metadata: {
          ...failed.metadata,
          evaluatedPolicies: policyNames,
          allDecisions: this.debugMode ? decisions : undefined,
        },
      };
    }

    return {
      allowed: true,
      reason: 'All policies passed',
      evaluationTime: performance.now() - startTime,
      metadata: {
        evaluatedPolicies: policyNames,
        allDecisions: this.debugMode ? decisions : undefined,
      },
    };
  }

  /**
   * Evaluate multiple policies with OR logic (at least one must pass)
   * Short-circuits on first success for performance
   */
  async evaluateAny(
    policyNames: string[],
    context: ExecutionContext,
    options?: PolicyEvaluationOptions,
  ): Promise<EnhancedPolicyDecision> {
    const startTime = performance.now();
    const decisions: EnhancedPolicyDecision[] = [];

    // Sequential evaluation with short-circuit
    for (const policyName of policyNames) {
      const decision = await this.evaluate(policyName, context, options);
      decisions.push(decision);

      // Short-circuit on first success
      if (decision.allowed) {
        return {
          ...decision,
          evaluationTime: performance.now() - startTime,
          metadata: {
            ...decision.metadata,
            evaluatedPolicies: policyNames.slice(0, decisions.length),
            allDecisions: this.debugMode ? decisions : undefined,
          },
        };
      }
    }

    return {
      allowed: false,
      reason: 'No policies passed',
      evaluationTime: performance.now() - startTime,
      metadata: {
        evaluatedPolicies: policyNames,
        reasons: decisions.map((d) => d.reason),
        allDecisions: this.debugMode ? decisions : undefined,
      },
    };
  }

  /**
   * Evaluate policy expression (complex AND/OR/NOT combinations)
   * Example: { and: [policy1, { or: [policy2, policy3] }] }
   */
  async evaluateExpression(
    expression: PolicyExpression,
    context: ExecutionContext,
    options?: PolicyEvaluationOptions,
  ): Promise<EnhancedPolicyDecision> {
    if (typeof expression === 'string') {
      return this.evaluate(expression, context, options);
    }

    if ('and' in expression) {
      const decisions = await Promise.all(
        expression.and.map((expr) =>
          this.evaluateExpression(expr, context, options),
        ),
      );
      const failed = decisions.find((d) => !d.allowed);
      return (
        failed ?? { allowed: true, reason: 'AND expression passed' }
      );
    }

    if ('or' in expression) {
      for (const expr of expression.or) {
        const decision = await this.evaluateExpression(expr, context, options);
        if (decision.allowed) return decision;
      }
      return { allowed: false, reason: 'OR expression failed' };
    }

    if ('not' in expression) {
      const decision = await this.evaluateExpression(
        expression.not,
        context,
        options,
      );
      return {
        allowed: !decision.allowed,
        reason: decision.allowed
          ? 'NOT expression passed'
          : 'NOT expression failed',
      };
    }

    throw Errors.badRequest('Invalid policy expression', { expression });
  }

  /**
   * Get all registered policies
   */
  getPolicies(): PolicyDefinition[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get policies by tag
   */
  getPoliciesByTag(tag: string): PolicyDefinition[] {
    return this.getPolicies().filter((policy) =>
      policy.tags?.includes(tag),
    );
  }

  /**
   * Clear policy cache
   */
  clearCache(pattern?: string): void {
    if (!pattern) {
      this.policyCache.clear();
    } else {
      // Clear cache entries matching pattern
      const keys = this.policyCache.keys();
      for (const key of keys) {
        if (key.includes(pattern)) {
          this.policyCache.delete(key);
        }
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    hits: number;
    misses: number;
  } {
    return this.policyCache.getStats();
  }

  /**
   * Enable or disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Get circuit breaker state for a policy
   */
  getCircuitBreakerState(policyName: string): string | undefined {
    return this.circuitBreakers.get(policyName)?.getState();
  }

  private getCacheKey(policyName: string, context: ExecutionContext): string {
    // Create deterministic cache key from context
    return `${policyName}:${context.auth?.userId}:${context.service.name}:${context.method?.name}:${context.resource?.id}`;
  }

  private async evaluateWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        const timer = setTimeout(
          () => reject(Errors.timeout('Policy evaluation timeout', timeout)),
          timeout,
        );
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Errors.internal('Policy evaluation aborted'));
        });
      }),
    ]);
  }
}
