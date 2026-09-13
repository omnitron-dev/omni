/**
 * Process Manager Decorators
 *
 * Decorators for defining processes, workflows, supervisors and other
 * process management constructs in Titan PM.
 */

import 'reflect-metadata';
import { Errors } from '@omnitron-dev/titan/errors';
import type {
  IProcessOptions,
  IProcessMetadata,
  IProcessMethodMetadata,
  ISupervisorOptions,
  ISupervisorChild,
  IWorkflowStage,
  IRateLimitOptions,
  ICacheOptions,
  IValidationOptions,
  ICircuitBreakerOptions,
} from './types.js';

import { Public as CorePublic } from '@omnitron-dev/titan/decorators';

/**
 * PM-specific Public decorator that wraps core @Public and also sets
 * PM-specific metadata (PROCESS_METHOD_METADATA_KEY) for worker runtime compatibility.
 *
 * @example
 * ```typescript
 * @Process({ name: 'calculator' })
 * class Calculator {
 *   @Public()
 *   add(a: number, b: number) { return a + b; }
 * }
 * ```
 */
export function Public(options?: { readonly?: boolean }): MethodDecorator & PropertyDecorator {
  return (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor): any => {
    // Call core @Public decorator
    CorePublic(options)(target, propertyKey, descriptor);

    // Also set PM-specific metadata for worker runtime
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    metadata.public = true;

    return descriptor;
  };
}

// ============================================================================
// Metadata Keys
// ============================================================================

export const PROCESS_METADATA_KEY = Symbol.for('process:metadata');
export const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');
export const SUPERVISOR_METADATA_KEY = Symbol.for('titan:supervisor:metadata');
export const WORKFLOW_METADATA_KEY = Symbol.for('titan:workflow:metadata');
export const ACTOR_METADATA_KEY = Symbol.for('titan:actor:metadata');

// ============================================================================
// Process Decorators
// ============================================================================

/**
 * Mark a class as a Process that can be spawned as a Netron service
 *
 * @example
 * // All methods need @Public() decorator
 * @Process({ name: 'calculator' })
 * class Calculator {
 *   @Public()
 *   add(a: number, b: number) { return a + b; }
 * }
 *
 * @example
 * // All methods are automatically public - no @Public() needed
 * @Process({ name: 'calculator', allMethodsPublic: true })
 * class Calculator {
 *   add(a: number, b: number) { return a + b; }
 *   subtract(a: number, b: number) { return a - b; }
 * }
 */
export function Process(options: IProcessOptions = {}): ClassDecorator {
  return (target: any) => {
    const metadata: IProcessMetadata = {
      ...options,
      target,
      isProcess: true,
      methods: new Map(),
    };

    // Store metadata
    Reflect.defineMetadata(PROCESS_METADATA_KEY, metadata, target);

    // Collect method metadata
    const prototype = target.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      let methodMetadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);

      // Auto-mark all methods as public if allMethodsPublic option is set
      if (options.allMethodsPublic && !methodMetadata) {
        methodMetadata = { public: true };
        Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, methodMetadata, prototype, propertyName);
      }

      if (methodMetadata) {
        // Ensure public flag is set when allMethodsPublic is enabled
        if (options.allMethodsPublic) {
          methodMetadata.public = true;
        }
        metadata.methods!.set(propertyName, methodMetadata);
      }
    }

    return target;
  };
}

/**
 * Record a rate limit on a process method.
 *
 * DECLARATIVE ONLY — this writes `metadata.rateLimit` and nothing reads it:
 * the worker runtime consults `public` and `healthCheck` from that metadata
 * and no more. A method carrying it is not rate limited.
 *
 * Note the name collision, which is the part that bites: `RateLimit` from
 * `@omnitron-dev/titan-ratelimit` DOES enforce, takes `{ limit, windowMs }`
 * rather than `{ rps, strategy }`, and is what almost every caller in this
 * repository imports. Two decorators, one name, opposite behaviour — picking
 * the import from this package silently turns the limit off.
 */
export function RateLimit(options: IRateLimitOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    metadata.rateLimit = options;
  };
}

/**
 * Enable caching for a process method
 */
export function Cache(options: ICacheOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    metadata.cache = options;
  };
}

/**
 * Add validation to a process method
 */
export function Validate(options: IValidationOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    metadata.validate = options;
  };
}

/**
 * Enable tracing for a process method
 */
