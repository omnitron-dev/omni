/**
 * Plugin System Type Definitions
 *
 * Type system for Titan database plugin management
 */

import type { Kysely, Transaction } from 'kysely';
import type { Plugin as KyseraPlugin } from '@kysera/repository';
import type { Repository } from '../repository/repository.types.js';

/**
 * Cache interface
 */
export interface ICache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern?: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/**
 * Plugin lifecycle hooks
 */
export interface IPluginLifecycle {
  /**
   * Called when plugin is registered
   */
  onRegister?(): void | Promise<void>;

  /**
   * Called before database connection is established
   */
  beforeConnect?(config: any): void | Promise<void>;

  /**
   * Called after database connection is established
   */
  afterConnect?(db: Kysely<any>): void | Promise<void>;

  /**
   * Called before transaction starts
   */
  beforeTransaction?(options: any): void | Promise<void>;

  /**
   * Called after transaction completes
   */
  afterTransaction?(result: 'commit' | 'rollback'): void | Promise<void>;

  /**
   * Called before plugin is destroyed
   */
  onDestroy?(): void | Promise<void>;
}

/**
 * Titan plugin interface
 * Extends Kysera plugin with additional features
 */
export interface ITitanPlugin extends KyseraPlugin, IPluginLifecycle {
  /**
   * Plugin name
   */
  name: string;

  /**
   * Plugin version
   */
  version: string;

  /**
   * Plugin dependencies
   */
  dependencies?: string[];

  /**
   * Plugin configuration schema
   */
  configSchema?: any;

  /**
   * Plugin initialization
   */
  init?(config?: any): void | Promise<void>;

  /**
   * Extend database connection
   */
  extendDatabase?(db: Kysely<any>): Kysely<any>;

  /**
   * Extend transaction
   */
  extendTransaction?(trx: Transaction<any>): Transaction<any>;

  /**
   * Plugin metadata
   */
  metadata?: PluginMetadata;
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  /**
   * Plugin author
   */
  author?: string;

  /**
   * Plugin description
   */
  description?: string;

  /**
   * Plugin license
   */
  license?: string;

  /**
   * Plugin homepage
   */
  homepage?: string;

  /**
   * Plugin tags
   */
  tags?: string[];

  /**
   * Plugin category
   */
  category?: 'audit' | 'validation' | 'caching' | 'logging' | 'security' | 'utility' | 'other';

  /**
   * Plugin compatibility
   */
  compatibility?: {
    /**
     * Minimum Titan version
     */
    titan?: string;

    /**
     * Minimum Kysera version
     */
    kysera?: string;

    /**
     * Database dialects
     */
    dialects?: Array<'postgres' | 'mysql' | 'sqlite'>;
  };
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /**
   * Plugin name or instance
   */
  plugin: string | ITitanPlugin | KyseraPlugin;

  /**
   * Plugin options
   */
  options?: Record<string, any>;

  /**
   * Enable/disable plugin
   */
  enabled?: boolean;

  /**
   * Plugin priority (lower runs first)
   */
  priority?: number;

  /**
   * Connections to apply to (defaults to all)
   */
  connections?: string[];

  /**
   * Tables to apply to (for repository plugins)
   */
  tables?: string[];
}

/**
 * Plugin manager options
 */
export interface PluginManagerOptions {
  /**
   * Enable plugin validation
   */
  validatePlugins?: boolean;

  /**
   * Enable plugin auto-discovery
   */
  autoDiscover?: boolean;

  /**
   * Plugin directories for auto-discovery
   */
  pluginDirectories?: string[];

  /**
   * Plugin name pattern for auto-discovery
   */
  pluginPattern?: string;

  /**
   * Enable plugin metrics
   */
  enableMetrics?: boolean;

  /**
   * Plugin load timeout
   */
  loadTimeout?: number;

  /**
   * Plugin initialization timeout
   */
  initTimeout?: number;
}

/**
 * Plugin registry entry
 */
export interface PluginRegistryEntry {
  /**
   * Plugin instance
   */
  plugin: ITitanPlugin;

