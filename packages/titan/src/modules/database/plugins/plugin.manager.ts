/**
 * Plugin Manager Service
 *
 * Manages database plugin registration, initialization, and lifecycle
 */

import { EventEmitter } from 'events';
import { Injectable, Inject } from '../../../decorators/index.js';
import type { Kysely, Transaction } from 'kysely';
import type { Plugin as KyseraPlugin } from '@kysera/repository';
import { Errors } from '../../../errors/index.js';

// Built-in Kysera plugins
import { softDeletePlugin } from '@kysera/soft-delete';
import { auditPlugin } from '@kysera/audit';
import { timestampsPlugin } from '@kysera/timestamps';

import { DATABASE_MANAGER, DATABASE_MODULE_OPTIONS } from '../database.constants.js';
import type { DatabaseManager } from '../database.manager.js';
import type { DatabaseModuleOptions } from '../database.types.js';

import { BuiltInPlugin, PluginState, PluginEventType } from './plugin.types.js';
import type {
  ITitanPlugin,
  IPluginManager,
  PluginConfig,
  PluginManagerOptions,
  PluginRegistryEntry,
  PluginMetrics,
  PluginEvent,
  IPluginLoader,
} from './plugin.types.js';

/**
 * Plugin Manager
 *
 * Centralized management for database plugins
 */
@Injectable()
export class PluginManager extends EventEmitter implements IPluginManager {
  private readonly registry: Map<string, PluginRegistryEntry> = new Map();
  private readonly options: PluginManagerOptions;
  private readonly loader?: IPluginLoader;
  private initialized = false;

  constructor(
    @Inject(DATABASE_MODULE_OPTIONS) private moduleOptions: DatabaseModuleOptions,
    @Inject(DATABASE_MANAGER) private dbManager: DatabaseManager
  ) {
    super();

    this.options = {
      validatePlugins: true,
      autoDiscover: false,
      enableMetrics: true,
      loadTimeout: 5000,
      initTimeout: 10000,
      ...this.moduleOptions.plugins?.manager,
    };

    this.registerBuiltInPlugins();
  }

  /**
   * Register built-in plugins
   */
  private registerBuiltInPlugins(): void {
    // Register soft delete plugin
    this.registerPlugin(BuiltInPlugin.SOFT_DELETE, this.createSoftDeletePlugin(), { enabled: false });

    // Register timestamps plugin
    this.registerPlugin(BuiltInPlugin.TIMESTAMPS, this.createTimestampsPlugin(), { enabled: false });

    // Register audit plugin
    this.registerPlugin(BuiltInPlugin.AUDIT, this.createAuditPlugin(), { enabled: false });
  }

  /**
   * Create soft delete plugin
   */
  private createSoftDeletePlugin(): ITitanPlugin {
    const kyseraPlugin = softDeletePlugin({
      deletedAtColumn: 'deleted_at',
      includeDeleted: false,
    });

    return {
      ...kyseraPlugin,
      name: BuiltInPlugin.SOFT_DELETE,
      version: '1.0.0',
      metadata: {
        description: 'Soft delete support for database records',
        category: 'utility',
        compatibility: {
          dialects: ['postgres', 'mysql', 'sqlite'],
        },
      },
    } as ITitanPlugin;
  }

  /**
   * Create timestamps plugin
   */
  private createTimestampsPlugin(): ITitanPlugin {
    const kyseraPlugin = timestampsPlugin({
      createdAtColumn: 'created_at',
      updatedAtColumn: 'updated_at',
    });

    return {
      ...kyseraPlugin,
      name: BuiltInPlugin.TIMESTAMPS,
      version: '1.0.0',
      metadata: {
        description: 'Automatic timestamp management',
        category: 'utility',
        compatibility: {
          dialects: ['postgres', 'mysql', 'sqlite'],
        },
      },
    } as ITitanPlugin;
  }

  /**
   * Create audit plugin
   */
  private createAuditPlugin(): ITitanPlugin {
    const kyseraPlugin = auditPlugin({
      auditTable: 'audit_logs',
      captureOldValues: true,
      captureNewValues: true,
    });

    return {
      ...kyseraPlugin,
      name: BuiltInPlugin.AUDIT,
      version: '1.0.0',
      metadata: {
        description: 'Comprehensive audit logging',
        category: 'audit',
        compatibility: {
          dialects: ['postgres', 'mysql', 'sqlite'],
        },
      },
    } as ITitanPlugin;
  }

