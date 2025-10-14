/**
 * Lazy Compilation for Development
 * On-demand compilation to improve development server startup time
 */

import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * Configuration for lazy compilation
 */
export interface LazyCompilationConfig {
  /**
   * Modules to always compile (entry points)
   */
  entries?: string[] | ((id: string) => boolean);

  /**
   * Test function or regex to determine which modules should be lazy
   */
  test?: RegExp | ((id: string) => boolean);

  /**
   * Backend configuration for WebSocket communication
   */
  backend?: {
    /** Client module path */
    client?: string;
    /** Server configuration */
    server?: {
      port?: number;
      host?: string;
    };
  };

  /**
   * Whether to enable background pre-compilation
   * @default true
   */
  backgroundCompilation?: boolean;

  /**
   * Maximum modules to pre-compile in background
   * @default 10
   */
  maxBackgroundCompilation?: number;

  /**
   * Timeout for compilation in ms
   * @default 30000
   */
  compilationTimeout?: number;

  /**
   * Cache directory for lazy compilation metadata
   */
  cacheDir?: string;
}

/**
 * Compilation status
 */
export type CompilationStatus = 'pending' | 'compiling' | 'compiled' | 'error';

/**
 * Module compilation state
 */
export interface ModuleState {
  /** Module ID */
  id: string;
  /** Compilation status */
  status: CompilationStatus;
  /** Compilation result */
  result?: any;
  /** Error if compilation failed */
  error?: Error;
  /** Access count */
  accessCount: number;
  /** Last accessed timestamp */
  lastAccessed: number;
  /** Dependencies */
  dependencies: string[];
  /** Compilation time in ms */
  compilationTime?: number;
}

/**
 * Compilation task
 */
export interface CompilationTask {
  /** Module ID */
  id: string;
  /** Priority (higher = more important) */
  priority: number;
  /** Callback when compilation completes */
  callback: (result: any, error?: Error) => void;
}

/**
 * Lazy compilation statistics
 */
export interface LazyCompilationStats {
  /** Total modules tracked */
  totalModules: number;
  /** Modules compiled */
  compiledModules: number;
  /** Modules pending */
  pendingModules: number;
  /** Modules currently compiling */
  compilingModules: number;
  /** Average compilation time */
  averageCompilationTime: number;
  /** Total compilation time saved */
  timeSaved: number;
  /** Cache hit rate */
  cacheHitRate: number;
}

/**
 * Lazy compilation manager
 */
