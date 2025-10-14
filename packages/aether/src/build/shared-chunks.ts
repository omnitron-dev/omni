/**
 * Shared Chunks Optimization
 * Advanced chunk splitting and code sharing strategies for optimal bundle sizes
 */

/**
 * Chunk strategy types
 */
export type ChunkStrategy = 'auto' | 'manual' | 'granular';

/**
 * Module information
 */
export interface ModuleInfo {
  id: string;
  size: number;
  importedBy: Set<string>;
  imports: Set<string>;
  dynamicImports: Set<string>;
  isVendor: boolean;
  isAetherCore: boolean;
  type: 'js' | 'css' | 'asset' | 'json';
}

/**
 * Cache group configuration
 */
export interface CacheGroup {
  test?: RegExp | ((module: ModuleInfo) => boolean);
  name?: string | ((module: ModuleInfo) => string);
  priority?: number;
  minSize?: number;
  minChunks?: number;
  maxSize?: number;
  reuseExistingChunk?: boolean;
  enforce?: boolean;
}

/**
 * Shared chunks configuration
 */
export interface SharedChunksConfig {
  /**
   * Chunk splitting strategy
   * @default 'auto'
   */
  strategy?: ChunkStrategy;

  /**
   * Minimum chunk size in bytes
   * @default 20000 (20KB)
   */
  minChunkSize?: number;

  /**
   * Maximum chunk size in bytes
   * @default 244000 (244KB - HTTP/2 optimal)
   */
  maxChunkSize?: number;

  /**
   * Maximum number of parallel requests
   * @default 30
   */
  maxChunks?: number;

  /**
   * Minimum number of chunks sharing a module before extraction
   * @default 2
   */
  minChunks?: number;

  /**
   * Vendor chunk configuration
   * @default true
   */
  vendorChunk?: boolean | string;

  /**
   * Vendor chunk name
   * @default 'vendor'
   */
  vendorChunkName?: string;

  /**
   * Common chunk configuration
   * @default true
   */
  commonChunk?: boolean | string;

  /**
   * Common chunk name
   * @default 'common'
   */
  commonChunkName?: string;

  /**
   * Framework chunk (Aether core)
   * @default true
   */
  frameworkChunk?: boolean;

  /**
   * Framework chunk name
   * @default 'aether'
   */
  frameworkChunkName?: string;

  /**
   * Manual chunk definitions
   */
  manualChunks?: Record<string, string[]> | ((id: string) => string | undefined);

  /**
   * Cache groups for fine-grained control
   */
  cacheGroups?: Record<string, CacheGroup>;

  /**
   * Enable preload hint generation
   * @default true
   */
  preloadHints?: boolean;

  /**
   * Enable prefetch strategies
   * @default true
   */
  prefetchStrategies?: boolean;

  /**
   * Enable critical chunk detection
   * @default true
   */
  criticalChunks?: boolean;

  /**
   * Hash chunk names for long-term caching
   * @default true
   */
  hashChunkNames?: boolean;

  /**
   * Hash length for chunk names
   * @default 8
   */
  hashLength?: number;
}

/**
 * Chunk information
 */
export interface ChunkInfo {
  id: string;
  name: string;
  hash?: string;
  type: 'entry' | 'vendor' | 'common' | 'framework' | 'async' | 'manual';
  modules: Set<string>;
  size: number;
  dependencies: Set<string>;
  dependents: Set<string>;
  isCritical: boolean;
  priority: number;
  preload: boolean;
  prefetch: boolean;
  loadOrder: number;
}

/**
 * Dependency graph node
 */
interface GraphNode {
  id: string;
  dependencies: Set<string>;
  dependents: Set<string>;
  visited: boolean;
  inCycle: boolean;
}

/**
 * Chunk analysis result
 */
export interface ChunkAnalysis {
  modules: Map<string, ModuleInfo>;
  dependencyGraph: Map<string, GraphNode>;
  circularDependencies: string[][];
  commonModules: Map<string, Set<string>>;
  vendorModules: Set<string>;
  frameworkModules: Set<string>;
  totalSize: number;
  averageModuleSize: number;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  chunks: Map<string, ChunkInfo>;
  manifest: ChunkManifest;
  preloadHints: Map<string, string[]>;
  prefetchHints: Map<string, string[]>;
  metrics: OptimizationMetrics;
  recommendations: string[];
}

/**
 * Chunk manifest
 */
export interface ChunkManifest {
  version: string;
  chunks: Record<
    string,
    {
      file: string;
      hash: string;
      size: number;
      dependencies: string[];
      preload: boolean;
      prefetch: boolean;
      critical: boolean;
    }
  >;
  entrypoints: Record<string, string[]>;
}

/**
 * Optimization metrics
 */
export interface OptimizationMetrics {
  totalChunks: number;
  totalSize: number;
  averageChunkSize: number;
  largestChunk: { name: string; size: number };
  smallestChunk: { name: string; size: number };
  duplicationRate: number;
  networkRequests: number;
  estimatedLoadTime: number;
  cacheEfficiency: number;
  chunksByType: Record<string, number>;
}

/**
 * Shared chunks optimizer
 */
