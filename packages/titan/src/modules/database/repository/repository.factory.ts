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
import {
  BUILT_IN_PLUGINS,
} from '../database.constants.js';
import type {
  IRepositoryFactory,
  Repository,
  RepositoryConfig,
  RepositoryMetadata,
  RepositoryFactoryConfig,
  RepositoryTransactionScope,
} from './repository.types.js';

/**
 * Repository Factory Service
 *
 * Creates and manages repository instances with plugin support
 */
@Injectable()
export class RepositoryFactory implements IRepositoryFactory {
  private repositories: Map<any, Repository<any>> = new Map();
  private metadata: Map<any, RepositoryMetadata> = new Map();
  private plugins: Map<string, KyseraPlugin> = new Map();
  private config: RepositoryFactoryConfig;

  constructor(
    private manager: DatabaseManager,
    config?: RepositoryFactoryConfig,
    private pluginManager?: PluginManager
  ) {
    this.config = config || {};

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
      const softDeleteConfig = typeof config.softDelete === 'object'
        ? config.softDelete
        : { column: 'deleted_at' };

      pluginsToApply.push(
        softDeletePlugin({
          deletedAtColumn: softDeleteConfig.column || 'deleted_at',
          includeDeleted: softDeleteConfig.includeDeleted || false,
        })
      );
    }

    if (config.timestamps) {
      const timestampsConfig = typeof config.timestamps === 'object'
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
      const auditConfig = typeof config.audit === 'object'
        ? config.audit
        : { table: 'audit_logs' };

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
  register(target: any, metadata: RepositoryMetadata): void {
    this.metadata.set(target, metadata);

    // Create and cache repository instance
    this.createAndCacheRepository(target, metadata);
  }

  /**
   * Create and cache a repository instance
   */
  private async createAndCacheRepository(
    target: any,
    metadata: RepositoryMetadata
  ): Promise<void> {
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

    const repository = await this.create(config);
    this.repositories.set(target, repository);
  }

  /**
   * Get a registered repository
   */
  async get<T = any>(target: any): Promise<T> {
    const repository = this.repositories.get(target);

    if (!repository) {
      const metadata = this.metadata.get(target);
      if (metadata) {
        // Try to create repository on-demand
        await this.createAndCacheRepository(target, metadata);
        return this.repositories.get(target) as T;
      }

      throw new Error(`Repository for ${target.name || target} is not registered`);
    }

    return repository as T;
  }

  /**
   * Get all registered repositories
   */
  getAll(): Map<any, Repository<any>> {
    return new Map(this.repositories);
  }

  /**
   * Get repository metadata
   */
  getMetadata(target: any): RepositoryMetadata | undefined {
    return this.metadata.get(target);
  }

  /**
   * Create repository with transaction
   */
  createWithTransaction<T = any>(target: any, transaction: Transaction<any>): T {
    const metadata = this.metadata.get(target);
    if (!metadata) {
      throw new Error(`Repository metadata for ${target.name || target} not found`);
    }

    // Create repository config from metadata
    const config: RepositoryConfig<any, any, any> = {
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

    // Create base repository with transaction
    const baseRepo = new BaseRepository(transaction, config);

    // Apply plugins if configured
    let repository: any = baseRepo;
    if (metadata.plugins && metadata.plugins.length > 0) {
      repository = this.applyPlugins(repository, metadata.plugins);
    }

    return repository as T;
  }

  /**
   * Apply plugins to a repository
   */
  applyPlugins(repository: any, plugins: Array<string | KyseraPlugin>): any {
    // Use plugin manager if available
    if (this.pluginManager) {
      const pluginNames = plugins
        .filter(p => typeof p === 'string')
        .map(p => p as string);

      // Apply string-based plugins through plugin manager
      if (pluginNames.length > 0) {
        repository = this.pluginManager.applyPlugins(repository, pluginNames);
      }

      // Apply direct plugin instances
      const directPlugins = plugins.filter(p => typeof p !== 'string');
      for (const plugin of directPlugins) {
        const pluginInstance = plugin as KyseraPlugin;
        if (pluginInstance.extendRepository) {
          repository = pluginInstance.extendRepository(repository);
        }
      }

      return repository;
    }

    // Fallback to local plugin handling
    let enhancedRepo = repository;

    for (const plugin of plugins) {
      const pluginInstance = typeof plugin === 'string'
        ? this.plugins.get(plugin)
        : plugin;

      if (!pluginInstance) {
        console.warn(`Plugin "${plugin}" not found`);
        continue;
      }

      // Apply plugin based on Kysera plugin interface
      if (pluginInstance.extendRepository) {
        enhancedRepo = pluginInstance.extendRepository(enhancedRepo);
      }
    }

    return enhancedRepo;
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
  async createTransactionScope(
    fn: (scope: RepositoryTransactionScope) => Promise<any>
  ): Promise<any> {
    const connectionName = this.config.connectionName || 'default';
    const db = await this.manager.getConnection(connectionName);

    return db.transaction().execute(async (trx) => {
      const scope: RepositoryTransactionScope = {
        getRepository: <T = any>(target: any): T => {
          const metadata = this.metadata.get(target);
          if (!metadata) {
            throw new Error(`Repository metadata for ${target.name || target} not found`);
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

          const baseRepo = new BaseRepository(trx, config);

          // Apply plugins if needed
          if (metadata.plugins && metadata.plugins.length > 0) {
            return this.applyPlugins(baseRepo, metadata.plugins) as T;
          }

          return baseRepo as T;
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
    const db = await this.manager.getConnection(connName) as Kysely<DB>;

    const factory = createKyseraRepositoryFactory<DB>(db);
    return factory.create as any;
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
  async refresh(target: any): Promise<void> {
    const metadata = this.metadata.get(target);
    if (metadata) {
      await this.createAndCacheRepository(target, metadata);
    }
  }
}