/**
 * High-Performance Middleware Pipeline for Netron Browser
 *
 * Lightweight middleware execution engine adapted from Titan
 * Optimized for browser environments with minimal overhead
 */

import {
  MiddlewareStage,
  type ClientMiddlewareContext,
  type MiddlewareFunction,
  type MiddlewareConfig,
  type MiddlewareRegistration,
  type IMiddlewareManager,
  type MiddlewareMetrics,
} from './types.js';

/**
 * Client-side middleware pipeline implementation
 */
export class MiddlewarePipeline implements IMiddlewareManager {
  // Global middleware by stage
  private globalMiddleware = new Map<MiddlewareStage, MiddlewareRegistration[]>();

  // Service-specific middleware
  private serviceMiddleware = new Map<string, Map<MiddlewareStage, MiddlewareRegistration[]>>();

  // Method-specific middleware
  private methodMiddleware = new Map<string, Map<MiddlewareStage, MiddlewareRegistration[]>>();

  // Metrics tracking
  private metrics: MiddlewareMetrics = {
    executions: 0,
    avgTime: 0,
    errors: 0,
    skips: 0,
    byMiddleware: new Map(),
  };

  constructor() {
    // Initialize stages
    for (const stage of Object.values(MiddlewareStage)) {
      this.globalMiddleware.set(stage as MiddlewareStage, []);
    }
  }

  /**
   * Register middleware globally
   */
  use(
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>,
    stage: MiddlewareStage = MiddlewareStage.PRE_REQUEST
  ): void {
    const registration: MiddlewareRegistration = {
      middleware,
      config: {
        name: config?.name || 'anonymous',
        priority: config?.priority ?? 100,
        ...config,
      },
      stage,
    };

    const stageMiddleware = this.globalMiddleware.get(stage) || [];
    stageMiddleware.push(registration);

    // Sort by priority
    stageMiddleware.sort((a, b) => (a.config.priority ?? 0) - (b.config.priority ?? 0));

    this.globalMiddleware.set(stage, stageMiddleware);
  }

  /**
   * Register service-specific middleware
   */
  useForService(
    serviceName: string,
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>,
    stage: MiddlewareStage = MiddlewareStage.PRE_REQUEST
  ): void {
    if (!this.serviceMiddleware.has(serviceName)) {
      this.serviceMiddleware.set(serviceName, new Map());
    }

    const serviceMap = this.serviceMiddleware.get(serviceName)!;
    if (!serviceMap.has(stage)) {
      serviceMap.set(stage, []);
    }

    const registration: MiddlewareRegistration = {
      middleware,
      config: {
        name: config?.name || `${serviceName}-middleware`,
        priority: config?.priority ?? 100,
        ...config,
      },
      stage,
    };

    const stageMiddleware = serviceMap.get(stage)!;
    stageMiddleware.push(registration);
    stageMiddleware.sort((a, b) => (a.config.priority ?? 0) - (b.config.priority ?? 0));
  }

  /**
   * Register method-specific middleware
   */
  useForMethod(
    serviceName: string,
    methodName: string,
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>,
    stage: MiddlewareStage = MiddlewareStage.PRE_REQUEST
  ): void {
    const key = `${serviceName}.${methodName}`;

    if (!this.methodMiddleware.has(key)) {
      this.methodMiddleware.set(key, new Map());
    }

    const methodMap = this.methodMiddleware.get(key)!;
    if (!methodMap.has(stage)) {
      methodMap.set(stage, []);
    }

    const registration: MiddlewareRegistration = {
      middleware,
      config: {
        name: config?.name || `${key}-middleware`,
        priority: config?.priority ?? 100,
        ...config,
      },
      stage,
    };

    const stageMiddleware = methodMap.get(stage)!;
    stageMiddleware.push(registration);
    stageMiddleware.sort((a, b) => (a.config.priority ?? 0) - (b.config.priority ?? 0));
  }