export class SharedChunksOptimizer {
  private config: Required<SharedChunksConfig>;
  private modules: Map<string, ModuleInfo> = new Map();
  private chunks: Map<string, ChunkInfo> = new Map();
  private analysis?: ChunkAnalysis;

  constructor(config: SharedChunksConfig = {}) {
    this.config = {
      strategy: config.strategy || 'auto',
      minChunkSize: config.minChunkSize ?? 20000,
      maxChunkSize: config.maxChunkSize ?? 244000,
      maxChunks: config.maxChunks ?? 30,
      minChunks: config.minChunks ?? 2,
      vendorChunk: config.vendorChunk ?? true,
      vendorChunkName: config.vendorChunkName || 'vendor',
      commonChunk: config.commonChunk ?? true,
      commonChunkName: config.commonChunkName || 'common',
      frameworkChunk: config.frameworkChunk ?? true,
      frameworkChunkName: config.frameworkChunkName || 'aether',
      manualChunks: config.manualChunks || {},
      cacheGroups: config.cacheGroups || {},
      preloadHints: config.preloadHints ?? true,
      prefetchStrategies: config.prefetchStrategies ?? true,
      criticalChunks: config.criticalChunks ?? true,
      hashChunkNames: config.hashChunkNames ?? true,
      hashLength: config.hashLength ?? 8,
    };
  }

  /**
   * Add module to the optimizer
   */
  addModule(id: string, info: Omit<ModuleInfo, 'isVendor' | 'isAetherCore'>): void {
    const moduleInfo: ModuleInfo = {
      ...info,
      isVendor: this.isVendorModule(id),
      isAetherCore: this.isAetherCoreModule(id),
    };

    this.modules.set(id, moduleInfo);
  }

  /**
   * Analyze modules and dependencies
   */
  analyze(): ChunkAnalysis {
    const analysis: ChunkAnalysis = {
      modules: this.modules,
      dependencyGraph: this.buildDependencyGraph(),
      circularDependencies: this.detectCircularDependencies(),
      commonModules: this.findCommonModules(),
      vendorModules: this.findVendorModules(),
      frameworkModules: this.findFrameworkModules(),
      totalSize: this.calculateTotalSize(),
      averageModuleSize: this.calculateAverageModuleSize(),
    };

    this.analysis = analysis;
    return analysis;
  }

  /**
   * Optimize chunks
   */
  async optimize(): Promise<OptimizationResult> {
    if (!this.analysis) {
      this.analyze();
    }

    // Clear previous chunks
    this.chunks.clear();

    // Apply strategy
    switch (this.config.strategy) {
      case 'manual':
        await this.applyManualStrategy();
        break;
      case 'granular':
        await this.applyGranularStrategy();
        break;
      case 'auto':
      default:
        await this.applyAutoStrategy();
        break;
    }

    // Apply cache groups
    await this.applyCacheGroups();

    // Merge small chunks
    await this.mergeSmallChunks();

    // Split large chunks
    await this.splitLargeChunks();

    // Calculate priorities and load order
    this.calculateChunkPriorities();
    this.calculateLoadOrder();

    // Identify critical chunks
    if (this.config.criticalChunks) {
      this.identifyCriticalChunks();
    }

    // Generate hints
    const preloadHints = this.config.preloadHints ? this.generatePreloadHints() : new Map();
    const prefetchHints = this.config.prefetchStrategies ? this.generatePrefetchHints() : new Map();

    // Build manifest
    const manifest = this.buildManifest();

    // Calculate metrics
    const metrics = this.calculateMetrics();

    // Generate recommendations
    const recommendations = this.generateRecommendations();

    return {
      chunks: this.chunks,
      manifest,
      preloadHints,
      prefetchHints,
      metrics,
      recommendations,
    };
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(): Map<string, GraphNode> {
    const graph = new Map<string, GraphNode>();

    // Initialize nodes
    for (const [id] of this.modules) {
      graph.set(id, {
        id,
        dependencies: new Set(),
        dependents: new Set(),
        visited: false,
        inCycle: false,
      });
    }

    // Build edges
    for (const [id, module] of this.modules) {
      const node = graph.get(id)!;

      for (const dep of module.imports) {
        node.dependencies.add(dep);

        const depNode = graph.get(dep);
        if (depNode) {
          depNode.dependents.add(id);
        }
      }

      for (const dep of module.dynamicImports) {
        node.dependencies.add(dep);

        const depNode = graph.get(dep);
        if (depNode) {
          depNode.dependents.add(id);
        }
      }
    }

    return graph;
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    // Use module imports directly instead of the graph
    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const module = this.modules.get(nodeId);
      if (!module) {
        recursionStack.delete(nodeId);
        return;
      }

      for (const dep of module.imports) {
        if (!visited.has(dep)) {
          dfs(dep, [...path]);
        } else if (recursionStack.has(dep)) {
          // Found cycle
          const cycleStart = path.indexOf(dep);
          if (cycleStart >= 0) {
            const cycle = path.slice(cycleStart);
            cycles.push([...cycle, dep]);
          }
        }
      }

      recursionStack.delete(nodeId);
    };

    for (const [id] of this.modules) {
      if (!visited.has(id)) {
        dfs(id, []);
      }
    }

    return cycles;
  }

