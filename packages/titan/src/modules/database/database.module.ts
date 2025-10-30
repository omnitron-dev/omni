/**
 * Database Module for Titan Framework
 *
 * Provides database integration with Kysera ORM
 */

import { DynamicModule, Provider, ProviderDefinition, RegistrationOptions, Constructor, ServiceIdentifier, IModule } from '../../nexus/index.js';
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
import type { RepositoryConstructor } from './database.internal-types.js';
import type { RepositoryMetadata } from './repository/repository.types.js';
import {
  DATABASE_SERVICE,
  DATABASE_HEALTH_INDICATOR,
  DATABASE_MANAGER,
  DATABASE_MODULE_OPTIONS,
  DATABASE_REPOSITORY_FACTORY,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_MIGRATION_RUNNER,
  DATABASE_MIGRATION_LOCK,
  DATABASE_TRANSACTION_MANAGER,
  DATABASE_TRANSACTION_SCOPE_FACTORY,
  DATABASE_PLUGIN_MANAGER,
  getDatabaseConnectionToken,
  getRepositoryToken,
  DATABASE_DEFAULT_CONNECTION,
} from './database.constants.js';
import type { DatabaseModuleOptions, DatabaseModuleAsyncOptions, DatabaseOptionsFactory } from './database.types.js';
import { createDefaultLogger } from './utils/logger.factory.js';

@Module()
export class TitanDatabaseModule {
  name = 'TitanDatabaseModule';
  private static logger = createDefaultLogger('TitanDatabaseModule');
  private static managerInstance: DatabaseManager | null = null;

  /**
   * Reset module (for testing)
   */
  static resetForTesting(): void {
    TitanDatabaseModule.managerInstance = null;
  }

  /**
   * Configure database module with static options
   */
  static forRoot(options: DatabaseModuleOptions = {}): DynamicModule {
    // Create providers using correct Nexus format
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      // Module options
      [
        DATABASE_MODULE_OPTIONS,
        {
          useValue: options,
        },
      ],

      // Database manager with initialization
      [
        DATABASE_MANAGER,
        {
          useFactory: async (moduleOptions: DatabaseModuleOptions) => {
            // Use a static instance to ensure singleton behavior even if factory is called multiple times
            if (!TitanDatabaseModule.managerInstance) {
              TitanDatabaseModule.managerInstance = new DatabaseManager(moduleOptions);
              await TitanDatabaseModule.managerInstance.init();
            }
            return TitanDatabaseModule.managerInstance;
          },
          inject: [DATABASE_MODULE_OPTIONS],
        },
      ],

      // Alias registration for DatabaseManager class (allows resolving by class)
      [
        DatabaseManager,
        {
          useFactory: async (manager: DatabaseManager) => manager,
          inject: [DATABASE_MANAGER],
        },
      ],

      // Database service
      [
        DATABASE_SERVICE,
        {
          useFactory: async (manager: DatabaseManager) => new DatabaseService(manager),
          inject: [DATABASE_MANAGER],
        },
      ],

      // Alias registration for DatabaseService class
      [
        DatabaseService,
        {
          useFactory: async (service: DatabaseService) => service,
          inject: [DATABASE_SERVICE],
        },
      ],

      // Health indicator
      [
        DATABASE_HEALTH_INDICATOR,
        {
          useFactory: async (manager: DatabaseManager) => new DatabaseHealthIndicator(manager),
          inject: [DATABASE_MANAGER],
        },
      ],

      // Alias registration for DatabaseHealthIndicator class
      [
        DatabaseHealthIndicator,
        {
          useFactory: async (indicator: DatabaseHealthIndicator) => indicator,
          inject: [DATABASE_HEALTH_INDICATOR],
        },
      ],

      // Plugin manager
      [
        DATABASE_PLUGIN_MANAGER,
        {
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
                    pluginManager.registerPlugin(config.name || plugin.name, plugin, config);
                  } else {
                    // Direct plugin instance
                    pluginManager.registerPlugin(config.name || config.plugin.name || 'custom', config.plugin, config);
                  }
                } catch (error) {
                  TitanDatabaseModule.logger.error('Failed to register custom plugin:', error);
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
        },
      ],

      // Repository factory (async because DATABASE_MANAGER is async)
      [
        DATABASE_REPOSITORY_FACTORY,
        {
          useFactory: async (manager: DatabaseManager, pluginManager: PluginManager) => {
            const factory = new RepositoryFactory(manager, options.kysera?.repository, pluginManager);

            // Auto-register repositories from metadata if any
            const repositories = (Reflect.getMetadata('database:repositories', global) || []) as Array<{
              target: RepositoryConstructor;
              metadata: RepositoryMetadata;
            }>;
            repositories.forEach(({ target, metadata }) => {
              factory.register(target, metadata);
            });

            return factory;
          },
          inject: [DATABASE_MANAGER, DATABASE_PLUGIN_MANAGER],
        },
      ],

