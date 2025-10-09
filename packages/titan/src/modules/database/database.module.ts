/**
 * Database Module for Titan Framework
 *
 * Provides database integration with Kysera ORM
 */

import { DynamicModule, Provider, ProviderDefinition } from '../../nexus/index.js';
import { Module } from '../../decorators/index.js';
import { DatabaseManager } from './database.manager.js';
import { DatabaseService } from './database.service.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { RepositoryFactory } from './repository/repository.factory.js';
import { MigrationRunner } from './migration/migration.runner.js';
import { TransactionManager } from './transaction/transaction.manager.js';
import { TransactionScopeFactory } from './transaction/transaction.scope.js';
import { PluginManager } from './plugins/plugin.manager.js';
import { PluginLoader } from './plugins/plugin.loader.js';
import { getRepositoryMetadata } from './database.decorators.js';
import {
  DATABASE_SERVICE,
  DATABASE_HEALTH_INDICATOR,
  DATABASE_MANAGER,
  DATABASE_MODULE_OPTIONS,
  DATABASE_REPOSITORY_FACTORY,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_TRANSACTION_MANAGER,
  DATABASE_TRANSACTION_SCOPE_FACTORY,
  DATABASE_PLUGIN_MANAGER,
  getDatabaseConnectionToken,
  getRepositoryToken,
  DATABASE_DEFAULT_CONNECTION,
} from './database.constants.js';
import type {
  DatabaseModuleOptions,
  DatabaseModuleAsyncOptions,
  DatabaseOptionsFactory,
} from './database.types.js';

@Module()
export class TitanDatabaseModule {
  name = 'TitanDatabaseModule';

