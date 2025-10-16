/**
 * Reflection and introspection types for @holon/flow
 * Provides runtime and compile-time reflection capabilities
 */

import type { EffectFlags } from './effects/index.js';

/**
 * Unique identifier for a Flow
 * Content-based hash ensures same logic = same ID
 */
export type FlowId = string & { readonly __brand: 'FlowId' };

/**
 * Source location information
 */
export interface SourceLocation {
  file?: string;
  line?: number;
  column?: number;
  name?: string;
}

/**
 * Type signature information
 */
export interface TypeSignature {
  input: string;
  output: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  returnType: string;
  async: boolean;
}

/**
 * Generic parameter information
 */
export interface GenericInfo {
  name: string;
  constraint?: string;
  default?: string;
}

/**
 * Complexity metrics
 */
export interface Complexity {
  /**
   * Big-O notation for time complexity
   */
  time: 'O(1)' | 'O(log n)' | 'O(n)' | 'O(n log n)' | 'O(n²)' | 'O(2^n)' | string;

  /**
   * Big-O notation for space complexity
   */
  space: 'O(1)' | 'O(log n)' | 'O(n)' | 'O(n²)' | string;

  /**
   * Cyclomatic complexity (number of independent paths)
   */
  cyclomatic: number;

  /**
   * Cognitive complexity (how hard it is to understand)
   */
  cognitive: number;

  /**
   * Nesting depth
   */
  maxDepth: number;
}

/**
 * Flow dependency information
 */
export interface FlowDependency {
  /**
   * The dependent flow
   */
  flow: any; // Flow type (avoiding circular dependency)

  /**
   * Type of dependency
   */
  type: 'composition' | 'reference' | 'closure';

  /**
   * Whether this dependency is optional
   */
  optional: boolean;
}

/**
 * Performance profile from runtime measurements
 */
export interface PerformanceProfile {
  /**
   * Number of samples taken
   */
  samples: number;

  /**
   * Average execution time in milliseconds
   */
  avgMs: number;

  /**
   * Median execution time in milliseconds
   */
  medianMs: number;

  /**
   * 95th percentile execution time
   */
  p95Ms: number;

  /**
   * 99th percentile execution time
   */
  p99Ms: number;

  /**
   * Standard deviation
   */
  stdDev: number;

  /**
   * Memory usage
   */
  memory?: {
    heap: number;
    external: number;
  };

  /**
   * Timestamp of profile creation
   */
  timestamp: number;
}

/**
 * Documentation comment extracted from source
 */
export interface DocComment {
  /**
   * Main description
   */
  description?: string;

  /**
   * Parameter documentation
   */
  params: Array<{
    name: string;
    description: string;
    type?: string;
  }>;

  /**
   * Return value documentation
   */
  returns?: {
    description: string;
    type?: string;
  };

  /**
   * Examples from JSDoc
   */
  examples: string[];

  /**
   * JSDoc tags
   */
  tags: Array<{
    name: string;
    value?: string;
  }>;
}

/**
 * Enhanced metadata for Flow introspection
 */
export interface FlowMetadata {
  /**
   * Source code information
   */
  source: {
    /**
     * Original function source code
     */
    code: string;

    /**
     * AST representation (if available)
     */
    ast?: any; // ts.SourceFile (avoiding TS dependency in types)

    /**
     * Source location
     */
    location: SourceLocation;
  };

  /**
   * Type information
   */
  types: {
    /**
     * Full type signature
     */
    signature: TypeSignature;

    /**
     * Generic parameters (if any)
     */
    generics: GenericInfo[];
  };

  /**
   * Effect flags for this Flow
   */
  effects: EffectFlags;

  /**
   * Complexity metrics
   */
  complexity: Complexity;

  /**
   * Dependencies on other Flows
   */
  dependencies: FlowDependency[];

  /**
   * Runtime performance profile
   */
  performance: PerformanceProfile | null;

  /**
   * Documentation extracted from JSDoc
   */
  docs: DocComment;

  /**
   * User-defined tags for categorization
   */
  tags: string[];

  /**
   * Version string
   */
  version: string;

  /**
   * Human-readable name
   */
  name: string;

  /**
   * Description
   */
  description?: string;

  /**
   * Custom metadata
   */
  [key: string]: any;
}

