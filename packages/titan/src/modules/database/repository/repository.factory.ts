/**
 * Repository Factory Service
 *
 * Manages repository creation, registration, and plugin application
 */

import { Injectable } from '../../../decorators/index.js';
import { Kysely, Transaction } from 'kysely';
import {
  createRepositoryFactory as createKyseraRepositoryFactory,
  type Plugin as KyseraPlugin,
} from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';
import { auditPlugin } from '@kysera/audit';
import { timestampsPlugin } from '@kysera/timestamps';

import { DatabaseManager } from '../database.manager.js';
import { BaseRepository } from './base.repository.js';
import { PluginManager } from '../plugins/plugin.manager.js';
import { Errors } from '../../../errors/index.js';
import { BUILT_IN_PLUGINS } from '../database.constants.js';
import type {
  IRepositoryFactory,
  Repository,
  RepositoryConfig,
  RepositoryMetadata,
  RepositoryFactoryConfig,
  RepositoryTransactionScope,
} from './repository.types.js';
import type { RepositoryConstructor } from '../database.internal-types.js';
import type { Logger } from '../database.internal-types.js';
import { createDefaultLogger } from '../utils/logger.factory.js';

/**
 * Repository Factory Service
 *
 * Creates and manages repository instances with plugin support
 */
@Injectable()
export class RepositoryFactory implements IRepositoryFactory {
  private repositories: Map<RepositoryConstructor, Repository<unknown>> = new Map();
  private metadata: Map<RepositoryConstructor, RepositoryMetadata> = new Map();
  private plugins: Map<string, KyseraPlugin> = new Map();
  private config: RepositoryFactoryConfig;
  private logger: Logger;

  constructor(
    private manager: DatabaseManager,
    config?: RepositoryFactoryConfig,
    private pluginManager?: PluginManager
  ) {
    this.config = config || {};
    this.logger = createDefaultLogger('RepositoryFactory');

    // Only initialize built-in plugins if no plugin manager is provided
    if (!this.pluginManager) {
      this.initializeBuiltInPlugins();
    }
  }

  /**
   * Initialize built-in plugins
   */
  private initializeBuiltInPlugins(): void {
    // Register built-in plugins
    this.plugins.set(
      BUILT_IN_PLUGINS.SOFT_DELETE,
      softDeletePlugin({
        deletedAtColumn: 'deleted_at',
      })
    );

    this.plugins.set(
      BUILT_IN_PLUGINS.TIMESTAMPS,
      timestampsPlugin({
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
      })
    );

    this.plugins.set(
      BUILT_IN_PLUGINS.AUDIT,
      auditPlugin({
        auditTable: 'audit_logs',
        captureOldValues: true,
        captureNewValues: true,
      })
    );
  }

  /**
   * Create a repository instance
   */
  async create<Entity = any, CreateInput = any, UpdateInput = any>(
    config: RepositoryConfig<any, any, any>
  ): Promise<Repository<Entity, CreateInput, UpdateInput>> {
    const connectionName = config.connectionName || this.config.connectionName || 'default';
    const db = await this.manager.getConnection(connectionName);

    // Create base repository
    const baseRepo = new BaseRepository(db, config);

    // Apply plugins if configured
    if (config.plugins && config.plugins.length > 0) {
      return this.applyPlugins(baseRepo, config.plugins) as Repository<Entity, CreateInput, UpdateInput>;
    }

    // Check for specific plugin configurations
    const pluginsToApply: KyseraPlugin[] = [];

    if (config.softDelete) {
      const softDeleteConfig = typeof config.softDelete === 'object' ? config.softDelete : { column: 'deleted_at' };

      pluginsToApply.push(
        softDeletePlugin({
          deletedAtColumn: softDeleteConfig.column || 'deleted_at',
          includeDeleted: softDeleteConfig.includeDeleted || false,
        })
      );
    }

    if (config.timestamps) {
      const timestampsConfig =
        typeof config.timestamps === 'object'
          ? config.timestamps
          : { createdAt: 'created_at', updatedAt: 'updated_at' };

      pluginsToApply.push(
        timestampsPlugin({
          createdAtColumn: timestampsConfig.createdAt || 'created_at',
          updatedAtColumn: timestampsConfig.updatedAt || 'updated_at',
        })
      );
    }

    if (config.audit) {
      const auditConfig = typeof config.audit === 'object' ? config.audit : { table: 'audit_logs' };

      pluginsToApply.push(
        auditPlugin({
          auditTable: auditConfig.table || 'audit_logs',
          captureOldValues: auditConfig.captureOldValues !== false,
          captureNewValues: auditConfig.captureNewValues !== false,
        })
      );
    }

    if (pluginsToApply.length > 0) {
      return this.applyPlugins(baseRepo, pluginsToApply) as Repository<Entity, CreateInput, UpdateInput>;
    }

    return baseRepo as Repository<Entity, CreateInput, UpdateInput>;
  }