  /**
   * Configure database module with static options
   */
  static forRoot(options: DatabaseModuleOptions = {}): DynamicModule {
    // Create providers using correct Nexus format
    const providers: Array<[string | symbol, ProviderDefinition<any>] | Provider<any>> = [
      // Module options
      [DATABASE_MODULE_OPTIONS, {
        useValue: options,
      }],

      // Database manager with initialization
      [DATABASE_MANAGER, {
        useFactory: async (moduleOptions: DatabaseModuleOptions) => {
          const manager = new DatabaseManager(moduleOptions);
          await manager.init();

          // Run auto-migrations if enabled
          if (moduleOptions.autoMigrate) {
            // This will be implemented with migration service
            // await runMigrations(manager);
          }

          return manager;
        },
        inject: [DATABASE_MODULE_OPTIONS],
      }],

      // Database service
      [DATABASE_SERVICE, {
        useFactory: async (manager: DatabaseManager) => new DatabaseService(manager),
        inject: [DATABASE_MANAGER],
      }],

      // Health indicator
      [DATABASE_HEALTH_INDICATOR, {
        useFactory: async (manager: DatabaseManager) => new DatabaseHealthIndicator(manager),
        inject: [DATABASE_MANAGER],
      }],

      // Plugin manager
      [DATABASE_PLUGIN_MANAGER, {
        useFactory: async (moduleOptions: DatabaseModuleOptions, manager: DatabaseManager) => {
          const pluginManager = new PluginManager(moduleOptions, manager);

          // Load and register custom plugins
          if (moduleOptions.plugins?.custom) {
            for (const config of moduleOptions.plugins.custom) {
              try {
                if (typeof config.plugin === 'string') {
                  // Load from file/package using loader
                  const loader = new PluginLoader();
                  const plugin = await loader.loadPlugin(config.plugin);
                  pluginManager.registerPlugin(
                    config.name || plugin.name,
                    plugin,
                    config
                  );
                } else {
                  // Direct plugin instance
                  pluginManager.registerPlugin(
                    config.name || config.plugin.name || 'custom',
                    config.plugin,
                    config
                  );
                }
              } catch (error) {
                console.error('Failed to register custom plugin:', error);
              }
            }
          }

          // Configure built-in plugins
          if (moduleOptions.plugins?.builtIn) {
            const { softDelete, timestamps, audit } = moduleOptions.plugins.builtIn;

            if (softDelete) {
              pluginManager.enablePlugin('soft-delete');
            }
            if (timestamps) {
              pluginManager.enablePlugin('timestamps');
            }
            if (audit) {
              pluginManager.enablePlugin('audit');
            }
          }

          // Initialize all plugins
          await pluginManager.initializeAll();

          return pluginManager;
        },
        inject: [DATABASE_MODULE_OPTIONS, DATABASE_MANAGER],
      }],

      // Repository factory (async because DATABASE_MANAGER is async)
      [DATABASE_REPOSITORY_FACTORY, {
        useFactory: async (manager: DatabaseManager, pluginManager: any) => {
          const factory = new RepositoryFactory(manager, options.kysera?.repository, pluginManager);

          // Auto-register repositories from metadata if any
          const repositories = Reflect.getMetadata('database:repositories', global) || [];
          repositories.forEach(({ target, metadata }: any) => {
            factory.register(target, metadata);
          });

          return factory;
        },
        inject: [DATABASE_MANAGER, DATABASE_PLUGIN_MANAGER],
      }],

      // Migration runner
      [DATABASE_MIGRATION_SERVICE, {
        useFactory: async (manager: DatabaseManager) => {
          const runner = new MigrationRunner(manager, options.migrations);

          // Auto-migrate if configured
          if (options.autoMigrate) {
            await runner.init();
            const result = await runner.migrate();
            if (!result.success) {
              console.error('Auto-migration failed:', result.errors);
            }
          }

          return runner;
        },
        inject: [DATABASE_MANAGER],
      }],

      // Transaction manager
      [DATABASE_TRANSACTION_MANAGER, {
        useFactory: (manager: DatabaseManager) => new TransactionManager(manager, options.transactionOptions),
        inject: [DATABASE_MANAGER],
      }],

      // Transaction scope factory
      [DATABASE_TRANSACTION_SCOPE_FACTORY, {
        useFactory: (repositoryFactory: RepositoryFactory, manager: DatabaseManager, transactionManager: TransactionManager) => new TransactionScopeFactory(repositoryFactory, manager, transactionManager),
        inject: [DATABASE_REPOSITORY_FACTORY, DATABASE_MANAGER, DATABASE_TRANSACTION_MANAGER],
      }],
    ];

    // Create connection providers
    const connectionProviders = this.createConnectionProviders(options);
    providers.push(...connectionProviders);

    // Create repository providers if any repositories are registered
    const repositoryProviders = this.createRepositoryProviders();
    providers.push(...repositoryProviders);

    // Exports
    const exports: any[] = [
      DATABASE_SERVICE,
      DATABASE_HEALTH_INDICATOR,
      DATABASE_MANAGER,
      DATABASE_PLUGIN_MANAGER,
      DATABASE_REPOSITORY_FACTORY,
      DATABASE_MIGRATION_SERVICE,
      DATABASE_TRANSACTION_MANAGER,
      DATABASE_TRANSACTION_SCOPE_FACTORY,
      ...connectionProviders.map(p => Array.isArray(p) ? p[0] : getDatabaseConnectionToken()),
      ...repositoryProviders.map(p => Array.isArray(p) ? p[0] : p),
    ];

    const result: DynamicModule = {
      module: TitanDatabaseModule,
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure database module with async options
   */
  static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
    const providers: Array<[string | symbol, ProviderDefinition<any>] | Provider<any>> = [];

    // Create async options provider
    const asyncProviders = this.createAsyncProviders(options);
    providers.push(...asyncProviders);

    // Database manager provider
    providers.push([DATABASE_MANAGER, {
      useFactory: async (moduleOptions: DatabaseModuleOptions) => {
        const manager = new DatabaseManager(moduleOptions);
        await manager.init();

        if (moduleOptions.autoMigrate) {
          // await runMigrations(manager);
        }

        return manager;
      },
      inject: [DATABASE_MODULE_OPTIONS],
    }]);

    // Service providers
    providers.push(DatabaseService);
    providers.push(DatabaseHealthIndicator);

    // Plugin manager
    providers.push([DATABASE_PLUGIN_MANAGER, {
      useFactory: async (moduleOptions: DatabaseModuleOptions, manager: DatabaseManager) => {
        const pluginManager = new PluginManager(moduleOptions, manager);

        // Load and register custom plugins
        if (moduleOptions.plugins?.custom) {
          for (const config of moduleOptions.plugins.custom) {
            try {
              if (typeof config.plugin === 'string') {
                const loader = new PluginLoader();
                const plugin = await loader.loadPlugin(config.plugin);
                pluginManager.registerPlugin(
                  config.name || plugin.name,
                  plugin,
                  config
                );
              } else {
                pluginManager.registerPlugin(
                  config.name || config.plugin.name || 'custom',
                  config.plugin,
                  config
                );
              }
            } catch (error) {
              console.error('Failed to register custom plugin:', error);
            }
          }
        }

        // Configure built-in plugins
        if (moduleOptions.plugins?.builtIn) {
          const { softDelete, timestamps, audit } = moduleOptions.plugins.builtIn;

          if (softDelete) {
            pluginManager.enablePlugin('soft-delete');
          }
          if (timestamps) {
            pluginManager.enablePlugin('timestamps');
          }
          if (audit) {
            pluginManager.enablePlugin('audit');
          }
        }

        // Initialize all plugins
        await pluginManager.initializeAll();

        return pluginManager;
      },
      inject: [DATABASE_MODULE_OPTIONS, DATABASE_MANAGER],
    }]);

    // Repository factory (async because DATABASE_MANAGER is async)
    providers.push([DATABASE_REPOSITORY_FACTORY, {
      useFactory: async (manager: DatabaseManager, moduleOptions: DatabaseModuleOptions, pluginManager: any) => {
        const factory = new RepositoryFactory(manager, moduleOptions.kysera?.repository, pluginManager);

        // Auto-register repositories
        const repositories = Reflect.getMetadata('database:repositories', global) || [];
        repositories.forEach(({ target, metadata }: any) => {
          factory.register(target, metadata);
        });

        return factory;
      },
      inject: [DATABASE_MANAGER, DATABASE_MODULE_OPTIONS, DATABASE_PLUGIN_MANAGER],
    }]);

    // Migration runner
    providers.push([DATABASE_MIGRATION_SERVICE, {
      useFactory: async (manager: DatabaseManager, moduleOptions: DatabaseModuleOptions) => {
        const runner = new MigrationRunner(manager, moduleOptions.migrations);

        // Auto-migrate if configured
        if (moduleOptions.autoMigrate) {
          await runner.init();
          const result = await runner.migrate();
          if (!result.success) {
            console.error('Auto-migration failed:', result.errors);
          }
        }

        return runner;
      },
      inject: [DATABASE_MANAGER, DATABASE_MODULE_OPTIONS],
    }]);

    // Transaction manager
    providers.push([DATABASE_TRANSACTION_MANAGER, {
      useFactory: (manager: DatabaseManager, moduleOptions: DatabaseModuleOptions) => new TransactionManager(manager, moduleOptions.transactionOptions),
      inject: [DATABASE_MANAGER, DATABASE_MODULE_OPTIONS],
    }]);

    // Transaction scope factory
    providers.push([DATABASE_TRANSACTION_SCOPE_FACTORY, {
      useFactory: (repositoryFactory: RepositoryFactory, manager: DatabaseManager, transactionManager: TransactionManager) => new TransactionScopeFactory(repositoryFactory, manager, transactionManager),
      inject: [DATABASE_REPOSITORY_FACTORY, DATABASE_MANAGER, DATABASE_TRANSACTION_MANAGER],
    }]);

    // Dynamic connection providers
    providers.push(['DATABASE_CONNECTION_PROVIDERS' as any, {
      useFactory: async (moduleOptions: DatabaseModuleOptions, manager: DatabaseManager) =>
        this.createDynamicConnectionProviders(moduleOptions, manager),
      inject: [DATABASE_MODULE_OPTIONS, DATABASE_MANAGER],
    }]);

    // Dynamic repository providers
    providers.push(['DATABASE_REPOSITORY_PROVIDERS' as any, {
      useFactory: async () => this.createRepositoryProviders(),
      inject: [],
    }]);

    const exports: any[] = [
      DATABASE_MANAGER,
      DatabaseService,
      DatabaseHealthIndicator,
      DATABASE_PLUGIN_MANAGER,
      DATABASE_REPOSITORY_FACTORY,
      DATABASE_MIGRATION_SERVICE,
      DATABASE_TRANSACTION_MANAGER,
      DATABASE_TRANSACTION_SCOPE_FACTORY,
    ];

    const result: DynamicModule = {
      module: TitanDatabaseModule,
      imports: options.imports as any || [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Register specific database entities/repositories
   */
  static forFeature(repositories: any[] = []): DynamicModule {
    const providers: Array<[string | symbol, ProviderDefinition<any>]> = [];

    for (const repository of repositories) {
      const metadata = getRepositoryMetadata(repository);
      if (metadata) {
        providers.push([
          getRepositoryToken(repository),
          {
            useFactory: async (factory: RepositoryFactory) => {
              // Register and return the repository
              factory.register(repository, metadata as any);
              return await factory.get(repository);
            },
            inject: [DATABASE_REPOSITORY_FACTORY],
          }
        ]);
      }
    }

    return {
      module: TitanDatabaseModule,
      providers,
      exports: providers.map(p => p[0]),
    };
  }

  /**
   * Create connection providers
   */
  private static createConnectionProviders(
    options: DatabaseModuleOptions
  ): Array<[string | symbol, ProviderDefinition<any>]> {
    const providers: Array<[string | symbol, ProviderDefinition<any>]> = [];

    // Create provider for default connection
    if (options.connection || (!options.connection && !options.connections)) {
      providers.push([
        getDatabaseConnectionToken(DATABASE_DEFAULT_CONNECTION),
        {
          useFactory: async (manager: DatabaseManager) =>
            manager.getConnection(DATABASE_DEFAULT_CONNECTION),
          inject: [DATABASE_MANAGER],
        }
      ]);
    }

    // Create providers for named connections
    if (options.connections) {
      for (const name of Object.keys(options.connections)) {
        providers.push([
          getDatabaseConnectionToken(name),
          {
            useFactory: async (manager: DatabaseManager) =>
              manager.getConnection(name),
            inject: [DATABASE_MANAGER],
          }
        ]);
      }
    }

    return providers;
  }

  /**
   * Create dynamic connection providers
   */
  private static createDynamicConnectionProviders(
    options: DatabaseModuleOptions,
    manager: DatabaseManager
  ): Array<[string | symbol, ProviderDefinition<any>]> {
    const providers: Array<[string | symbol, ProviderDefinition<any>]> = [];

    // Default connection
    if (options.connection || (!options.connection && !options.connections)) {
      providers.push([
        getDatabaseConnectionToken(DATABASE_DEFAULT_CONNECTION),
        {
          useFactory: () => manager.getConnection(DATABASE_DEFAULT_CONNECTION),
        }
      ]);
    }

    // Named connections
    if (options.connections) {
      for (const name of Object.keys(options.connections)) {
        providers.push([
          getDatabaseConnectionToken(name),
          {
            useFactory: () => manager.getConnection(name),
          }
        ]);
      }
    }

    return providers;
  }

  /**
   * Create async providers for module options
   */
  private static createAsyncProviders(
    options: DatabaseModuleAsyncOptions
  ): Array<[string | symbol, ProviderDefinition<any>] | Provider<any>> {
    const providers: Array<[string | symbol, ProviderDefinition<any>] | Provider<any>> = [];

    if (options.useFactory) {
      // Factory provider
      providers.push([DATABASE_MODULE_OPTIONS, {
        useFactory: async (...args: any[]) => Promise.resolve(options.useFactory!(...args)),
        inject: (options.inject || []) as any,
      }]);
    } else if (options.useExisting) {
      // Use existing provider
      providers.push([DATABASE_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: DatabaseOptionsFactory) =>
          optionsFactory.createDatabaseOptions(),
        inject: [options.useExisting],
      }]);
    } else if (options.useClass) {
      // Use class provider
      providers.push([options.useClass as any, {
        useClass: options.useClass,
      }]);

      providers.push([DATABASE_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: DatabaseOptionsFactory) =>
          optionsFactory.createDatabaseOptions(),
        inject: [options.useClass as any],
      }]);
    } else {
      // Default empty options
      providers.push([DATABASE_MODULE_OPTIONS, {
        useValue: {},
      }]);
    }

    return providers;
  }