/**
 * Flow structure for introspection
 */
export interface FlowStructure {
  /**
   * Unique identifier
   */
  id: FlowId;

  /**
   * Flow type
   */
  type: 'simple' | 'composed' | 'parallel' | 'conditional' | 'loop' | 'effect';

  /**
   * Component flows (for composed flows)
   */
  components: FlowStructure[];

  /**
   * Metadata
   */
  metadata: Partial<FlowMetadata>;
}

/**
 * JSON representation of a Flow
 */
export interface FlowJSON {
  /**
   * Flow identifier
   */
  id: FlowId;

  /**
   * Flow version
   */
  version: string;

  /**
   * Flow type
   */
  type: string;

  /**
   * Serialized metadata
   */
  metadata: Record<string, any>;

  /**
   * Dependencies (by ID)
   */
  dependencies: FlowId[];

  /**
   * Serialized logic (if serializable)
   */
  logic?: string;
}

/**
 * Graph representation of a Flow
 */
export interface FlowGraph {
  /**
   * Nodes in the graph
   */
  nodes: FlowNode[];

  /**
   * Edges connecting nodes
   */
  edges: FlowEdge[];

  /**
   * Graph metadata
   */
  metadata: {
    id: FlowId;
    name: string;
    version: string;
  };
}

/**
 * Node in a Flow graph
 */
export interface FlowNode {
  /**
   * Node identifier
   */
  id: string;

  /**
   * Node type
   */
  type: 'input' | 'output' | 'transform' | 'condition' | 'effect' | 'composite';

  /**
   * Node label
   */
  label: string;

  /**
   * Node metadata
   */
  metadata: Record<string, any>;

  /**
   * Position (for visualization)
   */
  position?: { x: number; y: number };
}

/**
 * Edge in a Flow graph
 */
export interface FlowEdge {
  /**
   * Source node ID
   */
  from: string;

  /**
   * Target node ID
   */
  to: string;

  /**
   * Edge type
   */
  type: 'data' | 'control' | 'dependency';

  /**
   * Edge label
   */
  label?: string;

  /**
   * Edge metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Flow transformer interface
 */
export interface Transformer {
  /**
   * Transformer name
   */
  name: string;

  /**
   * Transform a flow
   */
  transform(flow: any): any; // Flow types

  /**
   * Check if transformer is applicable
   */
  applicable(flow: any): boolean;

  /**
   * Transformer priority (higher = applied first)
   */
  priority?: number;
}

/**
 * Generate a content-based Flow ID
 */
export function createFlowId(source: string): FlowId {
  // Simple hash implementation (should use crypto.subtle.digest in production)
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `flow:${Math.abs(hash).toString(36)}` as FlowId;
}

/**
 * Extract source location from a function
 */
export function extractSourceLocation(fn: (...args: any[]) => any): SourceLocation {
  const source = fn.toString();
  const name = fn.name || 'anonymous';

  // Try to extract from Error stack
  const stack = new Error().stack || '';
  const stackLines = stack.split('\n');
  const callerLine = stackLines[2] || '';

  // Simple regex to extract file:line:column
  const match = callerLine.match(/\((.+):(\d+):(\d+)\)/);

  if (match) {
    return {
      file: match[1],
      line: Number.parseInt(match[2]!, 10),
      column: Number.parseInt(match[3]!, 10),
      name,
    };
  }

  return { name };
}

/**
 * Calculate basic complexity metrics
 */
export function calculateComplexity(source: string): Complexity {
  // Very basic implementation - should use proper AST analysis
  const lines = source.split('\n');
  const branches = (source.match(/if|else|switch|case|\?|\|\||&&/g) || []).length;
  const loops = (source.match(/for|while|do\s+/g) || []).length;

  // Cyclomatic complexity: E - N + 2P (simplified)
  const cyclomatic = branches + loops + 1;

  // Cognitive complexity (simplified)
  const cognitive = cyclomatic + (source.match(/\{\s*\{/g) || []).length;

  // Max nesting depth (simplified)
  let maxDepth = 0;
  let currentDepth = 0;
  for (const char of source) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth--;
    }
  }

  return {
    time: lines.length > 100 ? 'O(n)' : 'O(1)',
    space: 'O(1)',
    cyclomatic,
    cognitive,
    maxDepth,
  };
}
