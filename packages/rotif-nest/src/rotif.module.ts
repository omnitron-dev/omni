import { NotificationManager } from '@devgrid/rotif';
import { Module, Global, Provider, DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule, MetadataScanner } from '@nestjs/core';

import { RotifService } from './services/rotif.service';
import { ROTIF_MANAGER, ROTIF_MODULE_OPTIONS } from './constants';
import { RotifDiscoveryService } from './services/rotif-discovery.service';
import { RotifModuleOptions } from './interfaces/rotif-module-options.interface';
import {
  RotifModuleAsyncOptions,
  RotifModuleOptionsFactory,
} from './interfaces/rotif-module-async-options.interface';

/**
 * RotifModule integrates Rotif notifications with NestJS applications.
 * Supports dynamic and static configuration, automatic message handler discovery,
 * global interceptors, middleware, and exception filters.
 */
@Global()
@Module({})
export class RotifModule {
  /**
   * Registers RotifModule synchronously with provided configuration options.
   */
  static register(options: RotifModuleOptions): DynamicModule {
    return {
      module: RotifModule,
      imports: [DiscoveryModule],
      providers: [
        { provide: ROTIF_MODULE_OPTIONS, useValue: options },
        MetadataScanner,
        ...this.createCoreProviders(),
        ...this.createGlobalProviders(options),
      ],
      exports: [RotifService],
    };
  }

  /**
   * Registers RotifModule asynchronously.
   */
  static registerAsync(options: RotifModuleAsyncOptions): DynamicModule {
    return {
      module: RotifModule,
      imports: [DiscoveryModule, ...(options.imports || [])],
      providers: [
        MetadataScanner,
        ...this.createAsyncProviders(options),
        ...this.createCoreProviders(),
      ],
      exports: [RotifService],
    };
  }

  /**
   * Creates core providers necessary for RotifModule.
   */
  private static createCoreProviders(): Provider[] {
    return [
      RotifService,
      RotifDiscoveryService,
      this.createRotifManagerProvider(),
    ];
  }

  /**
   * Creates provider for NotificationManager including middleware and deduplication.
   */
  private static createRotifManagerProvider(): Provider {
    return {
      provide: ROTIF_MANAGER,
      useFactory: (options: RotifModuleOptions) => {
        const manager = new NotificationManager(options);

        if (options.middleware) {
          options.middleware.forEach((mw) => manager.use(mw));
        }

        return manager;
      },
      inject: [ROTIF_MODULE_OPTIONS],
    };
  }

  /**
   * Creates global NestJS providers for ExceptionFilters and Interceptors.
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
   * Creates asynchronous providers to load module configuration dynamically.
   */
  private static createAsyncProviders(options: RotifModuleAsyncOptions): Provider[] {
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

    const asyncProviders: Provider[] = [
      {
        provide: ROTIF_MODULE_OPTIONS,
        useFactory: async (factory: RotifModuleOptionsFactory) =>
          factory.createRotifModuleOptions(),
        inject: [injectToken],
      },
    ];

    if (options.useClass) {
      asyncProviders.push({
        provide: injectToken,
        useClass: injectToken,
      });
    }

    return asyncProviders;
  }
}