export function Trace(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    metadata.trace = true;
  };
}

/**
 * Enable metrics collection for a process method
 */
export function Metric(name?: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    metadata.metrics = true;
  };
}

// ============================================================================
// Supervisor Decorators
// ============================================================================

/**
 * Mark a class as a Supervisor that manages child processes
 */
export function Supervisor(options: ISupervisorOptions = {}): ClassDecorator {
  return (target: any) => {
    // Get existing metadata (may have been set by Child decorators)
    const existingMetadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, target) || {};

    // Merge with new options, preserving existing children Map
    const metadata = {
      ...existingMetadata,
      ...options,
      target,
      children: existingMetadata.children || new Map<string, ISupervisorChild>(),
    };

    Reflect.defineMetadata(SUPERVISOR_METADATA_KEY, metadata, target);
    return target;
  };
}

/**
 * Define a child process in a supervisor
 */
export function Child(options: Partial<ISupervisorChild> = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // Get or create metadata
    let metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, target.constructor);
    if (!metadata) {
      metadata = { children: new Map() };
    }
    if (!metadata.children) {
      metadata.children = new Map();
    }

    // Store child definition with property key
    const childDef: ISupervisorChild = {
      name: String(propertyKey),
      processClass: null, // Will be resolved from property value at runtime
      propertyKey: String(propertyKey), // Store property key for resolution
      ...options,
    };

    metadata.children.set(String(propertyKey), childDef);
    Reflect.defineMetadata(SUPERVISOR_METADATA_KEY, metadata, target.constructor);
  };
}

// ============================================================================
// Workflow Decorators
// ============================================================================

/**
 * Mark a class as a Workflow
 */
export function Workflow(): ClassDecorator {
  return (target: any) => {
    // Get existing metadata (may have been set by Stage decorators)
    const existingMetadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, target) || {};

    // Merge with new options, preserving existing stages Map
    const metadata = {
      ...existingMetadata,
      target,
      stages: existingMetadata.stages || new Map<string, IWorkflowStage>(),
    };

    Reflect.defineMetadata(WORKFLOW_METADATA_KEY, metadata, target);
    return target;
  };
}

/**
 * Define a workflow stage
 */
export function Stage(options: Partial<IWorkflowStage> = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, target.constructor) || {
      stages: new Map(),
    };

    // Normalize dependsOn to always be an array
    const normalizedOptions = { ...options };
    if (normalizedOptions.dependsOn && !Array.isArray(normalizedOptions.dependsOn)) {
      normalizedOptions.dependsOn = [normalizedOptions.dependsOn];
    }

    // Use options.name if provided, otherwise use propertyKey
    const stageName = options.name || String(propertyKey);

    const stage: IWorkflowStage = {
      name: stageName,
      handler: descriptor.value,
      ...normalizedOptions,
    };

    // Store with the stage name as key (for @Compensate to find)
    metadata.stages.set(stageName, stage);
    Reflect.defineMetadata(WORKFLOW_METADATA_KEY, metadata, target.constructor);
  };
}

/**
 * Define a compensation handler for a workflow stage
 */
export function Compensate(stageName: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, target.constructor) || {
      stages: new Map(),
    };

    const stage = metadata.stages.get(stageName);
    if (stage) {
      (stage as any).compensate = descriptor.value;
    }

    Reflect.defineMetadata(WORKFLOW_METADATA_KEY, metadata, target.constructor);
  };
}

// ============================================================================
// Actor Model Decorators
// ============================================================================

/**
 * Mark a class as an Actor.
 *
 * NOT IMPLEMENTED — records `ACTOR_METADATA_KEY` and nothing reads it. There
 * is no actor runtime in this package or anywhere in the monorepo: no mailbox,
 * no serialised message processing, no actor supervision. A class carrying
 * this behaves exactly as it would without it.
 *
 * Marked rather than deleted because it is exported from `index.ts` and is
 * therefore reachable API, the same reason the aspirational option interfaces
 * in `types.ts` are marked rather than removed. Nine sibling decorators —
 * @Saga, @Step, @SharedState, @Compose, @SelfHeal, @AdaptiveBitrate,
 * @GraphQLService, @DistributedTransaction and @InjectProcess — were equally
 * inert but reachable only from inside this package, so they went.
 *
 * For multi-step work with compensation, which is what @Saga/@Step claimed,
 * use @Workflow / @Stage / @Compensate: those are executed by
 * `process-workflow.ts`.
 */