  /**
   * Find common modules (used by multiple entry points)
   */
  private findCommonModules(): Map<string, Set<string>> {
    const commonModules = new Map<string, Set<string>>();

    for (const [id, module] of this.modules) {
      if (module.importedBy.size >= this.config.minChunks) {
        commonModules.set(id, new Set(module.importedBy));
      }
    }

    return commonModules;
  }

  /**
   * Find vendor modules
   */
  private findVendorModules(): Set<string> {
    const vendors = new Set<string>();

    for (const [id, module] of this.modules) {
      if (module.isVendor) {
        vendors.add(id);
      }
    }

    return vendors;
  }

  /**
   * Find framework modules (Aether core)
   */
  private findFrameworkModules(): Set<string> {
    const framework = new Set<string>();

    for (const [id, module] of this.modules) {
      if (module.isAetherCore) {
        framework.add(id);
      }
    }

    return framework;
  }

  /**
   * Apply auto strategy
   */
  private async applyAutoStrategy(): Promise<void> {
    if (!this.analysis) return;

    // 1. Framework chunk (Aether core)
    if (this.config.frameworkChunk && this.analysis.frameworkModules.size > 0) {
      this.createChunk(this.config.frameworkChunkName, 'framework', this.analysis.frameworkModules);
    }

    // 2. Vendor chunks
    if (this.config.vendorChunk && this.analysis.vendorModules.size > 0) {
      // Split vendors by size if too large
      const vendorSize = this.calculateModulesSize(this.analysis.vendorModules);

      if (vendorSize > this.config.maxChunkSize * 2) {
        // Split into multiple vendor chunks
        await this.splitVendorChunks();
      } else {
        this.createChunk(this.config.vendorChunkName, 'vendor', this.analysis.vendorModules);
      }
    }

    // 3. Common chunks
    if (this.config.commonChunk && this.analysis.commonModules.size > 0) {
      const commonModuleIds = new Set(this.analysis.commonModules.keys());
      const commonSize = this.calculateModulesSize(commonModuleIds);

      if (commonSize >= this.config.minChunkSize) {
        this.createChunk(this.config.commonChunkName, 'common', commonModuleIds);
      }
    }

    // 4. Async chunks (dynamic imports)
    await this.createAsyncChunks();

    // 5. Entry chunks for modules not yet in any chunk
    await this.createEntryChunks();
  }

  /**
   * Apply manual strategy
   */
  private async applyManualStrategy(): Promise<void> {
    const manualChunks = this.config.manualChunks;

    if (typeof manualChunks === 'function') {
      // Function-based manual chunks
      for (const [id] of this.modules) {
        const chunkName = manualChunks(id);
        if (chunkName) {
          let chunk = Array.from(this.chunks.values()).find((c) => c.name === chunkName);

          if (!chunk) {
            chunk = this.createChunk(chunkName, 'manual', new Set([id]));
          } else {
            chunk.modules.add(id);
            chunk.size += this.modules.get(id)?.size || 0;
          }
        }
      }
    } else {
      // Object-based manual chunks
      for (const [chunkName, moduleIds] of Object.entries(manualChunks)) {
        const modules = new Set(moduleIds.filter((id) => this.modules.has(id)));
        if (modules.size > 0) {
          this.createChunk(chunkName, 'manual', modules);
        }
      }
    }
  }

  /**
   * Apply granular strategy (one chunk per module type)
   */
  private async applyGranularStrategy(): Promise<void> {
    if (!this.analysis) return;

    // Group by module type and path patterns
    const groups = new Map<string, Set<string>>();

    for (const [id, module] of this.modules) {
      let groupName: string;

      if (module.isAetherCore) {
        groupName = 'aether-core';
      } else if (module.isVendor) {
        // Split vendors by package
        const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
        groupName = match ? `vendor-${match[1].replace(/[@/]/g, '-')}` : 'vendor-other';
      } else {
        // Split by directory
        const parts = id.split('/');
        if (parts.length > 2) {
          groupName = parts.slice(0, 2).join('-');
        } else {
          groupName = parts[0];
        }
      }

      if (!groups.has(groupName)) {
        groups.set(groupName, new Set());
      }
      groups.get(groupName)!.add(id);
    }

    // Create chunks from groups
    for (const [name, modules] of groups) {
      const size = this.calculateModulesSize(modules);
      if (size >= this.config.minChunkSize) {
        this.createChunk(name, 'manual', modules);
      }
    }
  }

