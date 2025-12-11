/**
 * Executor Service
 *
 * Provides unified plugin-aware execution layer for both Repository and DAL patterns.
 * Built on @kysera/executor for seamless plugin interception.
 *
 * @module @omnitron-dev/titan/module/database
 */

import type { Kysely, Transaction } from 'kysely';
import {
  createExecutor,
  createExecutorSync,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  wrapTransaction,
  applyPlugins,
  validatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  type Plugin,
  type KyseraExecutor,
  type KyseraTransaction,
  type QueryBuilderContext,
  type ExecutorConfig,
} from '@kysera/executor';
import { createContext, withTransaction, type DbContext } from '@kysera/dal';
import { softDeletePlugin } from '@kysera/soft-delete';
import { auditPlugin } from '@kysera/audit';
import { timestampsPlugin } from '@kysera/timestamps';

import { Injectable } from '../../../decorators/index.js';
import { Errors } from '../../../errors/index.js';
import type { ILogger } from '../../logger/logger.types.js';
import { createNullLogger } from '../../logger/logger.types.js';
import {
  hasSoftDelete,
  getSoftDeleteConfig,
  hasTimestamps,
  getTimestampsConfig,
  hasAudit,
  getAuditConfig,
  type SoftDeleteConfig,
  type TimestampsConfig,
  type AuditConfig,
} from '../database.decorators.js';
import type { RepositoryConstructor } from '../database.internal-types.js';

/**
 * Plugin configuration for executor creation
 */
export interface ExecutorPluginConfig {
  /** Enable soft delete plugin */
  softDelete?: boolean | SoftDeleteConfig;
  /** Enable timestamps plugin */
  timestamps?: boolean | TimestampsConfig;
  /** Enable audit plugin */
  audit?: boolean | AuditConfig;
  /** Custom plugins */
  custom?: Plugin[];
}

/**
 * Options for creating an executor
 */
export interface CreateExecutorOptions {
  /** Connection name */
  connectionName?: string;
  /** Plugin configuration */
  plugins?: ExecutorPluginConfig;
  /** Additional executor config */
  config?: ExecutorConfig;
}

/**
 * Executor cache entry
 */
interface ExecutorCacheEntry<DB> {
  executor: KyseraExecutor<DB>;
  plugins: readonly Plugin[];
  createdAt: Date;
}

/**
 * Executor Service
 *
 * Centralizes plugin-aware executor creation and management.
 * Enables zero-boilerplate plugin integration through decorators.
 */