export function Actor(options: any = {}): ClassDecorator {
  return (target: any) => {
    const metadata = {
      ...options,
      target,
      isActor: true,
    };
    Reflect.defineMetadata(ACTOR_METADATA_KEY, metadata, target);
    return target;
  };
}

// ============================================================================
// Resilience Decorators
// ============================================================================

/**
 * Add circuit breaker to a method
 */
export function CircuitBreaker(options: ICircuitBreakerOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    const stateMap = new WeakMap<
      object,
      { failures: number; lastFailTime: number; state: 'closed' | 'open' | 'half-open' }
    >();

    descriptor.value = async function circuitBreakerHandler(this: any, ...args: any[]) {
      const { threshold = 5, timeout = 60000, fallback } = options;

      // Get or initialize instance-specific state
      let state = stateMap.get(this);
      if (!state) {
        state = { failures: 0, lastFailTime: 0, state: 'closed' };
        stateMap.set(this, state);
      }

      // Check if circuit is open
      if (state.state === 'open') {
        const timeSinceLastFail = Date.now() - state.lastFailTime;
        if (timeSinceLastFail > timeout) {
          state.state = 'half-open';
        } else {
          // Use fallback if available
          if (fallback && typeof (this as any)[fallback] === 'function') {
            return (this as any)[fallback](...args);
          }
          throw Errors.conflict('Circuit breaker is open');
        }
      }

      try {
        const result = await original.apply(this, args);

        // Success - reset on half-open
        if (state.state === 'half-open') {
          state.state = 'closed';
          state.failures = 0;
        }

        return result;
      } catch (error) {
        state.failures++;
        state.lastFailTime = Date.now();

        if (state.failures >= threshold) {
          state.state = 'open';
        }

        // Use fallback if available
        if (fallback && typeof (this as any)[fallback] === 'function') {
          return (this as any)[fallback](...args);
        }

        throw error;
      }
    };

    return descriptor;
  };
}


/**
 * Make a method idempotent: a repeated call carrying the same key returns the
 * first call's result instead of running the body again.
 *
 * `options.key` names a FIELD ON THE FIRST ARGUMENT — `{ key: 'requestId' }`
 * reads `args[0].requestId`. It is not a template; `'user-{args.0}'` names no
 * field and is treated as a call with no key.
 *
 * A call whose argument does not carry that field is executed and NOT cached.
 * The previous fallback was `|| options.key`, the option name itself — a
 * constant — so every keyless call shared one entry for the whole TTL and the
 * first caller's result was handed to every caller after it. A cache that
 * answers the wrong question is worse than no cache; without identity there is
 * nothing to be idempotent about.
 *
 * Overlapping calls with the same key share one execution: a retry that
 * arrives before the first response is the case this decorator exists for. A
 * rejection is never cached — a failure is not an answer.
 *
 * Scope is ONE INSTANCE IN ONE PROCESS. In a pool, the same logical request
 * routed to another worker runs again; this is a guard against local retries,
 * not a distributed idempotency store.
 */
