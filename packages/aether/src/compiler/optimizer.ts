/**
 * Aether Compiler Optimizer
 * Orchestrates all optimization passes for maximum performance
 */

/**
 * Optimization configuration
 */
export interface OptimizerOptions {
  /**
   * Optimization mode
   * - 'none': No optimizations
   * - 'basic': Safe optimizations only
   * - 'aggressive': All optimizations, may break some edge cases
   * @default 'basic'
   */
  mode?: 'none' | 'basic' | 'aggressive';

  /**
   * Enable signal optimization
   * @default true
   */
  optimizeSignals?: boolean;

  /**
   * Enable effect batching
   * @default true
   */
  batchEffects?: boolean;

  /**
   * Enable component hoisting
   * @default true
   */
  hoistComponents?: boolean;

  /**
   * Enable tree shaking
   * @default true
   */
  treeShake?: boolean;

  /**
   * Enable dead code elimination
   * @default true
   */
  eliminateDeadCode?: boolean;

  /**
   * Enable minification
   * @default true in production
   */
  minify?: boolean;

  /**
   * Target environment
   * @default 'browser'
   */
  target?: 'browser' | 'server' | 'universal';

  /**
   * Development mode (preserves readability)
   * @default false
   */
  development?: boolean;

  /**
   * Generate source maps
   * @default true in development
   */
  sourceMaps?: boolean;

  /**
   * Custom optimization passes
   */
  customPasses?: OptimizationPass[];

  /**
   * Performance metrics
   * @default false
   */
  collectMetrics?: boolean;
}

/**
 * Optimization pass interface
 */
export interface OptimizationPass {
  /**
   * Pass name
   */
  name: string;

  /**
   * Priority (lower runs first)
   */
  priority: number;

  /**
   * Transform code
   */
  transform(code: string, context: OptimizationContext): Promise<OptimizationResult>;
}

/**
 * Optimization context
 */
export interface OptimizationContext {
  /**
   * Original source code
   */
  source: string;

  /**
   * Module path
   */
  modulePath: string;

  /**
   * Optimizer options
   */
  options: Required<OptimizerOptions>;

  /**
   * Source map from previous passes
   */
  sourceMap?: SourceMap;

  /**
   * Metadata from previous passes
   */
  metadata: Map<string, unknown>;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  /**
   * Transformed code
   */
  code: string;

  /**
   * Source map
   */
  sourceMap?: SourceMap;

  /**
   * Changes made
   */
  changes: OptimizationChange[];

  /**
   * Warnings
   */
  warnings: string[];

  /**
   * Metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Optimization change record
 */
export interface OptimizationChange {
  /**
   * Type of change
   */
  type: 'signal-inline' | 'effect-batch' | 'component-hoist' | 'tree-shake' | 'dead-code' | 'minify' | 'custom';

  /**
   * Description
   */
  description: string;

  /**
   * Size impact (bytes)
   */
  sizeImpact?: number;

  /**
   * Location in source
   */
  location?: {
    line: number;
    column: number;
  };
}

/**
 * Source map (simplified)
 */
export interface SourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: string[];
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  /**
   * Total optimization time (ms)
   */
  totalTime: number;

  /**
   * Pass timings
   */
  passTimings: Map<string, number>;

  /**
   * Original size (bytes)
   */
  originalSize: number;

  /**
   * Optimized size (bytes)
   */
  optimizedSize: number;

  /**
   * Size reduction (bytes)
   */
  sizeReduction: number;

  /**
   * Size reduction percentage
   */
  sizeReductionPercent: number;

  /**
   * Total changes
   */
  totalChanges: number;

  /**
   * Changes by type
   */
  changesByType: Map<string, number>;
}

/**
 * Main optimizer class
 */
export class Optimizer {
  private options: Required<OptimizerOptions>;
  private passes: OptimizationPass[] = [];
  private metrics: PerformanceMetrics | null = null;

  constructor(options: OptimizerOptions = {}) {
    this.options = this.normalizeOptions(options);
    this.initializePasses();
  }

  /**
   * Normalize options with defaults
   */
  private normalizeOptions(options: OptimizerOptions): Required<OptimizerOptions> {
    const mode = options.mode || 'basic';
    const development = options.development ?? false;

    return {
      mode,
      optimizeSignals: options.optimizeSignals ?? true,
      batchEffects: options.batchEffects ?? true,
      hoistComponents: options.hoistComponents ?? true,
      treeShake: options.treeShake ?? true,
      eliminateDeadCode: options.eliminateDeadCode ?? true,
      minify: options.minify ?? !development,
      target: options.target || 'browser',
      development,
      sourceMaps: options.sourceMaps ?? development,
      customPasses: options.customPasses || [],
      collectMetrics: options.collectMetrics ?? false,
    };
  }

