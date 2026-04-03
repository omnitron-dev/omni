/**
 * Database Module for Titan Framework
 *
 * Minimal DI wrapper around Kysera. Creates Kysely instances from config,
 * provides AsyncLocalStorage transaction context, and base repository class.
 *
 * ## Singleton Management
 *
 * Uses the DI container's built-in singleton scope. Each container gets its
 * own isolated DatabaseManager instance. Call `container.dispose()` to clean up.
 */

import {
  DynamicModule,
  Provider,
  ProviderDefinition,
  RegistrationOptions,
  ServiceIdentifier,
  IModule,
  Scope,
} from '@omnitron-dev/titan/nexus';
import { Module } from '@omnitron-dev/titan/decorators';
import { DatabaseManager } from './database.manager.js';
import { DatabaseHealthIndicator } from './database.health.js';
// Migrations delegated to @kysera/migrations — use kysera CLI or createMigrationRunner()
import { getRepositoryMetadata } from './database.decorators.js';
import type { RepositoryConstructor } from './database.internal-types.js';
import {
  DATABASE_HEALTH_INDICATOR,
  DATABASE_MANAGER,
  DATABASE_MODULE_OPTIONS,
  DATABASE_CONNECTION,
  getRepositoryToken,
  DATABASE_DEFAULT_CONNECTION,
} from './database.constants.js';
import type { DatabaseModuleOptions, DatabaseModuleAsyncOptions, DatabaseOptionsFactory } from './database.types.js';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';

const DATABASE_MODULE_LOGGER = Symbol.for('DATABASE_MODULE_LOGGER');

@Module()
export class TitanDatabaseModule {
  name = 'TitanDatabaseModule';

  /**
   * Lifecycle hook: close all database connections on app shutdown.
   * Without this, file-watcher restarts leak PG connections until
   * max_connections is exhausted ("too many clients already").
   */
  async onStop(app: any): Promise<void> {
    try {
      const container = app?.container;
      if (!container?.has?.(DATABASE_MANAGER)) return;
      const manager: DatabaseManager = container.resolve(DATABASE_MANAGER);
      await manager.closeAll();
    } catch {
      // Best-effort — process may already be tearing down
    }
  }

  static async resetForTesting(): Promise<void> {
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  static forRoot(options: DatabaseModuleOptions = {}): DynamicModule {
    return this.createModule(
      [DATABASE_MODULE_OPTIONS, { useValue: options }],
      options
    );
  }

  static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
    const optionsProviders = this.createAsyncProviders(options);
    return this.createModule(optionsProviders, options);
  }

  static forFeature(repositories: RepositoryConstructor[] = []): DynamicModule {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>, RegistrationOptions]> = [];

    for (const repository of repositories) {
      const metadata = getRepositoryMetadata(repository);
      if (!metadata) continue;

      const factoryFn = async (manager: DatabaseManager) => {
        const db = await manager.getConnection(metadata.connection);
        return new (repository as any)(db, metadata.table);
      };

      providers.push([
        repository,
        { useFactory: factoryFn, inject: [DATABASE_MANAGER], scope: Scope.Singleton },
        { override: true },
      ]);

      providers.push([
        getRepositoryToken(repository),
        { useFactory: factoryFn, inject: [DATABASE_MANAGER], scope: Scope.Singleton },
        { override: true },
      ]);
    }

