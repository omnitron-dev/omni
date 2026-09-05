/**
 * Scheduler Module
 *
 * Provides task scheduling capabilities
 */

import { type DynamicModule, Scope } from '@omnitron-dev/titan/nexus';
import { Module } from '@omnitron-dev/titan/decorators';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerRegistry } from './scheduler.registry.js';
import { SchedulerExecutor } from './scheduler.executor.js';
import { SchedulerDiscovery } from './scheduler.discovery.js';
import { SchedulerMetricsService } from './scheduler.metrics.js';
import { SchedulerPersistence } from './scheduler.persistence.js';
import {
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_SERVICE_TOKEN,
  SCHEDULER_METRICS_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN,
  DEFAULT_SCHEDULER_CONFIG,
  SCHEDULER_DISCOVERY_TOKEN,
  SCHEDULER_LISTENERS_TOKEN,
  SCHEDULER_LOCK_TOKEN,
  SCHEDULER_PERSISTENCE_TOKEN,
} from './scheduler.constants.js';

import type { ISchedulerModuleOptions, ISchedulerModuleAsyncOptions } from './scheduler.interfaces.js';

/**
 * Scheduler module
 */
@Module()
export class SchedulerModule {
  /**
   * Configure scheduler module with options
   */
  static forRoot(options: ISchedulerModuleOptions = {}): DynamicModule {
    const config = {
      ...DEFAULT_SCHEDULER_CONFIG,
      ...options,
    };

    return {
      module: SchedulerModule,
      providers: [
        // Config
        [SCHEDULER_CONFIG_TOKEN, { useValue: config }],
        // Core services — Singleton scope ensures shared instances across deps
        [SCHEDULER_REGISTRY_TOKEN, { useClass: SchedulerRegistry, scope: Scope.Singleton }],
        [SCHEDULER_EXECUTOR_TOKEN, { useClass: SchedulerExecutor, scope: Scope.Singleton }],
        // `persistenceProvider` / `metricsProvider` are declared in
        // ISchedulerModuleOptions as customisation points and were read by
        // nothing: the built-in classes were registered unconditionally, so a
        // caller who supplied their own token got the built-in one and their
        // jobs persisted somewhere other than where they configured. When a
        // token is given it is aliased here; otherwise the default stands, so
        // nothing changes for callers who pass neither.
        options.persistenceProvider
          ? [SCHEDULER_PERSISTENCE_TOKEN, { useExisting: options.persistenceProvider }]
          : [SCHEDULER_PERSISTENCE_TOKEN, { useClass: SchedulerPersistence, scope: Scope.Singleton }],
        options.metricsProvider
          ? [SCHEDULER_METRICS_TOKEN, { useExisting: options.metricsProvider }]
          : [SCHEDULER_METRICS_TOKEN, { useClass: SchedulerMetricsService, scope: Scope.Singleton }],
        [SCHEDULER_DISCOVERY_TOKEN, { useClass: SchedulerDiscovery, scope: Scope.Singleton }],
        [SCHEDULER_SERVICE_TOKEN, { useClass: SchedulerService, scope: Scope.Singleton }],
        // Export main service alias
        [SchedulerService, { useExisting: SCHEDULER_SERVICE_TOKEN }],
        // Listeners
        [SCHEDULER_LISTENERS_TOKEN, { useValue: options.listeners || [] }],
        // SC-1: distributed-lock provider (required iff distributed.enabled)
        [SCHEDULER_LOCK_TOKEN, { useValue: options.lockProvider }],
      ] as any,
      exports: [SchedulerService, SCHEDULER_SERVICE_TOKEN, SCHEDULER_REGISTRY_TOKEN, SCHEDULER_METRICS_TOKEN],
      global: true,
    };
  }

  /**
   * Configure scheduler module asynchronously
   */
  static forRootAsync(options: ISchedulerModuleAsyncOptions): DynamicModule {
    const providers: any[] = [];

    // Add config provider
    if (options.useFactory) {
      providers.push([
        SCHEDULER_CONFIG_TOKEN,
        {
          useFactory: async (...args: any[]) => {
            const config = await options.useFactory!(...args);
            return {
              ...DEFAULT_SCHEDULER_CONFIG,
              ...config,
            };
          },
          inject: options.inject || [],
        },
      ] as any);
    } else if (options.useExisting) {
      providers.push([SCHEDULER_CONFIG_TOKEN, { useExisting: options.useExisting }] as any);
    }

    // Add listeners provider
    providers.push([
      SCHEDULER_LISTENERS_TOKEN,
      {
        useFactory: (config: ISchedulerModuleOptions) => config.listeners || [],
        inject: [SCHEDULER_CONFIG_TOKEN],
      },
    ] as any);

    // SC-1: distributed-lock provider, read from the resolved config (a
    // useFactory can inject a lock service and return it on the config object).
    providers.push([
      SCHEDULER_LOCK_TOKEN,
      {
        useFactory: (config: ISchedulerModuleOptions) => config.lockProvider,
        inject: [SCHEDULER_CONFIG_TOKEN],
      },
    ] as any);

    // Add core services — Singleton scope ensures shared instances across deps
    providers.push(
      [SCHEDULER_REGISTRY_TOKEN, { useClass: SchedulerRegistry, scope: Scope.Singleton }] as any,
      [SCHEDULER_EXECUTOR_TOKEN, { useClass: SchedulerExecutor, scope: Scope.Singleton }] as any,
      (options.persistenceProvider
        ? [SCHEDULER_PERSISTENCE_TOKEN, { useExisting: options.persistenceProvider }]
        : [SCHEDULER_PERSISTENCE_TOKEN, { useClass: SchedulerPersistence, scope: Scope.Singleton }]) as any,
      (options.metricsProvider
        ? [SCHEDULER_METRICS_TOKEN, { useExisting: options.metricsProvider }]
        : [SCHEDULER_METRICS_TOKEN, { useClass: SchedulerMetricsService, scope: Scope.Singleton }]) as any,
      [SCHEDULER_DISCOVERY_TOKEN, { useClass: SchedulerDiscovery, scope: Scope.Singleton }] as any,
      [SCHEDULER_SERVICE_TOKEN, { useClass: SchedulerService, scope: Scope.Singleton }] as any,
      [SchedulerService, { useExisting: SCHEDULER_SERVICE_TOKEN }] as any
    );

    return {
      module: SchedulerModule,
      imports: options.imports || [],
      providers,
      exports: [SchedulerService, SCHEDULER_SERVICE_TOKEN, SCHEDULER_REGISTRY_TOKEN, SCHEDULER_METRICS_TOKEN],
      global: true,
    };
  }

  /**
   * Register scheduler module for a specific feature
   */
  static forFeature(providers: any[] = []): DynamicModule {
    return {
      module: SchedulerModule,
      providers,
      exports: providers,
    };
  }
}
