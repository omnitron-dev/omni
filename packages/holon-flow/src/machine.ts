/**
 * FlowMachine - Enhanced Flow with complete reflection capabilities
 *
 * Provides a production-ready implementation of the Flow-Machine architecture
 * with metadata, optimization, serialization, and introspection.
 */

import type { Flow, FlowMeta } from './types.js';
import type { FlowId, FlowMetadata, FlowStructure, FlowJSON, FlowGraph, Transformer } from './reflection.js';
import { flow as basicFlow } from './flow.js';
import { registerFlow, globalFlowRegistry } from './registry.js';
import { extractSourceLocation, calculateComplexity, createFlowId } from './reflection.js';
import { EffectFlags } from './effects/index.js';

/**
 * FlowMachine interface - A Flow with complete reflection and optimization capabilities
 */
export interface FlowMachine<In = any, Out = any> extends Flow<In, Out> {
  /**
   * Unique identifier (content-based hash)
   */
  readonly id: FlowId;

  /**
   * Semantic version
   */
  readonly version: string;

  /**
   * Human-readable name
   */
  readonly name: string;

  /**
   * Complete metadata
   */
  readonly metadata: Partial<FlowMetadata>;

  // === Reflection Methods ===

  /**
   * Inspect the Flow's structure
   */
  inspect(): FlowStructure;

  /**
   * Get all Flow dependencies
   */
  dependencies(): Flow[];

  /**
   * Get effect flags
   */
  effects(): EffectFlags;

  /**
   * Check if Flow is pure (no side effects)
   */
  isPure(): boolean;

  // === Optimization Methods ===

  /**
   * Optimize the Flow (e.g., memoization, constant folding)
   */
  optimize(): FlowMachine<In, Out>;

  /**
   * Transform the Flow using a transformer
   */
  transform(transformer: Transformer): FlowMachine<In, Out>;

  // === Serialization Methods ===

  /**
   * Serialize to JSON
   */
  toJSON(): FlowJSON;

  /**
   * Convert to graph representation
   */
  toGraph(): FlowGraph;

  /**
   * Get source code
   */
  toString(): string;

  // === Enhanced Composition ===

  /**
   * Override pipe to return FlowMachine
   */
  pipe<Next>(next: Flow<Out, Next>): FlowMachine<In, Next>;
}

/**
 * Options for creating a FlowMachine
 */
export interface FlowMachineOptions<In, Out> {
  /**
   * The function to wrap
   */
  fn: (input: In) => Out | Promise<Out>;

  /**
   * Optional metadata
   */
  meta?: FlowMeta;

  /**
   * Optional effect flags
   */
  effects?: EffectFlags;

  /**
   * Pre-computed metadata (from compile-time transformer)
   */
  compiledMetadata?: Partial<FlowMetadata>;
}

/**
 * Create a FlowMachine with full reflection capabilities
 */
