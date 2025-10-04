/**
 * Type-Safe Contract System with Perfect Type Inference
 *
 * Provides compile-time type safety and perfect type inference for
 * HTTP service contracts, eliminating runtime errors and improving DX.
 */

import { z } from 'zod';
import type { Contract, MethodContract } from '../../../validation/contract.js';
import { HttpTransportClient } from './client.js';
import type { OptimisticUpdateOptions } from './optimistic-update-manager.js';

/**
 * Contract definition for type-safe services
 */
export type ContractDefinition = Record<string, MethodContract>;

/**
 * Middleware configuration type
 */
export interface MiddlewareConfig {
  auth?: boolean;
  rateLimit?: number;
  cache?: boolean;
  retry?: boolean;
  [key: string]: any;
}

/**
 * Service method type based on contract
 */
export type ServiceMethod<M extends MethodContract> =
  M['stream'] extends true
    ? StreamMethod<M>
    : AsyncMethod<M>;

/**
 * Async method type with input/output inference
 */
export type AsyncMethod<M extends MethodContract> =
  M['input'] extends z.ZodSchema<infer I>
    ? M['output'] extends z.ZodSchema<infer O>
      ? (input: I) => Promise<O>
      : never
    : never;

/**
 * Stream method type with input/output inference
 */
export type StreamMethod<M extends MethodContract> =
  M['input'] extends z.ZodSchema<infer I>
    ? M['output'] extends z.ZodSchema<infer O>
      ? (input: I) => AsyncIterable<O>
      : never
    : never;

/**
 * Service type inferred from contract definition
 */
export type ServiceType<T extends ContractDefinition> = {
  [K in keyof T]: ServiceMethod<T[K]>;
};

/**
 * Infer input type from method contract
 */
export type InferInput<M extends MethodContract> =
  M['input'] extends z.ZodSchema<infer I> ? I : never;

/**
 * Infer output type from method contract
 */
export type InferOutput<M extends MethodContract> =
  M['output'] extends z.ZodSchema<infer O> ? O : never;

/**
 * Service proxy type with middleware
 */
export type ServiceProxy<
  T extends ContractDefinition,
  M extends MiddlewareConfig = {}
> = ServiceType<T> & {
  _middleware?: M;
};

/**
 * Query options for method calls
 */
export interface QueryOptions {
  cache?: {
    maxAge?: number;
    staleWhileRevalidate?: number;
    tags?: string[];
  };
  retry?: {
    attempts?: number;
    backoff?: 'exponential' | 'linear' | 'constant';
    maxDelay?: number;
  };
  timeout?: number;
  priority?: 'high' | 'normal' | 'low';
  optimisticUpdate?: OptimisticUpdateOptions;
  customMiddleware?: (ctx: any, next: () => Promise<void>) => Promise<void>;
  invalidateTags?: string[];
  dedupeKey?: string;
  backgroundRefetch?: number;
}

/**
 * Enhanced Contract with perfect type inference
 */
export class TypedContract<T extends ContractDefinition> {
  constructor(private definition: T) {}

  /**
   * Infer complete service type from contract
   */
  inferService(): ServiceType<T> {
    return this.createProxy();
  }

  /**
   * Generate type-safe HTTP client
   */
  generateClient<M extends MiddlewareConfig = {}>(
    baseUrl: string,
    options?: { middleware?: M }
  ): TypedHttpClient<T, M> {
    return new TypedHttpClient(this, baseUrl, options);
  }

  /**
   * Get contract definition
   */
  getDefinition(): T {
    return this.definition;
  }

  /**
   * Create service proxy
   */
  private createProxy(): ServiceType<T> {
    return new Proxy({} as ServiceType<T>, {
      get: (_, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;

        const method = this.definition[prop];
        if (!method) return undefined;

        // Return a function that validates and processes the call
        return async (input: any) => {
          // Validate input if schema exists
          if (method.input) {
            const validation = method.input.safeParse(input);
            if (!validation.success) {
              throw new Error(`Input validation failed: ${validation.error.message}`);
            }
          }

          // This is a placeholder - actual implementation would call the service
          throw new Error(`Service method ${prop} not implemented`);
        };
      }
    });
  }
}

/**
 * Type-Safe HTTP Client with Fluent API
 */
export class TypedHttpClient<
  TContract extends ContractDefinition,
  TMiddleware extends MiddlewareConfig = {}