  /**
   * Apply cache groups
   */
  private async applyCacheGroups(): Promise<void> {
    if (Object.keys(this.config.cacheGroups).length === 0) return;

    // Sort cache groups by priority
    const sortedGroups = Object.entries(this.config.cacheGroups).sort(
      ([, a], [, b]) => (b.priority || 0) - (a.priority || 0)
    );

    for (const [groupName, group] of sortedGroups) {
      const matchingModules = new Set<string>();

      for (const [id, module] of this.modules) {
        // Skip if already in a chunk with higher priority
        if (group.enforce !== true) {
          const existingChunk = this.findChunkContainingModule(id);
          if (existingChunk && existingChunk.priority > (group.priority || 0)) {
            continue;
          }
        }

        // Test module against cache group
        const matches =
          typeof group.test === 'function' ? group.test(module) : group.test ? group.test.test(id) : false;

        if (matches) {
          // Check min chunks requirement
          if (group.minChunks && module.importedBy.size < group.minChunks) {
            continue;
          }

          matchingModules.add(id);
        }
      }

      if (matchingModules.size > 0) {
        const size = this.calculateModulesSize(matchingModules);

        // Check size constraints
        if (group.minSize && size < group.minSize) {
          continue;
        }

        // Determine chunk name
        const chunkName =
          typeof group.name === 'function'
            ? group.name(this.modules.get(Array.from(matchingModules)[0])!)
            : group.name || groupName;

        // Create or update chunk
        const existingChunk = this.chunks.get(chunkName);

        if (existingChunk && group.reuseExistingChunk) {
          // Add to existing chunk
          for (const id of matchingModules) {
            existingChunk.modules.add(id);
          }
          existingChunk.size = this.calculateModulesSize(existingChunk.modules);
        } else {
          // Create new chunk
          const chunk = this.createChunk(chunkName, 'manual', matchingModules);
          chunk.priority = group.priority || 0;
        }
      }
    }
  }

  /**
   * Split vendor chunks
   */
  private async splitVendorChunks(): Promise<void> {
    if (!this.analysis) return;

    const vendorsByPackage = new Map<string, Set<string>>();

    for (const id of this.analysis.vendorModules) {
      const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
      const packageName = match ? match[1] : 'other';

      if (!vendorsByPackage.has(packageName)) {
        vendorsByPackage.set(packageName, new Set());
      }
      vendorsByPackage.get(packageName)!.add(id);
    }

    // Create chunks for large packages
    for (const [packageName, modules] of vendorsByPackage) {
      const size = this.calculateModulesSize(modules);

      if (size >= this.config.minChunkSize) {
        const chunkName = `vendor-${packageName.replace(/[@/]/g, '-')}`;
        this.createChunk(chunkName, 'vendor', modules);
      }
    }
  }

  /**
   * Create async chunks
   */
  private async createAsyncChunks(): Promise<void> {
    const asyncModules = new Map<string, Set<string>>();

    // Find modules with dynamic imports
    for (const [id, module] of this.modules) {
      for (const dynamicImport of module.dynamicImports) {
        if (!asyncModules.has(dynamicImport)) {
          asyncModules.set(dynamicImport, new Set());
        }

        // Collect all dependencies of the dynamic import
        const dependencies = this.collectDependencies(dynamicImport);
        for (const dep of dependencies) {
          asyncModules.get(dynamicImport)!.add(dep);
        }
      }
    }

    // Create async chunks
    for (const [entryId, modules] of asyncModules) {
      const chunkName = this.generateChunkName(entryId);
      this.createChunk(chunkName, 'async', modules);
    }
  }

  /**
   * Create entry chunks for remaining modules
   */
  private async createEntryChunks(): Promise<void> {
    // Find modules not in any chunk yet
    const unassignedModules = new Set<string>();

    for (const [id] of this.modules) {
      const existingChunk = this.findChunkContainingModule(id);
      if (!existingChunk) {
        unassignedModules.add(id);
      }
    }

    // If we have unassigned modules, create a main entry chunk
    if (unassignedModules.size > 0) {
      this.createChunk('main', 'entry', unassignedModules);
    }
  }