export function createFlowMachine<In, Out>(
  fnOrOptions: ((input: In) => Out | Promise<Out>) | FlowMachineOptions<In, Out>,
  meta?: FlowMeta
): FlowMachine<In, Out> {
  // Normalize arguments
  const options: FlowMachineOptions<In, Out> =
    typeof fnOrOptions === 'function' ? { fn: fnOrOptions, meta } : fnOrOptions;

  const { fn, meta: flowMeta, effects: effectFlags, compiledMetadata } = options;

  // Create base Flow
  const baseFlow = basicFlow(fn, flowMeta);

  // Generate source and ID
  const source = fn.toString();
  const flowId = createFlowId(source);
  const version = flowMeta?.version || '1.0.0';
  const flowName = flowMeta?.name || fn.name || 'anonymous';

  // Register with global registry
  registerFlow(baseFlow, source);

  // Build complete metadata
  const metadata: Partial<FlowMetadata> = {
    name: flowName,
    description: flowMeta?.description,
    version,
    tags: flowMeta?.tags || [],
    source: {
      code: source,
      location: extractSourceLocation(fn),
    },
    types: {
      signature: {
        input: 'any',
        output: 'any',
        parameters: [],
        returnType: 'any',
        async: source.includes('async '),
      },
      generics: [],
    },
    effects: effectFlags ?? EffectFlags.None,
    complexity: calculateComplexity(source),
    dependencies: [],
    performance: null,
    docs: {
      description: flowMeta?.description,
      params: [],
      examples: [],
      tags: [],
    },
    // Merge with compiled metadata if available
    ...compiledMetadata,
  };

  // Track dependencies
  const flowDependencies: Flow[] = [];

  // Create the FlowMachine
  const machine = baseFlow as unknown as FlowMachine<In, Out>;

  // Define readonly properties
  Object.defineProperty(machine, 'id', {
    value: flowId,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(machine, 'version', {
    value: version,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(machine, 'name', {
    value: flowName,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(machine, 'metadata', {
    value: metadata,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  // Implement inspect()
  machine.inspect = (): FlowStructure => ({
    id: flowId,
    type: 'simple',
    components: flowDependencies.map((dep) =>
      dep.inspect
        ? dep.inspect()
        : {
            id: createFlowId(dep.toString()),
            type: 'simple',
            components: [],
            metadata: dep.meta || {},
          }
    ),
    metadata,
  });

  // Implement dependencies()
  machine.dependencies = (): Flow[] => [...flowDependencies];

  // Implement effects()
  machine.effects = (): EffectFlags => {
    // Check if this is an EffectFlow
    if ('flags' in machine) {
      return (machine as any).flags;
    }
    return metadata.effects || EffectFlags.None;
  };

  // Implement isPure()
  machine.isPure = (): boolean => machine.effects() === EffectFlags.None;

  // Implement optimize()
  machine.optimize = (): FlowMachine<In, Out> => {
    const isPure = machine.isPure();

    if (isPure && flowMeta?.performance?.memoizable !== false) {
      // Apply memoization optimization
      const cache = new Map<string, Out>();

      const optimized = createFlowMachine<In, Out>({
        fn: (input: In) => {
          const key = JSON.stringify(input);
          if (cache.has(key)) {
            return cache.get(key)!;
          }
          const result = fn(input);
          if (result instanceof Promise) {
            return result.then((value) => {
              cache.set(key, value);
              return value;
            });
          }
          cache.set(key, result);
          return result;
        },
        meta: {
          ...flowMeta,
          name: `${flowName} (optimized)`,
          description: `Memoized version of ${flowName}`,
        },
        effects: effectFlags,
      });

      return optimized;
    }

    // No optimization applied
    return machine;
  };

  // Implement transform()
  machine.transform = (transformer: Transformer): FlowMachine<In, Out> => {
    if (!transformer.applicable(machine)) {
      return machine;
    }

    return transformer.transform(machine);
  };

  // Implement toJSON()
  machine.toJSON = (): FlowJSON => {
    const deps: FlowId[] = flowDependencies.map((dep) => {
      const depId = dep.id as FlowId | undefined;
      if (depId) return depId;
      return createFlowId(dep.toString());
    });

    return {
      id: flowId,
      version,
      type: 'simple',
      metadata: {
        name: metadata.name,
        description: metadata.description,
        tags: metadata.tags,
        effects: metadata.effects,
        complexity: metadata.complexity,
      } as Record<string, any>,
      dependencies: deps,
      logic: source,
    };
  };

  // Implement toGraph()
  machine.toGraph = (): FlowGraph => {
    const nodes = [
      {
        id: flowId as string,
        type: 'transform' as const,
        label: metadata.name || 'Flow',
        metadata: {
          effects: metadata.effects,
          complexity: metadata.complexity,
        },
      },
    ];

    const edges = [];

    // Add dependency nodes and edges
    for (let i = 0; i < flowDependencies.length; i++) {
      const dep = flowDependencies[i]!;
      const depId = (dep.id || createFlowId(dep.toString())) as string;

      nodes.push({
        id: depId,
        type: 'transform' as const,
        label: dep.meta?.name || `Dependency ${i + 1}`,
        metadata: {
          ...((dep.meta || {}) as Record<string, any>),
          effects: undefined,
          complexity: undefined,
        },
      });

      edges.push({
        from: depId,
        to: flowId as string,
        type: 'dependency' as const,
        label: 'depends on',
      });
    }

    return {
      nodes,
      edges,
      metadata: {
        id: flowId,
        name: metadata.name || 'Flow',
        version,
      },
    };
  };

  // Override toString()
  machine.toString = (): string => source;

  // Override pipe() to track dependencies and return FlowMachine
  const originalPipe = baseFlow.pipe.bind(baseFlow);
  machine.pipe = <Next>(next: Flow<Out, Next>): FlowMachine<In, Next> => {
    const composed = originalPipe(next);

    // Track dependency
    flowDependencies.push(next);

    // Register dependency in registry
    if (next.id) {
      globalFlowRegistry.addDependency(flowId, next.id as FlowId);
    }

    // Create new FlowMachine for composition
    const composedMachine = createFlowMachine<In, Next>({
      fn: (input: In) => composed(input),
      meta: {
        name: `${flowName} → ${next.meta?.name || 'flow'}`,
        description: `Composition of ${flowName} and ${next.meta?.name || 'flow'}`,
        version,
      },
      effects: machine.effects(),
    });

    return composedMachine;
  };

  return machine;
}

/**
 * Compose multiple Flows into a FlowMachine pipeline
 */
export function composeMachine<A, B>(f1: Flow<A, B>): FlowMachine<A, B>;
export function composeMachine<A, B, C>(f1: Flow<A, B>, f2: Flow<B, C>): FlowMachine<A, C>;
export function composeMachine<A, B, C, D>(f1: Flow<A, B>, f2: Flow<B, C>, f3: Flow<C, D>): FlowMachine<A, D>;
export function composeMachine<A, B, C, D, E>(
  f1: Flow<A, B>,
  f2: Flow<B, C>,
  f3: Flow<C, D>,
  f4: Flow<D, E>
): FlowMachine<A, E>;
export function composeMachine(...flows: Flow[]): FlowMachine {
  if (flows.length === 0) {
    throw new Error('composeMachine requires at least one flow');
  }

  if (flows.length === 1) {
    const flow = flows[0]!;
    // Convert to FlowMachine if not already
    if ('inspect' in flow) return flow as FlowMachine;
    return createFlowMachine({ fn: flow });
  }

  // Compose all flows
  let composed = flows[0]!;
  for (let i = 1; i < flows.length; i++) {
    composed = composed.pipe(flows[i]!);
  }

  // Convert to FlowMachine
  return createFlowMachine({
    fn: composed,
    meta: {
      name: `composed(${flows.length} flows)`,
      description: `Composition of ${flows.length} flows`,
    },
  });
}

/**
 * Identity FlowMachine
 */
export const identityMachine = <T>(): FlowMachine<T, T> =>
  createFlowMachine({
    fn: (x: T) => x,
    meta: {
      name: 'identity',
      description: 'Returns input unchanged',
      performance: { pure: true, memoizable: true },
      version: '1.0.0',
    },
    effects: EffectFlags.None,
  });

/**
 * Constant FlowMachine
 */
export const constantMachine = <T>(value: T): FlowMachine<any, T> =>
  createFlowMachine({
    fn: () => value,
    meta: {
      name: 'constant',
      description: `Always returns ${String(value)}`,
      performance: { pure: true, memoizable: true },
      version: '1.0.0',
    },
    effects: EffectFlags.None,
  });
