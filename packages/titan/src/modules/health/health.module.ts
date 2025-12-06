/**
 * Health Module
 *
 * Unified health check system for Titan framework.
 * Provides centralized health monitoring with built-in and custom indicators.
 *
 * @module titan/modules/health
 */

import type { DynamicModule, InjectionToken, ProviderDefinition, Provider } from '../../nexus/index.js';
import { Module } from '../../decorators/index.js';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';
import { MemoryHealthIndicator } from './indicators/memory.indicator.js';
import { EventLoopHealthIndicator } from './indicators/event-loop.indicator.js';
import { DiskHealthIndicator } from './indicators/disk.indicator.js';
import {
  HEALTH_SERVICE_TOKEN,
  HEALTH_MODULE_OPTIONS_TOKEN,
  HEALTH_CONTROLLER_TOKEN,
  MEMORY_HEALTH_INDICATOR_TOKEN,
  EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
  DISK_HEALTH_INDICATOR_TOKEN,
} from './health.tokens.js';
import type { HealthModuleOptions, HealthModuleAsyncOptions, IHealthIndicator } from './health.types.js';

/**
 * Health Module
 *
 * Provides unified health check capabilities for the Titan framework.
 *
 * @example
 * ```typescript
 * // Basic usage with default indicators
 * @Module({
 *   imports: [
 *     TitanHealthModule.forRoot({
 *       enableMemoryIndicator: true,
 *       enableEventLoopIndicator: true,
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Async configuration
 * @Module({
 *   imports: [
 *     TitanHealthModule.forRootAsync({
 *       inject: [ConfigService],
 *       useFactory: (config) => ({
 *         enableMemoryIndicator: true,
 *         memoryThresholds: {
 *           heapDegradedThreshold: config.get('health.memory.degraded'),
 *           heapUnhealthyThreshold: config.get('health.memory.unhealthy'),
 *         },
 *       }),
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Using the health service
 * const healthService = container.resolve(HEALTH_SERVICE_TOKEN);
 * const result = await healthService.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 * ```
 */
@Module()
export class TitanHealthModule {
  name = 'TitanHealthModule';

  /**
   * Configure the Health module with synchronous options
   */
  static forRoot(options: HealthModuleOptions = {}): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Create the health service
    const healthService = new HealthService(options);

    // Options provider
    providers.push([
      HEALTH_MODULE_OPTIONS_TOKEN,
      {
        useValue: options,
      },
    ]);

    // Health service provider
    providers.push([
      HEALTH_SERVICE_TOKEN,
      {
        useValue: healthService,
      },
    ]);

    // Also register HealthService class for direct injection
    providers.push([
      HealthService,
      {
        useValue: healthService,
      },
    ]);

    // Memory indicator
    if (options.enableMemoryIndicator !== false) {
      const memoryIndicator = new MemoryHealthIndicator(options.memoryThresholds);
      healthService.registerIndicator(memoryIndicator);

      providers.push([
        MEMORY_HEALTH_INDICATOR_TOKEN,
        {
          useValue: memoryIndicator,
        },
      ]);
    }

    // Event loop indicator
    if (options.enableEventLoopIndicator !== false) {
      const eventLoopIndicator = new EventLoopHealthIndicator(options.eventLoopThresholds);
      healthService.registerIndicator(eventLoopIndicator);

      providers.push([
        EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
        {
          useValue: eventLoopIndicator,
        },
      ]);
    }

    // Disk indicator (disabled by default)
    if (options.enableDiskIndicator === true) {
      const diskIndicator = new DiskHealthIndicator(options.diskThresholds);
      healthService.registerIndicator(diskIndicator);

      providers.push([
        DISK_HEALTH_INDICATOR_TOKEN,
        {
          useValue: diskIndicator,
        },
      ]);
    }

    // Register custom indicators
    if (options.indicators) {
      for (const IndicatorClass of options.indicators) {
        const indicator = new IndicatorClass();
        healthService.registerIndicator(indicator);
      }
    }

    // Health controller (optional)
    if (options.enableHttpEndpoints !== false) {
      const healthController = new HealthController(healthService);

      providers.push([
        HEALTH_CONTROLLER_TOKEN,
        {
          useValue: healthController,
        },
      ]);

      providers.push([
        HealthController,
        {
          useValue: healthController,
        },
      ]);
    }