> {
  private transport: HttpTransportClient;
  private serviceName: string;

  constructor(
    private contract: TypedContract<TContract>,
    private baseUrl: string,
    private options?: {
      middleware?: TMiddleware;
      serviceName?: string;
    }
  ) {
    this.transport = new HttpTransportClient(baseUrl);
    this.serviceName = options?.serviceName || 'Service';
  }

  /**
   * Type-safe method call with autocomplete
   */
  call<K extends keyof TContract>(
    method: K,
    input: InferInput<TContract[K]>
  ): QueryBuilder<TContract, K> {
    return new QueryBuilder(
      this.transport,
      this.serviceName,
      method as string,
      input,
      this.contract.getDefinition()[method]
    );
  }

  /**
   * Get direct service proxy with type inference
   */
  get service(): ServiceProxy<TContract, TMiddleware> {
    return new Proxy({} as ServiceProxy<TContract, TMiddleware>, {
      get: (_, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        if (prop === '_middleware') return this.options?.middleware;

        const methodContract = this.contract.getDefinition()[prop];
        if (!methodContract) return undefined;

        return (input: any) => {
          return this.call(prop as keyof TContract, input).execute();
        };
      }
    });
  }

  /**
   * Batch multiple method calls
   */
  async batch<K extends keyof TContract>(
    calls: Array<{ method: K; input: InferInput<TContract[K]> }>
  ): Promise<Array<InferOutput<TContract[K]>>> {
    const results = await Promise.all(
      calls.map(({ method, input }) =>
        this.call(method, input).execute()
      )
    );
    return results;
  }

  /**
   * Subscribe to real-time events
   */
  subscribe<K extends keyof TContract>(
    event: K,
    handler: (data: InferOutput<TContract[K]>) => void
  ): () => void {
    // Implementation would use SubscriptionManager
    console.warn('Subscriptions not yet implemented');
    return () => {};
  }
}

/**
 * Query Builder with chainable API and type preservation
 */
export class QueryBuilder<
  TContract extends ContractDefinition,
  TMethod extends keyof TContract = keyof TContract
> {
  private options: QueryOptions = {};

  constructor(
    private transport: HttpTransportClient,
    private serviceName: string,
    private method: string,
    private input: InferInput<TContract[TMethod]>,
    private methodContract: TContract[TMethod]
  ) {}

  /**
   * Configure caching with type preservation
   */
  cache<T extends this>(config: QueryOptions['cache']): T {
    this.options.cache = config;
    return this as T;
  }

  /**
   * Configure retry with type preservation
   */
  retry<T extends this>(config: QueryOptions['retry']): T {
    this.options.retry = config;
    return this as T;
  }

  /**
   * Add middleware with type preservation
   */
  middleware<M extends (ctx: any, next: () => Promise<void>) => Promise<void>, T extends this>(
    fn: M
  ): QueryBuilder<TContract, TMethod> & { middleware: M } {
    this.options.customMiddleware = fn;
    return this as any;
  }

  /**
   * Configure timeout
   */
  timeout<T extends this>(ms: number): T {
    this.options.timeout = ms;
    return this as T;
  }

  /**
   * Configure priority
   */
  priority<T extends this>(level: 'high' | 'normal' | 'low'): T {
    this.options.priority = level;
    return this as T;
  }

  /**
   * Invalidate cache tags on success
   */
  invalidateOn<T extends this>(tags: string[]): T {
    this.options.invalidateTags = tags;
    return this as T;
  }

  /**
   * Enable request deduplication
   */
  dedupe<T extends this>(key: string): T {
    this.options.dedupeKey = key;
    return this as T;
  }

  /**
   * Enable background refetch
   */
  background<T extends this>(interval: number): T {
    this.options.backgroundRefetch = interval;
    return this as T;
  }

  /**
   * Execute with perfect return type inference
   */
  async execute(): Promise<InferOutput<TContract[TMethod]>> {
    // Validate input if schema exists
    if (this.methodContract.input) {
      const validation = this.methodContract.input.safeParse(this.input);
      if (!validation.success) {
        throw new Error(`Input validation failed: ${validation.error.message}`);
      }
    }

    // Execute via transport
    const result = await this.transport.invoke(
      this.serviceName,
      this.method,
      [this.input],
      this.options
    );

    // Validate output if schema exists
    if (this.methodContract.output) {
      const validation = this.methodContract.output.safeParse(result);
      if (!validation.success) {
        throw new Error(`Output validation failed: ${validation.error.message}`);
      }
      return validation.data;
    }

    return result;
  }

  /**
   * Create mutation with optimistic updates
   */
  mutate<T extends InferOutput<TContract[TMethod]>>(
    optimisticUpdate?: (current: T | undefined) => T
  ): MutationBuilder<TContract, TMethod> {
    return new MutationBuilder(this, optimisticUpdate);
  }
}

/**
 * Mutation Builder for optimistic updates
 */
export class MutationBuilder<
  TContract extends ContractDefinition,
  TMethod extends keyof TContract
> {
  constructor(
    private queryBuilder: QueryBuilder<TContract, TMethod>,
    private optimisticUpdate?: (current: any) => any
  ) {}

  /**
   * Configure rollback handler
   */
  onRollback(
    handler: (key: string, originalValue: any, error: Error) => void
  ): this {
    // Store rollback handler in options
    return this;
  }

  /**
   * Configure success handler
   */
  onSuccess(handler: (data: InferOutput<TContract[TMethod]>) => void): this {
    // Store success handler
    return this;
  }

  /**
   * Execute mutation with optimistic update
   */
  async execute(): Promise<InferOutput<TContract[TMethod]>> {
    // Implementation would use OptimisticUpdateManager
    return this.queryBuilder.execute();
  }
}

/**
 * Create a typed contract from definition
 */
export function createTypedContract<T extends ContractDefinition>(
  definition: T
): TypedContract<T> {
  return new TypedContract(definition);
}

/**
 * Create a typed HTTP client
 */
export function createTypedClient<T extends ContractDefinition>(
  contract: TypedContract<T>,
  baseUrl: string,
  options?: { middleware?: MiddlewareConfig; serviceName?: string }
): TypedHttpClient<T> {
  return contract.generateClient(baseUrl, options);
}