      // Migration runner
      [
        DATABASE_MIGRATION_SERVICE,
        {
          useFactory: async (manager: DatabaseManager) => {
            const runner = new MigrationRunner(manager, options.migrations);

            // Auto-migrate if configured
            if (options.autoMigrate) {
              try {
                await runner.init();
                const result = await runner.migrate();
                if (!result.success) {
                  TitanDatabaseModule.logger.error('Auto-migration failed:', result.errors);
                  // Don't throw error during initialization - just log it
                  // Applications can check migration status via health endpoint
                } else {
                  TitanDatabaseModule.logger.info('Auto-migration completed successfully');
                }
              } catch (error) {
                TitanDatabaseModule.logger.error('Auto-migration error:', error);
                // Don't throw - let the application start but log the issue
              }
            }

            return runner;
          },
          inject: [DATABASE_MANAGER],
        },
      ],

      // Transaction manager
      [
        DATABASE_TRANSACTION_MANAGER,
        {
          useFactory: (manager: DatabaseManager) => new TransactionManager(manager, options.transactionOptions),
          inject: [DATABASE_MANAGER],
        },
      ],

      // Transaction scope factory
      [
        DATABASE_TRANSACTION_SCOPE_FACTORY,
        {
          useFactory: (
            repositoryFactory: RepositoryFactory,
            manager: DatabaseManager,
            transactionManager: TransactionManager
          ) => new TransactionScopeFactory(repositoryFactory, manager, transactionManager),
          inject: [DATABASE_REPOSITORY_FACTORY, DATABASE_MANAGER, DATABASE_TRANSACTION_MANAGER],
        },
      ],

      // Migration runner (alias for migration service)
      [
        DATABASE_MIGRATION_RUNNER,
        {
          useFactory: (service: MigrationRunner) => service,
          inject: [DATABASE_MIGRATION_SERVICE],
        },
      ],

