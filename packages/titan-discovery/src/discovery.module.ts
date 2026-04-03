/**
 * Discovery Module for Titan Framework
 *
 * Provides service discovery capabilities as a Titan module.
 * Uses DynamicModule pattern for proper DI integration — all providers
 * are declared at module definition time, not in lifecycle hooks.
 */

import { Redis } from 'ioredis';
import { Module, Injectable } from '@omnitron-dev/titan/decorators';
import { IModule, IApplication } from '@omnitron-dev/titan';
import { createToken, type Token, type InjectionToken, type ProviderDefinition } from '@omnitron-dev/titan/nexus';
import type { DynamicModule } from '@omnitron-dev/titan/nexus';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { REDIS_MANAGER } from '@omnitron-dev/titan-redis';
import type { RedisManager } from '@omnitron-dev/titan-redis';
import { DiscoveryService } from './discovery.service.js';
import { NetronDiscoveryIntegration } from './netron-integration.js';
import {
  DISCOVERY_SERVICE_TOKEN,
  REDIS_TOKEN,
  LOGGER_TOKEN,
  DISCOVERY_OPTIONS_TOKEN,
  DiscoveryOptions,
  IDiscoveryService,
} from './types.js';

// Module configuration interface
export interface DiscoveryModuleOptions extends DiscoveryOptions {
  redisUrl?: string;
  redisOptions?: any;
  /**
   * Enable automatic Netron-Discovery integration.
   * When enabled, services exposed via Netron are automatically registered with Discovery.
   * Default: true
   */
  enableNetronIntegration?: boolean;
}

// Token for the module
export const DiscoveryModuleToken: Token<DiscoveryModule> = createToken<DiscoveryModule>('DiscoveryModule');

// Token for the Netron-Discovery integration
export const NETRON_DISCOVERY_INTEGRATION_TOKEN: Token<NetronDiscoveryIntegration> =
  createToken<NetronDiscoveryIntegration>('NetronDiscoveryIntegration');

/**
 * Discovery Module — DynamicModule pattern.
 *
 * All DI providers are declared upfront via `forRoot()`, ensuring they are
 * available during `eagerlyInitialize()`. Lifecycle hooks (`onStart`/`onStop`)
 * handle runtime operations only (heartbeats, Netron integration).
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRootAsync({ ... }),
 *     DiscoveryModule.forRoot(),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Injectable()
@Module({})
export class DiscoveryModule implements IModule {
  name = 'discovery';
  version = '1.0.0';

  private discoveryService?: IDiscoveryService;
  private netronIntegration?: NetronDiscoveryIntegration;
  private logger?: ILogger;

  /**
   * Create a DynamicModule with all providers declared upfront.
   *
   * REDIS_TOKEN bridging:
   * - If `redisUrl` or `redisOptions` provided → standalone Redis connection
   * - Otherwise → bridges to existing `REDIS_MANAGER` from `RedisModule`
   */
  static forRoot(options: DiscoveryModuleOptions = {}): DynamicModule {
    const mergedOptions: DiscoveryModuleOptions = {
      enableNetronIntegration: true,
      ...options,
    };

    // Redis provider: standalone or bridged from RedisModule
    const redisProvider: [InjectionToken<unknown>, ProviderDefinition<unknown>] =
      options.redisUrl || options.redisOptions
        ? [
            REDIS_TOKEN,
            {
              useFactory: () => new Redis(options.redisUrl || options.redisOptions),
            },
          ]
        : [
            REDIS_TOKEN,
            {
              useFactory: (manager: unknown): Redis => (manager as RedisManager).getInternalClient() as Redis,
              inject: [REDIS_MANAGER] as InjectionToken<unknown>[],
            },
          ];

    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>]> = [
      [DISCOVERY_OPTIONS_TOKEN, { useValue: mergedOptions }],
      redisProvider,
      [DISCOVERY_SERVICE_TOKEN, { useClass: DiscoveryService }],
    ];

    if (mergedOptions.enableNetronIntegration !== false) {
      providers.push([NETRON_DISCOVERY_INTEGRATION_TOKEN, { useClass: NetronDiscoveryIntegration }]);
    }

    return {
      module: DiscoveryModule,
      providers,
      exports: [DISCOVERY_SERVICE_TOKEN, NETRON_DISCOVERY_INTEGRATION_TOKEN],
    };
  }

  /**
   * Start heartbeats and Netron integration (runtime-only, no DI registration).
   */
  async onStart(app: IApplication): Promise<void> {
    // Resolve logger
    try {
      this.logger = app.resolve(LOGGER_TOKEN);
    } catch {
      // Logger not available — proceed silently
    }

    // Start discovery service heartbeats
    this.discoveryService = app.resolve(DISCOVERY_SERVICE_TOKEN);
    await this.discoveryService.onStart();

    // Resolve options from container (not instance state — instance is created by framework)
    const opts = app.resolve(DISCOVERY_OPTIONS_TOKEN) as DiscoveryModuleOptions;

    // Initialize Netron-Discovery integration if enabled
    if (opts.enableNetronIntegration !== false) {
      try {
        this.netronIntegration = app.resolve(NETRON_DISCOVERY_INTEGRATION_TOKEN);
        if (typeof this.netronIntegration.onModuleInit === 'function') {
          await this.netronIntegration.onModuleInit();
        }
        this.logger?.info('Netron-Discovery integration initialized');
      } catch (error) {
        // Integration is optional — Netron may not be available
        this.logger?.debug?.({ error }, 'Netron-Discovery integration not initialized (Netron may not be available)');
      }
    }

    this.logger?.info('DiscoveryModule started');
  }

  /**
   * Stop discovery service and clean up.
   */
  async onStop(_app: IApplication): Promise<void> {
    // Clean up Netron integration
    if (this.netronIntegration) {
      try {
        if (typeof this.netronIntegration.onModuleDestroy === 'function') {
          await this.netronIntegration.onModuleDestroy();
        }
      } catch (error) {
        this.logger?.error?.({ error }, 'Error stopping Netron-Discovery integration');
      }
    }

    if (this.discoveryService) {
      await this.discoveryService.onStop();
    }

    this.logger?.info('DiscoveryModule stopped');
  }

  /**
   * Get the discovery service instance
   */
  getService(): IDiscoveryService | undefined {
    return this.discoveryService;
  }

  /**
   * Get the Netron-Discovery integration instance
   */
  getNetronIntegration(): NetronDiscoveryIntegration | undefined {
    return this.netronIntegration;
  }
}

/**
 * Factory function for creating a discovery module
 */
export function createDiscoveryModule(options: DiscoveryModuleOptions = {}): DynamicModule {
  return DiscoveryModule.forRoot(options);
}