  /**
   * Merge small chunks
   */
  private async mergeSmallChunks(): Promise<void> {
    const smallChunks = Array.from(this.chunks.values())
      .filter((chunk) => chunk.size < this.config.minChunkSize && chunk.type !== 'entry')
      .sort((a, b) => a.size - b.size);

    for (const smallChunk of smallChunks) {
      // Find best merge candidate
      let bestCandidate: ChunkInfo | null = null;
      let bestScore = 0;

      for (const candidate of this.chunks.values()) {
        if (candidate === smallChunk) continue;
        if (candidate.type === 'entry') continue;

        // Calculate merge score based on shared dependencies
        const sharedDeps = this.countSharedDependencies(smallChunk, candidate);
        const score = sharedDeps / (smallChunk.dependencies.size + candidate.dependencies.size);

        if (score > bestScore && candidate.size + smallChunk.size <= this.config.maxChunkSize) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      // Merge if good candidate found
      if (bestCandidate && bestScore > 0.3) {
        for (const moduleId of smallChunk.modules) {
          bestCandidate.modules.add(moduleId);
        }
        bestCandidate.size += smallChunk.size;
        this.chunks.delete(smallChunk.id);
      }
    }
  }

  /**
   * Split large chunks
   */
  private async splitLargeChunks(): Promise<void> {
    const largeChunks = Array.from(this.chunks.values()).filter(
      (chunk) => chunk.size > this.config.maxChunkSize && chunk.type !== 'entry'
    );

    for (const largeChunk of largeChunks) {
      const modules = Array.from(largeChunk.modules);
      const targetChunks = Math.ceil(largeChunk.size / this.config.maxChunkSize);

      // Only split if we need more than 1 chunk
      if (targetChunks > 1) {
        // Simple split by module count
        const modulesPerChunk = Math.ceil(modules.length / targetChunks);

        for (let i = 0; i < targetChunks; i++) {
          const start = i * modulesPerChunk;
          const end = Math.min(start + modulesPerChunk, modules.length);
          const chunkModules = new Set(modules.slice(start, end));

          if (chunkModules.size > 0) {
            const chunkName = i === 0 ? largeChunk.name : `${largeChunk.name}-${i}`;
            this.createChunk(chunkName, largeChunk.type, chunkModules);
          }
        }

        // Remove original large chunk
        this.chunks.delete(largeChunk.id);
      }
    }
  }

  /**
   * Calculate chunk priorities
   */
  private calculateChunkPriorities(): void {
    for (const chunk of this.chunks.values()) {
      let priority = 0;

      // Entry chunks have highest priority
      if (chunk.type === 'entry') {
        priority = 100;
      }
      // Framework next
      else if (chunk.type === 'framework') {
        priority = 90;
      }
      // Critical chunks
      else if (chunk.isCritical) {
        priority = 80;
      }
      // Vendor chunks
      else if (chunk.type === 'vendor') {
        priority = 70;
      }
      // Common chunks
      else if (chunk.type === 'common') {
        priority = 60;
      }
      // Async chunks
      else if (chunk.type === 'async') {
        priority = 40;
      }
      // Manual chunks
      else {
        priority = 50;
      }

      chunk.priority = priority;
    }
  }

  /**
   * Calculate load order
   */
  private calculateLoadOrder(): void {
    // Topological sort based on dependencies
    const sorted: ChunkInfo[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const visit = (chunk: ChunkInfo): void => {
      if (visited.has(chunk.id)) return;
      if (recursionStack.has(chunk.id)) {
        // Circular dependency, use priority
        return;
      }

      recursionStack.add(chunk.id);

      // Visit dependencies first
      for (const depId of chunk.dependencies) {
        const depChunk = this.chunks.get(depId);
        if (depChunk) {
          visit(depChunk);
        }
      }

      recursionStack.delete(chunk.id);
      visited.add(chunk.id);
      sorted.push(chunk);
    };

    // Sort chunks by priority first
    const chunksByPriority = Array.from(this.chunks.values()).sort((a, b) => b.priority - a.priority);

    for (const chunk of chunksByPriority) {
      visit(chunk);
    }

    // Assign load order
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].loadOrder = i;
    }
  }

  /**
   * Identify critical chunks
   */
  private identifyCriticalChunks(): void {
    for (const chunk of this.chunks.values()) {
      // Entry chunks are always critical
      if (chunk.type === 'entry') {
        chunk.isCritical = true;
        continue;
      }

      // Framework chunks are critical
      if (chunk.type === 'framework') {
        chunk.isCritical = true;
        continue;
      }

      // Chunks used by entry chunks are critical
      let usedByEntry = false;
      for (const entryChunk of this.chunks.values()) {
        if (entryChunk.type === 'entry' && entryChunk.dependencies.has(chunk.id)) {
          usedByEntry = true;
          break;
        }
      }

      chunk.isCritical = usedByEntry;
    }
  }

  /**
   * Generate preload hints
   */
  private generatePreloadHints(): Map<string, string[]> {
    const hints = new Map<string, string[]>();

    for (const chunk of this.chunks.values()) {
      if (chunk.type === 'entry') {
        const preloadChunks: string[] = [];

        // Preload critical dependencies
        for (const depId of chunk.dependencies) {
          const depChunk = this.chunks.get(depId);
          if (depChunk && depChunk.isCritical) {
            preloadChunks.push(depChunk.name);
            depChunk.preload = true;
          }
        }

        if (preloadChunks.length > 0) {
          hints.set(chunk.name, preloadChunks);
        }
      }
    }

    return hints;
  }

  /**
   * Generate prefetch hints
   */
  private generatePrefetchHints(): Map<string, string[]> {
    const hints = new Map<string, string[]>();

    for (const chunk of this.chunks.values()) {
      if (chunk.type === 'entry') {
        const prefetchChunks: string[] = [];

        // Prefetch non-critical async dependencies
        for (const depId of chunk.dependencies) {
          const depChunk = this.chunks.get(depId);
          if (depChunk && depChunk.type === 'async' && !depChunk.isCritical) {
            prefetchChunks.push(depChunk.name);
            depChunk.prefetch = true;
          }
        }

        if (prefetchChunks.length > 0) {
          hints.set(chunk.name, prefetchChunks);
        }
      }
    }

    return hints;
  }

  /**
   * Build chunk manifest
   */
  private buildManifest(): ChunkManifest {
    const manifest: ChunkManifest = {
      version: '1.0.0',
      chunks: {},
      entrypoints: {},
    };

    for (const chunk of this.chunks.values()) {
      const hash = chunk.hash || this.generateHash(chunk);
      const fileName = this.config.hashChunkNames ? `${chunk.name}.${hash}.js` : `${chunk.name}.js`;

      manifest.chunks[chunk.name] = {
        file: fileName,
        hash,
        size: chunk.size,
        dependencies: Array.from(chunk.dependencies),
        preload: chunk.preload,
        prefetch: chunk.prefetch,
        critical: chunk.isCritical,
      };

      if (chunk.type === 'entry') {
        manifest.entrypoints[chunk.name] = this.getChunkLoadChain(chunk);
      }
    }

    return manifest;
  }

