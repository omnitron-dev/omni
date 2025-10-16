/**
 * Enhanced Flow creation with full reflection capabilities
 * Extends the basic flow() function with introspection, optimization, and serialization
 */

import type { Flow, FlowMeta, FlowOptions } from './types.js';
import type { FlowId, FlowMetadata, FlowStructure, FlowJSON, FlowGraph, FlowNode, FlowEdge, Transformer } from './reflection.js';
import { flow as basicFlow } from './flow.js';
import { registerFlow, globalFlowRegistry } from './registry.js';
import { extractSourceLocation, calculateComplexity, createFlowId } from './reflection.js';
import { EffectFlags } from './effects/index.js';

/**
 * Enhanced Flow interface with all reflection methods implemented
 */
export interface EnhancedFlow<In = any, Out = any> extends Flow<In, Out> {
  readonly id: FlowId;
  readonly version: string;
  inspect(): FlowStructure;
  dependencies(): Flow[];
  effects(): EffectFlags;
  optimize(): EnhancedFlow<In, Out>;
  transform(transformer: Transformer): EnhancedFlow<In, Out>;
  toJSON(): FlowJSON;
  toGraph(): FlowGraph;
}

/**
 * Create an enhanced Flow with full reflection capabilities
 */
export function flowEnhanced<In, Out>(
  fnOrOptions: ((input: In) => Out | Promise<Out>) | FlowOptions<In, Out>,
  meta?: FlowMeta,
): EnhancedFlow<In, Out> {
  // Use basic flow() for core functionality
  const baseFlow = (typeof fnOrOptions === 'function'
    ? basicFlow(fnOrOptions, meta)
    : basicFlow(fnOrOptions)) as EnhancedFlow<In, Out>;

  // Extract function and metadata
  const fn = typeof fnOrOptions === 'function' ? fnOrOptions : fnOrOptions.fn;
  const flowMeta = typeof fnOrOptions === 'function' ? meta : fnOrOptions.meta;

  // Generate source and ID
  const source = fn.toString();
  const flowId = createFlowId(source);
  const version = flowMeta?.version || '1.0.0';

  // Register with global registry
  registerFlow(baseFlow, source);

  // Store metadata internally
  const internalMetadata: Partial<FlowMetadata> = {
    name: flowMeta?.name || fn.name || 'anonymous',
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
    effects: EffectFlags.None,
    complexity: calculateComplexity(source),
    dependencies: [],
    performance: null,
    docs: {
      description: flowMeta?.description,
      params: [],
      examples: [],
      tags: [],
    },
  };

  // Store dependencies (for composed flows)
  const flowDependencies: Flow[] = [];

  // Add ID and version as readonly properties
  Object.defineProperty(baseFlow, 'id', {
    value: flowId,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(baseFlow, 'version', {
    value: version,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  // Implement inspect()
  baseFlow.inspect = (): FlowStructure => {
    return {
      id: flowId,
      type: 'simple',
      components: flowDependencies.map(dep =>
        dep.inspect ? dep.inspect() : {
          id: createFlowId(dep.toString()),
          type: 'simple',
          components: [],
          metadata: dep.meta || {},
        }
      ),
      metadata: internalMetadata,
    };
  };

  // Implement dependencies()
  baseFlow.dependencies = (): Flow[] => {
    return [...flowDependencies];
  };

  // Implement effects()
  baseFlow.effects = (): EffectFlags => {
    // Check if this is an EffectFlow
    if ('flags' in baseFlow) {
      return (baseFlow as any).flags;
    }

    // Otherwise return stored effects or None
    return internalMetadata.effects || EffectFlags.None;
  };

  // Implement optimize()
  baseFlow.optimize = (): EnhancedFlow<In, Out> => {
    // Basic optimization: check if pure and memoizable
    const isPure = baseFlow.effects() === EffectFlags.None;

    if (isPure && flowMeta?.performance?.memoizable !== false) {
      // Apply memoization
      const cache = new Map<string, Out>();

      const optimized = flowEnhanced<In, Out>(
        (input: In) => {
          const key = JSON.stringify(input);
          if (cache.has(key)) {
            return cache.get(key)!;
          }
          const result = fn(input);
          if (result instanceof Promise) {
            return result.then(value => {
              cache.set(key, value);
              return value;
            });
          }
          cache.set(key, result);
          return result;
        },
        {
          ...flowMeta,
          name: `${flowMeta?.name || 'anonymous'} (optimized)`,
          description: `Memoized version of ${flowMeta?.name || 'flow'}`,
        }
      );

      return optimized;
    }

    // No optimization applied
    return baseFlow;
  };

  // Implement transform()
  baseFlow.transform = (transformer: Transformer): EnhancedFlow<In, Out> => {
    if (!transformer.applicable(baseFlow)) {
      return baseFlow;
    }

    return transformer.transform(baseFlow);
  };

  // Implement toJSON()
  baseFlow.toJSON = (): FlowJSON => {
    return {
      id: flowId,
      version,
      type: 'simple',
      metadata: {
        name: internalMetadata.name,
        description: internalMetadata.description,
        tags: internalMetadata.tags,
        effects: internalMetadata.effects,
      },
      dependencies: flowDependencies.map(dep => {
        if (dep.id) return dep.id as FlowId;
        return createFlowId(dep.toString());
      }),
      logic: source,
    };
  };

  // Implement toGraph()
  baseFlow.toGraph = (): FlowGraph => {
    const nodes: FlowNode[] = [
      {
        id: flowId,
        type: 'transform',
        label: internalMetadata.name || 'Flow',
        metadata: {
          effects: internalMetadata.effects,
          complexity: internalMetadata.complexity,
        },
      },
    ];

    const edges: FlowEdge[] = [];

    // Add dependency nodes and edges
    for (let i = 0; i < flowDependencies.length; i++) {
      const dep = flowDependencies[i]!;
      const depId = dep.id || createFlowId(dep.toString());

      nodes.push({
        id: depId,
        type: 'transform',
        label: dep.meta?.name || `Dependency ${i + 1}`,
        metadata: dep.meta || {},
      });

      edges.push({
        from: depId,
        to: flowId,
        type: 'dependency',
        label: 'depends on',
      });
    }

    return {
      nodes,
      edges,
      metadata: {
        id: flowId,
        name: internalMetadata.name || 'Flow',
        version,
      },
    };
  };

  // Override pipe() to track dependencies
  const originalPipe = baseFlow.pipe.bind(baseFlow);
  baseFlow.pipe = <Next>(next: Flow<Out, Next>): EnhancedFlow<In, Next> => {
    const composed = originalPipe(next) as EnhancedFlow<In, Next>;

    // Track dependency
    flowDependencies.push(next);

    // If next flow has ID, register dependency in registry
    if (next.id) {
      globalFlowRegistry.addDependency(flowId, next.id as FlowId);
    }

    // Return enhanced composed flow
    return flowEnhanced(
      (input: In) => composed(input),
      {
        name: `${flowMeta?.name || 'flow'} → ${next.meta?.name || 'flow'}`,
        description: `Composition of ${flowMeta?.name || 'flow'} and ${next.meta?.name || 'flow'}`,
        version,
      }
    );
  };

  return baseFlow;
}

/**
 * Create a composed flow with dependency tracking
 */
export function composeEnhanced<A, B>(f1: Flow<A, B>): EnhancedFlow<A, B>;
export function composeEnhanced<A, B, C>(f1: Flow<A, B>, f2: Flow<B, C>): EnhancedFlow<A, C>;
export function composeEnhanced<A, B, C, D>(
  f1: Flow<A, B>,
  f2: Flow<B, C>,
  f3: Flow<C, D>,
): EnhancedFlow<A, D>;
export function composeEnhanced<A, B, C, D, E>(
  f1: Flow<A, B>,
  f2: Flow<B, C>,
  f3: Flow<C, D>,
  f4: Flow<D, E>,
): EnhancedFlow<A, E>;
export function composeEnhanced(...flows: Flow[]): EnhancedFlow {
  if (flows.length === 0) {
    throw new Error('compose requires at least one flow');
  }

  if (flows.length === 1) {
    const flow = flows[0]!;
    // Convert to enhanced if not already
    if (flow.inspect) return flow as EnhancedFlow;
    return flowEnhanced(flow);
  }

  // Compose all flows
  let composed = flows[0]!;
  for (let i = 1; i < flows.length; i++) {
    composed = composed.pipe(flows[i]!);
  }

  // Ensure it's enhanced
  if ((composed as EnhancedFlow).inspect) {
    return composed as EnhancedFlow;
  }

  return flowEnhanced(composed, {
    name: `composed(${flows.length} flows)`,
    description: `Composition of ${flows.length} flows`,
  });
}

/**
 * Create an identity flow with reflection capabilities
 */
export const identityEnhanced = <T>(): EnhancedFlow<T, T> =>
  flowEnhanced((x: T) => x, {
    name: 'identity',
    description: 'Returns input unchanged',
    performance: { pure: true, memoizable: true },
    version: '1.0.0',
  });

/**
 * Create a constant flow with reflection capabilities
 */
export const constantEnhanced = <T>(value: T): EnhancedFlow<any, T> =>
  flowEnhanced(() => value, {
    name: 'constant',
    description: `Always returns ${String(value)}`,
    performance: { pure: true, memoizable: true },
    version: '1.0.0',
  });
