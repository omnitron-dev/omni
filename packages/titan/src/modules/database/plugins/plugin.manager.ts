/**
 * Plugin Manager Service
 *
 * Manages database plugin registration, initialization, and lifecycle.
 * Provides seamless integration between Titan decorators and Kysera plugins.
 *
 * Updated for @kysera/executor 0.7.0 - uses unified execution layer
 * for plugin validation and ordering.
 */

import { EventEmitter } from 'events';
import { Injectable, Inject } from '../../../decorators/index.js';
import type { Kysely, Transaction } from 'kysely';
import {
  validatePlugins as executorValidatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  type Plugin as ExecutorPlugin,
} from '@kysera/executor';
import type { Plugin as KyseraPlugin } from '@kysera/repository';
import { Errors } from '../../../errors/index.js';

// Built-in Kysera plugins
import { softDeletePlugin } from '@kysera/soft-delete';
import { auditPlugin } from '@kysera/audit';
import { timestampsPlugin } from '@kysera/timestamps';

import { DATABASE_MANAGER, DATABASE_MODULE_OPTIONS } from '../database.constants.js';
import type { DatabaseManager } from '../database.manager.js';
import type { DatabaseModuleOptions } from '../database.types.js';
import type { RepositoryConstructor } from '../database.internal-types.js';

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
import { createNullLogger, type ILogger } from '../../logger/logger.types.js';

// Import decorator metadata helpers
import {
  hasSoftDelete,
  getSoftDeleteConfig,
  hasTimestamps,
  getTimestampsConfig,
  hasAudit,
  getAuditConfig,
  getDecoratorPlugins,
  type SoftDeleteConfig,
  type TimestampsConfig,
  type AuditConfig,
} from '../database.decorators.js';

/**
 * Plugin Manager
 *
 * Centralized management for database plugins with decorator integration
 */
@Injectable()
export class PluginManager extends EventEmitter implements IPluginManager {
  private readonly registry: Map<string, PluginRegistryEntry> = new Map();
  private readonly options: PluginManagerOptions;
  private readonly loader?: IPluginLoader;
  private initialized = false;
  private logger: ILogger;