  /**
   * Register a repository class
   */
  register(target: RepositoryConstructor, metadata: RepositoryMetadata): void {
    this.metadata.set(target, metadata);

    // Create and cache repository instance
    this.createAndCacheRepository(target, metadata);
  }

  /**
   * Create and cache a repository instance
   */
  private async createAndCacheRepository(target: RepositoryConstructor, metadata: RepositoryMetadata): Promise<void> {
    const connectionName = metadata.connection || this.config.connectionName || 'default';
    const db = await this.manager.getConnection(connectionName);

    // Create an instance of the actual custom repository class
    // The custom repository class constructor expects the database connection and config
    const config: RepositoryConfig = {
      tableName: metadata.table,
      connectionName: metadata.connection,
      schemas: {
        entity: metadata.schema,
        create: metadata.createSchema,
        update: metadata.updateSchema,
      },
      plugins: metadata.plugins,
      softDelete: metadata.softDelete,
      timestamps: metadata.timestamps,
      audit: metadata.audit,
    };

    // Instantiate the actual repository class (e.g., UserRepository, ProductRepository)
    let repository: Repository<unknown>;

    // Check if target is a constructor function
    if (typeof target === 'function' && target.prototype) {
      // Create instance of the custom repository class
      repository = new target(db, config) as Repository<unknown>;
    } else {
      // Fallback to BaseRepository if not a constructor
      repository = new BaseRepository(db, config) as Repository<unknown>;
    }

    // Apply plugins if configured
    if (metadata.plugins && metadata.plugins.length > 0) {
      repository = this.applyPlugins(repository, metadata.plugins);
    }

    // Check for specific plugin configurations
    const pluginsToApply: KyseraPlugin[] = [];

    if (metadata.softDelete) {
      const softDeleteConfig = typeof metadata.softDelete === 'object' ? metadata.softDelete : { column: 'deleted_at' };

      pluginsToApply.push(
        softDeletePlugin({
          deletedAtColumn: softDeleteConfig.column || 'deleted_at',
          includeDeleted: softDeleteConfig.includeDeleted || false,
        })
      );
    }

    if (metadata.timestamps) {
      const timestampsConfig =
        typeof metadata.timestamps === 'object'
          ? metadata.timestamps
          : { createdAt: 'created_at', updatedAt: 'updated_at' };

      pluginsToApply.push(
        timestampsPlugin({
          createdAtColumn: timestampsConfig.createdAt || 'created_at',
          updatedAtColumn: timestampsConfig.updatedAt || 'updated_at',
        })
      );
    }

    if (metadata.audit) {
      const auditConfig = typeof metadata.audit === 'object' ? metadata.audit : { table: 'audit_logs' };

      pluginsToApply.push(
        auditPlugin({
          auditTable: auditConfig.table || 'audit_logs',
          captureOldValues: auditConfig.captureOldValues !== false,
          captureNewValues: auditConfig.captureNewValues !== false,
        })
      );
    }

    if (pluginsToApply.length > 0) {
      repository = this.applyPlugins(repository, pluginsToApply);
    }

    this.repositories.set(target, repository);
  }

  /**
   * Get a registered repository
   */
  async get<T = unknown>(target: RepositoryConstructor): Promise<T> {
    const repository = this.repositories.get(target);

    if (!repository) {
      const metadata = this.metadata.get(target);
      if (metadata) {
        // Try to create repository on-demand
        await this.createAndCacheRepository(target, metadata);
        return this.repositories.get(target) as T;
      }

      const targetName = typeof target === 'function' && target.name ? target.name : String(target);
      throw Errors.notFound('Repository', targetName);
    }

    return repository as T;
  }

  /**
   * Get all registered repositories
   */
  getAll(): Map<RepositoryConstructor, Repository<unknown>> {
    return new Map(this.repositories);
  }

