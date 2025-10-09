/**
 * Process Manager Decorators
 *
 * Decorators for defining processes, workflows, supervisors and other
 * process management constructs in Titan PM.
 */

import 'reflect-metadata';
import { Errors } from '../../errors/index.js';
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
  ISelfHealAction
} from './types.js';

// ============================================================================
// Metadata Keys
// ============================================================================

export const PROCESS_METADATA_KEY = Symbol('process:metadata');
export const PROCESS_METHOD_METADATA_KEY = Symbol('process:method:metadata');
export const SUPERVISOR_METADATA_KEY = Symbol('supervisor:metadata');
export const WORKFLOW_METADATA_KEY = Symbol('workflow:metadata');
export const ACTOR_METADATA_KEY = Symbol('actor:metadata');

// ============================================================================
// Process Decorators
// ============================================================================

/**
 * Mark a class as a Process that can be spawned as a Netron service
 */
export function Process(options: IProcessOptions = {}): ClassDecorator {
  return (target: any) => {
    const metadata: IProcessMetadata = {
      ...options,
      target,
      isProcess: true,
      methods: new Map()
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

      const methodMetadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        prototype,
        propertyName
      );

      if (methodMetadata) {
        metadata.methods!.set(propertyName, methodMetadata);
      }
    }

    return target;
  };
}

/**
 * Mark a method as publicly accessible via RPC
 */
export function Public(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(
      target,
      propertyKey,
      descriptor
    );
    metadata.public = true;
  };
}

/**
 * Apply rate limiting to a process method
 */
export function RateLimit(options: IRateLimitOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(
      target,
      propertyKey,
      descriptor
    );
    metadata.rateLimit = options;
  };
}

/**
 * Enable caching for a process method
 */
export function Cache(options: ICacheOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(
      target,
      propertyKey,
      descriptor
    );
    metadata.cache = options;
  };
}

/**
 * Add validation to a process method
 */
export function Validate(options: IValidationOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(
      target,
      propertyKey,
      descriptor
    );
    metadata.validate = options;
  };
}

/**
 * Enable tracing for a process method
 */
export function Trace(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(
      target,
      propertyKey,
      descriptor
    );
    metadata.trace = true;
  };
}

/**
 * Enable metrics collection for a process method
 */
export function Metric(name?: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: IProcessMethodMetadata = getOrCreateMethodMetadata(
      target,
      propertyKey,
      descriptor
    );
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
      children: existingMetadata.children || new Map<string, ISupervisorChild>()
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
      ...options
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
      stages: existingMetadata.stages || new Map<string, IWorkflowStage>()
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
      stages: new Map()
    };

    // Normalize dependsOn to always be an array
    const normalizedOptions = { ...options };
    if (normalizedOptions.dependsOn && !Array.isArray(normalizedOptions.dependsOn)) {
      normalizedOptions.dependsOn = [normalizedOptions.dependsOn];
    }

    const stage: IWorkflowStage = {
      name: String(propertyKey),
      handler: descriptor.value,
      ...normalizedOptions
    };

    metadata.stages.set(String(propertyKey), stage);
    Reflect.defineMetadata(WORKFLOW_METADATA_KEY, metadata, target.constructor);
  };
}

/**
 * Define a compensation handler for a workflow stage
 */
