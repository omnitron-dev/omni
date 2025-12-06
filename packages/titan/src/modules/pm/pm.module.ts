/**
 * Process Manager Module
 *
 * Provides process management capabilities with Netron integration,
 * treating every process as a service with full type safety.
 */

import { createToken, type DynamicModule, type Token } from '../../nexus/index.js';
import { Module } from '../../decorators/index.js';
import { ProcessManager } from './process-manager.js';
import { ProcessRegistry } from './process-registry.js';
import { ProcessSpawnerFactory } from './process-spawner.js';
import { ProcessMetricsCollector } from './process-metrics.js';
import { ProcessHealthChecker } from './process-health.js';
import { LOGGER_SERVICE_TOKEN } from '../logger/logger.tokens.js';

import type { IProcessManagerConfig } from './types.js';

/**
 * Process Manager module tokens
 * Using createToken for consistency with other Titan modules
 */
export const PM_CONFIG_TOKEN: Token<IProcessManagerConfig> = createToken<IProcessManagerConfig>('PMConfig');
export const PM_MANAGER_TOKEN: Token<ProcessManager> = createToken<ProcessManager>('PMManager');
export const PM_REGISTRY_TOKEN: Token<ProcessRegistry> = createToken<ProcessRegistry>('PMRegistry');
export const PM_SPAWNER_TOKEN: Token<ProcessSpawnerFactory> = createToken<ProcessSpawnerFactory>('PMSpawner');
export const PM_METRICS_TOKEN: Token<ProcessMetricsCollector> = createToken<ProcessMetricsCollector>('PMMetrics');
export const PM_HEALTH_TOKEN: Token<ProcessHealthChecker> = createToken<ProcessHealthChecker>('PMHealth');

/**
 * Default Process Manager configuration
 */
export const DEFAULT_PM_CONFIG: IProcessManagerConfig = {
  isolation: 'worker',
  transport: 'ipc',
  restartPolicy: {
    enabled: true,
    maxRestarts: 3,
    window: 60000,
    delay: 1000,
    backoff: {
      type: 'exponential',
      initial: 1000,
      max: 30000,
      factor: 2,
    },
  },
  resources: {
    maxMemory: '512MB',
    maxCpu: 1.0,
    timeout: 30000,
  },
  monitoring: {
    healthCheck: { interval: 30000, timeout: 5000 },
    metrics: true,
    tracing: false,
  },
  testing: {
    useMockSpawner: false,
  },
  advanced: {
    gracefulShutdownTimeout: 5000,
  },
};

/**
 * Process Manager Module
 *
 * @example
 * ```typescript
 * import { Application } from '@omnitron-dev/titan';
 * import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';
 *
 * const app = await Application.create({
 *   imports: [
 *     ProcessManagerModule.forRoot({
 *       netron: { transport: 'tcp' }
 *     })
 *   ]
 * });
 * ```
 */
@Module()
export class ProcessManagerModule {
  /**
   * Configure Process Manager module with options
   */
  static forRoot(options: IProcessManagerConfig = {}): DynamicModule {
    const config: IProcessManagerConfig = {
      ...DEFAULT_PM_CONFIG,
      ...options,
      restartPolicy: {
        ...DEFAULT_PM_CONFIG.restartPolicy,
        ...options.restartPolicy,
      },
      resources: {
        ...DEFAULT_PM_CONFIG.resources,
        ...options.resources,
      },
      monitoring: {
        ...DEFAULT_PM_CONFIG.monitoring,
        ...options.monitoring,
      },
      testing: {
        ...DEFAULT_PM_CONFIG.testing,
        ...options.testing,
      },
      advanced: {
        ...DEFAULT_PM_CONFIG.advanced,
        ...options.advanced,
      },
    };

    return {
      module: ProcessManagerModule,
      providers: [
        // Configuration
        [PM_CONFIG_TOKEN, { useValue: config }],

        // Core services
        [PM_REGISTRY_TOKEN, { useClass: ProcessRegistry }],
        [
          PM_SPAWNER_TOKEN,
          {
            useFactory: (logger: any, pmConfig: IProcessManagerConfig) =>
              ProcessSpawnerFactory.create(logger, pmConfig),
            inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN],
          },
        ],
        [
          PM_METRICS_TOKEN,
          {
            useFactory: (logger: any) => new ProcessMetricsCollector(logger),
            inject: [LOGGER_SERVICE_TOKEN],
          },
        ],
        [
          PM_HEALTH_TOKEN,
          {
            useFactory: (logger: any) => new ProcessHealthChecker(logger),
            inject: [LOGGER_SERVICE_TOKEN],
          },
        ],

        // Main Process Manager
        [
          PM_MANAGER_TOKEN,
          {
            useFactory: (logger: any, pmConfig: IProcessManagerConfig) => new ProcessManager(logger, pmConfig),
            inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN],
          },
        ],

        // Export alias
        [ProcessManager, { useExisting: PM_MANAGER_TOKEN }],
      ] as any,
      exports: [ProcessManager, PM_MANAGER_TOKEN, PM_REGISTRY_TOKEN, PM_METRICS_TOKEN, PM_HEALTH_TOKEN],
      global: true,
    };
  }

  /**
   * Configure Process Manager module asynchronously
   */
  static forRootAsync(options: {
    useFactory?: (...args: any[]) => Promise<IProcessManagerConfig> | IProcessManagerConfig;
    inject?: any[];
    useExisting?: any;
  }): DynamicModule {
    const providers: any[] = [];

    // Add config provider
    if (options.useFactory) {
      providers.push([
        PM_CONFIG_TOKEN,
        {
          useFactory: async (...args: any[]) => {
            const config = await options.useFactory!(...args);
            return {
              ...DEFAULT_PM_CONFIG,
              ...config,
            };
          },
          inject: options.inject || [],
        },
      ] as any);
    } else if (options.useExisting) {
      providers.push([PM_CONFIG_TOKEN, { useExisting: options.useExisting }] as any);
    }

    // Add service providers
    providers.push(
      [PM_REGISTRY_TOKEN, { useClass: ProcessRegistry }],
      [
        PM_SPAWNER_TOKEN,
        {
          useFactory: (logger: any, config: IProcessManagerConfig) => ProcessSpawnerFactory.create(logger, config),
          inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN],
        },
      ],
      [
        PM_METRICS_TOKEN,
        {
          useFactory: (logger: any) => new ProcessMetricsCollector(logger),
          inject: [LOGGER_SERVICE_TOKEN],
        },
      ],
      [
        PM_HEALTH_TOKEN,
        {
          useFactory: (logger: any) => new ProcessHealthChecker(logger),
          inject: [LOGGER_SERVICE_TOKEN],
        },
      ],
      [
        PM_MANAGER_TOKEN,
        {
          useFactory: (logger: any, config: IProcessManagerConfig) => new ProcessManager(logger, config),
          inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN],
        },
      ],
      [ProcessManager, { useExisting: PM_MANAGER_TOKEN }]
    );

    return {
      module: ProcessManagerModule,
      providers: providers as any,
      exports: [ProcessManager, PM_MANAGER_TOKEN, PM_REGISTRY_TOKEN, PM_METRICS_TOKEN, PM_HEALTH_TOKEN],
      global: true,
    };
  }
}