    // Build exports
    const exports: InjectionToken<any>[] = [
      HEALTH_SERVICE_TOKEN,
      HEALTH_MODULE_OPTIONS_TOKEN,
      HealthService,
    ];

    if (options.enableMemoryIndicator !== false) {
      exports.push(MEMORY_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableEventLoopIndicator !== false) {
      exports.push(EVENT_LOOP_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableDiskIndicator === true) {
      exports.push(DISK_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableHttpEndpoints !== false) {
      exports.push(HEALTH_CONTROLLER_TOKEN);
      exports.push(HealthController);
    }

    const result: DynamicModule = {
      module: TitanHealthModule,
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure the Health module with asynchronous options
   */
  static forRootAsync(options: HealthModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Async options provider
    if (options.useFactory) {
      providers.push([
        HEALTH_MODULE_OPTIONS_TOKEN,
        {
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ]);
    }

    // Health service provider (created from options)
    providers.push([
      HEALTH_SERVICE_TOKEN,
      {
        useFactory: async (moduleOptions: HealthModuleOptions) => {
          const healthService = new HealthService(moduleOptions);

          // Register built-in indicators based on options
          if (moduleOptions.enableMemoryIndicator !== false) {
            healthService.registerIndicator(
              new MemoryHealthIndicator(moduleOptions.memoryThresholds)
            );
          }

          if (moduleOptions.enableEventLoopIndicator !== false) {
            healthService.registerIndicator(
              new EventLoopHealthIndicator(moduleOptions.eventLoopThresholds)
            );
          }

          if (moduleOptions.enableDiskIndicator === true) {
            healthService.registerIndicator(
              new DiskHealthIndicator(moduleOptions.diskThresholds)
            );
          }

          // Register custom indicators
          if (moduleOptions.indicators) {
            for (const IndicatorClass of moduleOptions.indicators) {
              healthService.registerIndicator(new IndicatorClass());
            }
          }

          return healthService;
        },
        inject: [HEALTH_MODULE_OPTIONS_TOKEN],
      },
    ]);

    // HealthService class alias
    providers.push([
      HealthService,
      {
        useFactory: (healthService: HealthService) => healthService,
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    // Health controller provider
    providers.push([
      HEALTH_CONTROLLER_TOKEN,
      {
        useFactory: (healthService: HealthService) => new HealthController(healthService),
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    providers.push([
      HealthController,
      {
        useFactory: (controller: HealthController) => controller,
        inject: [HEALTH_CONTROLLER_TOKEN],
      },
    ]);

    // Built-in indicator tokens (resolved from health service)
    providers.push([
      MEMORY_HEALTH_INDICATOR_TOKEN,
      {
        useFactory: (healthService: HealthService) => healthService.getIndicator('memory'),
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    providers.push([
      EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
      {
        useFactory: (healthService: HealthService) => healthService.getIndicator('event-loop'),
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    providers.push([
      DISK_HEALTH_INDICATOR_TOKEN,
      {
        useFactory: (healthService: HealthService) => healthService.getIndicator('disk'),
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    const exports: InjectionToken<any>[] = [
      HEALTH_SERVICE_TOKEN,
      HEALTH_MODULE_OPTIONS_TOKEN,
      HEALTH_CONTROLLER_TOKEN,
      HealthService,
      HealthController,
      MEMORY_HEALTH_INDICATOR_TOKEN,
      EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
      DISK_HEALTH_INDICATOR_TOKEN,
    ];

    const result: DynamicModule = {
      module: TitanHealthModule,
      imports: options.imports || [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Create a feature module with additional custom indicators
   */
  static forFeature(indicators: Array<new (...args: any[]) => IHealthIndicator>): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>]> = [];

    // Provider to register indicators with the health service
    providers.push([
      'HEALTH_FEATURE_INIT' as any,
      {
        useFactory: (healthService: HealthService) => {
          for (const IndicatorClass of indicators) {
            const indicator = new IndicatorClass();
            if (!healthService.hasIndicator(indicator.name)) {
              healthService.registerIndicator(indicator);
            }
          }
          return true;
        },
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    return {
      module: TitanHealthModule,
      providers,
      exports: [],
    };
  }
}
