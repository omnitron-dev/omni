/**
 * Module Bundler
 *
 * Creates optimal bundle strategy based on module boundaries
 * Uses ModuleGraph to determine chunk splits
 */

import { ModuleGraph, type LoadStrategy } from '../modules/graph.js';
import type { ModuleDefinition, SplitPoint } from '../di/types.js';
import type { ModuleAnalysisResult, ModuleMetadata } from '../compiler/optimizations/module-analyzer.js';

/**
 * Bundle strategy configuration
 */
export interface BundleStrategy {
  /** Main bundle (entry point) */
  main: BundleChunk;

  /** Lazy loaded chunks */
  lazy: BundleChunk[];

  /** Shared chunks (common dependencies) */
  shared: BundleChunk[];

  /** Preload hints */
  preload: PreloadHint[];

  /** Prefetch hints */
  prefetch: PrefetchHint[];
}

/**
 * Bundle chunk definition
 */
export interface BundleChunk {
  /** Chunk ID */
  id: string;

  /** Module IDs in this chunk */
  modules: string[];

  /** Chunk size estimate */
  size: number;

  /** Load strategy */
  strategy: LoadStrategy;

  /** Priority */
  priority: number;

  /** Dependencies on other chunks */
  dependencies: string[];
}

/**
 * Preload hint
 */
export interface PreloadHint {
  /** Chunk ID to preload */
  chunkId: string;

  /** Resource type */
  as: 'script' | 'style' | 'font' | 'image';
}

/**
 * Prefetch hint
 */
export interface PrefetchHint {
  /** Chunk ID to prefetch */
  chunkId: string;

  /** Priority */
  priority: 'high' | 'low';
}

/**
 * Module bundler options
 */
export interface ModuleBundlerOptions {
  /**
   * Maximum chunk size in bytes
   * @default 250000 (250KB)
   */
  maxChunkSize?: number;

  /**
   * Minimum chunk size in bytes
   * @default 20000 (20KB)
   */
  minChunkSize?: number;

  /**
   * Maximum parallel async requests
   * @default 5
   */
  maxAsyncRequests?: number;

  /**
   * Enable aggressive code splitting
   * @default false
   */
  aggressiveSplitting?: boolean;

  /**
   * Shared chunk threshold (min modules sharing dependency)
   * @default 2
   */
  sharedChunkThreshold?: number;
}

/**
 * Module Bundler
 *
 * Analyzes module graph and creates optimal bundle strategy
 */
export class ModuleBundler {
  private options: Required<ModuleBundlerOptions>;
  private moduleGraph: ModuleGraph;
  private moduleAnalysis: ModuleAnalysisResult | null = null;

  constructor(options: ModuleBundlerOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 250000,
      minChunkSize: options.minChunkSize ?? 20000,
      maxAsyncRequests: options.maxAsyncRequests ?? 5,
      aggressiveSplitting: options.aggressiveSplitting ?? false,
      sharedChunkThreshold: options.sharedChunkThreshold ?? 2,
    };

