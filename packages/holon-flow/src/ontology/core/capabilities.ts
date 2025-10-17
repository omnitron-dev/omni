/**
 * Capabilities System - Capabilities-Based Component Composition
 *
 * Capabilities define what a component can do. Components can only be composed
 * if their capabilities match appropriately.
 *
 * Philosophy:
 * - Components declare what they can do (capabilities)
 * - Components declare what they need (requirements)
 * - Composition is only valid if requirements are satisfied
 *
 * @module ontology/core/capabilities
 */

import type { Brand } from './brand-types.js';
import type { ProtocolName } from './protocols.js';

/**
 * Capability - A named capability with optional parameters
 */
export interface Capability {
  readonly name: string;
  readonly version?: string;
  readonly parameters?: Record<string, any>;
  readonly metadata?: CapabilityMetadata;
}

/**
 * Capability Metadata
 */
export interface CapabilityMetadata {
  description?: string;
  tags?: string[];
  experimental?: boolean;
  deprecated?: boolean;
  since?: string;
}

/**
 * Capability Set - A collection of capabilities
 */
export interface CapabilitySet {
  readonly capabilities: ReadonlyArray<Capability>;

  /**
   * Check if this set has a specific capability
   */
  has(name: string): boolean;

  /**
   * Get a capability by name
   */
  get(name: string): Capability | undefined;

  /**
   * Check if this set satisfies requirements
   */
  satisfies(requirements: CapabilityRequirements): boolean;

  /**
   * Combine with another capability set
   */
  merge(other: CapabilitySet): CapabilitySet;
}

/**
 * Capability Requirements
 */