  /**
   * Get repository metadata
   */
  getMetadata(target: RepositoryConstructor): RepositoryMetadata | undefined {
    return this.metadata.get(target);
  }

  /**
   * Create repository with transaction
   */
  createWithTransaction<T = unknown>(target: RepositoryConstructor, transaction: Transaction<unknown>): T {
    const metadata = this.metadata.get(target);
    if (!metadata) {
      const targetName = typeof target === 'function' && target.name ? target.name : String(target);
      throw Errors.notFound('Repository metadata', targetName);
    }

    // Create repository config from metadata
    const config: RepositoryConfig = {
      tableName: metadata.table,
      connectionName: metadata.connection,
      schemas: {
        entity: metadata.schema,
        create: metadata.createSchema,
        update: metadata.updateSchema,
      },
      plugins: metadata.plugins,
      softDelete: metadata.softDelete,
      timestamps: metadata.timestamps,
      audit: metadata.audit,
    };

    // Instantiate the actual repository class with transaction
    let repository: Repository<unknown>;

    // Check if target is a constructor function
    if (typeof target === 'function' && target.prototype) {
      // Create instance of the custom repository class
      repository = new target(transaction, config) as Repository<unknown>;
    } else {
      // Fallback to BaseRepository if not a constructor
      repository = new BaseRepository(transaction, config) as Repository<unknown>;
    }

    // Apply plugins if configured
    if (metadata.plugins && metadata.plugins.length > 0) {
      repository = this.applyPlugins(repository, metadata.plugins);
    }

    // Check for specific plugin configurations
    const pluginsToApply: KyseraPlugin[] = [];

    if (metadata.softDelete) {
      const softDeleteConfig = typeof metadata.softDelete === 'object' ? metadata.softDelete : { column: 'deleted_at' };

      pluginsToApply.push(
        softDeletePlugin({
          deletedAtColumn: softDeleteConfig.column || 'deleted_at',
          includeDeleted: softDeleteConfig.includeDeleted || false,
        })
      );
    }

    if (metadata.timestamps) {
      const timestampsConfig =
        typeof metadata.timestamps === 'object'
          ? metadata.timestamps
          : { createdAt: 'created_at', updatedAt: 'updated_at' };

      pluginsToApply.push(
        timestampsPlugin({
          createdAtColumn: timestampsConfig.createdAt || 'created_at',
          updatedAtColumn: timestampsConfig.updatedAt || 'updated_at',
        })
      );
    }

    if (metadata.audit) {
      const auditConfig = typeof metadata.audit === 'object' ? metadata.audit : { table: 'audit_logs' };

      pluginsToApply.push(
        auditPlugin({
          auditTable: auditConfig.table || 'audit_logs',
          captureOldValues: auditConfig.captureOldValues !== false,
          captureNewValues: auditConfig.captureNewValues !== false,
        })
      );
    }

    if (pluginsToApply.length > 0) {
      repository = this.applyPlugins(repository, pluginsToApply);
    }

    return repository as T;
  }

  /**
   * Apply plugins to a repository
   */
  applyPlugins<T extends object = Record<string, unknown>>(repository: T, plugins: Array<string | KyseraPlugin>): T {
    // Use plugin manager if available
    if (this.pluginManager) {
      const pluginNames = plugins.filter((p) => typeof p === 'string').map((p) => p as string);

      // Apply string-based plugins through plugin manager
      if (pluginNames.length > 0) {
        repository = this.pluginManager.applyPlugins(repository, pluginNames) as T;
      }

      // Apply direct plugin instances
      const directPlugins = plugins.filter((p) => typeof p !== 'string');
      for (const plugin of directPlugins) {
        const pluginInstance = plugin as KyseraPlugin;
        if (pluginInstance.extendRepository) {
          repository = pluginInstance.extendRepository(repository) as T;
        }
      }

      return repository;
    }

    // Fallback to local plugin handling
    let enhancedRepo = repository;

    for (const plugin of plugins) {
      const pluginInstance = typeof plugin === 'string' ? this.plugins.get(plugin) : plugin;

      if (!pluginInstance) {
        this.logger.warn(`Plugin "${plugin}" not found`);
        continue;
      }

      // Apply plugin based on Kysera plugin interface
      if (pluginInstance.extendRepository) {
        enhancedRepo = pluginInstance.extendRepository(enhancedRepo) as T;
      }
    }

    return enhancedRepo as T;
  }

