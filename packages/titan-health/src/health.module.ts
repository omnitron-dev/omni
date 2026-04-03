/**
 * Health Module
 *
 * Unified health check system for Titan framework.
 * Provides centralized health monitoring with built-in and custom indicators.
 * Uses Netron RPC for exposing health endpoints.
 *
 * @module titan/modules/health
 */

import type { DynamicModule, InjectionToken, ProviderDefinition, Provider } from '@omnitron-dev/titan/nexus';
import { Module } from '@omnitron-dev/titan/decorators';
import { HealthService } from './health.service.js';
import { HealthRpcService } from './health.rpc-service.js';
import { MemoryHealthIndicator } from './indicators/memory.indicator.js';
import { EventLoopHealthIndicator } from './indicators/event-loop.indicator.js';
import { DiskHealthIndicator } from './indicators/disk.indicator.js';
import { DatabaseHealthIndicator } from './indicators/database.indicator.js';
import { RedisHealthIndicator } from './indicators/redis.indicator.js';
import {
  HEALTH_SERVICE_TOKEN,
  HEALTH_MODULE_OPTIONS_TOKEN,
  HEALTH_RPC_SERVICE_TOKEN,
  MEMORY_HEALTH_INDICATOR_TOKEN,
  EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
  DISK_HEALTH_INDICATOR_TOKEN,
  DATABASE_HEALTH_INDICATOR_TOKEN,
  REDIS_HEALTH_INDICATOR_TOKEN,
} from './health.tokens.js';
import type { HealthModuleOptions, HealthModuleAsyncOptions, IHealthIndicator } from './health.types.js';

/**
 * Health Module
 *
 * Provides unified health check capabilities for the Titan framework.
 * Exposes health endpoints via Netron RPC protocol.
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
 * // With database and Redis indicators
 * @Module({
 *   imports: [
 *     TitanHealthModule.forRoot({
 *       enableDatabaseIndicator: true,
 *       databaseConnection: db,
 *       enableRedisIndicator: true,
 *       redisClient: redis,
 *       version: '1.0.0',
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Async configuration
 * @Module({
 *   imports: [
 *     TitanHealthModule.forRootAsync({
 *       inject: [ConfigService, DatabaseService, RedisService],
 *       useFactory: (config, db, redis) => ({
 *         enableMemoryIndicator: true,
 *         enableDatabaseIndicator: true,
 *         databaseConnection: db.connection,
 *         enableRedisIndicator: true,
 *         redisClient: redis.client,
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
 * // Client-side usage via Netron RPC
 * const health = await peer.queryInterface<HealthRpcService>('Health@1.0.0');
 * const result = await health.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 *
 * // Kubernetes probes
 * const live = await health.live();   // liveness
 * const ready = await health.ready(); // readiness
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

    // Memory indicator (enabled by default)
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

    // Event loop indicator (enabled by default)
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

    // Database indicator (disabled by default)
    if (options.enableDatabaseIndicator === true) {
      const databaseIndicator = new DatabaseHealthIndicator(options.databaseConnection, options.databaseOptions);
      healthService.registerIndicator(databaseIndicator);

      providers.push([
        DATABASE_HEALTH_INDICATOR_TOKEN,
        {
          useValue: databaseIndicator,
        },
      ]);
    }

    // Redis indicator (disabled by default)
    if (options.enableRedisIndicator === true) {
      const redisIndicator = new RedisHealthIndicator(options.redisClient, options.redisOptions);
      healthService.registerIndicator(redisIndicator);

      providers.push([
        REDIS_HEALTH_INDICATOR_TOKEN,
        {
          useValue: redisIndicator,
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

    // Health RPC service (Netron-native, enabled by default)
    if (options.enableRpcService !== false) {
      const healthRpcService = new HealthRpcService();
      healthRpcService.setHealthService(healthService);
      if (options.version) {
        healthRpcService.setVersion(options.version);
      }

      providers.push([
        HEALTH_RPC_SERVICE_TOKEN,
        {
          useValue: healthRpcService,
        },
      ]);

      providers.push([
        HealthRpcService,
        {
          useValue: healthRpcService,
        },
      ]);
    }

    // Build exports
    const exports: InjectionToken<any>[] = [HEALTH_SERVICE_TOKEN, HEALTH_MODULE_OPTIONS_TOKEN, HealthService];

    if (options.enableMemoryIndicator !== false) {
      exports.push(MEMORY_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableEventLoopIndicator !== false) {
      exports.push(EVENT_LOOP_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableDiskIndicator === true) {
      exports.push(DISK_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableDatabaseIndicator === true) {
      exports.push(DATABASE_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableRedisIndicator === true) {
      exports.push(REDIS_HEALTH_INDICATOR_TOKEN);
    }

    if (options.enableRpcService !== false) {
      exports.push(HEALTH_RPC_SERVICE_TOKEN);
      exports.push(HealthRpcService);
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
            healthService.registerIndicator(new MemoryHealthIndicator(moduleOptions.memoryThresholds));
          }

          if (moduleOptions.enableEventLoopIndicator !== false) {
            healthService.registerIndicator(new EventLoopHealthIndicator(moduleOptions.eventLoopThresholds));
          }

          if (moduleOptions.enableDiskIndicator === true) {
            healthService.registerIndicator(new DiskHealthIndicator(moduleOptions.diskThresholds));
          }

          if (moduleOptions.enableDatabaseIndicator === true) {
            healthService.registerIndicator(
              new DatabaseHealthIndicator(moduleOptions.databaseConnection, moduleOptions.databaseOptions)
            );
          }

          if (moduleOptions.enableRedisIndicator === true) {
            healthService.registerIndicator(
              new RedisHealthIndicator(moduleOptions.redisClient, moduleOptions.redisOptions)
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

    // Health RPC service provider
    providers.push([
      HEALTH_RPC_SERVICE_TOKEN,
      {
        useFactory: (healthService: HealthService, moduleOptions: HealthModuleOptions) => {
          const rpcService = new HealthRpcService();
          rpcService.setHealthService(healthService);
          if (moduleOptions.version) {
            rpcService.setVersion(moduleOptions.version);
          }
          return rpcService;
        },
        inject: [HEALTH_SERVICE_TOKEN, HEALTH_MODULE_OPTIONS_TOKEN],
      },
    ]);

    providers.push([
      HealthRpcService,
      {
        useFactory: (rpcService: HealthRpcService) => rpcService,
        inject: [HEALTH_RPC_SERVICE_TOKEN],
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

    providers.push([
      DATABASE_HEALTH_INDICATOR_TOKEN,
      {
        useFactory: (healthService: HealthService) => healthService.getIndicator('database'),
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    providers.push([
      REDIS_HEALTH_INDICATOR_TOKEN,
      {
        useFactory: (healthService: HealthService) => healthService.getIndicator('redis'),
        inject: [HEALTH_SERVICE_TOKEN],
      },
    ]);

    const exports: InjectionToken<any>[] = [
      HEALTH_SERVICE_TOKEN,
      HEALTH_MODULE_OPTIONS_TOKEN,
      HEALTH_RPC_SERVICE_TOKEN,
      HealthService,
      HealthRpcService,
      MEMORY_HEALTH_INDICATOR_TOKEN,
      EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
      DISK_HEALTH_INDICATOR_TOKEN,
      DATABASE_HEALTH_INDICATOR_TOKEN,
      REDIS_HEALTH_INDICATOR_TOKEN,
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