@Injectable()
export class ExecutorService {
  private readonly executorCache: Map<string, ExecutorCacheEntry<unknown>> = new Map();
  private readonly logger: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger ? logger.child({ module: 'ExecutorService' }) : createNullLogger();
  }

  // ============================================================================
  // EXECUTOR CREATION
  // ============================================================================

  /**
   * Create a plugin-aware executor from a Kysely instance
   *
   * @example
   * ```typescript
   * const executor = await executorService.createExecutor(db, {
   *   plugins: {
   *     softDelete: true,
   *     timestamps: { createdAt: 'created', updatedAt: 'modified' },
   *   }
   * });
   *
   * // All queries now have plugins applied automatically
   * const users = await executor.selectFrom('users').selectAll().execute();
   * ```
   */
  async createExecutor<DB>(
    db: Kysely<DB>,
    options: CreateExecutorOptions = {}
  ): Promise<KyseraExecutor<DB>> {
    const plugins = this.buildPluginArray(options.plugins);

    if (plugins.length === 0) {
      this.logger.debug('Creating executor without plugins');
      return createExecutor(db, [], options.config);
    }

    this.logger.debug(
      { pluginCount: plugins.length, plugins: plugins.map((p) => p.name) },
      'Creating executor with plugins'
    );

    try {
      return await createExecutor(db, plugins, options.config);
    } catch (error) {
      if (error instanceof PluginValidationError) {
        this.logger.error(
          { error: error.message, type: error.type, details: error.details },
          'Plugin validation failed'
        );
        throw Errors.badRequest(`Plugin validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Create executor synchronously (no plugin initialization)
   * Use when plugins don't require async initialization
   */
  createExecutorSync<DB>(
    db: Kysely<DB>,
    options: CreateExecutorOptions = {}
  ): KyseraExecutor<DB> {
    const plugins = this.buildPluginArray(options.plugins);

    try {
      return createExecutorSync(db, plugins, options.config);
    } catch (error) {
      if (error instanceof PluginValidationError) {
        throw Errors.badRequest(`Plugin validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Create executor with plugins derived from repository class decorators
   *
   * @example
   * ```typescript
   * @Repository({ table: 'users' })
   * @SoftDelete()
   * @Timestamps()
   * class UserRepository extends BaseRepository<User> {}
   *
   * // Automatically applies soft-delete and timestamps plugins
   * const executor = await executorService.createExecutorForRepository(db, UserRepository);
   * ```
   */
  async createExecutorForRepository<DB>(
    db: Kysely<DB>,
    repositoryClass: RepositoryConstructor,
    additionalPlugins?: Plugin[]
  ): Promise<KyseraExecutor<DB>> {
    const decoratorPlugins = this.getPluginsFromDecorators(repositoryClass);
    const allPlugins = [...decoratorPlugins, ...(additionalPlugins || [])];

    if (allPlugins.length === 0) {
      return createExecutor(db);
    }

    this.logger.debug(
      {
        repository: repositoryClass.name,
        plugins: allPlugins.map((p) => p.name),
      },
      'Creating executor for repository with decorator plugins'
    );

    return createExecutor(db, allPlugins);
  }

  // ============================================================================
  // PLUGIN MANAGEMENT
  // ============================================================================

  /**
   * Get plugins configured via decorators on a repository class
   */
  getPluginsFromDecorators(repositoryClass: RepositoryConstructor): Plugin[] {
    const plugins: Plugin[] = [];

    if (hasSoftDelete(repositoryClass)) {
      const config = getSoftDeleteConfig(repositoryClass);
      plugins.push(this.createSoftDeletePlugin(config));
    }

    if (hasTimestamps(repositoryClass)) {
      const config = getTimestampsConfig(repositoryClass);
      plugins.push(this.createTimestampsPlugin(config));
    }

    if (hasAudit(repositoryClass)) {
      const config = getAuditConfig(repositoryClass);
      plugins.push(this.createAuditPlugin(config));
    }

    return plugins;
  }

  /**
   * Build plugin array from configuration
   */
  buildPluginArray(config?: ExecutorPluginConfig): Plugin[] {
    if (!config) return [];

    const plugins: Plugin[] = [];

    if (config.softDelete) {
      const softDeleteConfig = typeof config.softDelete === 'object' ? config.softDelete : undefined;
      plugins.push(this.createSoftDeletePlugin(softDeleteConfig));
    }

    if (config.timestamps) {
      const timestampsConfig = typeof config.timestamps === 'object' ? config.timestamps : undefined;
      plugins.push(this.createTimestampsPlugin(timestampsConfig));
    }

    if (config.audit) {
      const auditConfig = typeof config.audit === 'object' ? config.audit : undefined;
      plugins.push(this.createAuditPlugin(auditConfig));
    }

    if (config.custom && config.custom.length > 0) {
      plugins.push(...config.custom);
    }

    return plugins;
  }

  /**
   * Create soft delete plugin with configuration
   */
  createSoftDeletePlugin(config?: SoftDeleteConfig): Plugin {
    return softDeletePlugin({
      deletedAtColumn: config?.column || 'deleted_at',
      includeDeleted: config?.includeDeleted || false,
    });
  }

  /**
   * Create timestamps plugin with configuration
   */
  createTimestampsPlugin(config?: TimestampsConfig): Plugin {
    return timestampsPlugin({
      createdAtColumn: config?.createdAt || 'created_at',
      updatedAtColumn: config?.updatedAt || 'updated_at',
    });
  }

  /**
   * Create audit plugin with configuration
   */
  createAuditPlugin(config?: AuditConfig): Plugin {
    return auditPlugin({
      auditTable: config?.table || 'audit_logs',
      captureOldValues: config?.captureOldValues !== false,
      captureNewValues: config?.captureNewValues !== false,
    });
  }

  // ============================================================================
  // DAL INTEGRATION
  // ============================================================================

  /**
   * Create a DAL context from an executor
   * The context provides access to the plugin-aware database for DAL queries
   *
   * @example
   * ```typescript
   * const executor = await executorService.createExecutor(db, { plugins: { softDelete: true } });
   * const ctx = executorService.createContext(executor);
   *
   * // DAL query with plugins applied
   * const getUsers = createQuery((ctx) =>
   *   ctx.db.selectFrom('users').selectAll().execute()
   * );
   * const users = await getUsers(ctx);
   * ```
   */
  createContext<DB>(executor: KyseraExecutor<DB>): DbContext<DB> {
    return createContext(executor);
  }

  /**
   * Execute function within a transaction with plugin support
   * Plugins are automatically propagated to the transaction
   *
   * @example
   * ```typescript
   * await executorService.withTransaction(executor, async (ctx) => {
   *   // All queries in this context have plugins applied
   *   const user = await ctx.db.selectFrom('users').where('id', '=', 1).executeTakeFirst();
   *   await ctx.db.updateTable('users').set({ name: 'Updated' }).where('id', '=', 1).execute();
   * });
   * ```
   */
  async withTransaction<DB, T>(
    executor: KyseraExecutor<DB>,
    fn: (ctx: DbContext<DB>) => Promise<T>
  ): Promise<T> {
    return withTransaction(executor, fn);
  }

  // ============================================================================
  // EXECUTOR UTILITIES
  // ============================================================================

  /**
   * Check if a database instance is a KyseraExecutor
   */
  isExecutor<DB>(value: Kysely<DB>): value is KyseraExecutor<DB> {
    return isKyseraExecutor(value);
  }

  /**
   * Get plugins from an executor
   */
  getPlugins<DB>(executor: KyseraExecutor<DB>): readonly Plugin[] {
    return getPlugins(executor);
  }

  /**
   * Get raw Kysely instance bypassing plugin interceptors
   * Use for internal queries that shouldn't trigger plugin logic
   *
   * @example
   * ```typescript
   * // Inside a plugin implementation:
   * const rawDb = executorService.getRawDb(executor);
   * // This query bypasses all plugin interceptors
   * const result = await rawDb.selectFrom('users').selectAll().execute();
   * ```
   */
  getRawDb<DB>(executor: Kysely<DB>): Kysely<DB> {
    return getRawDb(executor);
  }

  /**
   * Wrap a transaction with plugins
   * Use when manually managing transactions
   */
  wrapTransaction<DB>(
    trx: Transaction<DB>,
    plugins: readonly Plugin[]
  ): KyseraTransaction<DB> {
    return wrapTransaction(trx, plugins);
  }

  /**
   * Apply plugins to a query builder manually
   * Use for complex queries that need plugin behavior without interception
   */
  applyPlugins<QB>(
    qb: QB,
    plugins: readonly Plugin[],
    context: QueryBuilderContext
  ): QB {
    return applyPlugins(qb, plugins, context);
  }

  /**
   * Validate plugins for conflicts, duplicates, and missing dependencies
   */
  validatePlugins(plugins: readonly Plugin[]): void {
    try {
      validatePlugins(plugins);
    } catch (error) {
      if (error instanceof PluginValidationError) {
        throw Errors.badRequest(`Plugin validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Resolve plugin execution order
   */
  resolvePluginOrder(plugins: readonly Plugin[]): Plugin[] {
    return resolvePluginOrder(plugins);
  }

  // ============================================================================
  // CACHING
  // ============================================================================

  /**
   * Cache an executor for reuse
   */
  cacheExecutor<DB>(
    key: string,
    executor: KyseraExecutor<DB>,
    plugins: readonly Plugin[]
  ): void {
    this.executorCache.set(key, {
      executor: executor as unknown as KyseraExecutor<unknown>,
      plugins,
      createdAt: new Date(),
    });
  }

  /**
   * Get cached executor
   */
  getCachedExecutor<DB>(key: string): KyseraExecutor<DB> | undefined {
    const entry = this.executorCache.get(key);
    return entry?.executor as KyseraExecutor<DB> | undefined;
  }

  /**
   * Clear executor cache
   */
  clearCache(key?: string): void {
    if (key) {
      this.executorCache.delete(key);
    } else {
      this.executorCache.clear();
    }
  }
}

// Re-export types for convenience
export type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  QueryBuilderContext,
  ExecutorConfig,
  DbContext,
};

export {
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  wrapTransaction,
  applyPlugins,
  validatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  createContext,
  withTransaction,
};