  /**
   * Plugin configuration
   */
  config?: Partial<PluginConfig>;

  /**
   * Plugin state
   */
  state: PluginState;

  /**
   * Registration timestamp
   */
  registeredAt: Date;

  /**
   * Initialization timestamp
   */
  initializedAt?: Date;

  /**
   * Plugin metrics
   */
  metrics?: PluginMetrics;
}

/**
 * Plugin state
 */
export enum PluginState {
  REGISTERED = 'registered',
  INITIALIZING = 'initializing',
  INITIALIZED = 'initialized',
  ACTIVE = 'active',
  ERROR = 'error',
  DISABLED = 'disabled',
  DESTROYED = 'destroyed',
}

/**
 * Plugin metrics
 */
export interface PluginMetrics {
  /**
   * Number of times plugin was invoked
   */
  invocations: number;

  /**
   * Total execution time in ms
   */
  totalTime: number;

  /**
   * Average execution time in ms
   */
  averageTime: number;

  /**
   * Last execution time in ms
   */
  lastExecutionTime?: number;

  /**
   * Error count
   */
  errors: number;

  /**
   * Last error
   */
  lastError?: Error;
}

/**
 * Plugin events
 */
export enum PluginEventType {
  PLUGIN_REGISTERED = 'plugin.registered',
  PLUGIN_INITIALIZING = 'plugin.initializing',
  PLUGIN_INITIALIZED = 'plugin.initialized',
  PLUGIN_ACTIVATED = 'plugin.activated',
  PLUGIN_DEACTIVATED = 'plugin.deactivated',
  PLUGIN_ERROR = 'plugin.error',
  PLUGIN_DESTROYED = 'plugin.destroyed',
}

/**
 * Plugin event payload
 */
export interface PluginEvent {
  type: PluginEventType;
  pluginName: string;
  timestamp: Date;
  data?: any;
  error?: Error;
}

/**
 * Built-in plugin names
 */
export enum BuiltInPlugin {
  SOFT_DELETE = 'soft-delete',
  TIMESTAMPS = 'timestamps',
  AUDIT = 'audit',
  VALIDATION = 'validation',
  CACHING = 'caching',
  OPTIMISTIC_LOCKING = 'optimistic-locking',
  ENCRYPTION = 'encryption',
  COMPRESSION = 'compression',
}

/**
 * Plugin factory function
 */
export type PluginFactory<T = any> = (options?: T) => ITitanPlugin | KyseraPlugin;

/**
 * Plugin loader interface
 */
export interface IPluginLoader {
  /**
   * Load plugin from file
   */
  loadPlugin(path: string): Promise<ITitanPlugin>;

  /**
   * Load plugins from directory
   */
  loadPluginsFromDirectory(directory: string): Promise<ITitanPlugin[]>;

  /**
   * Validate plugin
   */
  validatePlugin(plugin: any): boolean;
}

/**
 * Plugin manager interface
 */
export interface IPluginManager {
  /**
   * Register a plugin
   */
  registerPlugin(name: string, plugin: ITitanPlugin | KyseraPlugin, config?: Partial<PluginConfig>): void;

  /**
   * Get a registered plugin
   */
  getPlugin(name: string): ITitanPlugin | undefined;

  /**
   * Get all registered plugins
   */
  getAllPlugins(): Map<string, PluginRegistryEntry>;

  /**
   * Initialize a plugin
   */
  initializePlugin(name: string, options?: any): Promise<void>;

  /**
   * Initialize all plugins
   */
  initializeAll(): Promise<void>;

  /**
   * Apply plugins to repository
   */
  applyPlugins(repository: any, pluginNames: string[]): any;

  /**
   * Destroy a plugin
   */
  destroyPlugin(name: string): Promise<void>;

  /**
   * Destroy all plugins
   */
  destroyAll(): Promise<void>;

  /**
   * Get plugin metrics
   */
  getMetrics(name?: string): PluginMetrics | Map<string, PluginMetrics>;

  /**
   * Reset plugin metrics
   */
  resetMetrics(name?: string): void;
}