export class LazyCompilationManager extends EventEmitter {
  private config: Required<LazyCompilationConfig>;
  private modules: Map<string, ModuleState> = new Map();
  private compilationQueue: CompilationTask[] = [];
  private isCompiling = false;
  private compiler?: (id: string) => Promise<any>;
  private backgroundCompilationQueue: string[] = [];
  private stats = {
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(config: LazyCompilationConfig = {}) {
    super();

    this.config = {
      entries: config.entries || [],
      test: config.test || (() => true),
      backend: config.backend || {},
      backgroundCompilation: config.backgroundCompilation !== false,
      maxBackgroundCompilation: config.maxBackgroundCompilation || 10,
      compilationTimeout: config.compilationTimeout || 30000,
      cacheDir: config.cacheDir || '.aether/lazy-cache',
    };
  }

  /**
   * Set the compiler function
   */
  setCompiler(compiler: (id: string) => Promise<any>): void {
    this.compiler = compiler;
  }

  /**
   * Request compilation of a module
   */
  async requestCompilation(id: string, priority: number = 0): Promise<any> {
    const normalizedId = this.normalizeId(id);

    // Check if it's an entry point (always compile immediately)
    if (this.isEntry(normalizedId)) {
      return this.compileImmediately(normalizedId);
    }

    // Check if module should be lazy
    if (!this.shouldBeLazy(normalizedId)) {
      return this.compileImmediately(normalizedId);
    }

    // Check if already compiled
    const state = this.modules.get(normalizedId);
    if (state?.status === 'compiled') {
      this.recordAccess(normalizedId);
      this.stats.cacheHits++;
      return state.result;
    }

    this.stats.cacheMisses++;

    // Add to queue if not already compiling
    if (!state || state.status === 'pending') {
      return new Promise((resolve, reject) => {
        this.enqueueCompilation({
          id: normalizedId,
          priority,
          callback: (result, error) => {
            if (error) reject(error);
            else resolve(result);
          },
        });
      });
    }

    // Wait for ongoing compilation
    if (state.status === 'compiling') {
      return new Promise((resolve, reject) => {
        const onCompiled = (compiledId: string) => {
          if (compiledId === normalizedId) {
            this.off('compiled', onCompiled);
            this.off('error', onError);
            const updatedState = this.modules.get(normalizedId);
            if (updatedState?.result) {
              resolve(updatedState.result);
            } else {
              reject(new Error(`Compilation failed for ${normalizedId}`));
            }
          }
        };

        const onError = (errorId: string, error: Error) => {
          if (errorId === normalizedId) {
            this.off('compiled', onCompiled);
            this.off('error', onError);
            reject(error);
          }
        };

        this.on('compiled', onCompiled);
        this.on('error', onError);
      });
    }

    // Return error result if compilation failed
    if (state.status === 'error') {
      throw state.error || new Error(`Compilation error for ${normalizedId}`);
    }

    throw new Error(`Unknown state for module ${normalizedId}`);
  }

  /**
   * Pre-compile modules in background
   */
  async precompileInBackground(modules: string[]): Promise<void> {
    if (!this.config.backgroundCompilation) return;

    for (const id of modules) {
      const normalizedId = this.normalizeId(id);
      if (this.backgroundCompilationQueue.length < this.config.maxBackgroundCompilation) {
        this.backgroundCompilationQueue.push(normalizedId);
      }
    }

    this.processBackgroundQueue();
  }

  /**
   * Get module state
   */
  getModuleState(id: string): ModuleState | undefined {
    return this.modules.get(this.normalizeId(id));
  }

  /**
   * Get all module states
   */
  getAllModuleStates(): Map<string, ModuleState> {
    return new Map(this.modules);
  }

  /**
   * Get compilation statistics
   */
  getStats(): LazyCompilationStats {
    const states = Array.from(this.modules.values());
    const compiled = states.filter((s) => s.status === 'compiled');
    const compiling = states.filter((s) => s.status === 'compiling');
    const pending = states.filter((s) => s.status === 'pending');

    const compilationTimes = compiled.map((s) => s.compilationTime || 0).filter((t) => t > 0);

    const avgTime =
      compilationTimes.length > 0 ? compilationTimes.reduce((a, b) => a + b, 0) / compilationTimes.length : 0;

    // Estimate time saved by not compiling pending modules
    const timeSaved = pending.length * avgTime;

    return {
      totalModules: states.length,
      compiledModules: compiled.length,
      pendingModules: pending.length,
      compilingModules: compiling.length,
      averageCompilationTime: avgTime,
      timeSaved,
      cacheHitRate:
        this.stats.cacheHits + this.stats.cacheMisses > 0
          ? this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)
          : 0,
    };
  }

  /**
   * Get suggested modules to pre-compile based on access patterns
   */
  getSuggestedPrecompilation(limit: number = 10): string[] {
    const states = Array.from(this.modules.values());

    // Sort by access count (descending)
    const sorted = states
      .filter((s) => s.status === 'pending' || s.status === 'error')
      .sort((a, b) => b.accessCount - a.accessCount);

    return sorted.slice(0, limit).map((s) => s.id);
  }

  /**
   * Clear lazy compilation state
   */
  clear(): void {
    this.modules.clear();
    this.compilationQueue = [];
    this.backgroundCompilationQueue = [];
    this.stats = { cacheHits: 0, cacheMisses: 0 };
  }

  /**
   * Invalidate module and its dependents
   */
  async invalidate(id: string): Promise<string[]> {
    const normalizedId = this.normalizeId(id);
    const invalidated: string[] = [];

    // Find modules that depend on this one
    for (const [moduleId, state] of this.modules) {
      if (state.dependencies.includes(normalizedId) || moduleId === normalizedId) {
        // Reset state
        state.status = 'pending';
        state.result = undefined;
        state.error = undefined;
        state.compilationTime = undefined;
        invalidated.push(moduleId);

        this.emit('invalidated', moduleId);
      }
    }

    return invalidated;
  }

  /**
   * Normalize module ID
   */
  private normalizeId(id: string): string {
    return path.normalize(id);
  }

  /**
   * Check if module is an entry point
   */
  private isEntry(id: string): boolean {
    const entries = this.config.entries;

    if (Array.isArray(entries)) {
      return entries.some((entry) => id === entry || id.includes(entry));
    }

    return entries(id);
  }

  /**
   * Check if module should be lazy compiled
   */
  private shouldBeLazy(id: string): boolean {
    const test = this.config.test;

    if (test instanceof RegExp) {
      return test.test(id);
    }

    return test(id);
  }