    this.moduleGraph = new ModuleGraph();
  }

  /**
   * Build module graph from module analysis
   */
  buildGraph(moduleAnalysis: ModuleAnalysisResult): void {
    this.moduleAnalysis = moduleAnalysis;

    // Add all modules as nodes
    for (const module of moduleAnalysis.modules) {
      const definition: ModuleDefinition = {
        id: module.id,
        imports: module.imports.map((imp) => ({
          id: imp.source,
          definition: { id: imp.source },
        })) as any,
        providers: module.providers as any,
        stores: module.stores as any,
        routes: module.routes as any,
        islands: module.islands as any,
        exports: module.exports as any,
        optimization: module.optimization || undefined,
      };

      this.moduleGraph.addNode(module.id, definition);
    }

    // Add edges (dependencies)
    for (const [moduleId, deps] of moduleAnalysis.dependencies) {
      for (const dep of deps) {
        this.moduleGraph.addEdge(moduleId, dep);
      }
    }
  }

  /**
   * Generate bundle strategy
   */
  generateStrategy(entryModuleId: string): BundleStrategy {
    if (!this.moduleAnalysis) {
      throw new Error('Module analysis not available. Call buildGraph() first.');
    }

    // Get split points from module graph
    const splitPoints = this.moduleGraph.getSplitPoints();

    // Get shared dependencies
    const sharedDeps = this.moduleGraph.getSharedDependencies();

    // Create bundle chunks
    const chunks = this.createChunks(entryModuleId, splitPoints, sharedDeps);

    // Separate chunks by strategy
    const main = chunks.find((c) => c.id === 'main') || this.createDefaultMainChunk(entryModuleId);
    const lazy = chunks.filter((c) => c.strategy === 'lazy' && c.id !== 'main');
    const shared = chunks.filter((c) => c.id.startsWith('shared-'));

    // Generate preload/prefetch hints
    const preload = this.generatePreloadHints(chunks);
    const prefetch = this.generatePrefetchHints(chunks);

    return {
      main,
      lazy,
      shared,
      preload,
      prefetch,
    };
  }

  /**
   * Create bundle chunks from split points
   */
  private createChunks(
    entryModuleId: string,
    splitPoints: SplitPoint[],
    sharedDeps: Map<string, string[]>
  ): BundleChunk[] {
    const chunks: BundleChunk[] = [];

    // Create main chunk
    const mainModules = this.collectMainModules(entryModuleId, splitPoints);
    chunks.push({
      id: 'main',
      modules: mainModules,
      size: this.calculateChunkSize(mainModules),
      strategy: 'preload',
      priority: 100,
      dependencies: [],
    });

    // Create chunks for each split point
    for (const splitPoint of splitPoints) {
      const chunkModules = this.collectChunkModules(splitPoint.module, splitPoints);
      const chunkSize = this.calculateChunkSize(chunkModules);

      // Skip if chunk is too small and not marked for splitting
      if (chunkSize < this.options.minChunkSize && !this.options.aggressiveSplitting) {
        mainModules.push(...chunkModules);
        continue;
      }

      // Skip if chunk would exceed max async requests
      const lazyCount = chunks.filter((c) => c.strategy === 'lazy').length;
      if (lazyCount >= this.options.maxAsyncRequests) {
        mainModules.push(...chunkModules);
        continue;
      }

      const chunk: BundleChunk = {
        id: `chunk-${splitPoint.module}`,
        modules: chunkModules,
        size: chunkSize,
        strategy: splitPoint.strategy,
        priority: this.calculatePriority(splitPoint),
        dependencies: this.findChunkDependencies(chunkModules, chunks),
      };

      chunks.push(chunk);
    }

    // Create shared chunks for common dependencies
    const sharedChunks = this.createSharedChunks(sharedDeps, chunks);
    chunks.push(...sharedChunks);

    // Optimize chunk sizes
    this.optimizeChunkSizes(chunks);

    return chunks;
  }

  /**
   * Collect modules for main bundle
   */
  private collectMainModules(entryModuleId: string, splitPoints: SplitPoint[]): string[] {
    const splitModules = new Set(splitPoints.map((sp) => sp.module));
    const mainModules: string[] = [];

    // Get load order
    const loadOrder = this.moduleGraph.getLoadOrder();

    for (const moduleId of loadOrder) {
      // Skip if this is a split point
      if (splitModules.has(moduleId)) {
        continue;
      }

      // Include module if it's the entry or a dependency of entry (not split)
      if (moduleId === entryModuleId || this.moduleGraph.dependsOn(entryModuleId, moduleId)) {
        mainModules.push(moduleId);
      }
    }

    return mainModules;
  }

  /**
   * Collect modules for a chunk
   */
  private collectChunkModules(moduleId: string, splitPoints: SplitPoint[]): string[] {
    const chunkModules: string[] = [moduleId];
    const splitModules = new Set(splitPoints.map((sp) => sp.module));

    // Get transitive dependencies (but stop at split points)
    const dependencies = this.moduleGraph.getTransitiveDependencies(moduleId);

    for (const dep of dependencies) {
      // Don't include other split point modules
      if (splitModules.has(dep) && dep !== moduleId) {
        continue;
      }
      chunkModules.push(dep);
    }

    return chunkModules;
  }

  /**
   * Create shared chunks for common dependencies
   */
  private createSharedChunks(sharedDeps: Map<string, string[]>, existingChunks: BundleChunk[]): BundleChunk[] {
    const sharedChunks: BundleChunk[] = [];
    let sharedIndex = 0;

    for (const [depModuleId, dependents] of sharedDeps) {
      // Only create shared chunk if threshold is met
      if (dependents.length < this.options.sharedChunkThreshold) {
        continue;
      }

      // Check if already included in another chunk
      const alreadyIncluded = existingChunks.some((chunk) => chunk.modules.includes(depModuleId));
      if (alreadyIncluded) {
        continue;
      }

      // Collect modules for shared chunk
      const sharedModules = [depModuleId];
      const size = this.calculateChunkSize(sharedModules);

      // Skip if too small
      if (size < this.options.minChunkSize && !this.options.aggressiveSplitting) {
        continue;
      }

      sharedChunks.push({
        id: `shared-${sharedIndex++}`,
        modules: sharedModules,
        size,
        strategy: 'preload',
        priority: 50,
        dependencies: [],
      });
    }

    return sharedChunks;
  }

  /**
   * Find chunk dependencies
   */
  private findChunkDependencies(chunkModules: string[], allChunks: BundleChunk[]): string[] {
    const deps = new Set<string>();

    for (const moduleId of chunkModules) {
      const moduleDeps = this.moduleGraph.getDependencies(moduleId);

      for (const dep of moduleDeps) {
        // Find which chunk contains this dependency
        const depChunk = allChunks.find((chunk) => chunk.modules.includes(dep));
        if (depChunk && !chunkModules.includes(dep)) {
          deps.add(depChunk.id);
        }
      }
    }

    return Array.from(deps);
  }

  /**
   * Calculate chunk size
   */
  private calculateChunkSize(moduleIds: string[]): number {
    if (!this.moduleAnalysis) return 0;

    let totalSize = 0;

    for (const moduleId of moduleIds) {
      const module = this.moduleAnalysis.modules.find((m) => m.id === moduleId);
      if (module) {
        totalSize += module.estimatedSize;
      }
    }

    return totalSize;
  }

  /**
   * Calculate chunk priority
   */
  private calculatePriority(splitPoint: SplitPoint): number {
    switch (splitPoint.strategy) {
      case 'preload':
        return 90;
      case 'prefetch':
        return 50;
      case 'lazy':
        return 10;
      default:
        return 10;
    }
  }

  /**
   * Optimize chunk sizes
   */
  private optimizeChunkSizes(chunks: BundleChunk[]): void {
    // Split chunks that are too large
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      if (chunk.size > this.options.maxChunkSize) {
        // Split the chunk
        const splitChunks = this.splitLargeChunk(chunk);
        chunks.splice(i, 1, ...splitChunks);
        i += splitChunks.length - 1;
      }
    }

    // Merge chunks that are too small
    if (!this.options.aggressiveSplitting) {
      for (let i = 0; i < chunks.length - 1; i++) {
        const chunk1 = chunks[i];
        const chunk2 = chunks[i + 1];

        if (!chunk1 || !chunk2) continue;

        if (
          chunk1.size < this.options.minChunkSize &&
          chunk2.size < this.options.minChunkSize &&
          chunk1.strategy === chunk2.strategy
        ) {
          // Merge the chunks
          const merged = this.mergeChunks(chunk1, chunk2);
          chunks.splice(i, 2, merged);
          i--;
        }
      }
    }
  }

  /**
   * Split a large chunk into smaller chunks
   */
  private splitLargeChunk(chunk: BundleChunk): BundleChunk[] {
    const targetChunks = Math.ceil(chunk.size / this.options.maxChunkSize);
    const modulesPerChunk = Math.ceil(chunk.modules.length / targetChunks);

    const splitChunks: BundleChunk[] = [];

    for (let i = 0; i < targetChunks; i++) {
      const startIdx = i * modulesPerChunk;
      const endIdx = Math.min(startIdx + modulesPerChunk, chunk.modules.length);
      const chunkModules = chunk.modules.slice(startIdx, endIdx);

      splitChunks.push({
        id: `${chunk.id}-${i}`,
        modules: chunkModules,
        size: this.calculateChunkSize(chunkModules),
        strategy: chunk.strategy,
        priority: chunk.priority,
        dependencies: chunk.dependencies,
      });
    }

    return splitChunks;
  }

  /**
   * Merge two chunks
   */
  private mergeChunks(chunk1: BundleChunk, chunk2: BundleChunk): BundleChunk {
    return {
      id: `${chunk1.id}-${chunk2.id}`,
      modules: [...chunk1.modules, ...chunk2.modules],
      size: chunk1.size + chunk2.size,
      strategy: chunk1.priority > chunk2.priority ? chunk1.strategy : chunk2.strategy,
      priority: Math.max(chunk1.priority, chunk2.priority),
      dependencies: [...new Set([...chunk1.dependencies, ...chunk2.dependencies])],
    };
  }

  /**
   * Generate preload hints
   */
  private generatePreloadHints(chunks: BundleChunk[]): PreloadHint[] {
    const hints: PreloadHint[] = [];

    for (const chunk of chunks) {
      if (chunk.strategy === 'preload' && chunk.id !== 'main') {
        hints.push({
          chunkId: chunk.id,
          as: 'script',
        });
      }
    }

    return hints;
  }

  /**
   * Generate prefetch hints
   */
  private generatePrefetchHints(chunks: BundleChunk[]): PrefetchHint[] {
    const hints: PrefetchHint[] = [];

    for (const chunk of chunks) {
      if (chunk.strategy === 'prefetch') {
        hints.push({
          chunkId: chunk.id,
          priority: chunk.priority > 50 ? 'high' : 'low',
        });
      }
    }

    return hints;
  }

  /**
   * Create default main chunk
   */
  private createDefaultMainChunk(entryModuleId: string): BundleChunk {
    return {
      id: 'main',
      modules: [entryModuleId],
      size: 10000,
      strategy: 'preload',
      priority: 100,
      dependencies: [],
    };
  }

  /**
   * Get module graph
   */
  getModuleGraph(): ModuleGraph {
    return this.moduleGraph;
  }

  /**
   * Get bundle stats
   */
  getBundleStats(strategy: BundleStrategy): {
    totalChunks: number;
    totalSize: number;
    mainSize: number;
    lazySize: number;
    sharedSize: number;
    avgChunkSize: number;
  } {
    const totalChunks = 1 + strategy.lazy.length + strategy.shared.length;
    const mainSize = strategy.main.size;
    const lazySize = strategy.lazy.reduce((sum, chunk) => sum + chunk.size, 0);
    const sharedSize = strategy.shared.reduce((sum, chunk) => sum + chunk.size, 0);
    const totalSize = mainSize + lazySize + sharedSize;

    return {
      totalChunks,
      totalSize,
      mainSize,
      lazySize,
      sharedSize,
      avgChunkSize: totalSize / totalChunks,
    };
  }
}