  /**
   * Register a plugin
   */
  registerPlugin(name: string, plugin: ITitanPlugin | KyseraPlugin, config?: Partial<PluginConfig>): void {
    // Check if already registered
    if (this.registry.has(name)) {
      throw Errors.conflict(`Plugin "${name}" is already registered`);
    }

    // Convert Kysera plugin to Titan plugin if needed
    const titanPlugin = this.toTitanPlugin(plugin, name);

    // Validate plugin if enabled
    if (this.options.validatePlugins) {
      this.validatePlugin(titanPlugin);
    }

    // Create registry entry
    const entry: PluginRegistryEntry = {
      plugin: titanPlugin,
      config: config || {},
      state: PluginState.REGISTERED,
      registeredAt: new Date(),
      metrics: this.options.enableMetrics
        ? {
            invocations: 0,
            totalTime: 0,
            averageTime: 0,
            errors: 0,
          }
        : undefined,
    };

    this.registry.set(name, entry);

    // Call plugin lifecycle hook
    if (titanPlugin.onRegister) {
      try {
        const result = titanPlugin.onRegister();
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(`Plugin "${name}" onRegister hook failed:`, error);
          });
        }
      } catch (error) {
        console.error(`Plugin "${name}" onRegister hook failed:`, error);
      }
    }

    // Emit event
    this.emitPluginEvent({
      type: 'plugin.registered' as PluginEventType,
      pluginName: name,
      timestamp: new Date(),
    });
  }

  /**
   * Convert Kysera plugin to Titan plugin
   */
  private toTitanPlugin(plugin: ITitanPlugin | KyseraPlugin, name: string): ITitanPlugin {
    // If already a Titan plugin, return as is
    if ('name' in plugin && plugin.name) {
      return plugin as ITitanPlugin;
    }

    // Convert Kysera plugin
    return {
      ...(plugin as KyseraPlugin),
      name,
      version: '1.0.0',
    } as ITitanPlugin;
  }

  /**
   * Validate plugin
   */
  private validatePlugin(plugin: ITitanPlugin): void {
    if (!plugin.name) {
      throw Errors.badRequest('Plugin must have a name');
    }

    // Check for required methods (at least one extension method)
    const hasExtension = plugin.extendRepository || plugin.extendDatabase || plugin.extendTransaction;

    if (!hasExtension) {
      throw Errors.badRequest(`Plugin "${plugin.name}" must implement at least one extension method`);
    }

    // Validate dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registry.has(dep)) {
          throw Errors.badRequest(`Plugin "${plugin.name}" depends on unregistered plugin "${dep}"`);
        }
      }
    }
  }

  /**
   * Get a registered plugin
   */
  getPlugin(name: string): ITitanPlugin | undefined {
    const entry = this.registry.get(name);
    return entry?.plugin;
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): Map<string, PluginRegistryEntry> {
    return new Map(this.registry);
  }

  /**
   * Initialize a plugin
   */
  async initializePlugin(name: string, options?: any): Promise<void> {
    const entry = this.registry.get(name);
    if (!entry) {
      throw Errors.notFound('Plugin', name);
    }

    if (entry.state === PluginState.INITIALIZED || entry.state === PluginState.ACTIVE) {
      return; // Already initialized
    }

    // Update state
    entry.state = PluginState.INITIALIZING;

    // Emit event
    this.emitPluginEvent({
      type: 'plugin.initializing' as PluginEventType,
      pluginName: name,
      timestamp: new Date(),
    });

    try {
      // Initialize dependencies first
      if (entry.plugin.dependencies) {
        for (const dep of entry.plugin.dependencies) {
          await this.initializePlugin(dep);
        }
      }

      // Initialize plugin
      if (entry.plugin.init) {
        await this.withTimeout(
          Promise.resolve(entry.plugin.init(options || entry.config?.options)),
          this.options.initTimeout!,
          `Plugin "${name}" initialization timed out`
        );
      }

      // Update state
      entry.state = PluginState.INITIALIZED;
      entry.initializedAt = new Date();

      // Call lifecycle hook
      if (entry.plugin.afterConnect) {
        const db = await this.dbManager.getConnection();
        await entry.plugin.afterConnect(db);
      }

      // Emit event
      this.emitPluginEvent({
        type: 'plugin.initialized' as PluginEventType,
        pluginName: name,
        timestamp: new Date(),
      });
    } catch (error) {
      entry.state = PluginState.ERROR;
      if (entry.metrics) {
        entry.metrics.errors++;
        entry.metrics.lastError = error as Error;
      }

      this.emitPluginEvent({
        type: 'plugin.error' as PluginEventType,
        pluginName: name,
        timestamp: new Date(),
        error: error as Error,
      });

      throw Errors.internal(`Failed to initialize plugin "${name}"`, error as Error);
    }
  }

  /**
   * Initialize all plugins
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Get plugins sorted by priority and dependencies
    const sortedPlugins = this.getSortedPlugins();

    for (const [name, entry] of sortedPlugins) {
      if (entry.config?.enabled !== false) {
        await this.initializePlugin(name);
      }
    }

    this.initialized = true;
  }

  /**
   * Get plugins sorted by priority and dependencies
   */
  private getSortedPlugins(): Array<[string, PluginRegistryEntry]> {
    const entries = Array.from(this.registry.entries());

    // Topological sort based on dependencies
    const visited = new Set<string>();
    const sorted: Array<[string, PluginRegistryEntry]> = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);

      const entry = this.registry.get(name);
      if (entry?.plugin.dependencies) {
        for (const dep of entry.plugin.dependencies) {
          visit(dep);
        }
      }

      const entryPair = entries.find(([n]) => n === name);
      if (entryPair) {
        sorted.push(entryPair);
      }
    };

    for (const [name] of entries) {
      visit(name);
    }

    // Sort by priority within dependency order
    return sorted.sort((a, b) => {
      const priorityA = a[1].config?.priority ?? 999;
      const priorityB = b[1].config?.priority ?? 999;
      return priorityA - priorityB;
    });
  }

  /**
   * Apply plugins to repository
   */
  applyPlugins(repository: any, pluginNames: string[]): any {
    let enhancedRepo = repository;

    for (const name of pluginNames) {
      const entry = this.registry.get(name);
      if (!entry) {
        console.warn(`Plugin "${name}" not found`);
        continue;
      }

      if (entry.config?.enabled === false) {
        continue;
      }

      const startTime = Date.now();

      try {
        // Apply plugin based on extension method
        if (entry.plugin.extendRepository) {
          enhancedRepo = entry.plugin.extendRepository(enhancedRepo);
        }

        // Update metrics
        if (entry.metrics) {
          const executionTime = Date.now() - startTime;
          entry.metrics.invocations++;
          entry.metrics.totalTime += executionTime;
          entry.metrics.averageTime = entry.metrics.totalTime / entry.metrics.invocations;
          entry.metrics.lastExecutionTime = executionTime;
        }
      } catch (error) {
        if (entry.metrics) {
          entry.metrics.errors++;
          entry.metrics.lastError = error as Error;
        }

        console.error(`Failed to apply plugin "${name}":`, error);
        // Continue with other plugins
      }
    }

    return enhancedRepo;
  }

  /**
   * Apply plugins to database connection
   */
  applyDatabasePlugins(db: Kysely<any>, connectionName?: string): Kysely<any> {
    let enhancedDb = db;

    for (const [name, entry] of this.getSortedPlugins()) {
      if (entry.config?.enabled === false) {
        continue;
      }

      // Check if plugin applies to this connection
      if (entry.config?.connections && connectionName && !entry.config.connections.includes(connectionName)) {
        continue;
      }

      if (entry.plugin.extendDatabase) {
        try {
          enhancedDb = entry.plugin.extendDatabase(enhancedDb);
        } catch (error) {
          console.error(`Failed to apply database plugin "${name}":`, error);
        }
      }
    }

    return enhancedDb;
  }

  /**
   * Apply plugins to transaction
   */
  applyTransactionPlugins(trx: Transaction<any>, connectionName?: string): Transaction<any> {
    let enhancedTrx = trx;

    for (const [name, entry] of this.getSortedPlugins()) {
      if (entry.config?.enabled === false) {
        continue;
      }

      // Check if plugin applies to this connection
      if (entry.config?.connections && connectionName && !entry.config.connections.includes(connectionName)) {
        continue;
      }

      if (entry.plugin.extendTransaction) {
        try {
          enhancedTrx = entry.plugin.extendTransaction(enhancedTrx);
        } catch (error) {
          console.error(`Failed to apply transaction plugin "${name}":`, error);
        }
      }
    }

    return enhancedTrx;
  }

  /**
   * Enable a plugin
   */
  enablePlugin(name: string): void {
    const entry = this.registry.get(name);
    if (!entry) {
      throw Errors.notFound('Plugin', name);
    }

    if (!entry.config) {
      entry.config = {};
    }
    entry.config.enabled = true;
    entry.state = PluginState.ACTIVE;

    this.emitPluginEvent({
      type: 'plugin.activated' as PluginEventType,
      pluginName: name,
      timestamp: new Date(),
    });
  }

  /**
   * Disable a plugin
   */
  disablePlugin(name: string): void {
    const entry = this.registry.get(name);
    if (!entry) {
      throw Errors.notFound('Plugin', name);
    }

    if (!entry.config) {
      entry.config = {};
    }
    entry.config.enabled = false;
    entry.state = PluginState.DISABLED;

    this.emitPluginEvent({
      type: 'plugin.deactivated' as PluginEventType,
      pluginName: name,
      timestamp: new Date(),
    });
  }

  /**
   * Destroy a plugin
   */
  async destroyPlugin(name: string): Promise<void> {
    const entry = this.registry.get(name);
    if (!entry) {
      return;
    }

    try {
      // Call lifecycle hook
      if (entry.plugin.onDestroy) {
        await entry.plugin.onDestroy();
      }

      // Update state
      entry.state = PluginState.DESTROYED;

      // Remove from registry
      this.registry.delete(name);

      // Emit event
      this.emitPluginEvent({
        type: 'plugin.destroyed' as PluginEventType,
        pluginName: name,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error(`Failed to destroy plugin "${name}":`, error);
    }
  }

  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    const plugins = Array.from(this.registry.keys()).reverse();

    for (const name of plugins) {
      await this.destroyPlugin(name);
    }

    this.initialized = false;
  }

  /**
   * Get plugin metrics
   */
  getMetrics(name?: string): PluginMetrics | Map<string, PluginMetrics> {
    if (name) {
      const entry = this.registry.get(name);
      if (!entry || !entry.metrics) {
        throw Errors.notFound(`Metrics for plugin`, name);
      }
      return entry.metrics;
    }

    // Return all metrics
    const metrics = new Map<string, PluginMetrics>();
    for (const [pluginName, entry] of this.registry) {
      if (entry.metrics) {
        metrics.set(pluginName, entry.metrics);
      }
    }
    return metrics;
  }

  /**
   * Reset plugin metrics
   */
  resetMetrics(name?: string): void {
    if (name) {
      const entry = this.registry.get(name);
      if (entry && entry.metrics) {
        entry.metrics = {
          invocations: 0,
          totalTime: 0,
          averageTime: 0,
          errors: 0,
        };
      }
    } else {
      // Reset all metrics
      for (const entry of this.registry.values()) {
        if (entry.metrics) {
          entry.metrics = {
            invocations: 0,
            totalTime: 0,
            averageTime: 0,
            errors: 0,
          };
        }
      }
    }
  }

  /**
   * Load custom plugin from configuration
   */
  async loadCustomPlugin(config: PluginConfig): Promise<void> {
    if (typeof config.plugin === 'string') {
      // Load from file or package
      if (!this.loader) {
        throw Errors.internal('Plugin loader not configured');
      }

      const plugin = await this.loader.loadPlugin(config.plugin);
      this.registerPlugin(plugin.name, plugin, config);
    } else {
      // Direct plugin instance
      const plugin = config.plugin as ITitanPlugin;
      this.registerPlugin(plugin.name || 'custom', plugin, config);
    }
  }

  /**
   * Helper to run operation with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(Errors.timeout('plugin operation: ' + message, timeout)), timeout)
      ),
    ]);
  }

  /**
   * Emit plugin event
   */
  private emitPluginEvent(event: PluginEvent): void {
    this.emit(event.type, event);
    this.emit('plugin.event', event);
  }

  /**
   * Get plugin status
   */
  getPluginStatus(): Map<string, { state: PluginState; enabled: boolean }> {
    const status = new Map<string, { state: PluginState; enabled: boolean }>();

    for (const [name, entry] of this.registry) {
      status.set(name, {
        state: entry.state,
        enabled: entry.config?.enabled !== false,
      });
    }

    return status;
  }

  /**
   * Check if plugin is active
   */
  isPluginActive(name: string): boolean {
    const entry = this.registry.get(name);
    return entry !== undefined && entry.state === PluginState.ACTIVE && entry.config?.enabled !== false;
  }
}
