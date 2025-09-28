/**
 * Process Manager Module
 *
 * Provides process management capabilities with Netron integration,
 * treating every process as a service with full type safety.
 */

import type { DynamicModule } from '../../nexus/index.js';
import { Module } from '../../decorators/index.js';
import { ProcessManager } from './process-manager.js';
import { ProcessRegistry } from './process-registry.js';
import { ProcessSpawner } from './process-spawner.js';
import { ProcessMetricsCollector } from './process-metrics.js';
import { ProcessHealthChecker } from './process-health.js';
import { LoggerService } from '../logger/logger.service.js';
import { LOGGER_SERVICE_TOKEN } from '../logger/logger.tokens.js';

import type { IProcessManagerConfig } from './types.js';

/**
 * Process Manager module tokens
 */
export const PM_CONFIG_TOKEN = Symbol('PM_CONFIG_TOKEN');
export const PM_MANAGER_TOKEN = Symbol('PM_MANAGER_TOKEN');
export const PM_REGISTRY_TOKEN = Symbol('PM_REGISTRY_TOKEN');
export const PM_SPAWNER_TOKEN = Symbol('PM_SPAWNER_TOKEN');
export const PM_METRICS_TOKEN = Symbol('PM_METRICS_TOKEN');
export const PM_HEALTH_TOKEN = Symbol('PM_HEALTH_TOKEN');

/**
 * Default Process Manager configuration
 */
export const DEFAULT_PM_CONFIG: IProcessManagerConfig = {
  netron: {
    discovery: 'local',
    transport: 'unix',
    compression: false,
    encryption: false
  },
  process: {
    restartPolicy: {
      enabled: true,
      maxRestarts: 3,
      window: 60000,
      delay: 1000,
      backoff: {
        type: 'exponential',
        initial: 1000,
        max: 30000,
        factor: 2
      }
    },
    maxMemory: '512MB',
    timeout: 30000,
    isolation: 'none'
  },
  monitoring: {
    metrics: true,
    tracing: false,
    profiling: false,
    logs: 'console'
  },
  integrations: {
    scheduler: true,
    notifications: false,
    redis: false
  }
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
    const config = {
      ...DEFAULT_PM_CONFIG,
      ...options,
      netron: {
        ...DEFAULT_PM_CONFIG.netron,
        ...options.netron
      },
      process: {
        ...DEFAULT_PM_CONFIG.process,
        ...options.process
      },
      monitoring: {
        ...DEFAULT_PM_CONFIG.monitoring,
        ...options.monitoring
      },
      integrations: {
        ...DEFAULT_PM_CONFIG.integrations,
        ...options.integrations
      }
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
            useFactory: (logger: any, config: IProcessManagerConfig) => {
              return new ProcessSpawner(logger, config);
            },
            inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN]
          }
        ],
        [
          PM_METRICS_TOKEN,
          {
            useFactory: (logger: any) => {
              return new ProcessMetricsCollector(logger);
            },
            inject: [LOGGER_SERVICE_TOKEN]
          }
        ],
        [
          PM_HEALTH_TOKEN,
          {
            useFactory: (logger: any) => {
              return new ProcessHealthChecker(logger);
            },
            inject: [LOGGER_SERVICE_TOKEN]
          }
        ],

        // Main Process Manager
        [
          PM_MANAGER_TOKEN,
          {
            useFactory: (logger: any, config: IProcessManagerConfig) => {
              return new ProcessManager(logger, config);
            },
            inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN]
          }
        ],

        // Export alias
        [ProcessManager, { useExisting: PM_MANAGER_TOKEN }]
      ] as any,
      exports: [
        ProcessManager,
        PM_MANAGER_TOKEN,
        PM_REGISTRY_TOKEN,
        PM_METRICS_TOKEN,
        PM_HEALTH_TOKEN
      ],
      global: true
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
              ...config
            };
          },
          inject: options.inject || []
        }
      ] as any);
    } else if (options.useExisting) {
      providers.push([
        PM_CONFIG_TOKEN,
        { useExisting: options.useExisting }
      ] as any);
    }

    // Add service providers
    providers.push(
      [PM_REGISTRY_TOKEN, { useClass: ProcessRegistry }],
      [
        PM_SPAWNER_TOKEN,
        {
          useFactory: (logger: any, config: IProcessManagerConfig) => {
            return new ProcessSpawner(logger, config);
          },
          inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN]
        }
      ],
      [
        PM_METRICS_TOKEN,
        {
          useFactory: (logger: any) => {
            return new ProcessMetricsCollector(logger);
          },
          inject: [LOGGER_SERVICE_TOKEN]
        }
      ],
      [
        PM_HEALTH_TOKEN,
        {
          useFactory: (logger: any) => {
            return new ProcessHealthChecker(logger);
          },
          inject: [LOGGER_SERVICE_TOKEN]
        }
      ],
      [
        PM_MANAGER_TOKEN,
        {
          useFactory: (logger: any, config: IProcessManagerConfig) => {
            return new ProcessManager(logger, config);
          },
          inject: [LOGGER_SERVICE_TOKEN, PM_CONFIG_TOKEN]
        }
      ],
      [ProcessManager, { useExisting: PM_MANAGER_TOKEN }]
    );

    return {
      module: ProcessManagerModule,
      providers: providers as any,
      exports: [
        ProcessManager,
        PM_MANAGER_TOKEN,
        PM_REGISTRY_TOKEN,
        PM_METRICS_TOKEN,
        PM_HEALTH_TOKEN
      ],
      global: true
    };
  }
}