export function Compensate(stageName: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, target.constructor) || {
      stages: new Map()
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
 * Mark a class as an Actor
 */
export function Actor(options: any = {}): ClassDecorator {
  return (target: any) => {
    const metadata = {
      ...options,
      target,
      isActor: true
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
    let failures = 0;
    let lastFailTime = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';

    descriptor.value = async function (this: any, ...args: any[]) {
      const { threshold = 5, timeout = 60000, fallback } = options;

      // Check if circuit is open
      if (state === 'open') {
        const timeSinceLastFail = Date.now() - lastFailTime;
        if (timeSinceLastFail > timeout) {
          state = 'half-open';
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
        if (state === 'half-open') {
          state = 'closed';
          failures = 0;
        }

        return result;
      } catch (error) {
        failures++;
        lastFailTime = Date.now();

        if (failures >= threshold) {
          state = 'open';
        }

        // Use fallback if available
        if (fallback && typeof (this as any)[fallback] === 'function') {
          return (this as any)[fallback](...args);
        }

        throw error;
      }
    };
  };
}

/**
 * Add self-healing behavior to a method
 */
export function SelfHeal(options: ISelfHealAction): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Store self-healing metadata for runtime processing
    const metadata = {
      method: propertyKey,
      ...options
    };

    const existing = Reflect.getMetadata('self-heal', target) || [];
    existing.push(metadata);
    Reflect.defineMetadata('self-heal', existing, target);
  };
}

/**
 * Make a method idempotent
 */
export function Idempotent(options: { key: string; ttl?: string }): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    const cache = new Map<string, { result: any; timestamp: number }>();

    descriptor.value = async function (this: any, ...args: any[]) {
      // Extract idempotency key from request
      const key = args[0]?.[options.key] || options.key;

      // Check cache
      const cached = cache.get(key);
      if (cached) {
        const ttl = parseDuration(options.ttl || '1h');
        if (Date.now() - cached.timestamp < ttl) {
          return cached.result;
        }
      }

      // Execute and cache
      const result = await original.apply(this, args);
      cache.set(key, { result, timestamp: Date.now() });

      return result;
    };
  };
}

// ============================================================================
// Dependency Injection Decorators
// ============================================================================

/**
 * Inject a process as a dependency
 */
export function InjectProcess(ProcessClass: any): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existingTokens = Reflect.getMetadata('design:paramtypes', target) || [];
    const existingInjects = Reflect.getMetadata('custom:inject:process', target) || [];

    existingInjects[parameterIndex] = ProcessClass;
    Reflect.defineMetadata('custom:inject:process', existingInjects, target);
  };
}

/**
 * Define a composable service
 */
export function Compose(...services: any[]): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = {
      services,
      method: propertyKey
    };

    const existing = Reflect.getMetadata('compose', target) || [];
    existing.push(metadata);
    Reflect.defineMetadata('compose', existing, target);
  };
}

// ============================================================================
// Advanced Decorators
// ============================================================================

/**
 * Enable shared state across process instances
 */
export function SharedState(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = Reflect.getMetadata('shared-state', target) || [];
    existing.push(propertyKey);
    Reflect.defineMetadata('shared-state', existing, target);
  };
}

/**
 * Define a health check method
 */
export function HealthCheck(options: { interval?: number } = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = {
      method: propertyKey,
      ...options
    };
    Reflect.defineMetadata('health-check', metadata, target);
  };
}

/**
 * Handle process shutdown gracefully
 */
export function OnShutdown(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('on-shutdown', propertyKey, target);
  };
}

/**
 * Enable adaptive bitrate for streaming
 */
export function AdaptiveBitrate(options: any): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = {
      method: propertyKey,
      ...options
    };
    Reflect.defineMetadata('adaptive-bitrate', metadata, target);
  };
}

/**
 * Define a GraphQL service
 */
export function GraphQLService(options: any): ClassDecorator {
  return (target: any) => {
    const metadata = {
      ...options,
      target
    };
    Reflect.defineMetadata('graphql-service', metadata, target);
    return target;
  };
}

/**
 * Define a distributed transaction
 */
export function DistributedTransaction(): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata('distributed-transaction', true, target);
    return target;
  };
}

/**
 * Define a saga
 */
export function Saga(options: any = {}): ClassDecorator {
  return (target: any) => {
    const metadata = {
      ...options,
      target,
      steps: new Map()
    };
    Reflect.defineMetadata('saga', metadata, target);
    return target;
  };
}

/**
 * Define a saga step
 */
export function Step(options: any = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata('saga', target.constructor) || { steps: new Map() };
    metadata.steps.set(propertyKey, { ...options, handler: descriptor.value });
    Reflect.defineMetadata('saga', metadata, target.constructor);
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
  descriptor: PropertyDescriptor
): IProcessMethodMetadata {
  let metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, target, propertyKey);

  if (!metadata) {
    metadata = {
      name: String(propertyKey),
      descriptor
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
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}