  /**
   * Calculate optimization metrics
   */
  private calculateMetrics(): OptimizationMetrics {
    const chunks = Array.from(this.chunks.values());
    const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);
    const averageChunkSize = chunks.length > 0 ? totalSize / chunks.length : 0;

    const sortedBySize = [...chunks].sort((a, b) => b.size - a.size);
    const largestChunk = sortedBySize[0] || { name: '', size: 0 };
    const smallestChunk = sortedBySize[sortedBySize.length - 1] || { name: '', size: 0 };

    // Calculate duplication rate
    const allModules = new Set<string>();
    let totalModuleReferences = 0;

    for (const chunk of chunks) {
      for (const moduleId of chunk.modules) {
        allModules.add(moduleId);
        totalModuleReferences++;
      }
    }

    const duplicationRate =
      allModules.size > 0 ? ((totalModuleReferences - allModules.size) / allModules.size) * 100 : 0;

    // Network requests (assuming HTTP/2 multiplexing)
    const networkRequests = Math.min(chunks.length, 6); // HTTP/2 typical concurrent streams

    // Estimate load time (simplified)
    const estimatedLoadTime = this.estimateLoadTime(chunks);

    // Cache efficiency
    const cacheEfficiency = this.calculateCacheEfficiency();

    // Chunks by type
    const chunksByType: Record<string, number> = {};
    for (const chunk of chunks) {
      chunksByType[chunk.type] = (chunksByType[chunk.type] || 0) + 1;
    }

    return {
      totalChunks: chunks.length,
      totalSize,
      averageChunkSize,
      largestChunk: { name: largestChunk.name, size: largestChunk.size },
      smallestChunk: { name: smallestChunk.name, size: smallestChunk.size },
      duplicationRate,
      networkRequests,
      estimatedLoadTime,
      cacheEfficiency,
      chunksByType,
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const metrics = this.calculateMetrics();

    // Check total chunks
    if (metrics.totalChunks > this.config.maxChunks) {
      recommendations.push(
        `Too many chunks (${metrics.totalChunks}). Consider increasing minChunkSize or reducing granularity.`
      );
    }

    // Check largest chunk
    if (metrics.largestChunk.size > this.config.maxChunkSize * 1.5) {
      recommendations.push(
        `Chunk "${metrics.largestChunk.name}" is very large (${(metrics.largestChunk.size / 1024).toFixed(1)}KB). Consider code splitting.`
      );
    }

    // Check duplication
    if (metrics.duplicationRate > 10) {
      recommendations.push(
        `High code duplication (${metrics.duplicationRate.toFixed(1)}%). Consider extracting more common chunks.`
      );
    }

    // Check small chunks
    const smallChunks = Array.from(this.chunks.values()).filter(
      (c) => c.size < this.config.minChunkSize && c.type !== 'async'
    );

    if (smallChunks.length > 3) {
      recommendations.push(
        `${smallChunks.length} chunks are below minimum size. Consider merging them to reduce HTTP requests.`
      );
    }

    // Check cache efficiency
    if (metrics.cacheEfficiency < 70) {
      recommendations.push(
        `Low cache efficiency (${metrics.cacheEfficiency.toFixed(1)}%). Consider using content hashing and splitting vendor chunks.`
      );
    }

    return recommendations;
  }

  /**
   * Helper: Check if module is vendor module
   */
  private isVendorModule(id: string): boolean {
    return id.includes('node_modules');
  }

  /**
   * Helper: Check if module is Aether core module
   */
  private isAetherCoreModule(id: string): boolean {
    return (
      (id.includes('@omnitron-dev/aether') || id.includes('packages/aether')) &&
      !id.includes('node_modules') &&
      (id.includes('/core/') || id.includes('/jsx-runtime') || id.includes('aether/src/core'))
    );
  }

  /**
   * Helper: Calculate total size
   */
  private calculateTotalSize(): number {
    let total = 0;
    for (const module of this.modules.values()) {
      total += module.size;
    }
    return total;
  }

  /**
   * Helper: Calculate average module size
   */
  private calculateAverageModuleSize(): number {
    const size = this.calculateTotalSize();
    return this.modules.size > 0 ? size / this.modules.size : 0;
  }

  /**
   * Helper: Calculate size of modules set
   */
  private calculateModulesSize(modules: Set<string>): number {
    let size = 0;
    for (const id of modules) {
      const module = this.modules.get(id);
      if (module) {
        size += module.size;
      }
    }
    return size;
  }

  /**
   * Helper: Collect all dependencies recursively
   */
  private collectDependencies(moduleId: string, visited = new Set<string>()): Set<string> {
    if (visited.has(moduleId)) {
      return visited;
    }

    visited.add(moduleId);
    const module = this.modules.get(moduleId);

    if (module) {
      for (const dep of module.imports) {
        this.collectDependencies(dep, visited);
      }
    }

    return visited;
  }

  /**
   * Helper: Generate chunk name from module ID
   */
  private generateChunkName(moduleId: string): string {
    const parts = moduleId.split('/');
    const fileName = parts[parts.length - 1];
    const name = fileName.replace(/\.[^.]+$/, '');
    return name.replace(/[^a-zA-Z0-9-_]/g, '-');
  }