  /**
   * Initialize optimization passes
   */
  private async initializePasses(): Promise<void> {
    const passes: OptimizationPass[] = [];

    // Import and register built-in passes based on options
    if (this.options.optimizeSignals) {
      const { SignalOptimizer } = await import('./optimizations/signal-optimizer.js');
      passes.push(new SignalOptimizer(this.options));
    }

    if (this.options.batchEffects) {
      const { EffectBatcher } = await import('./optimizations/effect-batcher.js');
      passes.push(new EffectBatcher(this.options));
    }

    if (this.options.hoistComponents) {
      const { ComponentHoister } = await import('./optimizations/component-hoister.js');
      passes.push(new ComponentHoister(this.options));
    }

    if (this.options.treeShake) {
      const { TreeShakerPass } = await import('./optimizations/tree-shaker.js');
      passes.push(new TreeShakerPass(this.options));
    }

    if (this.options.eliminateDeadCode) {
      const { DeadCodeEliminator } = await import('./optimizations/dead-code-eliminator.js');
      passes.push(new DeadCodeEliminator(this.options));
    }

    if (this.options.minify) {
      const { Minifier } = await import('./optimizations/minifier.js');
      passes.push(new Minifier(this.options));
    }

    // Add custom passes
    passes.push(...this.options.customPasses);

    // Sort passes by priority
    this.passes = passes.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Optimize code
   */
  async optimize(code: string, modulePath = ''): Promise<OptimizationResult> {
    // Ensure passes are initialized
    if (this.passes.length === 0) {
      await this.initializePasses();
    }

    const startTime = Date.now();
    const originalSize = code.length;

    // Initialize context
    const context: OptimizationContext = {
      source: code,
      modulePath,
      options: this.options,
      metadata: new Map(),
    };

    let currentCode = code;
    let currentSourceMap: SourceMap | undefined;
    const allChanges: OptimizationChange[] = [];
    const allWarnings: string[] = [];
    const passTimings = new Map<string, number>();

    // Run optimization passes
    for (const pass of this.passes) {
      const passStartTime = Date.now();

      try {
        const result = await pass.transform(currentCode, {
          ...context,
          source: currentCode,
          sourceMap: currentSourceMap,
        });

        currentCode = result.code;
        currentSourceMap = result.sourceMap || currentSourceMap;
        allChanges.push(...result.changes);
        allWarnings.push(...result.warnings);

        // Merge metadata
        if (result.metadata) {
          for (const [key, value] of Object.entries(result.metadata)) {
            context.metadata.set(`${pass.name}.${key}`, value);
          }
        }
      } catch (error) {
        allWarnings.push(
          `Optimization pass "${pass.name}" failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const passTime = Date.now() - passStartTime;
      passTimings.set(pass.name, passTime);
    }

    const totalTime = Date.now() - startTime;
    const optimizedSize = currentCode.length;

    // Collect metrics
    if (this.options.collectMetrics) {
      const changesByType = new Map<string, number>();
      for (const change of allChanges) {
        changesByType.set(change.type, (changesByType.get(change.type) || 0) + 1);
      }

      this.metrics = {
        totalTime,
        passTimings,
        originalSize,
        optimizedSize,
        sizeReduction: originalSize - optimizedSize,
        sizeReductionPercent: originalSize > 0 ? ((originalSize - optimizedSize) / originalSize) * 100 : 0,
        totalChanges: allChanges.length,
        changesByType,
      };
    }

    return {
      code: currentCode,
      sourceMap: currentSourceMap,
      changes: allChanges,
      warnings: allWarnings,
    };
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics | null {
    return this.metrics;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = null;
  }

  /**
   * Get active passes
   */
  getPasses(): OptimizationPass[] {
    return [...this.passes];
  }

  /**
   * Add custom pass
   */
  addPass(pass: OptimizationPass): void {
    this.passes.push(pass);
    this.passes.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove pass by name
   */
  removePass(name: string): boolean {
    const index = this.passes.findIndex((p) => p.name === name);
    if (index !== -1) {
      this.passes.splice(index, 1);
      return true;
    }
    return false;
  }
}

/**
 * Create optimizer with options
 */
export function createOptimizer(options?: OptimizerOptions): Optimizer {
  return new Optimizer(options);
}

/**
 * Quick optimize function for simple use cases
 */
export async function optimize(code: string, options?: OptimizerOptions): Promise<string> {
  const optimizer = new Optimizer(options);
  const result = await optimizer.optimize(code);
  return result.code;
}
