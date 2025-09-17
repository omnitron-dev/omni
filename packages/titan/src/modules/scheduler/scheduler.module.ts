/**
 * Scheduler Module
 *
 * Provides task scheduling capabilities
 */

import { Module, type DynamicModule } from '@omnitron-dev/nexus';

import { SchedulerService } from './scheduler.service';
import { SchedulerRegistry } from './scheduler.registry';
import { SchedulerExecutor } from './scheduler.executor';
import { SchedulerDiscovery } from './scheduler.discovery';
import { SchedulerMetricsService } from './scheduler.metrics';
import { SchedulerPersistence } from './scheduler.persistence';
import {
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_SERVICE_TOKEN,
  SCHEDULER_METRICS_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN,
  DEFAULT_SCHEDULER_CONFIG,
  SCHEDULER_DISCOVERY_TOKEN,
  SCHEDULER_LISTENERS_TOKEN,
  SCHEDULER_PERSISTENCE_TOKEN
} from './scheduler.constants';

import type {
  SchedulerModuleOptions,
  SchedulerModuleAsyncOptions
} from './scheduler.interfaces';

/**
 * Scheduler module
 */
@Module({})
export class SchedulerModule {
  /**
   * Configure scheduler module with options
   */
  static forRoot(options: SchedulerModuleOptions = {}): DynamicModule {
    const config = {
      ...DEFAULT_SCHEDULER_CONFIG,
      ...options
    };

    return {
      module: SchedulerModule,
      providers: [
        // Config
        [SCHEDULER_CONFIG_TOKEN, {
          useValue: config
        }] as any,
        // Core services
        [SCHEDULER_REGISTRY_TOKEN, {
          useClass: SchedulerRegistry
        }] as any,
        [SCHEDULER_EXECUTOR_TOKEN, {
          useClass: SchedulerExecutor
        }] as any,
        [SCHEDULER_PERSISTENCE_TOKEN, {
          useClass: SchedulerPersistence
        }] as any,
        [SCHEDULER_METRICS_TOKEN, {
          useClass: SchedulerMetricsService
        }] as any,
        [SCHEDULER_DISCOVERY_TOKEN, {
          useClass: SchedulerDiscovery
        }] as any,
        [SCHEDULER_SERVICE_TOKEN, {
          useClass: SchedulerService
        }] as any,
        // Listeners
        [SCHEDULER_LISTENERS_TOKEN, {
          useValue: options.listeners || []
        }] as any,
        // Export main service
        SchedulerService
      ],
      exports: [
        SchedulerService,
        SCHEDULER_SERVICE_TOKEN,
        SCHEDULER_REGISTRY_TOKEN,
        SCHEDULER_METRICS_TOKEN
      ],
      global: true
    };
  }

  /**
   * Configure scheduler module asynchronously
   */
  static forRootAsync(options: SchedulerModuleAsyncOptions): DynamicModule {
    const providers = [];

    // Add config provider
    if (options.useFactory) {
      providers.push([SCHEDULER_CONFIG_TOKEN, {
        useFactory: async (...args: any[]) => {
          const config = await options.useFactory!(...args);
          return {
            ...DEFAULT_SCHEDULER_CONFIG,
            ...config
          };
        },
        inject: options.inject || []
      }] as any);
    } else if (options.useExisting) {
      providers.push([SCHEDULER_CONFIG_TOKEN, {
        useExisting: options.useExisting
      }] as any);
    }

    // Add listeners provider
    providers.push([SCHEDULER_LISTENERS_TOKEN, {
      useFactory: (config: SchedulerModuleOptions) => config.listeners || [],
      inject: [SCHEDULER_CONFIG_TOKEN]
    }] as any);

    // Add core services
    providers.push(
      [SCHEDULER_REGISTRY_TOKEN, {
        useClass: SchedulerRegistry
      }] as any,
      [SCHEDULER_EXECUTOR_TOKEN, {
        useClass: SchedulerExecutor
      }] as any,
      [SCHEDULER_PERSISTENCE_TOKEN, {
        useClass: SchedulerPersistence
      }] as any,
      [SCHEDULER_METRICS_TOKEN, {
        useClass: SchedulerMetricsService
      }] as any,
      [SCHEDULER_DISCOVERY_TOKEN, {
        useClass: SchedulerDiscovery
      }] as any,
      [SCHEDULER_SERVICE_TOKEN, {
        useClass: SchedulerService
      }] as any,
      SchedulerService
    );

    return {
      module: SchedulerModule,
      imports: options.imports || [],
      providers,
      exports: [
        SchedulerService,
        SCHEDULER_SERVICE_TOKEN,
        SCHEDULER_REGISTRY_TOKEN,
        SCHEDULER_METRICS_TOKEN
      ],
      global: true
    };
  }

  /**
   * Register scheduler module for a specific feature
   */
  static forFeature(providers: any[] = []): DynamicModule {
    return {
      module: SchedulerModule,
      providers,
      exports: providers
    };
  }
}