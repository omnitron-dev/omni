/**
 * Registry Manager
 *
 * Core registry management for Prism components and blocks.
 * Handles loading, merging, querying, and caching of registry data.
 *
 * Key Features:
 * - Multiple registry sources (local, remote, merged)
 * - Automatic dependency resolution
 * - Version management and compatibility checking
 * - Caching with configurable TTL
 *
 * @module @omnitron/prism/registry/manager
 */

import type { RegistrySchema, ComponentDefinition, RegistryConfig, RemoteRegistryConfig } from '../types/registry.js';
import type { BlockDefinition } from '../types/blocks.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RegistryManagerOptions {
  /** Base directory for local registries */
  baseDir?: string;
  /** Default registry name */
  defaultRegistry?: string;
  /** Registry configuration */
  config?: RegistryConfig;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtl?: number;
}

export interface SearchOptions {
  /** Filter by category */
  category?: string;
  /** Search query */
  query?: string;
  /** Include dependencies in results */
  includeDependencies?: boolean;
  /** Limit results */
  limit?: number;
}

export interface ResolvedItem {
  /** Item definition */
  definition: ComponentDefinition | BlockDefinition;
  /** Registry source */
  registry: string;
  /** Resolved dependencies */
  dependencies: ResolvedItem[];
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// =============================================================================
// REGISTRY MANAGER
// =============================================================================

/**
 * Registry manager for Prism design system.
 *
 * Manages component and block registries with support for:
 * - Local and remote registry sources
 * - Registry merging and extension
 * - Dependency resolution
 * - Caching with TTL
 *
 * @example
 * ```typescript
 * const manager = new RegistryManager({
 *   baseDir: './prism',
 *   config: {
 *     default: 'prism',
 *     registries: {
 *       prism: 'https://registry.prism.dev',
 *       custom: './custom-registry.json',
 *     },
 *   },
 * });
 *
 * // Get a component
 * const button = await manager.getComponent('button');
 *
 * // Search for components
 * const inputs = await manager.searchComponents({ category: 'inputs' });
 *
 * // Resolve dependencies
 * const resolved = await manager.resolveDependencies('data-table');
 * ```
 */
export class RegistryManager {
  private readonly options: Required<RegistryManagerOptions>;
  private registries: Map<string, RegistrySchema> = new Map();
  private cache: Map<string, CacheEntry<RegistrySchema>> = new Map();
  private loaders: Map<string, () => Promise<RegistrySchema>> = new Map();

  constructor(options: RegistryManagerOptions = {}) {
    this.options = {
      baseDir: options.baseDir ?? (typeof process !== 'undefined' && process.cwd ? process.cwd() : '/'),
      defaultRegistry: options.defaultRegistry ?? 'prism',
      config: options.config ?? { default: 'prism', registries: {} },
      cacheTtl: options.cacheTtl ?? 5 * 60 * 1000, // 5 minutes
    };
  }

  // ===========================================================================
  // REGISTRY LOADING
  // ===========================================================================

  /**
   * Register a custom loader for a registry.
   */
  registerLoader(name: string, loader: () => Promise<RegistrySchema>): void {
    this.loaders.set(name, loader);
  }

  /**
   * Load a registry by name.
   */
  async loadRegistry(name: string): Promise<RegistrySchema> {
    // Check cache first
    const cached = this.cache.get(name);
    if (cached && Date.now() - cached.timestamp < this.options.cacheTtl) {
      return cached.data;
    }

    // Check if already loaded
    const existing = this.registries.get(name);
    if (existing && !cached) {
      return existing;
    }

    // Use custom loader if registered
    const customLoader = this.loaders.get(name);
    if (customLoader) {
      const registry = await customLoader();
      this.cacheRegistry(name, registry);
      return registry;
    }

    // Get registry config
    const config = this.options.config.registries[name];
    if (!config) {
      throw new Error(`Registry "${name}" not found in configuration`);
    }

    // Load based on config type
    const registry = typeof config === 'string' ? await this.loadFromPath(config) : await this.loadFromRemote(config);

    // Handle registry extension
    if (registry.extends) {
      const baseRegistry = await this.loadRegistry(registry.extends);
      const merged = this.mergeRegistries(baseRegistry, registry);
      this.cacheRegistry(name, merged);
      return merged;
    }

    this.cacheRegistry(name, registry);
    return registry;
  }