export function Idempotent(options: { key: string; ttl?: string }): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    const ttlSource = options.ttl || '1h';
    const ttl = parseDuration(ttlSource);

    // parseDuration answers 0 for anything it cannot read, and 'ms' — the
    // first unit most people try — is not one of the four it supports. Left
    // to return 0, every lookup compares against a zero window and the
    // decorator silently caches nothing. Refuse at decoration time, the way
    // @RateLimit refuses a non-positive limit.
    if (ttl <= 0) {
      throw new Error(
        `@Idempotent: ttl must be a positive duration in s/m/h/d, got ${JSON.stringify(ttlSource)} ` +
          `on ${target?.constructor?.name ?? 'class'}.${String(propertyKey)}`
      );
    }

    interface IIdempotencyEntry {
      result?: any;
      inFlight?: Promise<any>;
      timestamp: number;
    }

    const cacheMap = new WeakMap<object, Map<string, IIdempotencyEntry>>();

    descriptor.value = async function idempotentHandler(this: any, ...args: any[]) {
      const first = args[0];
      const raw = first !== null && typeof first === 'object' ? (first as any)[options.key] : undefined;
      if (raw === undefined || raw === null) {
        return original.apply(this, args);
      }
      const key = String(raw);

      let cache = cacheMap.get(this);
      if (!cache) {
        cache = new Map<string, IIdempotencyEntry>();
        cacheMap.set(this, cache);
      }

      const cached = cache.get(key);
      // Join a running call whatever the clock says: a body that outlives its
      // own TTL must not be started a second time alongside itself.
      if (cached?.inFlight) return cached.inFlight;

      const now = Date.now();
      if (cached) {
        if (now - cached.timestamp < ttl) return cached.result;
        cache.delete(key);
      }

      const entry: IIdempotencyEntry = { timestamp: now };
      const inFlight = (async () => {
        try {
          const result = await original.apply(this, args);
          entry.result = result;
          entry.inFlight = undefined;
          entry.timestamp = Date.now();
          return result;
        } catch (error) {
          cache.delete(key);
          throw error;
        }
      })();
      entry.inFlight = inFlight;
      cache.set(key, entry);

      // Drop entries that have aged out, so a long-lived instance does not
      // grow without bound. Never touch a call still running.
      if (cache.size > 1) {
        for (const [cacheKey, existing] of cache) {
          if (cacheKey !== key && !existing.inFlight && now - existing.timestamp >= ttl) {
            cache.delete(cacheKey);
          }
        }
      }

      return inFlight;
    };

    return descriptor;
  };
}



// ============================================================================
// Lifecycle Decorators
// ============================================================================

/**
 * Define a health check method
 */
export function HealthCheck(options: { interval?: number } = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // The worker runtime finds health checks by scanning each method's entry
    // under PROCESS_METHOD_METADATA_KEY for a `healthCheck` field
    // (`worker-runtime.ts`, `__getProcessHealth`). This decorator wrote to a
    // different key entirely — the string 'health-check', on the prototype
    // rather than per method — so the two never met: `healthCheckMethods` was
    // always empty and `__getProcessHealth` always answered
    // `{ status: 'healthy', checks: [] }`.
    //
    // A worker that knows it is degraded reporting healthy is the exact
    // inversion a custom health check exists to prevent, and the pool's health
    // monitor consumes this answer.
    const methodMetadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    methodMetadata.healthCheck = { method: String(propertyKey), ...options };

    // The original prototype-level key is kept: it is part of the shape any
    // existing reader may rely on, and it costs nothing.
    Reflect.defineMetadata('health-check', { method: propertyKey, ...options }, target);
  };
}

/**
 * Handle process shutdown gracefully.
 *
 * Same defect as `@HealthCheck` above, four lines apart and left behind when
 * that one was fixed: `serviceWrapper.__shutdown` finds handlers by scanning
 * each method's entry under PROCESS_METHOD_METADATA_KEY for an `onShutdown`
 * field (`worker-runtime.ts`), and this decorator wrote to a different key
 * entirely — the string 'on-shutdown', on the prototype rather than per
 * method. The two never met: a method carrying `@OnShutdown` was never called,
 * and the runtime went on to `netron.stop()` and `process.exit(0)`. An exit
 * that skips the cleanup a process asked for looks exactly like a clean one.
 *
 * The prototype key was also single-valued, so two `@OnShutdown` methods on one
 * class overwrote each other — a limit the runtime does not have. Per method,
 * every handler runs.
 */
export function OnShutdown(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const methodMetadata: IProcessMethodMetadata = getOrCreateMethodMetadata(target, propertyKey, descriptor);
    methodMetadata.onShutdown = true;

    // The original prototype-level key is kept: it is part of the shape any
    // existing reader may rely on, and it costs nothing.
    Reflect.defineMetadata('on-shutdown', propertyKey, target);
  };
}






// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get or create method metadata
 */
function getOrCreateMethodMetadata(
  target: any,
  propertyKey: string | symbol,
  descriptor?: PropertyDescriptor
): IProcessMethodMetadata {
  let metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, target, propertyKey);

  if (!metadata) {
    metadata = {
      name: String(propertyKey),
      descriptor,
    };
    Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, metadata, target, propertyKey);
  }

  return metadata;
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 0;

  const [, value, unit] = match;
  if (!value || !unit) return 0;
  const num = parseInt(value, 10);

  switch (unit) {
    case 's':
      return num * 1000;
    case 'm':
      return num * 60 * 1000;
    case 'h':
      return num * 60 * 60 * 1000;
    case 'd':
      return num * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}
