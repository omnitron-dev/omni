/**
 * Titan Metrics — DI Module
 *
 * Configurable module providing MetricsService via forRoot() pattern.
 *
 * @module titan-metrics
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { METRICS_SERVICE_TOKEN, METRICS_OPTIONS_TOKEN, METRICS_STORAGE_TOKEN } from './tokens.js';
import { MetricsService } from './metrics.service.js';
import { MemoryMetricsStorage } from './storage.js';
import type { IMetricsModuleOptions, IMetricsStorage } from './types.js';

@Module({})
export class TitanMetricsModule {
  /**
   * Configure the metrics module.
   *
   * Storage backend:
   *  - 'memory' (default) — in-process ring buffer, zero deps
   *  - 'postgres' — requires a Kysely instance registered separately;
   *    inject METRICS_STORAGE_TOKEN with a PostgresMetricsStorage manually.
   *
   * When using postgres, register METRICS_STORAGE_TOKEN as an external provider
   * so you can inject your app's Kysely instance.
   */
  static forRoot(options: IMetricsModuleOptions): any {
    const providers: Array<[unknown, Record<string, unknown>]> = [
      // Options
      [
        METRICS_OPTIONS_TOKEN,
        { useValue: options },
      ],
    ];

    // Storage — memory by default
    if (!options.storage || options.storage.type === 'memory') {
      providers.push([
        METRICS_STORAGE_TOKEN,
        {
          useFactory: (): IMetricsStorage => new MemoryMetricsStorage(),
          scope: 'singleton',
        },
      ]);
    }
    // For postgres, the consumer must provide METRICS_STORAGE_TOKEN themselves
    // with a PostgresMetricsStorage wired to their Kysely instance.

    // Main service
    providers.push([
      METRICS_SERVICE_TOKEN,
      {
        useFactory: (opts: IMetricsModuleOptions, storage: IMetricsStorage): MetricsService => {
          const svc = new MetricsService(opts, storage);
          svc.start();
          return svc;
        },
        inject: [METRICS_OPTIONS_TOKEN, METRICS_STORAGE_TOKEN],
        scope: 'singleton',
      },
    ]);

    return {
      module: TitanMetricsModule,
      global: options.isGlobal ?? false,
      providers: providers as any,
      exports: [METRICS_SERVICE_TOKEN, METRICS_OPTIONS_TOKEN, METRICS_STORAGE_TOKEN],
    };
  }

  /**
   * Configure the metrics module asynchronously.
   *
   * Useful when options depend on config service or other async providers.
   */
  static forRootAsync(factory: {
    useFactory: (...args: never[]) => Promise<IMetricsModuleOptions> | IMetricsModuleOptions;
    inject?: unknown[];
  }): any {
    const providers: Array<[unknown, Record<string, unknown>]> = [
      // Async options
      [
        METRICS_OPTIONS_TOKEN,
        {
          useFactory: factory.useFactory,
          inject: factory.inject ?? [],
        },
      ],

      // Memory storage (default — override with METRICS_STORAGE_TOKEN for pg)
      [
        METRICS_STORAGE_TOKEN,
        {
          useFactory: (): IMetricsStorage => new MemoryMetricsStorage(),
          scope: 'singleton',
        },
      ],

      // Main service
      [
        METRICS_SERVICE_TOKEN,
        {
          useFactory: (opts: IMetricsModuleOptions, storage: IMetricsStorage): MetricsService => {
            const svc = new MetricsService(opts, storage);
            svc.start();
            return svc;
          },
          inject: [METRICS_OPTIONS_TOKEN, METRICS_STORAGE_TOKEN],
          scope: 'singleton',
        },
      ],
    ];

    return {
      module: TitanMetricsModule,
      providers: providers as any,
      exports: [METRICS_SERVICE_TOKEN, METRICS_OPTIONS_TOKEN, METRICS_STORAGE_TOKEN],
    };
  }
}