  /**
   * Load registry from local file path.
   * Uses dynamic import for ESM compatibility across environments.
   *
   * @param path - Relative or absolute path to registry JSON
   * @returns Loaded registry schema
   */
  private async loadFromPath(path: string): Promise<RegistrySchema> {
    const fullPath = path.startsWith('/') ? path : `${this.options.baseDir}/${path}`;

    // Check if running in Node.js-like environment with fs access
    if (typeof process !== 'undefined' && (process.versions?.node || process.versions?.bun)) {
      // Dynamic import for Node.js fs module
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(fullPath, 'utf-8');
      return JSON.parse(content) as RegistrySchema;
    }

    // In browser/Deno environment, try to fetch if it's a URL
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load registry from ${path}: ${response.statusText}`);
      }
      return response.json();
    }

    // For browser environment with bundled registries, use custom loader
    throw new Error(
      `Cannot load local file "${fullPath}" in browser environment. ` +
        `Register a custom loader with manager.registerLoader() or use a remote URL.`
    );
  }

  /**
   * Load registry from remote URL.
   */
  private async loadFromRemote(config: RemoteRegistryConfig): Promise<RegistrySchema> {
    const response = await fetch(config.url, {
      headers: config.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to load registry from ${config.url}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Cache a loaded registry.
   */
  private cacheRegistry(name: string, registry: RegistrySchema): void {
    this.registries.set(name, registry);
    this.cache.set(name, {
      data: registry,
      timestamp: Date.now(),
    });
  }

  /**
   * Merge two registries (base + extension).
   */
  private mergeRegistries(base: RegistrySchema, extension: RegistrySchema): RegistrySchema {
    return {
      ...base,
      ...extension,
      components: { ...base.components, ...extension.components },
      blocks: { ...base.blocks, ...extension.blocks },
      themes: { ...base.themes, ...extension.themes },
    };
  }

  /**
   * Clear registry cache.
   */
  clearCache(name?: string): void {
    if (name) {
      this.cache.delete(name);
    } else {
      this.cache.clear();
    }
  }

  // ===========================================================================
  // COMPONENT OPERATIONS
  // ===========================================================================

  /**
   * Get a component definition by name.
   */
  async getComponent(name: string, registryName?: string): Promise<ComponentDefinition | null> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    return registry.components[name] ?? null;
  }

  /**
   * Get all components from a registry.
   */
  async getComponents(registryName?: string): Promise<Record<string, ComponentDefinition>> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    return registry.components;
  }

  /**
   * Search for components.
   */
  async searchComponents(options: SearchOptions, registryName?: string): Promise<ComponentDefinition[]> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    let results = Object.values(registry.components);

    // Filter by category
    if (options.category) {
      results = results.filter((c) => c.category === options.category);
    }

    // Filter by query
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.displayName?.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query)
      );
    }

    // Limit results
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get component categories.
   */
  async getComponentCategories(registryName?: string): Promise<string[]> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    const categories = new Set<string>();

    for (const component of Object.values(registry.components)) {
      categories.add(component.category);
    }

    return Array.from(categories).sort();
  }

  // ===========================================================================
  // BLOCK OPERATIONS
  // ===========================================================================

  /**
   * Get a block definition by name.
   */
  async getBlock(name: string, registryName?: string): Promise<BlockDefinition | null> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    return registry.blocks[name] ?? null;
  }

  /**
   * Get all blocks from a registry.
   */
  async getBlocks(registryName?: string): Promise<Record<string, BlockDefinition>> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    return registry.blocks;
  }

  /**
   * Search for blocks.
   */
  async searchBlocks(options: SearchOptions, registryName?: string): Promise<BlockDefinition[]> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    let results = Object.values(registry.blocks);

    // Filter by category
    if (options.category) {
      results = results.filter((b) => b.category === options.category);
    }

    // Filter by query
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(
        (b) =>
          b.name.toLowerCase().includes(query) ||
          b.displayName?.toLowerCase().includes(query) ||
          b.description?.toLowerCase().includes(query)
      );
    }

    // Limit results
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get block categories.
   */
  async getBlockCategories(registryName?: string): Promise<string[]> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);
    const categories = new Set<string>();

    for (const block of Object.values(registry.blocks)) {
      categories.add(block.category);
    }

    return Array.from(categories).sort();
  }

  // ===========================================================================
  // DEPENDENCY RESOLUTION
  // ===========================================================================

  /**
   * Resolve all dependencies for a component.
   */
  async resolveComponentDependencies(name: string, registryName?: string): Promise<ResolvedItem> {
    const registry = registryName ?? this.options.defaultRegistry;
    const component = await this.getComponent(name, registry);

    if (!component) {
      throw new Error(`Component "${name}" not found in registry "${registry}"`);
    }

    const dependencies: ResolvedItem[] = [];

    // Resolve component dependencies
    for (const depName of component.dependencies.components) {
      const resolved = await this.resolveComponentDependencies(depName, registry);
      dependencies.push(resolved);
    }

    return {
      definition: component,
      registry,
      dependencies,
    };
  }

  /**
   * Resolve all dependencies for a block.
   */
  async resolveBlockDependencies(name: string, registryName?: string): Promise<ResolvedItem> {
    const registry = registryName ?? this.options.defaultRegistry;
    const block = await this.getBlock(name, registry);

    if (!block) {
      throw new Error(`Block "${name}" not found in registry "${registry}"`);
    }

    const dependencies: ResolvedItem[] = [];

    // Resolve component dependencies
    for (const compName of block.dependencies.components) {
      const resolved = await this.resolveComponentDependencies(compName, registry);
      dependencies.push(resolved);
    }

    // Resolve block dependencies
    for (const blockName of block.dependencies.blocks) {
      const resolved = await this.resolveBlockDependencies(blockName, registry);
      dependencies.push(resolved);
    }

    return {
      definition: block,
      registry,
      dependencies,
    };
  }

  /**
   * Get flat list of all npm dependencies for resolved items.
   */
  getNpmDependencies(resolved: ResolvedItem): string[] {
    const deps = new Set<string>();

    function collectDeps(item: ResolvedItem): void {
      // Add direct npm dependencies
      const definition = item.definition as ComponentDefinition | BlockDefinition;
      if ('dependencies' in definition) {
        for (const dep of definition.dependencies.npm) {
          deps.add(dep);
        }
      }

      // Recurse into dependencies
      for (const child of item.dependencies) {
        collectDeps(child);
      }
    }

    collectDeps(resolved);
    return Array.from(deps).sort();
  }

  /**
   * Get flat list of all file paths for resolved items.
   */
  getFilePaths(resolved: ResolvedItem): string[] {
    const paths = new Set<string>();

    function collectPaths(item: ResolvedItem): void {
      // Add direct file paths
      const definition = item.definition as ComponentDefinition | BlockDefinition;
      for (const file of definition.files) {
        paths.add(file.path);
      }

      // Recurse into dependencies
      for (const child of item.dependencies) {
        collectPaths(child);
      }
    }

    collectPaths(resolved);
    return Array.from(paths).sort();
  }

  // ===========================================================================
  // VERSION CHECKING
  // ===========================================================================

  /**
   * Check if a component version is compatible.
   */
  async checkComponentVersion(name: string, requiredVersion: string, registryName?: string): Promise<boolean> {
    const component = await this.getComponent(name, registryName);
    if (!component) return false;

    return this.isVersionCompatible(component.version, requiredVersion);
  }

  /**
   * Check semver version compatibility.
   * Simple implementation - considers major.minor compatibility.
   */
  private isVersionCompatible(actual: string, required: string): boolean {
    const [actualMajor, actualMinor] = actual.split('.').map(Number);
    const [requiredMajor, requiredMinor] = required.split('.').map(Number);

    // Major version must match
    if (actualMajor !== requiredMajor) return false;

    // Minor version must be >= required
    return actualMinor >= requiredMinor;
  }

  // ===========================================================================
  // REGISTRY INFO
  // ===========================================================================

  /**
   * Get registry metadata.
   */
  async getRegistryInfo(registryName?: string): Promise<{
    name: string;
    version: string;
    description?: string;
    componentCount: number;
    blockCount: number;
    themeCount: number;
  }> {
    const registry = await this.loadRegistry(registryName ?? this.options.defaultRegistry);

    return {
      name: registry.name,
      version: registry.version,
      description: registry.description,
      componentCount: Object.keys(registry.components).length,
      blockCount: Object.keys(registry.blocks).length,
      themeCount: Object.keys(registry.themes).length,
    };
  }

  /**
   * Get list of loaded registries.
   */
  getLoadedRegistries(): string[] {
    return Array.from(this.registries.keys());
  }
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

/**
 * Default registry manager instance.
 */
export const registry = new RegistryManager();

/**
 * Create a new registry manager with custom options.
 */
export function createRegistryManager(options?: RegistryManagerOptions): RegistryManager {
  return new RegistryManager(options);
}