  /**
   * Get middleware for specific service/method
   */
  getMiddleware(serviceName?: string, methodName?: string, stage?: MiddlewareStage): MiddlewareRegistration[] {
    const stages = stage ? [stage] : Object.values(MiddlewareStage);
    const result: MiddlewareRegistration[] = [];

    for (const s of stages) {
      // Add global middleware
      const global = this.globalMiddleware.get(s as MiddlewareStage) || [];
      result.push(...global);

      // Add service-specific middleware
      if (serviceName) {
        const serviceMap = this.serviceMiddleware.get(serviceName);
        if (serviceMap) {
          const service = serviceMap.get(s as MiddlewareStage) || [];
          result.push(...service);
        }
      }

      // Add method-specific middleware
      if (serviceName && methodName) {
        const key = `${serviceName}.${methodName}`;
        const methodMap = this.methodMiddleware.get(key);
        if (methodMap) {
          const method = methodMap.get(s as MiddlewareStage) || [];
          result.push(...method);
        }
      }
    }

    // Sort by priority
    result.sort((a, b) => (a.config.priority ?? 0) - (b.config.priority ?? 0));

    return result;
  }

  /**
   * Execute middleware pipeline
   */
  async execute(ctx: ClientMiddlewareContext, stage: MiddlewareStage): Promise<void> {
    const startTime = performance.now();
    this.metrics.executions++;

    // Get applicable middleware
    const middlewares = this.getMiddleware(ctx.service, ctx.method, stage);

    // Filter by conditions
    const applicable = middlewares.filter((reg) => {
      if (reg.config.condition && !reg.config.condition(ctx)) {
        this.metrics.skips++;
        return false;
      }

      // Check service filter
      if (reg.config.services) {
        if (Array.isArray(reg.config.services)) {
          if (!reg.config.services.includes(ctx.service)) {
            return false;
          }
        } else if (reg.config.services instanceof RegExp) {
          if (!reg.config.services.test(ctx.service)) {
            return false;
          }
        }
      }

      // Check method filter
      if (reg.config.methods) {
        if (Array.isArray(reg.config.methods)) {
          if (!reg.config.methods.includes(ctx.method)) {
            return false;
          }
        } else if (reg.config.methods instanceof RegExp) {
          if (!reg.config.methods.test(ctx.method)) {
            return false;
          }
        }
      }

      return true;
    });

    // Execute pipeline
    let index = 0;

    const next = async (): Promise<void> => {
      if (ctx.skipRemaining) {
        return;
      }

      if (index >= applicable.length) {
        return;
      }

      const registration = applicable[index++];
      if (!registration) {
        return;
      }

      const middlewareStart = performance.now();

      // Update per-middleware metrics
      const middlewareMetrics = this.metrics.byMiddleware.get(registration.config.name) || {
        executions: 0,
        avgTime: 0,
        errors: 0,
      };

      try {
        await registration.middleware(ctx, next);

        // Update metrics
        middlewareMetrics.executions++;
        const time = performance.now() - middlewareStart;
        middlewareMetrics.avgTime =
          (middlewareMetrics.avgTime * (middlewareMetrics.executions - 1) + time) / middlewareMetrics.executions;

        ctx.timing.middlewareTimes.set(registration.config.name, time);
      } catch (error: any) {
        middlewareMetrics.errors++;
        this.metrics.errors++;

        if (registration.config.onError) {
          registration.config.onError(error, ctx);
        }

        throw error;
      } finally {
        this.metrics.byMiddleware.set(registration.config.name, middlewareMetrics);
      }
    };

    try {
      await next();
    } finally {
      const totalTime = performance.now() - startTime;
      this.metrics.avgTime =
        (this.metrics.avgTime * (this.metrics.executions - 1) + totalTime) / this.metrics.executions;
    }
  }

  /**
   * Clear all middleware
   */
  clear(): void {
    this.globalMiddleware.clear();
    this.serviceMiddleware.clear();
    this.methodMiddleware.clear();

    // Re-initialize stages
    for (const stage of Object.values(MiddlewareStage)) {
      this.globalMiddleware.set(stage as MiddlewareStage, []);
    }

    // Reset metrics
    this.metrics = {
      executions: 0,
      avgTime: 0,
      errors: 0,
      skips: 0,
      byMiddleware: new Map(),
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): MiddlewareMetrics {
    return { ...this.metrics };
  }
}