  /**
   * Compile module immediately
   */
  private async compileImmediately(id: string): Promise<any> {
    if (!this.compiler) {
      throw new Error('Compiler not set');
    }

    // Initialize state if not exists
    if (!this.modules.has(id)) {
      this.modules.set(id, {
        id,
        status: 'pending',
        accessCount: 0,
        lastAccessed: Date.now(),
        dependencies: [],
      });
    }

    const state = this.modules.get(id)!;
    state.status = 'compiling';

    const startTime = performance.now();

    try {
      const result = await Promise.race([
        this.compiler(id),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Compilation timeout for ${id}`)), this.config.compilationTimeout)
        ),
      ]);

      const endTime = performance.now();
      state.status = 'compiled';
      state.result = result;
      state.compilationTime = Math.max(0.001, endTime - startTime); // Ensure non-zero even for instant compilations

      this.recordAccess(id);
      this.emit('compiled', id, result);

      return result;
    } catch (error) {
      state.status = 'error';
      state.error = error as Error;

      // Only emit error event if there are listeners (to avoid unhandled error exceptions)
      if (this.listenerCount('error') > 0) {
        this.emit('error', id, error);
      }
      throw error;
    }
  }

  /**
   * Enqueue compilation task
   */
  private enqueueCompilation(task: CompilationTask): void {
    // Initialize state if not exists
    if (!this.modules.has(task.id)) {
      this.modules.set(task.id, {
        id: task.id,
        status: 'pending',
        accessCount: 0,
        lastAccessed: Date.now(),
        dependencies: [],
      });
    }

    // Add to queue (sorted by priority)
    this.compilationQueue.push(task);
    this.compilationQueue.sort((a, b) => b.priority - a.priority);

    this.processQueue();
  }

  /**
   * Process compilation queue
   */
  private async processQueue(): Promise<void> {
    if (this.isCompiling || this.compilationQueue.length === 0) return;

    this.isCompiling = true;

    while (this.compilationQueue.length > 0) {
      const task = this.compilationQueue.shift()!;

      try {
        const result = await this.compileImmediately(task.id);
        task.callback(result);
      } catch (error) {
        task.callback(null, error as Error);
      }
    }

    this.isCompiling = false;
  }

  /**
   * Process background compilation queue
   */
  private async processBackgroundQueue(): Promise<void> {
    while (
      this.backgroundCompilationQueue.length > 0 &&
      !this.isCompiling // Don't compete with active compilations
    ) {
      const id = this.backgroundCompilationQueue.shift()!;
      const state = this.modules.get(id);

      // Skip if already compiled or compiling
      if (state && (state.status === 'compiled' || state.status === 'compiling')) {
        continue;
      }

      try {
        await this.compileImmediately(id);
        this.emit('backgroundCompiled', id);
      } catch (error) {
        // Ignore background compilation errors
        this.emit('backgroundError', id, error);
      }

      // Small delay to avoid blocking
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Record module access
   */
  private recordAccess(id: string): void {
    const state = this.modules.get(id);
    if (state) {
      state.accessCount++;
      state.lastAccessed = Date.now();
    }
  }
}

/**
 * Create a lazy compilation manager
 */
export function createLazyCompiler(config: LazyCompilationConfig = {}): LazyCompilationManager {
  return new LazyCompilationManager(config);
}

/**
 * Lazy compilation plugin for build systems
 */
export class LazyCompilationPlugin {
  private manager: LazyCompilationManager;

  constructor(config: LazyCompilationConfig = {}) {
    this.manager = new LazyCompilationManager(config);
  }

  /**
   * Get the manager instance
   */
  getManager(): LazyCompilationManager {
    return this.manager;
  }

  /**
   * Apply plugin to build system
   */
  apply(hooks: {
    onLoad?: (callback: (id: string) => Promise<any>) => void;
    onRequest?: (callback: (id: string) => Promise<any>) => void;
  }): void {
    if (hooks.onLoad) {
      hooks.onLoad(async (id: string) => {
        return this.manager.requestCompilation(id);
      });
    }

    if (hooks.onRequest) {
      hooks.onRequest(async (id: string) => {
        return this.manager.requestCompilation(id, 10); // Higher priority
      });
    }
  }

  /**
   * Get statistics
   */
  getStats(): LazyCompilationStats {
    return this.manager.getStats();
  }
}

/**
 * Create lazy compilation plugin
 */
export function createLazyCompilationPlugin(config: LazyCompilationConfig = {}): LazyCompilationPlugin {
  return new LazyCompilationPlugin(config);
}