export interface CapabilityRequirements {
  readonly required: ReadonlyArray<string>;
  readonly optional?: ReadonlyArray<string>;
  readonly anyOf?: ReadonlyArray<ReadonlyArray<string>>;
  readonly allOf?: ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * Well-Known Capabilities
 */
export const Capabilities = {
  // Data Capabilities
  READ: 'cap:data:read',
  WRITE: 'cap:data:write',
  STREAM: 'cap:data:stream',
  BATCH: 'cap:data:batch',
  QUERY: 'cap:data:query',
  TRANSFORM: 'cap:data:transform',
  VALIDATE: 'cap:data:validate',

  // Network Capabilities
  HTTP_CLIENT: 'cap:network:http:client',
  HTTP_SERVER: 'cap:network:http:server',
  WEBSOCKET_CLIENT: 'cap:network:websocket:client',
  WEBSOCKET_SERVER: 'cap:network:websocket:server',
  TCP: 'cap:network:tcp',
  UDP: 'cap:network:udp',

  // Storage Capabilities
  FILESYSTEM: 'cap:storage:filesystem',
  DATABASE: 'cap:storage:database',
  CACHE: 'cap:storage:cache',
  OBJECT_STORAGE: 'cap:storage:object',
  KEY_VALUE: 'cap:storage:key-value',

  // Processing Capabilities
  CPU_INTENSIVE: 'cap:processing:cpu',
  GPU: 'cap:processing:gpu',
  PARALLEL: 'cap:processing:parallel',
  CONCURRENT: 'cap:processing:concurrent',
  ASYNC: 'cap:processing:async',

  // Security Capabilities
  ENCRYPT: 'cap:security:encrypt',
  DECRYPT: 'cap:security:decrypt',
  SIGN: 'cap:security:sign',
  VERIFY: 'cap:security:verify',
  AUTHENTICATE: 'cap:security:authenticate',
  AUTHORIZE: 'cap:security:authorize',

  // Observability Capabilities
  LOGGING: 'cap:observability:logging',
  METRICS: 'cap:observability:metrics',
  TRACING: 'cap:observability:tracing',
  PROFILING: 'cap:observability:profiling',

  // State Capabilities
  STATELESS: 'cap:state:stateless',
  STATEFUL: 'cap:state:stateful',
  TRANSACTIONAL: 'cap:state:transactional',
  IDEMPOTENT: 'cap:state:idempotent',

  // Reliability Capabilities
  RETRY: 'cap:reliability:retry',
  TIMEOUT: 'cap:reliability:timeout',
  CIRCUIT_BREAKER: 'cap:reliability:circuit-breaker',
  FALLBACK: 'cap:reliability:fallback',
  BULKHEAD: 'cap:reliability:bulkhead',

  // Deployment Capabilities
  CONTAINER: 'cap:deployment:container',
  SERVERLESS: 'cap:deployment:serverless',
  EDGE: 'cap:deployment:edge',
  HYBRID: 'cap:deployment:hybrid',
} as const;

export type CapabilityName = (typeof Capabilities)[keyof typeof Capabilities] | string;

/**
 * Component with Capabilities
 */
export interface CapableComponent<T = any> {
  readonly id: string;
  readonly capabilities: CapabilitySet;
  readonly requirements: CapabilityRequirements;
  readonly value: T;
}

/**
 * Create a capability
 */
export function capability(name: CapabilityName, parameters?: Record<string, any>): Capability {
  return {
    name,
    parameters,
  };
}

/**
 * Create a capability set
 */
export function capabilitySet(capabilities: Capability[]): CapabilitySet {
  const capMap = new Map(capabilities.map((c) => [c.name, c]));

  return {
    capabilities,

    has(name: string): boolean {
      return capMap.has(name);
    },

    get(name: string): Capability | undefined {
      return capMap.get(name);
    },

    satisfies(requirements: CapabilityRequirements): boolean {
      // Check required capabilities
      for (const required of requirements.required) {
        if (!this.has(required)) {
          return false;
        }
      }

      // Check anyOf (at least one must be satisfied)
      if (requirements.anyOf) {
        for (const group of requirements.anyOf) {
          const hasAny = group.some((cap) => this.has(cap));
          if (!hasAny) {
            return false;
          }
        }
      }

      // Check allOf (all must be satisfied)
      if (requirements.allOf) {
        for (const group of requirements.allOf) {
          const hasAll = group.every((cap) => this.has(cap));
          if (!hasAll) {
            return false;
          }
        }
      }

      return true;
    },

    merge(other: CapabilitySet): CapabilitySet {
      const merged = new Map(capMap);

      for (const cap of other.capabilities) {
        if (!merged.has(cap.name)) {
          merged.set(cap.name, cap);
        }
      }

      return capabilitySet(Array.from(merged.values()));
    },
  };
}

/**
 * Create capability requirements
 */
export function requirements(
  required: string[],
  options?: {
    optional?: string[];
    anyOf?: string[][];
    allOf?: string[][];
  }
): CapabilityRequirements {
  return {
    required,
    optional: options?.optional,
    anyOf: options?.anyOf,
    allOf: options?.allOf,
  };
}

/**
 * Check if two components can be composed
 */
export function canCompose(provider: CapableComponent, consumer: CapableComponent): boolean {
  return provider.capabilities.satisfies(consumer.requirements);
}

/**
 * Capability Inference - Automatically infer capabilities from component
 */
export class CapabilityInferrer {
  /**
   * Infer capabilities from function signature and body
   */
  inferFromFunction(fn: Function): Capability[] {
    const inferred: Capability[] = [];
    const fnStr = fn.toString();

    // Check for async
    if (fnStr.includes('async') || fnStr.includes('Promise')) {
      inferred.push(capability(Capabilities.ASYNC));
    }

    // Check for network operations
    if (fnStr.includes('fetch') || fnStr.includes('http')) {
      inferred.push(capability(Capabilities.HTTP_CLIENT));
    }

    // Check for file system
    if (fnStr.includes('fs.') || fnStr.includes('readFile') || fnStr.includes('writeFile')) {
      inferred.push(capability(Capabilities.FILESYSTEM));
    }

    // Check for state
    if (fnStr.includes('this.') || fnStr.includes('state')) {
      inferred.push(capability(Capabilities.STATEFUL));
    } else {
      inferred.push(capability(Capabilities.STATELESS));
    }

    return inferred;
  }