      // Migration lock (alias for migration service lock capability)
      [
        DATABASE_MIGRATION_LOCK,
        {
          useFactory: (service: MigrationRunner) => service,
          inject: [DATABASE_MIGRATION_SERVICE],
        },
      ],
    ];

    // Create connection providers
    const connectionProviders = this.createConnectionProviders(options);
    providers.push(...connectionProviders);

    // Create repository providers if any repositories are registered
    const repositoryProviders = this.createRepositoryProviders();
    providers.push(...repositoryProviders);

    // Exports
    const exports: Array<ServiceIdentifier<unknown>> = [
      DATABASE_SERVICE,
      DATABASE_HEALTH_INDICATOR,
      DATABASE_MANAGER,
      DATABASE_PLUGIN_MANAGER,
      DATABASE_REPOSITORY_FACTORY,
      DATABASE_MIGRATION_SERVICE,
      DATABASE_MIGRATION_RUNNER,
      DATABASE_MIGRATION_LOCK,
      DATABASE_TRANSACTION_MANAGER,
      DATABASE_TRANSACTION_SCOPE_FACTORY,
      // Also export class constructors as aliases
      DatabaseManager,
      DatabaseService,
      DatabaseHealthIndicator,
      ...connectionProviders.map((p) => (Array.isArray(p) ? p[0] : getDatabaseConnectionToken())),
      ...repositoryProviders.map((p) => (Array.isArray(p) ? p[0] : p)),
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
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [];

    // Create async options provider
    const asyncProviders = this.createAsyncProviders(options);
    providers.push(...asyncProviders);

    // Database manager provider
    providers.push([
      DATABASE_MANAGER,
      {
        useFactory: async (moduleOptions: DatabaseModuleOptions) => {
          const manager = new DatabaseManager(moduleOptions);
          await manager.init();

          return manager;
        },
        inject: [DATABASE_MODULE_OPTIONS],
      },
    ]);

    // Service providers
    providers.push(DatabaseService);
    providers.push(DatabaseHealthIndicator);

    // Plugin manager
    providers.push([
      DATABASE_PLUGIN_MANAGER,
      {
        useFactory: async (moduleOptions: DatabaseModuleOptions, manager: DatabaseManager) => {
          const pluginManager = new PluginManager(moduleOptions, manager);

          // Load and register custom plugins
          if (moduleOptions.plugins?.custom) {
            for (const config of moduleOptions.plugins.custom) {
              try {
                if (typeof config.plugin === 'string') {
                  const loader = new PluginLoader();
                  const plugin = await loader.loadPlugin(config.plugin);
                  pluginManager.registerPlugin(config.name || plugin.name, plugin, config);
                } else {
                  pluginManager.registerPlugin(config.name || config.plugin.name || 'custom', config.plugin, config);
                }
              } catch (error) {
                TitanDatabaseModule.logger.error('Failed to register custom plugin:', error);
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
      },
    ]);

    // Repository factory (async because DATABASE_MANAGER is async)
    providers.push([
      DATABASE_REPOSITORY_FACTORY,
      {
        useFactory: async (manager: DatabaseManager, moduleOptions: DatabaseModuleOptions, pluginManager: PluginManager) => {
          const factory = new RepositoryFactory(manager, moduleOptions.kysera?.repository, pluginManager);

          // Auto-register repositories
          const repositories = (Reflect.getMetadata('database:repositories', global) || []) as Array<{
            target: RepositoryConstructor;
            metadata: RepositoryMetadata;
          }>;
          repositories.forEach(({ target, metadata }) => {
            factory.register(target, metadata);
          });

          return factory;
        },
        inject: [DATABASE_MANAGER, DATABASE_MODULE_OPTIONS, DATABASE_PLUGIN_MANAGER],
      },
    ]);

    // Migration runner
    providers.push([
      DATABASE_MIGRATION_SERVICE,
      {
        useFactory: async (manager: DatabaseManager, moduleOptions: DatabaseModuleOptions) => {
          const runner = new MigrationRunner(manager, moduleOptions.migrations);

          // Auto-migrate if configured
          if (moduleOptions.autoMigrate) {
            try {
              await runner.init();
              const result = await runner.migrate();
              if (!result.success) {
                TitanDatabaseModule.logger.error('Auto-migration failed:', result.errors);
                // Don't throw error during initialization - just log it
                // Applications can check migration status via health endpoint
              } else {
                TitanDatabaseModule.logger.info('Auto-migration completed successfully');
              }
            } catch (error) {
              TitanDatabaseModule.logger.error('Auto-migration error:', error);
              // Don't throw - let the application start but log the issue
            }
          }

          return runner;
        },
        inject: [DATABASE_MANAGER, DATABASE_MODULE_OPTIONS],
      },
    ]);

    // Transaction manager
    providers.push([
      DATABASE_TRANSACTION_MANAGER,
      {
        useFactory: (manager: DatabaseManager, moduleOptions: DatabaseModuleOptions) =>
          new TransactionManager(manager, moduleOptions.transactionOptions),
        inject: [DATABASE_MANAGER, DATABASE_MODULE_OPTIONS],
      },
    ]);

    // Transaction scope factory
    providers.push([
      DATABASE_TRANSACTION_SCOPE_FACTORY,
      {
        useFactory: (
          repositoryFactory: RepositoryFactory,
          manager: DatabaseManager,
          transactionManager: TransactionManager
        ) => new TransactionScopeFactory(repositoryFactory, manager, transactionManager),
        inject: [DATABASE_REPOSITORY_FACTORY, DATABASE_MANAGER, DATABASE_TRANSACTION_MANAGER],
      },
    ]);

    // Migration runner (alias for migration service)
    providers.push([
      DATABASE_MIGRATION_RUNNER,
      {
        useFactory: (service: MigrationRunner) => service,
        inject: [DATABASE_MIGRATION_SERVICE],
      },
    ]);

    // Migration lock (alias for migration service lock capability)
    providers.push([
      DATABASE_MIGRATION_LOCK,
      {
        useFactory: (service: MigrationRunner) => service,
        inject: [DATABASE_MIGRATION_SERVICE],
      },
    ]);

    // Dynamic connection providers
    providers.push([
      Symbol.for('DATABASE_CONNECTION_PROVIDERS'),
      {
        useFactory: async (moduleOptions: DatabaseModuleOptions, manager: DatabaseManager) =>
          this.createDynamicConnectionProviders(moduleOptions, manager),
        inject: [DATABASE_MODULE_OPTIONS, DATABASE_MANAGER],
      },
    ]);

    // Dynamic repository providers
    providers.push([
      Symbol.for('DATABASE_REPOSITORY_PROVIDERS'),
      {
        useFactory: async () => this.createRepositoryProviders(),
        inject: [],
      },
    ]);

    const exports: Array<ServiceIdentifier<unknown>> = [
      DATABASE_MANAGER,
      DatabaseService,
      DatabaseHealthIndicator,
      DATABASE_PLUGIN_MANAGER,
      DATABASE_REPOSITORY_FACTORY,
      DATABASE_MIGRATION_SERVICE,
      DATABASE_MIGRATION_RUNNER,
      DATABASE_MIGRATION_LOCK,
      DATABASE_TRANSACTION_MANAGER,
      DATABASE_TRANSACTION_SCOPE_FACTORY,
    ];

    const result: DynamicModule = {
      module: TitanDatabaseModule,
      imports: (options.imports as IModule[]) || [],
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
  static forFeature(repositories: RepositoryConstructor[] = []): DynamicModule {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>, RegistrationOptions]> = [];

    for (const repository of repositories) {
      const metadata = getRepositoryMetadata(repository);
      if (metadata) {
        // Create shared factory function that ensures repository is registered
        // This is idempotent - calling register() multiple times is safe
        const factoryFn = async (factory: RepositoryFactory) => {
          // Register if not already registered (idempotent operation)
          if (!factory.getMetadata(repository)) {
            // Convert RepositoryConfig to RepositoryMetadata by adding target field
            const repositoryMetadata: RepositoryMetadata = {
              ...metadata,
              target: repository as new (...args: unknown[]) => unknown,
            };
            factory.register(repository as new (...args: unknown[]) => unknown, repositoryMetadata);
          }
          return await factory.get(repository);
        };

        // Register with class constructor token (for direct injection by class)
        providers.push([
          repository,
          {
            useFactory: factoryFn,
            inject: [DATABASE_REPOSITORY_FACTORY],
          },
          { override: true }, // Registration options as third element
        ]);

        // Also register with string token (for @InjectRepository decorator)
        providers.push([
          getRepositoryToken(repository),
          {
            useFactory: factoryFn,
            inject: [DATABASE_REPOSITORY_FACTORY],
          },
          { override: true }, // Registration options as third element
        ]);
      }
    }

    return {
      module: TitanDatabaseModule,
      providers,
      exports: providers.map((p) => p[0]),
    };
  }

  /**
   * Create connection providers
   */
  private static createConnectionProviders(
    options: DatabaseModuleOptions
  ): Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> = [];

    // Create provider for default connection
    if (options.connection || (!options.connection && !options.connections)) {
      providers.push([
        getDatabaseConnectionToken(DATABASE_DEFAULT_CONNECTION),
        {
          useFactory: async (manager: DatabaseManager) => manager.getConnection(DATABASE_DEFAULT_CONNECTION),
          inject: [DATABASE_MANAGER],
        },
      ]);
    }

    // Create providers for named connections
    if (options.connections) {
      for (const name of Object.keys(options.connections)) {
        providers.push([
          getDatabaseConnectionToken(name),
          {
            useFactory: async (manager: DatabaseManager) => manager.getConnection(name),
            inject: [DATABASE_MANAGER],
          },
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
  ): Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> = [];

    // Default connection
    if (options.connection || (!options.connection && !options.connections)) {
      providers.push([
        getDatabaseConnectionToken(DATABASE_DEFAULT_CONNECTION),
        {
          useFactory: () => manager.getConnection(DATABASE_DEFAULT_CONNECTION),
        },
      ]);
    }

    // Named connections
    if (options.connections) {
      for (const name of Object.keys(options.connections)) {
        providers.push([
          getDatabaseConnectionToken(name),
          {
            useFactory: () => manager.getConnection(name),
          },
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
  ): Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [];

    if (options.useFactory) {
      // Factory provider
      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useFactory: async (...args: unknown[]) => Promise.resolve(options.useFactory!(...args)),
          inject: options.inject || [],
        },
      ]);
    } else if (options.useExisting) {
      // Use existing provider
      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useFactory: async (optionsFactory: DatabaseOptionsFactory) => optionsFactory.createDatabaseOptions(),
          inject: [options.useExisting],
        },
      ]);
    } else if (options.useClass) {
      // Use class provider
      providers.push([
        options.useClass,
        {
          useClass: options.useClass,
        },
      ]);

      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useFactory: async (optionsFactory: DatabaseOptionsFactory) => optionsFactory.createDatabaseOptions(),
          inject: [options.useClass],
        },
      ]);
    } else {
      // Default empty options
      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useValue: {},
        },
      ]);
    }

    return providers;
  }

  /**
   * Create repository providers from registered repositories
   */
  private static createRepositoryProviders(): Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> = [];

    // Get all registered repositories from global metadata
    const repositories = (Reflect.getMetadata('database:repositories', global) || []) as Array<{
      target: RepositoryConstructor;
      metadata: RepositoryMetadata;
    }>;

    for (const { target } of repositories) {
      providers.push([
        getRepositoryToken(target),
        {
          useFactory: async (factory: RepositoryFactory) => await factory.get(target),
          inject: [DATABASE_REPOSITORY_FACTORY],
        },
      ]);
    }

    return providers;
  }
}