    return {
      module: TitanDatabaseModule,
      providers,
      exports: providers.map((p) => p[0]),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: shared module builder
  // ---------------------------------------------------------------------------

  private static createModule(
    optionsProvider: [ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Provider<unknown>>,
    moduleOptions: DatabaseModuleOptions | DatabaseModuleAsyncOptions = {}
  ): DynamicModule {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [];

    // Options provider(s)
    if (Array.isArray(optionsProvider) && Array.isArray(optionsProvider[0])) {
      // Multiple providers from createAsyncProviders
      providers.push(...(optionsProvider as Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]>));
    } else {
      providers.push(optionsProvider as [ServiceIdentifier<unknown>, ProviderDefinition<unknown>]);
    }

    // Module logger
    providers.push([
      DATABASE_MODULE_LOGGER,
      {
        useFactory: (loggerModule: ILoggerModule) => loggerModule.create('TitanDatabaseModule'),
        inject: [LOGGER_SERVICE_TOKEN],
        scope: Scope.Singleton,
      },
    ]);

    // DatabaseManager — creates Kysely instances, manages pools
    providers.push([
      DATABASE_MANAGER,
      {
        useFactory: async (opts: DatabaseModuleOptions, loggerModule: ILoggerModule) => {
          const logger = loggerModule.create('Database');
          const manager = new DatabaseManager(opts, logger);
          await manager.init();
          return manager;
        },
        inject: [DATABASE_MODULE_OPTIONS, LOGGER_SERVICE_TOKEN],
        scope: Scope.Singleton,
      },
    ]);

    // Class alias for DatabaseManager
    providers.push([
      DatabaseManager,
      {
        useFactory: async (manager: DatabaseManager) => manager,
        inject: [DATABASE_MANAGER],
        scope: Scope.Singleton,
      },
    ]);

    // Default connection
    providers.push([
      DATABASE_CONNECTION,
      {
        useFactory: async (manager: DatabaseManager) => manager.getConnection(DATABASE_DEFAULT_CONNECTION),
        inject: [DATABASE_MANAGER],
        scope: Scope.Singleton,
      },
    ]);

    // Health indicator
    providers.push([
      DATABASE_HEALTH_INDICATOR,
      {
        useFactory: async (manager: DatabaseManager) => new DatabaseHealthIndicator(manager),
        inject: [DATABASE_MANAGER],
        scope: Scope.Singleton,
      },
    ]);

    providers.push([
      DatabaseHealthIndicator,
      {
        useFactory: async (indicator: DatabaseHealthIndicator) => indicator,
        inject: [DATABASE_HEALTH_INDICATOR],
        scope: Scope.Singleton,
      },
    ]);

    // Migrations handled externally via @kysera/migrations + kysera CLI
    // No auto-migrate in DI — use `createMigrationRunner()` or `kysera migrate up`

    const exports: Array<ServiceIdentifier<unknown>> = [
      DATABASE_MANAGER,
      DatabaseManager,
      DATABASE_CONNECTION,
      DATABASE_HEALTH_INDICATOR,
      DatabaseHealthIndicator,
      DATABASE_MODULE_OPTIONS,
    ];

    const result: DynamicModule = {
      module: TitanDatabaseModule,
      imports: ('imports' in moduleOptions ? (moduleOptions as DatabaseModuleAsyncOptions).imports as IModule[] : undefined) || [],
      providers,
      exports,
    };

    if ('isGlobal' in moduleOptions && moduleOptions.isGlobal) {
      result.global = true;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal: async options providers
  // ---------------------------------------------------------------------------

  private static createAsyncProviders(
    options: DatabaseModuleAsyncOptions
  ): Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> {
    const providers: Array<[ServiceIdentifier<unknown>, ProviderDefinition<unknown>]> = [];

    if (options.useFactory) {
      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useFactory: async (...args: unknown[]) => Promise.resolve(options.useFactory!(...args)),
          inject: options.inject || [],
          scope: Scope.Singleton,
        },
      ]);
    } else if (options.useExisting) {
      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useFactory: async (factory: DatabaseOptionsFactory) => factory.createDatabaseOptions(),
          inject: [options.useExisting],
          scope: Scope.Singleton,
        },
      ]);
    } else if (options.useClass) {
      providers.push([
        options.useClass,
        { useClass: options.useClass, scope: Scope.Singleton },
      ]);
      providers.push([
        DATABASE_MODULE_OPTIONS,
        {
          useFactory: async (factory: DatabaseOptionsFactory) => factory.createDatabaseOptions(),
          inject: [options.useClass],
          scope: Scope.Singleton,
        },
      ]);
    } else {
      providers.push([DATABASE_MODULE_OPTIONS, { useValue: {} }]);
    }

    return providers;
  }
}

// Backward-compatible alias
export { TitanDatabaseModule as DatabaseModule };