  /**
   * Infer requirements from dependencies
   */
  inferRequirements(dependencies: any[]): CapabilityRequirements {
    const required: string[] = [];

    for (const dep of dependencies) {
      if (dep.capabilities) {
        required.push(...dep.capabilities.capabilities.map((c: Capability) => c.name));
      }
    }

    return requirements(required);
  }
}

/**
 * Capability-based Flow Composition
 */
export interface CapableFlow<In, Out> {
  (input: In): Out | Promise<Out>;
  readonly capabilities: CapabilitySet;
  readonly requirements: CapabilityRequirements;
  readonly protocol: ProtocolName;
}

/**
 * Create a capable flow
 */
export function capableFlow<In, Out>(
  fn: (input: In) => Out | Promise<Out>,
  options: {
    capabilities: Capability[];
    requirements?: CapabilityRequirements;
    protocol: ProtocolName;
  }
): CapableFlow<In, Out> {
  const flow = fn as CapableFlow<In, Out>;

  Object.defineProperties(flow, {
    capabilities: {
      value: capabilitySet(options.capabilities),
      enumerable: true,
    },
    requirements: {
      value: options.requirements || requirements([]),
      enumerable: true,
    },
    protocol: {
      value: options.protocol,
      enumerable: true,
    },
  });

  return flow;
}

/**
 * Compose capable flows with safety checks
 */
export function composeCapable<A, B, C>(
  flowA: CapableFlow<A, B>,
  flowB: CapableFlow<B, C>
): CapableFlow<A, C> | null {
  // Check if flowA's capabilities satisfy flowB's requirements
  if (!flowA.capabilities.satisfies(flowB.requirements)) {
    return null;
  }

  // Create composed flow
  const composed = async (input: A): Promise<C> => {
    const intermediate = await flowA(input);
    return await flowB(intermediate);
  };

  // Merge capabilities and requirements
  return capableFlow(composed, {
    capabilities: [...flowA.capabilities.capabilities, ...flowB.capabilities.capabilities],
    requirements: flowA.requirements,
    protocol: flowA.protocol, // Use first flow's protocol
  });
}

/**
 * Capability Registry - Global registry of components and their capabilities
 */
export class CapabilityRegistry {
  private components = new Map<string, CapableComponent>();
  private capabilityIndex = new Map<string, Set<string>>();

  /**
   * Register a component
   */
  register(component: CapableComponent): void {
    this.components.set(component.id, component);

    // Index by capabilities
    for (const cap of component.capabilities.capabilities) {
      let components = this.capabilityIndex.get(cap.name);
      if (!components) {
        components = new Set();
        this.capabilityIndex.set(cap.name, components);
      }
      components.add(component.id);
    }
  }

  /**
   * Find components by capability
   */
  findByCapability(capabilityName: string): CapableComponent[] {
    const componentIds = this.capabilityIndex.get(capabilityName);
    if (!componentIds) {
      return [];
    }

    return Array.from(componentIds)
      .map((id) => this.components.get(id))
      .filter((c): c is CapableComponent => c !== undefined);
  }

  /**
   * Find components that satisfy requirements
   */
  findBySatisfying(requirements: CapabilityRequirements): CapableComponent[] {
    return Array.from(this.components.values()).filter((component) =>
      component.capabilities.satisfies(requirements)
    );
  }

  /**
   * Find compatible components (can be composed with target)
   */
  findCompatible(target: CapableComponent): CapableComponent[] {
    return Array.from(this.components.values()).filter((component) => canCompose(component, target));
  }

  /**
   * Get component by id
   */
  get(id: string): CapableComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Check if component exists
   */
  has(id: string): boolean {
    return this.components.has(id);
  }

  /**
   * Get all registered components
   */
  all(): CapableComponent[] {
    return Array.from(this.components.values());
  }
}

/**
 * Global capability registry
 */
export const capabilityRegistry = new CapabilityRegistry();