  constructor(
    @Inject(DATABASE_MODULE_OPTIONS) private moduleOptions: DatabaseModuleOptions,
    @Inject(DATABASE_MANAGER) private dbManager: DatabaseManager,
    logger?: ILogger
  ) {
    super();

    this.logger = logger ? logger.child({ module: 'PluginManager' }) : createNullLogger();

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
   * Create soft delete plugin with default options
   */
  private createSoftDeletePlugin(options?: SoftDeleteConfig): ITitanPlugin {
    const kyseraPlugin = softDeletePlugin({
      deletedAtColumn: options?.column || 'deleted_at',
      includeDeleted: options?.includeDeleted || false,
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
   * Create timestamps plugin with default options
   */
  private createTimestampsPlugin(options?: TimestampsConfig): ITitanPlugin {
    const kyseraPlugin = timestampsPlugin({
      createdAtColumn: options?.createdAt || 'created_at',
      updatedAtColumn: options?.updatedAt || 'updated_at',
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
   * Create audit plugin with default options
   */
  private createAuditPlugin(options?: AuditConfig): ITitanPlugin {
    const kyseraPlugin = auditPlugin({
      auditTable: options?.table || 'audit_logs',
      captureOldValues: options?.captureOldValues !== false,
      captureNewValues: options?.captureNewValues !== false,
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

  // ============================================================================
  // DECORATOR-BASED PLUGIN INTEGRATION
  // ============================================================================

  /**
   * Detect plugins required by a repository class based on decorators
   * Returns list of plugin names that should be applied
   */
  detectDecoratorPlugins(repositoryClass: RepositoryConstructor): string[] {
    return getDecoratorPlugins(repositoryClass);
  }

  /**
   * Create a configured soft delete plugin based on decorator config
   */
  createConfiguredSoftDeletePlugin(config?: SoftDeleteConfig): KyseraPlugin {
    return softDeletePlugin({
      deletedAtColumn: config?.column || 'deleted_at',
      includeDeleted: config?.includeDeleted || false,
    });
  }

  /**
   * Create a configured timestamps plugin based on decorator config
   */
  createConfiguredTimestampsPlugin(config?: TimestampsConfig): KyseraPlugin {
    return timestampsPlugin({
      createdAtColumn: config?.createdAt || 'created_at',
      updatedAtColumn: config?.updatedAt || 'updated_at',
    });
  }

  /**
   * Create a configured audit plugin based on decorator config
   */
  createConfiguredAuditPlugin(config?: AuditConfig): KyseraPlugin {
    return auditPlugin({
      auditTable: config?.table || 'audit_logs',
      captureOldValues: config?.captureOldValues !== false,
      captureNewValues: config?.captureNewValues !== false,
    });
  }

  /**
   * Get all plugins configured via decorators for a repository class
   * Returns array of configured Kysera plugins ready to apply
   */
  getDecoratorPluginsForRepository(repositoryClass: RepositoryConstructor): KyseraPlugin[] {
    const plugins: KyseraPlugin[] = [];

    // Check for soft delete decorator
    if (hasSoftDelete(repositoryClass)) {
      const config = getSoftDeleteConfig(repositoryClass);
      plugins.push(this.createConfiguredSoftDeletePlugin(config));
    }

    // Check for timestamps decorator
    if (hasTimestamps(repositoryClass)) {
      const config = getTimestampsConfig(repositoryClass);
      plugins.push(this.createConfiguredTimestampsPlugin(config));
    }

    // Check for audit decorator
    if (hasAudit(repositoryClass)) {
      const config = getAuditConfig(repositoryClass);
      plugins.push(this.createConfiguredAuditPlugin(config));
    }

    return plugins;
  }

  /**
   * Apply decorator-configured plugins to a repository instance
   * This is the main entry point for zero-boilerplate plugin integration
   */
  applyDecoratorPlugins<T extends object>(repository: T, repositoryClass: RepositoryConstructor): T {
    const plugins = this.getDecoratorPluginsForRepository(repositoryClass);
    
    if (plugins.length === 0) {
      return repository;
    }

    let enhancedRepo = repository;

    for (const plugin of plugins) {
      if (plugin.extendRepository) {
        enhancedRepo = this.applyPluginWithPrototypePreservation(enhancedRepo, plugin);
      }
    }

    return enhancedRepo;
  }

  /**
   * Apply plugin while preserving prototype chain
   * Kysera plugins use object spread which loses prototype methods,
   * so we merge new properties back onto the original object
   */
  private applyPluginWithPrototypePreservation<T extends object>(repository: T, plugin: KyseraPlugin): T {
    if (!plugin.extendRepository) {
      return repository;
    }

    const extended = plugin.extendRepository(repository);

    // If the plugin returned a different object (e.g., via object spread),
    // merge the new/modified properties back onto the original repository
    // to preserve the prototype chain
    if (extended !== repository && extended) {
      // Copy all enumerable own properties from extended to repository
      for (const key of Object.keys(extended)) {
        const extendedValue = (extended as Record<string, unknown>)[key];
        const originalValue = (repository as Record<string, unknown>)[key];

        // Copy if it's a new property, a function, or the value changed
        if (typeof extendedValue === 'function' || !(key in repository) || extendedValue !== originalValue) {
          (repository as Record<string, unknown>)[key] = extendedValue;
        }
      }

      // Also copy any symbol properties
      for (const sym of Object.getOwnPropertySymbols(extended)) {
        (repository as Record<symbol, unknown>)[sym] = (extended as Record<symbol, unknown>)[sym];
      }

      return repository;
    }

    return extended as T;
  }

  // ============================================================================
  // CORE PLUGIN MANAGEMENT
  // ============================================================================

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
            this.logger.error({ error, name }, `Plugin "${name}" onRegister hook failed`);
          });
        }
      } catch (error) {
        this.logger.error({ error, name }, `Plugin "${name}" onRegister hook failed`);
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
   * Validate plugin.
   * Uses @kysera/executor validation for consistency with unified execution layer.
   */
  private validatePlugin(plugin: ITitanPlugin): void {
    if (!plugin.name) {
      throw Errors.badRequest('Plugin must have a name');
    }

    // Check for required methods (at least one extension method or interceptQuery)
    const hasExtension = plugin.extendRepository || plugin.extendDatabase || plugin.extendTransaction;
    const hasInterceptor = 'interceptQuery' in plugin && typeof plugin.interceptQuery === 'function';

    if (!hasExtension && !hasInterceptor) {
      throw Errors.badRequest(
        `Plugin "${plugin.name}" must implement at least one extension method or interceptQuery`
      );
    }

    // Validate dependencies - use executor validation for comprehensive check
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registry.has(dep)) {
          throw Errors.badRequest(`Plugin "${plugin.name}" depends on unregistered plugin "${dep}"`);
        }
      }
    }

    // Check for conflicts using executor's conflict detection
    if (plugin.conflictsWith) {
      for (const conflict of plugin.conflictsWith) {
        if (this.registry.has(conflict)) {
          throw Errors.badRequest(`Plugin "${plugin.name}" conflicts with registered plugin "${conflict}"`);
        }
      }
    }
  }

  /**
   * Validate all registered plugins together.
   * Uses @kysera/executor's validatePlugins for comprehensive validation
   * including circular dependency detection.
   */
  validateAllPlugins(): void {
    const plugins = Array.from(this.registry.values()).map((entry) => entry.plugin as ExecutorPlugin);

    try {
      executorValidatePlugins(plugins);
    } catch (error) {
      if (error instanceof PluginValidationError) {
        throw Errors.badRequest(`Plugin validation failed: ${error.message}`);
      }
      throw error;
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
   * Get plugins sorted by priority and dependencies.
   * Uses @kysera/executor's resolvePluginOrder for consistent ordering
   * with the unified execution layer.
   */
  private getSortedPlugins(): Array<[string, PluginRegistryEntry]> {
    const entries = Array.from(this.registry.entries());

    // Extract plugins for executor's ordering algorithm
    const plugins = entries.map(([, entry]) => entry.plugin as ExecutorPlugin);

    try {
      // Use executor's topological sort with priority handling
      const sortedPlugins = resolvePluginOrder(plugins);

      // Map back to registry entries while preserving order
      return sortedPlugins
        .map((plugin) => {
          const entry = entries.find(([, e]) => e.plugin.name === plugin.name);
          return entry || null;
        })
        .filter((entry): entry is [string, PluginRegistryEntry] => entry !== null);
    } catch (error) {
      // Fallback to original ordering if executor's sort fails
      if (error instanceof PluginValidationError) {
        this.logger.warn(
          { error: error.message, type: error.type },
          'Plugin ordering failed, using registration order'
        );
      }
      return entries;
    }
  }

  /**
   * Apply plugins to repository by name
   */
  applyPlugins(repository: any, pluginNames: string[]): any {
    let enhancedRepo = repository;

    for (const name of pluginNames) {
      const entry = this.registry.get(name);
      if (!entry) {
        this.logger.warn(`Plugin "${name}" not found`);
        continue;
      }

      if (entry.config?.enabled === false) {
        continue;
      }

      const startTime = Date.now();

      try {
        // Apply plugin based on extension method
        if (entry.plugin.extendRepository) {
          enhancedRepo = this.applyPluginWithPrototypePreservation(enhancedRepo, entry.plugin);
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

        this.logger.error({ error, name }, `Failed to apply plugin "${name}"`);
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
          this.logger.error({ error, name }, `Failed to apply database plugin "${name}"`);
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
          this.logger.error({ error, name }, `Failed to apply transaction plugin "${name}"`);
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
      this.logger.error({ error, name }, `Failed to destroy plugin "${name}"`);
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
