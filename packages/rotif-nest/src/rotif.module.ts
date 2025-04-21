import { Module, Global, Provider, DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { RedisDedupStore, InMemoryDedupStore, NotificationManager } from '@devgrid/rotif';

import { RotifService } from './services/rotif.service';
import { ROTIF_MANAGER, ROTIF_MODULE_OPTIONS } from './constants';
import { RotifHealthService } from './services/rotif-health.service';
import { RotifDiscoveryService } from './services/rotif-discovery.service';
import { RotifModuleOptions } from './interfaces/rotif-module-options.interface';
import {
  RotifModuleAsyncOptions,
  RotifModuleOptionsFactory,
} from './interfaces/rotif-module-async-options.interface';

/**
 * Global NestJS module that provides integration with the Rotif notification system.
 * This module handles the initialization of the NotificationManager, registration of
 * message handlers, and setup of middleware, interceptors, and exception filters.
 * 
 * @example
 * // Static registration
 * ＠Module({
 *   imports: [
 *     RotifModule.register({
 *       redis: 'redis://localhost:6379',
 *       enableDelayed: true
 *     })
 *   ]
 * })
 * export class AppModule {}
 * 
 * @example
 * // Async registration with factory
 * ＠Module({
 *   imports: [
 *     RotifModule.registerAsync({
 *       useFactory: (config: ConfigService) => ({
 *         redis: config.get('REDIS_URL'),
 *         exactlyOnce: true
 *       }),
 *       inject: [ConfigService]
 *     })
 *   ]
 * })
 * export class AppModule {}
 */
@Global()
@Module({})
export class RotifModule {
  /**
   * Registers the RotifModule with static configuration options.
   * This method sets up the NotificationManager with the provided configuration
   * and registers all necessary providers, including global filters and interceptors.
   * 
   * @param options - Configuration options for the Rotif module
   * @returns A dynamic module configuration for NestJS
   */
  static register(options: RotifModuleOptions): DynamicModule {
    const providers = this.createProviders(options);

    const globalFiltersProviders = (options.globalExceptionFilters || []).map(filter => ({
      provide: APP_FILTER,
      useClass: filter,
    }));

    const globalInterceptorsProviders = (options.globalInterceptors || []).map(interceptor => ({
      provide: APP_INTERCEPTOR,
      useClass: interceptor,
    }));

    return {
      module: RotifModule,
      imports: [DiscoveryModule],
      providers: [
        ...providers,
        RotifDiscoveryService,
        RotifHealthService,
        ...globalFiltersProviders,
        ...globalInterceptorsProviders,
      ],
      exports: [RotifService, RotifHealthService],
    };
  }

  /**
   * Registers the RotifModule with asynchronous configuration options.
   * This method allows for dynamic configuration of the module, such as loading
   * configuration from environment variables or other async sources.
   * 
   * @param options - Async configuration options for the Rotif module
   * @returns A dynamic module configuration for NestJS
   * 
   * @throws Error if neither useFactory, useClass, nor useExisting is provided
   */
  static registerAsync(options: RotifModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);
    const rotifManagerProvider = this.createRotifManagerProvider();

    return {
      module: RotifModule,
      imports: [DiscoveryModule, ...(options.imports || [])],
      providers: [...asyncProviders, rotifManagerProvider, RotifService, RotifDiscoveryService, RotifHealthService],
      exports: [RotifService, RotifHealthService],
    };
  }

  /**
   * Creates providers for static module registration.
   * Sets up the NotificationManager and related providers with the given configuration.
   * 
   * @private
   * @param options - Configuration options for the Rotif module
   * @returns Array of providers for the module
   */
  private static createProviders(options: RotifModuleOptions): Provider[] {
    const rotifManagerProvider = {
      provide: ROTIF_MANAGER,
      useFactory: () => {
        const manager = new NotificationManager(options);
        if (options.middleware) {
          options.middleware.forEach(mw => manager.use(mw));
        }
        return manager;
      },
    };

    return [
      { provide: ROTIF_MODULE_OPTIONS, useValue: options },
      rotifManagerProvider,
      RotifService,
    ];
  }

  /**
   * Creates the NotificationManager provider with deduplication support.
   * This provider is responsible for creating and configuring the NotificationManager
   * instance with the appropriate deduplication store if enabled.
   * 
   * @private
   * @returns Provider configuration for NotificationManager
   */
  private static createRotifManagerProvider(): Provider {
    return {
      provide: ROTIF_MANAGER,
      useFactory: (options: RotifModuleOptions) => {
        const manager = new NotificationManager(options);

        if (options.middleware) {
          options.middleware.forEach(mw => manager.use(mw));
        }

        if (options.exactlyOnce) {
          let dedupStore;
          if (options.deduplication?.type === 'redis') {
            dedupStore = new RedisDedupStore(manager.redis, options.deduplication.ttlSeconds);
          } else {
            dedupStore = new InMemoryDedupStore();
          }
          (manager as any).dedupStore = dedupStore;
        }

        return manager;
      },
      inject: [ROTIF_MODULE_OPTIONS],
    };
  }

  /**
   * Creates providers for async module registration.
   * Handles different async configuration patterns (useFactory, useClass, useExisting).
   * 
   * @private
   * @param options - Async configuration options
   * @returns Array of providers for async configuration
   * @throws Error if no valid configuration pattern is provided
   */
  private static createAsyncProviders(
    options: RotifModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: ROTIF_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    const injectToken = options.useExisting || options.useClass;
    if (!injectToken) {
      throw new Error('Must provide useFactory, useClass, or useExisting');
    }

    const provider: Provider = {
      provide: ROTIF_MODULE_OPTIONS,
      useFactory: async (factory: RotifModuleOptionsFactory) =>
        factory.createRotifModuleOptions(),
      inject: [injectToken],
    };

    if (options.useClass) {
      return [provider, { provide: options.useClass, useClass: options.useClass }];
    }

    return [provider];
  }
}