  /**
   * Helper: Create chunk
   */
  private createChunk(name: string, type: ChunkInfo['type'], modules: Set<string>): ChunkInfo {
    const id = `chunk-${this.chunks.size}-${name}`;
    const size = this.calculateModulesSize(modules);

    const chunk: ChunkInfo = {
      id,
      name,
      type,
      modules,
      size,
      dependencies: new Set(),
      dependents: new Set(),
      isCritical: false,
      priority: 0,
      preload: false,
      prefetch: false,
      loadOrder: 0,
    };

    // Calculate dependencies
    for (const moduleId of modules) {
      const module = this.modules.get(moduleId);
      if (module) {
        for (const dep of module.imports) {
          const depChunk = this.findChunkContainingModule(dep);
          if (depChunk && depChunk !== chunk) {
            chunk.dependencies.add(depChunk.id);
            depChunk.dependents.add(chunk.id);
          }
        }
      }
    }

    this.chunks.set(id, chunk);
    return chunk;
  }

  /**
   * Helper: Find chunk containing module
   */
  private findChunkContainingModule(moduleId: string): ChunkInfo | undefined {
    for (const chunk of this.chunks.values()) {
      if (chunk.modules.has(moduleId)) {
        return chunk;
      }
    }
    return undefined;
  }

  /**
   * Helper: Count shared dependencies
   */
  private countSharedDependencies(chunk1: ChunkInfo, chunk2: ChunkInfo): number {
    let shared = 0;
    for (const dep of chunk1.dependencies) {
      if (chunk2.dependencies.has(dep)) {
        shared++;
      }
    }
    return shared;
  }

  /**
   * Helper: Generate hash for chunk
   */
  private generateHash(chunk: ChunkInfo): string {
    const content = Array.from(chunk.modules).sort().join('|');
    let hash = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(36).slice(0, this.config.hashLength);
  }

  /**
   * Helper: Get chunk load chain
   */
  private getChunkLoadChain(chunk: ChunkInfo): string[] {
    const chain: string[] = [chunk.name];
    const visited = new Set<string>([chunk.id]);

    const addDependencies = (currentChunk: ChunkInfo): void => {
      const sortedDeps = Array.from(currentChunk.dependencies)
        .map((id) => this.chunks.get(id))
        .filter((c): c is ChunkInfo => c !== undefined)
        .sort((a, b) => a.loadOrder - b.loadOrder);

      for (const dep of sortedDeps) {
        if (!visited.has(dep.id)) {
          visited.add(dep.id);
          chain.push(dep.name);
          addDependencies(dep);
        }
      }
    };

    addDependencies(chunk);
    return chain;
  }

  /**
   * Helper: Estimate load time
   */
  private estimateLoadTime(chunks: ChunkInfo[]): number {
    // Simplified estimation based on chunk sizes and dependencies
    // Assumes 5 Mbps connection and HTTP/2
    const bandwidth = 5 * 1024 * 1024; // 5 Mbps in bytes
    const parallelism = 6; // HTTP/2 typical streams

    let totalTime = 0;
    const remaining = new Set(chunks.map((c) => c.id));
    const loaded = new Set<string>();

    while (remaining.size > 0) {
      // Find chunks that can be loaded (dependencies satisfied)
      const canLoad = Array.from(remaining)
        .map((id) => this.chunks.get(id)!)
        .filter((c) => Array.from(c.dependencies).every((d) => loaded.has(d)));

      if (canLoad.length === 0) break;

      // Load up to parallelism chunks
      const toLoad = canLoad.slice(0, parallelism);
      const batchSize = toLoad.reduce((sum, c) => sum + c.size, 0);
      const batchTime = (batchSize / bandwidth) * 1000; // Convert to ms

      totalTime += batchTime;

      // Mark as loaded
      for (const chunk of toLoad) {
        loaded.add(chunk.id);
        remaining.delete(chunk.id);
      }
    }

    return totalTime;
  }

  /**
   * Helper: Calculate cache efficiency
   */
  private calculateCacheEfficiency(): number {
    // Simplified cache efficiency based on chunk stability
    // Assumes vendor and framework chunks are highly cacheable
    let cacheableSize = 0;
    const totalSize = Array.from(this.chunks.values()).reduce((sum, c) => sum + c.size, 0);

    for (const chunk of this.chunks.values()) {
      if (chunk.type === 'vendor' || chunk.type === 'framework') {
        cacheableSize += chunk.size;
      } else if (chunk.type === 'common') {
        cacheableSize += chunk.size * 0.8; // Common chunks are moderately cacheable
      }
    }

    return totalSize > 0 ? (cacheableSize / totalSize) * 100 : 0;
  }
}

/**
 * Vite/Rollup plugin integration helper
 */
export function createSharedChunksPlugin(config: SharedChunksConfig = {}) {
  const optimizer = new SharedChunksOptimizer(config);

  return {
    name: 'aether-shared-chunks',

    /**
     * Convert to Vite/Rollup manualChunks function
     */
    getManualChunks() {
      return (id: string) => {
        // This will be called by Vite/Rollup for each module
        if (typeof config.manualChunks === 'function') {
          return config.manualChunks(id);
        }

        if (typeof config.manualChunks === 'object') {
          for (const [chunkName, modules] of Object.entries(config.manualChunks)) {
            if (modules.includes(id)) {
              return chunkName;
            }
          }
        }

        // Auto strategy
        if (config.frameworkChunk !== false && optimizer['isAetherCoreModule'](id)) {
          return config.frameworkChunkName || 'aether';
        }

        if (config.vendorChunk !== false && optimizer['isVendorModule'](id)) {
          // Split large vendors
          const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
          if (match) {
            return `vendor-${match[1].replace(/[@/]/g, '-')}`;
          }
          return config.vendorChunkName || 'vendor';
        }

        return undefined;
      };
    },

    /**
     * Get optimizer instance for advanced usage
     */
    getOptimizer() {
      return optimizer;
    },
  };
}

