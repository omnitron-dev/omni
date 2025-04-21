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

@Global()
@Module({})
export class RotifModule {
  static register(options: RotifModuleOptions): DynamicModule {
    return {
      module: RotifModule,
      imports: [DiscoveryModule],
      providers: [
        ...this.createRotifProviders(),
        { provide: ROTIF_MODULE_OPTIONS, useValue: options },
        ...this.createGlobalProviders(options),
      ],
      exports: [RotifService, RotifHealthService],
    };
  }

  static registerAsync(options: RotifModuleAsyncOptions): DynamicModule {
    return {
      module: RotifModule,
      imports: [DiscoveryModule, ...(options.imports || [])],
      providers: [
        ...this.createRotifProviders(),
        ...this.createAsyncProviders(options),
      ],
      exports: [RotifService, RotifHealthService],
    };
  }

  /**
   * Создание общих провайдеров для Rotif модуля.
   */
  private static createRotifProviders(): Provider[] {
    return [
      RotifService,
      RotifDiscoveryService,
      RotifHealthService,
      this.createRotifManagerProvider(),
    ];
  }

  /**
   * Создание провайдера NotificationManager с поддержкой middleware и deduplication.
   */
  private static createRotifManagerProvider(): Provider {
    return {
      provide: ROTIF_MANAGER,
      useFactory: (options: RotifModuleOptions) => {
        const manager = new NotificationManager(options);

        if (options.middleware) {
          options.middleware.forEach((mw) => manager.use(mw));
        }

        if (options.exactlyOnce) {
          manager['dedupStore'] =
            options.deduplication?.type === 'redis'
              ? new RedisDedupStore(manager.redis, options.deduplication.ttlSeconds)
              : new InMemoryDedupStore();
        }

        return manager;
      },
      inject: [ROTIF_MODULE_OPTIONS],
    };
  }

  /**
   * Создание глобальных провайдеров для ExceptionFilters и Interceptors.
   */
  private static createGlobalProviders(options: RotifModuleOptions): Provider[] {
    const filters = (options.globalExceptionFilters || []).map((filter) => ({
      provide: APP_FILTER,
      useClass: filter,
    }));

    const interceptors = (options.globalInterceptors || []).map((interceptor) => ({
      provide: APP_INTERCEPTOR,
      useClass: interceptor,
    }));

    return [...filters, ...interceptors];
  }

  /**
   * Создание провайдеров для асинхронной конфигурации.
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
        ...this.createOptionalGlobalProvidersAsync(),
      ];
    }

    const injectToken = options.useExisting || options.useClass;
    if (!injectToken) {
      throw new Error('Must provide useFactory, useClass, or useExisting');
    }

    const asyncProvider: Provider = {
      provide: ROTIF_MODULE_OPTIONS,
      useFactory: async (factory: RotifModuleOptionsFactory) =>
        factory.createRotifModuleOptions(),
      inject: [injectToken],
    };

    const providers: Provider[] = [asyncProvider];

    if (options.useClass) {
      providers.push({ provide: options.useClass, useClass: options.useClass });
    }

    return [...providers, ...this.createOptionalGlobalProvidersAsync()];
  }

  /**
   * Создание дополнительных (опциональных) провайдеров глобальных фильтров и интерсепторов для асинхронной конфигурации.
   */
  private static createOptionalGlobalProvidersAsync(): Provider[] {
    return [
      {
        provide: APP_FILTER,
        useFactory: (options: RotifModuleOptions) =>
          options.globalExceptionFilters?.map((filter) => new filter()) || [],
        inject: [ROTIF_MODULE_OPTIONS],
      },
      {
        provide: APP_INTERCEPTOR,
        useFactory: (options: RotifModuleOptions) =>
          options.globalInterceptors?.map((interceptor) => new interceptor()) || [],
        inject: [ROTIF_MODULE_OPTIONS],
      },
    ];
  }
}