  /**
   * Create repository providers from registered repositories
   */
  private static createRepositoryProviders(): Array<[string | symbol, ProviderDefinition<any>]> {
    const providers: Array<[string | symbol, ProviderDefinition<any>]> = [];

    // Get all registered repositories from global metadata
    const repositories = Reflect.getMetadata('database:repositories', global) || [];

    for (const { target, metadata } of repositories) {
      providers.push([
        getRepositoryToken(target),
        {
          useFactory: async (factory: RepositoryFactory) => await factory.get(target),
          inject: [DATABASE_REPOSITORY_FACTORY],
        }
      ]);
    }

    return providers;
  }

  /**
   * Register repositories for feature modules
   */
  static forFeature(repositories: any[] = []): DynamicModule {
    const providers: Array<[string | symbol, ProviderDefinition<any>]> = [];

    for (const RepositoryClass of repositories) {
      const token = getRepositoryToken(RepositoryClass);
      providers.push([
        token,
        {
          useFactory: async (factory: RepositoryFactory) => await factory.get(RepositoryClass),
          inject: [DATABASE_REPOSITORY_FACTORY],
          async: true,
        }
      ]);
    }

    return {
      module: TitanDatabaseModule,
      providers,
      exports: providers.map(p => p[0]),
    };
  }
}