/**
 * Shared Chunk Manager (simplified API for testing)
 */
export class SharedChunkManager {
  private config: { minSize: number; maxSize?: number; minChunks: number };
  private modules: Map<string, { dependencies: string[]; size: number }> = new Map();

  constructor(config: { minSize: number; maxSize?: number; minChunks: number }) {
    this.config = config;
  }

  addModule(moduleName: string, dependencies: string[], size: number = 1000): void {
    this.modules.set(moduleName, { dependencies, size });
  }

  /**
   * Analyze which modules are shared across multiple entry points
   * Returns a map of dependency -> Set of modules that depend on it
   */
  analyzeSharedModules(): Map<string, Set<string>> {
    const analysis = new Map<string, Set<string>>();

    // For each module's dependencies, track which modules use them
    for (const [moduleName, { dependencies }] of this.modules) {
      for (const dep of dependencies) {
        if (!analysis.has(dep)) {
          analysis.set(dep, new Set());
        }
        analysis.get(dep)!.add(moduleName);
      }
    }

    return analysis;
  }

  generateChunks(): Array<{ name: string; modules: string[]; size: number }> {
    // Simple chunk generation for testing
    const chunks: Array<{ name: string; modules: string[]; size: number }> = [];

    // Analyze shared dependencies
    const sharedDeps = this.analyzeSharedModules();

    // Find dependencies used by at least minChunks modules
    const commonDeps = new Set<string>();
    for (const [dep, users] of sharedDeps) {
      if (users.size >= this.config.minChunks) {
        commonDeps.add(dep);
      }
    }

    // Create vendor chunk for common dependencies if they exist
    if (commonDeps.size > 0) {
      chunks.push({
        name: 'vendor',
        modules: Array.from(commonDeps),
        size: commonDeps.size * 50, // Estimate: 50 bytes per dependency name
      });
    }

    // Group all modules by their dependency patterns
    const dependencyGroups = new Map<string, Set<string>>();

    for (const [moduleName, { dependencies }] of this.modules) {
      // Filter out common deps that are in vendor chunk
      const uniqueDeps = dependencies.filter(d => !commonDeps.has(d));
      const depsKey = uniqueDeps.sort().join(',');

      if (!dependencyGroups.has(depsKey)) {
        dependencyGroups.set(depsKey, new Set());
      }
      dependencyGroups.get(depsKey)!.add(moduleName);
    }

    // Create chunks from groups, respecting size constraints
    let chunkId = 0;
    for (const [depsKey, moduleSet] of dependencyGroups) {
      // Calculate total size for this group
      let totalSize = 0;
      for (const moduleName of moduleSet) {
        const moduleData = this.modules.get(moduleName);
        if (moduleData) {
          totalSize += moduleData.size;
        }
      }

      // Check if we need to split based on size
      if (this.config.maxSize && totalSize > this.config.maxSize) {
        // Split into multiple chunks
        const modulesArray = Array.from(moduleSet);
        let currentChunk: string[] = [];
        let currentSize = 0;

        for (const moduleName of modulesArray) {
          const moduleData = this.modules.get(moduleName);
          const moduleSize = moduleData?.size || 0;

          // If adding this module exceeds maxSize and we have modules in current chunk, start a new chunk
          if (currentSize + moduleSize > this.config.maxSize && currentChunk.length > 0) {
            chunks.push({
              name: `chunk-${chunkId++}`,
              modules: currentChunk,
              size: currentSize,
            });
            currentChunk = [];
            currentSize = 0;
          }

          currentChunk.push(moduleName);
          currentSize += moduleSize;
        }

        // Add remaining modules
        if (currentChunk.length > 0) {
          chunks.push({
            name: `chunk-${chunkId++}`,
            modules: currentChunk,
            size: currentSize,
          });
        }
      } else if (moduleSet.size >= this.config.minChunks || totalSize >= this.config.minSize) {
        // Create a single chunk if it meets the criteria
        chunks.push({
          name: `chunk-${chunkId++}`,
          modules: Array.from(moduleSet),
          size: totalSize,
        });
      }
    }

    return chunks;
  }

  /**
   * Get statistics about chunks and modules
   */
  getStatistics() {
    const chunks = this.generateChunks();
    const sharedModules = this.analyzeSharedModules();

    // Count how many dependencies are shared
    let sharedCount = 0;
    for (const [dep, users] of sharedModules) {
      if (users.size >= this.config.minChunks) {
        sharedCount++;
      }
    }

    return {
      totalModules: this.modules.size,
      totalChunks: chunks.length,
      sharedModules: sharedCount,
    };
  }
}

// Alias for backwards compatibility
export { SharedChunksOptimizer as SharedChunksManager };