  /**
   * Register a custom plugin
   */
  registerPlugin(name: string, plugin: KyseraPlugin): void {
    this.plugins.set(name, plugin);
  }

  /**
   * Create a transaction scope for repositories
   */
  async createTransactionScope(fn: (scope: RepositoryTransactionScope) => Promise<unknown>): Promise<unknown> {
    const connectionName = this.config.connectionName || 'default';
    const db = await this.manager.getConnection(connectionName);

    return db.transaction().execute(async (trx) => {
      const scope: RepositoryTransactionScope = {
        getRepository: <T = unknown>(target: RepositoryConstructor): T => {
          const metadata = this.metadata.get(target);
          if (!metadata) {
            const targetName = typeof target === 'function' && target.name ? target.name : String(target);
            throw Errors.notFound('Repository metadata', targetName);
          }

          const config: RepositoryConfig = {
            tableName: metadata.table,
            connectionName: metadata.connection,
            schemas: {
              entity: metadata.schema,
              create: metadata.createSchema,
              update: metadata.updateSchema,
            },
            plugins: metadata.plugins,
            softDelete: metadata.softDelete,
            timestamps: metadata.timestamps,
            audit: metadata.audit,
          };

          // Instantiate the actual repository class with transaction
          let repository: Repository<unknown>;

          // Check if target is a constructor function
          if (typeof target === 'function' && target.prototype) {
            // Create instance of the custom repository class
            repository = new target(trx, config) as Repository<unknown>;
          } else {
            // Fallback to BaseRepository if not a constructor
            repository = new BaseRepository(trx, config) as Repository<unknown>;
          }

          // Apply plugins if needed
          if (metadata.plugins && metadata.plugins.length > 0) {
            repository = this.applyPlugins(repository, metadata.plugins);
          }

          // Check for specific plugin configurations
          const pluginsToApply: KyseraPlugin[] = [];

          if (metadata.softDelete) {
            const softDeleteConfig = typeof metadata.softDelete === 'object' ? metadata.softDelete : { column: 'deleted_at' };

            pluginsToApply.push(
              softDeletePlugin({
                deletedAtColumn: softDeleteConfig.column || 'deleted_at',
                includeDeleted: softDeleteConfig.includeDeleted || false,
              })
            );
          }

          if (metadata.timestamps) {
            const timestampsConfig =
              typeof metadata.timestamps === 'object'
                ? metadata.timestamps
                : { createdAt: 'created_at', updatedAt: 'updated_at' };

            pluginsToApply.push(
              timestampsPlugin({
                createdAtColumn: timestampsConfig.createdAt || 'created_at',
                updatedAtColumn: timestampsConfig.updatedAt || 'updated_at',
              })
            );
          }

          if (metadata.audit) {
            const auditConfig = typeof metadata.audit === 'object' ? metadata.audit : { table: 'audit_logs' };

            pluginsToApply.push(
              auditPlugin({
                auditTable: auditConfig.table || 'audit_logs',
                captureOldValues: auditConfig.captureOldValues !== false,
                captureNewValues: auditConfig.captureNewValues !== false,
              })
            );
          }

          if (pluginsToApply.length > 0) {
            repository = this.applyPlugins(repository, pluginsToApply);
          }

          return repository as T;
        },
        execute: async <T>(executeFn: () => Promise<T>): Promise<T> => executeFn(),
      };

      return fn(scope);
    });
  }

  /**
   * Create repository with Kysera factory (for compatibility)
   */
  async createWithKysera<DB, Entity>(
    connectionName?: string
  ): Promise<ReturnType<typeof createKyseraRepositoryFactory<DB>>['create']> {
    const connName = connectionName || this.config.connectionName || 'default';
    const db = (await this.manager.getConnection(connName)) as Kysely<unknown>;

    const factory = createKyseraRepositoryFactory<DB>(db as Kysely<DB>);
    return factory.create;
  }

  /**
   * Clear all cached repositories
   */
  clearCache(): void {
    this.repositories.clear();
  }

  /**
   * Refresh a specific repository
   */
  async refresh(target: RepositoryConstructor): Promise<void> {
    const metadata = this.metadata.get(target);
    if (metadata) {
      await this.createAndCacheRepository(target, metadata);
    }
  }
}
